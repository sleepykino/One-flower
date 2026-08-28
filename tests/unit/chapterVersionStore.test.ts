/**
 * ChapterVersionStore 自动 GC 行为（批次2建议3）
 * - 保存链路每满 N 次（默认 50）自动触发一次 gc，保留最近 50 版 + 每日 1 版
 * - 内容无变化的保存不落版本、也不计入触发计数
 *
 * 复用 dbMigrations.test.ts 的 node:sqlite 适配器模式，直接跑生产代码。
 * 依赖：Node >= 22.5（node:sqlite）。
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { Database } from '../../src/db/Database';
import { WriteQueue } from '../../src/db/WriteQueue';
import { ChapterVersionStore } from '../../src/services/chapter/ChapterVersionStore';
import type { DatabaseAdapter, NativeBridge, Transaction } from '../../src/native/NativeBridge';
import type { ProseMirrorDoc } from '../../src/types';
import { docToPlainText } from '../../src/utils/pmdoc';

/** node:sqlite 实现 DatabaseAdapter（与 dbMigrations.test.ts 相同） */
class SqliteAdapter implements DatabaseAdapter {
  constructor(private db: DatabaseSync) {}

  async exec(sql: string, params?: unknown[]): Promise<void> {
    if (!params || params.length === 0) {
      this.db.exec(sql);
      return;
    }
    this.db.prepare(sql).run(...(params as (string | number | null)[]));
  }

  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    const rows = params && params.length > 0 ? stmt.all(...(params as (string | number | null)[])) : stmt.all();
    return rows as T[];
  }

  async queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    const rows = await this.query<T>(sql, params);
    return rows[0] ?? null;
  }

  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    this.db.exec('BEGIN');
    try {
      const tx: Transaction = {
        exec: (sql, params) => this.exec(sql, params),
        query: (sql, params) => this.query(sql, params)
      };
      const result = await fn(tx);
      this.db.exec('COMMIT');
      return result;
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
  }
}

function setup(): { adapter: SqliteAdapter; store: ChapterVersionStore } {
  const raw = new DatabaseSync(':memory:');
  const adapter = new SqliteAdapter(raw);
  raw.exec(`CREATE TABLE chapter_versions (
    id TEXT PRIMARY KEY,
    chapter_id TEXT NOT NULL,
    diff_json TEXT NOT NULL,
    word_count INTEGER,
    created_at INTEGER NOT NULL
  )`);
  const db = new Database({ db: adapter } as unknown as NativeBridge);
  const wq = new WriteQueue(adapter);
  const store = new ChapterVersionStore({} as unknown as NativeBridge, db, wq);
  return { adapter, store };
}

function doc(text: string): ProseMirrorDoc {
  return {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text }] }]
  } as unknown as ProseMirrorDoc;
}

async function versionCount(adapter: SqliteAdapter): Promise<number> {
  const rows = await adapter.query<{ n: number }>('SELECT COUNT(*) AS n FROM chapter_versions');
  return Number(rows[0]?.n ?? 0);
}

async function waitFor(pred: () => Promise<boolean>, timeoutMs = 3000): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await pred()) return;
    await new Promise((r) => setTimeout(r, 10));
  }
  throw new Error('waitFor 超时');
}

describe('ChapterVersionStore 自动 GC（批次2建议3）', () => {
  it('每满 50 次保存自动触发一次 gc：旧版本压缩到「最近 50 版 + 每日 1 版」', async () => {
    const { adapter, store } = setup();

    // 预置 55 条同一天旧版本（时间戳远早于后续自动保存）
    for (let i = 0; i < 55; i++) {
      await adapter.exec(
        'INSERT INTO chapter_versions (id, chapter_id, diff_json, word_count, created_at) VALUES (?, ?, ?, ?, ?)',
        [`old-${i}`, 'c1', '{}', 1, 1_000_000 + i]
      );
    }

    // 前 49 次保存：只增不减，不触发 gc
    for (let i = 0; i < 49; i++) {
      await store.saveVersion('c1', doc(`第 ${i + 1} 次`));
    }
    expect(await versionCount(adapter)).toBe(55 + 49);

    // 第 50 次保存：自动触发 gc（fire-and-forget），等清理落库
    await store.saveVersion('c1', doc('第 50 次'));
    await waitFor(async () => (await versionCount(adapter)) === 51);
  });

  it('内容无变化的保存不落版本、不计入触发计数', async () => {
    const { adapter, store } = setup();
    await store.saveVersion('c1', doc('a'));
    await store.saveVersion('c1', doc('a')); // 与上一版一致 → 不落版本
    expect(await versionCount(adapter)).toBe(1);
  });

  it('restore 后最新文档缓存同步：随后保存基于被恢复的文档做 delta（批次2建议2）', async () => {
    // 独立环境：补齐 books/chapters/chapters_fts + fs mock，使 restore 可运行
    const raw = new DatabaseSync(':memory:');
    const adapter = new SqliteAdapter(raw);
    raw.exec(`CREATE TABLE chapter_versions (
      id TEXT PRIMARY KEY,
      chapter_id TEXT NOT NULL,
      diff_json TEXT NOT NULL,
      word_count INTEGER,
      created_at INTEGER NOT NULL
    )`);
    raw.exec('CREATE TABLE books (id TEXT PRIMARY KEY, storage_dir TEXT NOT NULL)');
    raw.exec(
      'CREATE TABLE chapters (id TEXT PRIMARY KEY, book_id TEXT NOT NULL, title TEXT, content_path TEXT, word_count INTEGER DEFAULT 0, updated_at INTEGER DEFAULT 0)'
    );
    raw.exec(
      'CREATE TABLE chapters_fts (chapter_id TEXT PRIMARY KEY, book_id TEXT, title TEXT, content TEXT)'
    );
    raw.exec("INSERT INTO books (id, storage_dir) VALUES ('b1', '/appdata/books/b1')");
    raw.exec("INSERT INTO chapters (id, book_id, title, content_path) VALUES ('c1', 'b1', '一章', '/appdata/books/b1/chapters/c1.json')");

    const bridge = { fs: { writeFile: async (): Promise<void> => {} } } as unknown as NativeBridge;
    const wq = new WriteQueue(adapter);
    const store = new ChapterVersionStore(bridge, new Database({ db: adapter } as unknown as NativeBridge), wq);

    const multiDoc = (texts: string[]): ProseMirrorDoc =>
      ({
        type: 'doc',
        content: texts.map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] }))
      }) as unknown as ProseMirrorDoc;

    await store.saveVersion('c1', multiDoc(['前'])); // full
    await new Promise((r) => setTimeout(r, 5)); // 保证 created_at 递增，链序稳定
    await store.saveVersion('c1', multiDoc(['前', '中'])); // delta 前→[前,中]
    await new Promise((r) => setTimeout(r, 5));
    const metas = await store.listVersions('c1'); // 最新在前
    const firstId = metas[metas.length - 1].id; // 最初的 full 版本
    await store.restore(firstId); // 恢复为 ['前']，应同步缓存
    await new Promise((r) => setTimeout(r, 5));
    await store.saveVersion('c1', multiDoc(['前', '中', '后'])); // 应基于恢复后的 ['前'] 出 delta
    const latestDoc = await store.getVersion((await store.listVersions('c1'))[0].id);
    // 若缓存未随 restore 刷新（仍为 ['前','中']），delta 会缺失 '中' → 重建结果错误
    expect(docToPlainText(latestDoc)).toBe('前\n\n中\n\n后');
  });
});