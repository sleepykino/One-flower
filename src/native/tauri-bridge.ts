/**
 * Tauri 实现的 NativeBridge：所有调用经 invoke 到 Rust 命令
 */

import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type {
  DatabaseAdapter,
  DirEntry,
  FileChangeEvent,
  FileSystemAdapter,
  KeyStoreAdapter,
  NativeBridge,
  StorageAdapter,
  Transaction
} from './NativeBridge';

// ============ base64 与 Uint8Array 互转 ============

function u8ToBase64(data: Uint8Array): string {
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < data.length; i += chunk) {
    binary += String.fromCharCode(...data.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function base64ToU8(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    out[i] = binary.charCodeAt(i);
  }
  return out;
}

// ============ Storage ============

const storage: StorageAdapter = {
  async appDataDir(): Promise<string> {
    return invoke<string>('app_data_dir_path');
  },
  async readAppData(path: string): Promise<string> {
    return invoke<string>('read_app_data', { path });
  },
  async writeAppData(path: string, content: string): Promise<void> {
    return invoke('write_app_data', { path, content });
  }
};

// ============ FileSystem ============

const fs: FileSystemAdapter & {
  readBinaryFile(p: string): Promise<Uint8Array>;
  writeBinaryFile(p: string, data: Uint8Array): Promise<void>;
  deletePath(p: string): Promise<void>;
} = {
  async readFile(path: string): Promise<string> {
    return invoke<string>('read_file', { path });
  },
  async readBinaryFile(path: string): Promise<Uint8Array> {
    const b64 = await invoke<string>('read_binary_file', { path });
    return base64ToU8(b64);
  },
  async writeFile(path: string, content: string): Promise<void> {
    return invoke('write_file', { path, content });
  },
  async writeBinaryFile(path: string, data: Uint8Array): Promise<void> {
    return invoke('write_binary_file', { path, dataB64: u8ToBase64(data) });
  },
  async ensureDir(path: string): Promise<void> {
    return invoke('ensure_dir', { path });
  },
  async listDir(path: string): Promise<DirEntry[]> {
    return invoke<DirEntry[]>('list_dir', { path });
  },
  async deletePath(path: string): Promise<void> {
    return invoke('delete_path', { path });
  },
  watchDir(path: string, onChange: (event: FileChangeEvent) => void): () => void {
    let disposed = false;
    // 监听全局 fs-change 事件，过滤出目标目录
    const unlistenP = listen<{ root: string; path: string; type: FileChangeEvent['type'] }>(
      'fs-change',
      (e) => {
        const p = e.payload;
        if (p.root === path || p.path.replace(/\\/g, '/').startsWith(path.replace(/\\/g, '/'))) {
          onChange({ type: p.type, path: p.path });
        }
      }
    );
    void invoke('watch_dir', { path }).catch((err) => console.error('watch_dir 失败', err));
    return () => {
      if (disposed) return;
      disposed = true;
      void unlistenP.then((f) => f());
      void invoke('unwatch_dir', { path }).catch(() => undefined);
    };
  }
};

// ============ Database ============

const db: DatabaseAdapter = {
  async exec(sql: string, params?: unknown[]): Promise<void> {
    return invoke('db_exec', { sql, params: params ?? [] });
  },
  async query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]> {
    const rows = await invoke<Record<string, unknown>[]>('db_query', {
      sql,
      params: params ?? []
    });
    return rows as T[];
  },
  async queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null> {
    const row = await invoke<Record<string, unknown> | null>('db_query_one', {
      sql,
      params: params ?? []
    });
    // Rust 端无行时返回 null（JSON null）
    return (row ?? null) as T | null;
  },
  async transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
    // 事务内的 exec 收集为语句批次，一次性提交 Rust 事务；
    // 事务内的 query 直接读取（读操作无需事务保护）
    const statements: Array<{ sql: string; params: unknown[] }> = [];
    const tx: Transaction = {
      exec: async (sql: string, params?: unknown[]) => {
        statements.push({ sql, params: (params ?? []) as unknown[] });
      },
      query: <T2 = Record<string, unknown>>(sql: string, params?: unknown[]) =>
        db.query<T2>(sql, params)
    };
    const result = await fn(tx);
    if (statements.length > 0) {
      await invoke('db_transaction', { statements });
    }
    return result;
  }
};

// ============ KeyStore ============

const keyStore: KeyStoreAdapter = {
  async setSecret(key: string, value: string): Promise<void> {
    return invoke('set_secret', { key, value });
  },
  async getSecret(key: string): Promise<string | null> {
    return invoke<string | null>('get_secret', { key });
  },
  async deleteSecret(key: string): Promise<void> {
    return invoke('delete_secret', { key });
  }
};

export const tauriBridge: NativeBridge & { fs: typeof fs } = {
  storage,
  fs,
  db,
  keyStore
};
