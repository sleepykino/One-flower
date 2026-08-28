/**
 * 批次5建议1（2026-08-29）：删除联动级联清理 + 一次性存量孤儿清理
 *
 * 用 Node 24 node:sqlite 真实执行迁移后，验证各删除点的事务内级联清理：
 *   - CharacterService.remove：relationships / setting_facts(source=character) / timeline_events.character_ids 摘除
 *   - ChapterService.remove：setting_facts(source=chapter) / foreshadowings 章节引用置 NULL / timeline_events.chapter_id 置 NULL
 *   - BookService.purge：补齐 relationships/timeline_events/setting_facts/setting_inferences/worldbook_embeddings
 *   - BookService.sweepOrphans：一次性存量清理（setting_facts 悬空 source_ref / timeline 角色摘除 / 伏笔章节引用置 NULL）
 *
 * 依赖：Node >= 22.5（node:sqlite）。FK 在 db.rs 打开时置 ON，此处同样打开以贴近生产。
 */
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { Database } from '../../src/db/Database';
import { WriteQueue } from '../../src/db/WriteQueue';
import { BookService } from '../../src/services/book/BookService';
import { ChapterService } from '../../src/services/chapter/ChapterService';
import { CharacterService } from '../../src/services/character/CharacterService';
import type { DatabaseAdapter, NativeBridge, Transaction } from '../../src/native/NativeBridge';

const { MIGRATIONS } = await import('../../src/db/Database');

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

function makeDb(): { db: Database; raw: DatabaseSync; bridge: NativeBridge } {
  const raw = new DatabaseSync(':memory:');
  raw.exec('PRAGMA foreign_keys = ON');
  const adapter = new SqliteAdapter(raw);
  // 直接跑生产迁移 1..13
  for (const m of MIGRATIONS) {
    adapter.exec(m.sql);
  }
  const bridge = {
    db: adapter,
    storage: { appDataDir: async () => '/appdata' },
    fs: { deletePath: async () => undefined }
  } as unknown as NativeBridge;
  const db = new Database(bridge);
  return { db, raw, bridge };
}

function makeServices(db: Database, raw: DatabaseSync, bridge: NativeBridge) {
  const wq = new WriteQueue(bridge.db as unknown as DatabaseAdapter);
  const chapterService = new ChapterService(bridge, db, wq, null as never);
  const characterService = new CharacterService(bridge, db, wq);
  const bookService = new BookService(bridge, db, wq);
  return { wq, chapterService, characterService, bookService };
}

/** 种子：一本书 + 2 章 + 2 角色 + 1 关系 + 若干事实 + 时间线 + 伏笔 + 世界书 */
function seed(ctx: { raw: DatabaseSync }) {
  const { raw } = ctx;
  const now = Date.now();
  const ins = (sql: string, params: unknown[]) => raw.prepare(sql).run(...(params as (string | number | null)[]));
  ins('INSERT INTO books (id, title, genre, storage_dir, created_at, updated_at) VALUES (?,?,?,?,?,?)', ['b1', 'B', 'g', '/books/b1', now, now]);
  ins('INSERT INTO chapters (id, book_id, title, sort_order, word_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', ['c1', 'b1', 'C1', 0, 0, now, now]);
  ins('INSERT INTO chapters (id, book_id, title, sort_order, word_count, created_at, updated_at) VALUES (?,?,?,?,?,?,?)', ['c2', 'b1', 'C2', 1, 0, now, now]);
  ins('INSERT INTO characters (id, book_id, name, data, created_at, updated_at) VALUES (?,?,?,?,?,?)', ['ch1', 'b1', '甲', '{}', now, now]);
  ins('INSERT INTO characters (id, book_id, name, data, created_at, updated_at) VALUES (?,?,?,?,?,?)', ['ch2', 'b1', '乙', '{}', now, now]);
  ins('INSERT INTO relationships (id, book_id, from_character_id, to_character_id, type, created_at) VALUES (?,?,?,?,?,?)', ['r1', 'b1', 'ch1', 'ch2', 'friend', now]);
  ins('INSERT INTO worldbook_entries (id, book_id, title, content, created_at, updated_at) VALUES (?,?,?,?,?,?)', ['w1', 'b1', 'W1', '内容', now, now]);
  ins('INSERT INTO worldbook_embeddings (entry_id, book_id, embedding, dim, updated_at) VALUES (?,?,?,?,?)', ['w1', 'b1', 'aGVsbG8=', 4, now]);
  ins('INSERT INTO setting_facts (id, book_id, kind, domain, fact, basis, source, source_ref, created_at) VALUES (?,?,?,?,?,?,?,?,?)', ['f1', 'b1', 'object', 'd', 'F1', 'basis', 'character', 'ch1', now]);
  ins('INSERT INTO setting_facts (id, book_id, kind, domain, fact, basis, source, source_ref, created_at) VALUES (?,?,?,?,?,?,?,?,?)', ['f2', 'b1', 'object', 'd', 'F2', 'basis', 'worldbook', 'w1', now]);
  ins('INSERT INTO setting_facts (id, book_id, kind, domain, fact, basis, source, source_ref, created_at) VALUES (?,?,?,?,?,?,?,?,?)', ['f3', 'b1', 'object', 'd', 'F3', 'basis', 'chapter', 'c1', now]);
  ins('INSERT INTO setting_inferences (id, fact_id, book_id, premise, conclusion, created_at) VALUES (?,?,?,?,?,?)', ['i1', 'f1', 'b1', 'p', 'c', now]);
  ins('INSERT INTO timeline_events (id, book_id, title, sort_order, chapter_id, character_ids, created_at) VALUES (?,?,?,?,?,?,?)', ['t1', 'b1', 'T1', 0, 'c1', JSON.stringify(['ch1', 'ch2']), now]);
  ins('INSERT INTO foreshadowings (id, book_id, description, planted_chapter_id, created_at) VALUES (?,?,?,?,?)', ['fw1', 'b1', '伏笔', 'c1', now]);
  return { now };
}

describe('批次5建议1：删除联动级联清理', () => {
  it('CharacterService.remove：删角色级联 relationships、setting_facts(source=character)、timeline character_ids 摘除', async () => {
    const { db, raw, bridge } = makeDb();
    const { characterService } = makeServices(db, raw, bridge);
    seed({ raw });
    await characterService.remove('ch1');
    const rel = raw.prepare('SELECT COUNT(*) AS n FROM relationships').get() as { n: number };
    expect(rel.n).toBe(0);
    const charFacts = raw.prepare("SELECT COUNT(*) AS n FROM setting_facts WHERE source='character'").get() as { n: number };
    expect(charFacts.n).toBe(0);
    const infer = raw.prepare('SELECT COUNT(*) AS n FROM setting_inferences').get() as { n: number };
    expect(infer.n).toBe(0); // FK 级联
    const ev = raw.prepare("SELECT character_ids AS c FROM timeline_events WHERE id='t1'").get() as { c: string };
    expect(JSON.parse(ev.c)).toEqual(['ch2']); // 事件保留，仅摘除 ch1
    const other = raw.prepare("SELECT COUNT(*) AS n FROM setting_facts WHERE source='worldbook'").get() as { n: number };
    expect(other.n).toBe(1); // 不动世界书事实
  });

  it('ChapterService.remove：删章节级联 setting_facts(source=chapter)、伏笔章节引用置 NULL、timeline chapter_id 置 NULL', async () => {
    const { db, raw, bridge } = makeDb();
    const { chapterService } = makeServices(db, raw, bridge);
    seed({ raw });
    await chapterService.remove('c1');
    const chFacts = raw.prepare("SELECT COUNT(*) AS n FROM setting_facts WHERE source='chapter'").get() as { n: number };
    expect(chFacts.n).toBe(0);
    const fw = raw.prepare("SELECT planted_chapter_id AS p FROM foreshadowings WHERE id='fw1'").get() as { p: string | null };
    expect(fw.p).toBeNull();
    const ev = raw.prepare("SELECT chapter_id AS c FROM timeline_events WHERE id='t1'").get() as { c: string | null };
    expect(ev.c).toBeNull();
    const c2 = raw.prepare("SELECT COUNT(*) AS n FROM chapters WHERE id='c2'").get() as { n: number };
    expect(c2.n).toBe(1); // 只删 c1 与其子孙，不动兄弟章
  });

  it('BookService.purge：补齐 relationships/timeline_events/setting_facts/setting_inferences/worldbook_embeddings 清理', async () => {
    const { db, raw, bridge } = makeDb();
    const { bookService } = makeServices(db, raw, bridge);
    seed({ raw });
    await bookService.purge('b1');
    for (const table of [
      'relationships',
      'timeline_events',
      'setting_facts',
      'setting_inferences',
      'worldbook_embeddings',
      'worldbook_entries',
      'characters',
      'chapters',
      'foreshadowings'
    ]) {
      const r = raw.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number };
      expect(r.n, `${table} 应清空`).toBe(0);
    }
    const books = raw.prepare('SELECT COUNT(*) AS n FROM books').get() as { n: number };
    expect(books.n).toBe(0);
  });

  it('BookService.sweepOrphans：一次性存量清理悬空 setting_facts + timeline 角色摘除 + 伏笔章节引用置 NULL', async () => {
    const { db, raw, bridge } = makeDb();
    const { bookService } = makeServices(db, raw, bridge);
    seed({ raw });
    // 制造存量孤儿：删掉 source 对应行但留下 facts / 时间线角色 / 伏笔章节引用
    raw.prepare("DELETE FROM worldbook_entries WHERE id='w1'").run();
    raw.prepare("DELETE FROM characters WHERE id='ch1'").run();
    raw.prepare("DELETE FROM chapters WHERE id='c1'").run();
    raw.prepare("INSERT INTO timeline_events (id, book_id, title, sort_order, character_ids, created_at) VALUES ('t2','b1','孤儿',1,JSON_ARRAY('ghost'),?)").run(Date.now());
    raw.prepare("INSERT INTO foreshadowings (id, book_id, description, planted_chapter_id, created_at) VALUES ('fw2','b1','孤儿伏笔','ghost-ch',?)").run(Date.now());

    const res = await bookService.sweepOrphans();
    const facts = raw.prepare('SELECT COUNT(*) AS n FROM setting_facts').get() as { n: number };
    expect(facts.n).toBe(0); // f1/f2/f3 全部悬空被清（ch1/w1/c1 已删）
    const ghost = raw.prepare("SELECT character_ids AS c FROM timeline_events WHERE id='t2'").get() as { c: string };
    expect(JSON.parse(ghost.c)).toEqual([]);
    const fw2 = raw.prepare("SELECT planted_chapter_id AS p FROM foreshadowings WHERE id='fw2'").get() as { p: string | null };
    expect(fw2.p).toBeNull();
    expect(res.clearedFacts).toBe(3);
    // fw1 指向已删 c1 + fw2 指向 ghost-ch = 2 个伏笔被清理
    expect(res.clearedForeshadows).toBe(2);
    // t1 摘除已删 ch1 + t2 摘除 ghost = 2 个事件被清理
    expect(res.clearedEvents).toBe(2);
  });
});
