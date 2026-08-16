/**
 * 书籍服务：CRUD + 启用 Skill + Provider 配置关联
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { Book } from '../../types';

export interface BookInput {
  title: string;
  genre?: string | null;
  author?: string | null;
  coverPath?: string | null;
}

export class BookService {
  private bridge: NativeBridge & { fs: { deletePath(p: string): Promise<void> } };
  private db: Database;
  private wq: WriteQueue;

  constructor(bridge: NativeBridge, db: Database, wq: WriteQueue) {
    this.bridge = bridge as never;
    this.db = db;
    this.wq = wq;
  }

  async list(): Promise<Book[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM books ORDER BY updated_at DESC'
    );
    return rows.map(rowToBook);
  }

  async get(id: string): Promise<Book | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM books WHERE id = ?',
      [id]
    );
    return row ? rowToBook(row) : null;
  }

  async create(input: BookInput): Promise<Book> {
    const id = crypto.randomUUID();
    const appDataDir = await this.bridge.storage.appDataDir();
    const storageDir = `${appDataDir}/books/${id}`.replace(/\\/g, '/');
    await this.bridge.fs.ensureDir(storageDir);
    await this.bridge.fs.ensureDir(`${storageDir}/chapters`);

    const now = Date.now();
    await this.wq.enqueue(() =>
      this.db.exec(
        `INSERT INTO books (id, title, genre, author, cover_path, storage_dir, enabled_skills, provider_config_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, '[]', NULL, ?, ?)`,
        [id, input.title, input.genre ?? null, input.author ?? null, input.coverPath ?? null, storageDir, now, now]
      )
    );
    return (await this.get(id))!;
  }

  async update(id: string, patch: Partial<BookInput>): Promise<void> {
    const book = await this.get(id);
    if (!book) throw new Error('书籍不存在');
    await this.wq.enqueue(() =>
      this.db.exec(
        'UPDATE books SET title = ?, genre = ?, author = ?, cover_path = ?, updated_at = ? WHERE id = ?',
        [
          patch.title ?? book.title,
          patch.genre !== undefined ? patch.genre : book.genre,
          patch.author !== undefined ? patch.author : book.author,
          patch.coverPath !== undefined ? patch.coverPath : book.coverPath,
          Date.now(),
          id
        ]
      )
    );
  }

  async remove(id: string): Promise<void> {
    const book = await this.get(id);
    if (!book) return;
    // 先删 FTS 索引，再删行（级联删除 chapters/characters 等），最后删目录
    await this.wq.enqueue(() =>
      this.db.transaction(async (tx) => {
        await tx.exec('DELETE FROM chapters_fts WHERE book_id = ?', [id]);
        await tx.exec('DELETE FROM chapter_versions WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id = ?)', [id]);
        await tx.exec('DELETE FROM chapters WHERE book_id = ?', [id]);
        await tx.exec('DELETE FROM characters WHERE book_id = ?', [id]);
        await tx.exec('DELETE FROM character_schemas WHERE book_id = ?', [id]);
        await tx.exec('DELETE FROM worldbook_entries WHERE book_id = ?', [id]);
        await tx.exec('DELETE FROM foreshadowings WHERE book_id = ?', [id]);
        await tx.exec('DELETE FROM books WHERE id = ?', [id]);
      })
    );
    await this.bridge.fs.deletePath(book.storageDir).catch(() => undefined);
  }

  async getEnabledSkills(bookId: string): Promise<string[]> {
    const book = await this.get(bookId);
    if (!book) return [];
    try {
      return JSON.parse(book.enabledSkills || '[]') as string[];
    } catch {
      return [];
    }
  }

  async setEnabledSkills(bookId: string, skills: string[]): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.exec('UPDATE books SET enabled_skills = ?, updated_at = ? WHERE id = ?', [
        JSON.stringify(skills),
        Date.now(),
        bookId
      ])
    );
  }

  async setProviderConfig(bookId: string, configId: string | null): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.exec('UPDATE books SET provider_config_id = ?, updated_at = ? WHERE id = ?', [
        configId,
        Date.now(),
        bookId
      ])
    );
  }

  /** 触碰更新时间（章节保存时联动） */
  async touch(bookId: string): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.exec('UPDATE books SET updated_at = ? WHERE id = ?', [Date.now(), bookId])
    );
  }
}

type Row = Record<string, unknown>;

export function rowToBook(r: Row): Book {
  return {
    id: String(r.id),
    title: String(r.title),
    genre: (r.genre as string) ?? null,
    author: (r.author as string) ?? null,
    coverPath: (r.cover_path as string) ?? null,
    storageDir: String(r.storage_dir),
    enabledSkills: (r.enabled_skills as string) ?? '[]',
    providerConfigId: (r.provider_config_id as string) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at)
  };
}
