/**
 * SQLite 单写队列：所有写操作走此队列串行执行，
 * 避免自动保存 / AI 生成 / 全局替换并发写冲突。
 */

import type { DatabaseAdapter } from '../native/NativeBridge';

export class WriteQueue {
  private db: DatabaseAdapter;
  private chain: Promise<unknown> = Promise.resolve();

  constructor(db: DatabaseAdapter) {
    this.db = db;
  }

  /** 所有写操作必须走此队列，串行执行 */
  enqueue<T>(fn: () => Promise<T>): Promise<T> {
    const next = this.chain.then(fn, fn);
    // 失败不断链：错误向下传递但队列继续
    this.chain = next.catch(() => undefined);
    return next;
  }
}
