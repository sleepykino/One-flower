/**
 * NativeBridge 接口定义（锁定 Tauri/Electron 可替换性）
 * 所有系统能力（存储/文件/数据库/密钥）都通过此抽象层访问。
 */

export interface FileChangeEvent {
  type: 'create' | 'modify' | 'delete';
  path: string;
}

export interface DirEntry {
  name: string;
  isDir: boolean;
}

export interface Transaction {
  exec(sql: string, params?: unknown[]): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
}

export interface StorageAdapter {
  readAppData(path: string): Promise<string>;
  writeAppData(path: string, content: string): Promise<void>;
  appDataDir(): Promise<string>;
}

export interface FileSystemAdapter {
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  watchDir(path: string, onChange: (event: FileChangeEvent) => void): () => void;
  ensureDir(path: string): Promise<void>;
  listDir(path: string): Promise<DirEntry[]>;
  /** 二进制读写（图片/地图素材等；tauri-bridge 已实现） */
  readBinaryFile(path: string): Promise<Uint8Array>;
  writeBinaryFile(path: string, data: Uint8Array): Promise<void>;
}

export interface DatabaseAdapter {
  exec(sql: string, params?: unknown[]): Promise<void>;
  query<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T[]>;
  queryOne<T = Record<string, unknown>>(sql: string, params?: unknown[]): Promise<T | null>;
  transaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T>;
}

export interface KeyStoreAdapter {
  setSecret(key: string, value: string): Promise<void>;
  getSecret(key: string): Promise<string | null>;
  deleteSecret(key: string): Promise<void>;
}

export interface NativeBridge {
  readonly storage: StorageAdapter;
  readonly fs: FileSystemAdapter;
  readonly db: DatabaseAdapter;
  readonly keyStore: KeyStoreAdapter;
}
