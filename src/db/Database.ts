/**
 * 数据库连接管理：初始化（Rust 侧持连接）+ 迁移机制
 * 迁移策略：PRAGMA user_version 记录版本，按序执行 migrations
 */

import type { DatabaseAdapter, NativeBridge, Transaction } from '../native/NativeBridge';
import initSql from './migrations/001_init.sql?raw';
import p1Sql from './migrations/002_p1_additions.sql?raw';
import p2Sql from './migrations/003_p2_additions.sql?raw';
import p21Sql from './migrations/004_p21_additions.sql?raw';
import p21bSql from './migrations/005_p2_1b_inspiration.sql?raw';
import p3Sql from './migrations/006_p3_additions.sql?raw';
import p31Sql from './migrations/007_default_provider.sql?raw';
import p41Sql from './migrations/008_p41_map_assets.sql?raw';
import p5Sql from './migrations/009_p5_screenplay.sql?raw';
import wbEnabledSql from './migrations/010_worldbook_enabled.sql?raw';
import p6Sql from './migrations/011_p6_bookshelf.sql?raw';
import lfEnhSql from './migrations/012_longform_hints.sql?raw';
import lfSeamsSql from './migrations/013_longform_seams.sql?raw';
import aiUsageSql from './migrations/014_ai_usage.sql?raw';
import outlineInjectSql from './migrations/015_outline_inject.sql?raw';
import notesSql from './migrations/016_notes.sql?raw';

interface Migration {
  version: number;
  sql: string;
}

export const MIGRATIONS: Migration[] = [
  { version: 1, sql: initSql },
  { version: 2, sql: p1Sql },
  { version: 3, sql: p2Sql },
  { version: 4, sql: p21Sql },
  { version: 5, sql: p21bSql },
  { version: 6, sql: p3Sql },
  { version: 7, sql: p31Sql },
  { version: 8, sql: p41Sql },
  { version: 9, sql: p5Sql },
  { version: 10, sql: wbEnabledSql },
  { version: 11, sql: p6Sql },
  { version: 12, sql: lfEnhSql },
  { version: 13, sql: lfSeamsSql },
  { version: 14, sql: aiUsageSql },
  { version: 15, sql: outlineInjectSql },
  { version: 16, sql: notesSql }
];

/**
 * 从迁移 SQL 提取 `ALTER TABLE ... ADD COLUMN ...` 的目标列。
 * 用于迁移幂等预检：SQLite 不支持 ADD COLUMN IF NOT EXISTS，
 * 若 user_version 与真实 schema 不同步（如恢复了旧备份），直接重放会因
 * duplicate column 报错；此处先探测列是否已存在，全部存在则跳过该迁移。
 */
export function extractAddedColumns(sql: string): Array<{ table: string; column: string }> {
  const out: Array<{ table: string; column: string }> = [];
  const re = /ALTER\s+TABLE\s+([A-Za-z_][\w-]*)\s+ADD\s+COLUMN\s+([A-Za-z_][\w-]*)/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(sql)) !== null) {
    out.push({ table: m[1], column: m[2] });
  }
  return out;
}

export class Database {
  private bridge: NativeBridge;
  private adapter: DatabaseAdapter;
  private dbPath: string | null = null;

  constructor(bridge: NativeBridge) {
    this.bridge = bridge;
    this.adapter = bridge.db;
  }

  get path(): string | null {
    return this.dbPath;
  }

  /** 初始化连接 + 执行迁移 */
  async init(dbPath?: string): Promise<void> {
    const appDataDir = await this.bridge.storage.appDataDir();
    this.dbPath = dbPath ?? `${appDataDir}/novelagent.db`;
    // Rust 侧打开连接并设置 WAL / foreign_keys
    // db_init 通过 storage 语义：直接调用 invoke —— 但 Database 只依赖 adapter，
    // 因此这里复用 exec 的初始化通道：先通过 bridge.db 无法打开连接，
    // 初始化连接需要一个专用入口。见下方说明：
    // —— 实际由 app-context 调用 invoke('db_init')，此处仅保留 path 计算。
    await this.runMigrations();
  }

  /** 供 app-context 在 invoke('db_init') 之后调用 */
  async runMigrations(): Promise<void> {
    const row = await this.adapter.queryOne<{ user_version: number }>(
      'PRAGMA user_version'
    );
    const current = Number(row?.user_version ?? 0);
    for (const m of MIGRATIONS) {
      if (m.version <= current) continue;
      // 幂等预检：若该迁移要 ADD 的列已全部存在，说明 schema 已处于该版本
      // （典型场景：恢复了旧备份导致 user_version 落后于实际 schema），
      // 跳过执行、仅推进版本号，避免 ADD COLUMN 重复报错导致启动失败。
      if (await this.isMigrationApplied(m)) {
        await this.adapter.exec(`PRAGMA user_version = ${m.version}`);
        continue;
      }
      // 每个迁移在单事务中执行：迁移 SQL 与 user_version 前进原子化（Rust 端 db_transaction
      // 对无参数语句走 execute_batch，支持多语句；任一失败整批回滚，不会留下半套 schema）
      await this.transaction(async (tx) => {
        await tx.exec(m.sql);
        await tx.exec(`PRAGMA user_version = ${m.version}`);
      });
    }
  }

  /** 判断迁移是否已被应用：其全部 ADD COLUMN 目标列已存在即为已应用 */
  private async isMigrationApplied(m: Migration): Promise<boolean> {
    const targets = extractAddedColumns(m.sql);
    if (targets.length === 0) return false;
    let existing = 0;
    for (const { table, column } of targets) {
      // table/column 均来自仓库内受控迁移 SQL（标识符白名单），可安全内插
      const cols = await this.adapter.query<{ name: string }>(
        `PRAGMA table_info(${table})`
      );
      if (cols.some((c) => c.name === column)) existing++;
    }
    return existing === targets.length;
  }

  exec(sql: string, params?: unknown[]): Promise<void> {
    return this.adapter.exec(sql, params);
  }

  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    return this.adapter.query<T>(sql, params);
  }

  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    return this.adapter.queryOne<T>(sql, params);
  }

  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    return this.adapter.transaction<T>(fn);
  }
}
