/**
 * 数据库迁移全量自检（真实 SQLite 执行）
 *
 * 用 Node 24 内置的 node:sqlite 实现 DatabaseAdapter，直接跑生产代码
 * Database.runMigrations()，对迁移 1..N 做真实执行级校验：
 *   - MIGRATIONS 数组与迁移文件一致性
 *   - 从 v0 全量应用后 schema 快照（表 + 列）符合预期
 *   - 幂等性：已是最新版本时重复运行无副作用
 *   - 恢复场景：user_version 落后于实际 schema（如恢复旧备份）时自愈不报错
 *   - 增量升级：旧库（只到 v5）升到最新正常补全缺失表
 *
 * 依赖：Node >= 22.5（node:sqlite）。无需任何 npm 依赖。
 */
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { describe, expect, it } from 'vitest';
import { Database, MIGRATIONS, extractAddedColumns } from '../../src/db/Database';
import type { DatabaseAdapter, NativeBridge, Transaction } from '../../src/native/NativeBridge';

/** node:sqlite 实现 DatabaseAdapter，让真实 runMigrations 在单测中可运行 */
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

  /** 当前 user_version */
  userVersion(): number {
    const row = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    return Number(row?.user_version ?? 0);
  }

  /** 所有表名（含 FTS5 影子表） */
  tables(): string[] {
    const rows = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    return rows.map((r) => r.name);
  }

  /** 指定表的列名 */
  columns(table: string): string[] {
    const rows = this.db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
    return rows.map((r) => r.name);
  }
}

/** 用真实 Database 跑迁移 */
function makeDatabase() {
  const db = new DatabaseSync(':memory:');
  const adapter = new SqliteAdapter(db);
  const dbInstance = new Database({ db: adapter } as unknown as NativeBridge);
  return { db, adapter, dbInstance };
}

/** 仅应用前 maxVersion 个迁移（模拟旧版本库） */
async function applyUpTo(adapter: DatabaseAdapter, maxVersion: number): Promise<void> {
  for (const m of MIGRATIONS) {
    if (m.version > maxVersion) break;
    await adapter.transaction(async (tx) => {
      await tx.exec(m.sql);
      await tx.exec(`PRAGMA user_version = ${m.version}`);
    });
  }
}

/** 迁移 1..N 建出的全部业务表（不含 FTS5 影子表） */
const EXPECTED_TABLES = [
  'books',
  'chapters',
  'characters',
  'character_schemas',
  'worldbook_entries',
  'chapter_versions',
  'foreshadowings',
  'chapters_fts',
  'provider_configs',
  'skills_cache',
  'relationships',
  'writing_stats',
  'writing_goals',
  'worldbook_embeddings',
  'app_settings',
  'maps',
  'timeline_events',
  'chapter_segments',
  'chapter_segments_embeddings',
  'chapter_summary_embeddings',
  'name_favorites',
  'setting_facts',
  'setting_inferences',
  'longform_sessions',
  'inspirations',
  'interview_sessions',
  'images',
  'map_assets',
  'screenplays'
];

/** 各迁移 ADD COLUMN 累计出的关键列（表 -> 列集合） */
const EXPECTED_COLUMNS: Record<string, string[]> = {
  books: ['deleted_at', 'pinned', 'sort_order'],
  chapters: ['summary_generated_at', 'summary_source_words', 'beats'],
  provider_configs: ['is_default'],
  worldbook_entries: ['enabled'],
  longform_sessions: ['hints', 'character_ids', 'seams']
};

/** 各迁移预期 ADD COLUMN 数（验证 extractAddedColumns 解析正确） */
const EXPECTED_ADD_COLUMN_COUNTS: Record<number, number> = {
  1: 0,
  2: 2,
  3: 0,
  4: 1,
  5: 0,
  6: 0,
  7: 1,
  8: 0,
  9: 0,
  10: 1,
  11: 3,
  12: 2,
  13: 1,
  14: 0
};

describe('迁移注册一致性', () => {
  it('MIGRATIONS 版本号从 1 严格递增、无跳号无重复', () => {
    const versions = MIGRATIONS.map((m) => m.version);
    expect(versions).toEqual(Array.from({ length: versions.length }, (_, i) => i + 1));
  });

  it('每个迁移 SQL 非空，且 migrations 目录文件数与 MIGRATIONS 一致', () => {
    for (const m of MIGRATIONS) {
      expect(m.sql.trim().length, `migration v${m.version} 为空`).toBeGreaterThan(0);
    }
    const dir = fileURLToPath(new URL('../../src/db/migrations', import.meta.url));
    const files = readdirSync(dir).filter((f) => f.endsWith('.sql'));
    expect(files).toHaveLength(MIGRATIONS.length);
  });

  it('extractAddedColumns 能解析出各迁移的全部 ADD COLUMN 目标', () => {
    for (const m of MIGRATIONS) {
      const targets = extractAddedColumns(m.sql);
      expect(targets.length, `migration v${m.version} ADD COLUMN 数不符`).toBe(
        EXPECTED_ADD_COLUMN_COUNTS[m.version]
      );
      for (const t of targets) {
        expect(t.table).toMatch(/^[A-Za-z_][\w-]*$/);
        expect(t.column).toMatch(/^[A-Za-z_][\w-]*$/);
      }
    }
  });
});

describe('全量迁移（v0 -> 最新）', () => {
  it('顺序执行全部迁移后 user_version 达到最新且 schema 符合预期', async () => {
    const { adapter, dbInstance } = makeDatabase();
    await dbInstance.runMigrations();

    expect(adapter.userVersion()).toBe(MIGRATIONS.length);

    const tables = adapter.tables();
    for (const t of EXPECTED_TABLES) {
      expect(tables, `缺少表 ${t}`).toContain(t);
    }
    for (const [table, cols] of Object.entries(EXPECTED_COLUMNS)) {
      const actual = adapter.columns(table);
      for (const c of cols) {
        expect(actual, `表 ${table} 缺少列 ${c}`).toContain(c);
      }
    }

    // FTS5 真实可用（生产检索依赖 chapters_fts）。
    // 注：tokenizer 为 unicode61，对 CJK 按整串分词，故用单词级检索验证引擎可用。
    adapter.exec(
      "INSERT INTO chapters_fts (chapter_id, book_id, title, content) VALUES ('c1', 'b1', 'morning', 'the quick brown fox jumps')"
    );
    const hit = await adapter.query<{ chapter_id: string }>(
      "SELECT chapter_id FROM chapters_fts WHERE chapters_fts MATCH 'fox'"
    );
    expect(hit.map((r) => r.chapter_id)).toContain('c1');
  });

  it('已是最新版本时重复运行无副作用、不报错', async () => {
    const { adapter, dbInstance } = makeDatabase();
    await dbInstance.runMigrations();
    const tablesBefore = adapter.tables().sort();
    await dbInstance.runMigrations();
    expect(adapter.userVersion()).toBe(MIGRATIONS.length);
    expect(adapter.tables().sort()).toEqual(tablesBefore);
  });
});

describe('迁移幂等性 / 恢复场景', () => {
  it('user_version 被重置为 0（schema 却已是最新）时自愈到最新、不抛 duplicate column', async () => {
    const { adapter, dbInstance } = makeDatabase();
    await dbInstance.runMigrations();
    adapter.exec('PRAGMA user_version = 0');

    await expect(dbInstance.runMigrations()).resolves.toBeUndefined();
    expect(adapter.userVersion()).toBe(MIGRATIONS.length);
    for (const t of EXPECTED_TABLES) {
      expect(adapter.tables()).toContain(t);
    }
  });

  it('user_version 落后于实际 schema（如恢复到 v5）时自愈到最新', async () => {
    const { adapter, dbInstance } = makeDatabase();
    await dbInstance.runMigrations();
    adapter.exec('PRAGMA user_version = 5');

    await expect(dbInstance.runMigrations()).resolves.toBeUndefined();
    expect(adapter.userVersion()).toBe(MIGRATIONS.length);
  });
});

describe('增量升级（旧库 -> 最新）', () => {
  it('旧库只到 v5 时，升级补全 6..N 的表且不丢旧表', async () => {
    const { adapter, dbInstance } = makeDatabase();
    await applyUpTo(adapter, 5);
    expect(adapter.userVersion()).toBe(5);

    await dbInstance.runMigrations();
    expect(adapter.userVersion()).toBe(MIGRATIONS.length);

    const tables = adapter.tables();
    for (const t of EXPECTED_TABLES) {
      expect(tables, `缺少表 ${t}`).toContain(t);
    }
    // v6+ 新增表确实被创建
    for (const t of ['images', 'map_assets', 'screenplays']) {
      expect(tables).toContain(t);
    }
  });
});
