/**
 * AppSettingsService：应用级键值设置（app_settings 表）
 * 存储非结构化配置，如 embedding.providerConfigId / embedding.model
 */

import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';

export class AppSettingsService {
  private db: Database;
  private wq: WriteQueue;

  constructor(db: Database, wq: WriteQueue) {
    this.db = db;
    this.wq = wq;
  }

  async get(key: string): Promise<string | null> {
    const row = await this.db.queryOne<{ value: string | null }>(
      'SELECT value FROM app_settings WHERE key = ?',
      [key]
    );
    return row?.value ?? null;
  }

  async set(key: string, value: string | null): Promise<void> {
    if (value === null) {
      await this.wq.enqueue(() => this.db.exec('DELETE FROM app_settings WHERE key = ?', [key]));
      return;
    }
    await this.wq.enqueue(() =>
      this.db.exec(
        'INSERT INTO app_settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
        [key, value]
      )
    );
  }
}
