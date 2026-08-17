/**
 * 数据库连接管理：初始化（Rust 侧持连接）+ 迁移机制
 * 迁移策略：PRAGMA user_version 记录版本，按序执行 migrations
 */

import type { DatabaseAdapter, NativeBridge, Transaction } from '../native/NativeBridge';
import initSql from './migrations/001_init.sql?raw';
import p1Sql from './migrations/002_p1_additions.sql?raw';
import p2Sql from './migrations/003_p2_additions.sql?raw';

interface Migration {
  version: number;
  sql: string;
}

const MIGRATIONS: Migration[] = [
  { version: 1, sql: initSql },
  { version: 2, sql: p1Sql },
  { version: 3, sql: p2Sql }
];

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
      if (m.version > current) {
        // 多语句批量执行（db_exec 无参数时走 execute_batch）
        await this.adapter.exec(m.sql);
        await this.adapter.exec(`PRAGMA user_version = ${m.version}`);
      }
    }
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
