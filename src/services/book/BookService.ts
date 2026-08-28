/**
 * 书籍服务：CRUD + 启用 Skill + Provider 配置关联 + P6 回收站/置顶/排序
 * trash/restore 只动 books.deleted_at 一列（关联行/FTS/目录零触碰，恢复零损耗）；
 * purge 才执行硬删（FTS 手动清 + 事务 + 级联 + 目录递归删）
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

  /** 书架列表：未删除书 + 章节数/字数聚合（子查询一次取齐，避免 N+1） */
  async list(): Promise<Book[]> {
    const rows = await this.db.query<Record<string, unknown>>(`
      SELECT b.*,
        (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id) AS chapter_count,
        (SELECT COALESCE(SUM(c.word_count), 0) FROM chapters c WHERE c.book_id = b.id) AS total_words
      FROM books b
      WHERE b.deleted_at IS NULL
      ORDER BY b.updated_at DESC
    `);
    return rows.map(rowToBook);
  }

  /** 回收站列表：已删除书按删除时间倒序，带同一套聚合 */
  async listDeleted(): Promise<Book[]> {
    const rows = await this.db.query<Record<string, unknown>>(`
      SELECT b.*,
        (SELECT COUNT(*) FROM chapters c WHERE c.book_id = b.id) AS chapter_count,
        (SELECT COALESCE(SUM(c.word_count), 0) FROM chapters c WHERE c.book_id = b.id) AS total_words
      FROM books b
      WHERE b.deleted_at IS NOT NULL
      ORDER BY b.deleted_at DESC
    `);
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

  /** 软删除（移入回收站）：仅 UPDATE deleted_at 一列，不动关联行/FTS/目录 */
  async trash(id: string): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.exec('UPDATE books SET deleted_at = ? WHERE id = ? AND deleted_at IS NULL', [
        Date.now(),
        id
      ])
    );
  }

  /** 从回收站恢复：deleted_at 置 NULL */
  async restore(id: string): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.exec('UPDATE books SET deleted_at = NULL WHERE id = ? AND deleted_at IS NOT NULL', [
        id
      ])
    );
  }

  /** 彻底删除：原硬删全量逻辑（FTS 手动清 + 事务 + 级联行 + 递归删 storageDir） */
  async purge(id: string): Promise<void> {
    const book = await this.get(id);
    if (!book) return;
    // 先删 FTS 索引，再删行（级联删除 chapters/characters 等），最后删目录。
    // 批次5建议1：补齐 source_ref/JSON 引用等无 FK 表的显式清理（setting_facts 的推导链由 FK 级联），
    // 防孤儿数据在 FK 未开启或旧库场景下残留。
    await this.wq.enqueue(() =>
      this.db.transaction(async (tx) => {
        await tx.exec('DELETE FROM chapters_fts WHERE book_id = ?', [id]);
        await tx.exec('DELETE FROM chapter_versions WHERE chapter_id IN (SELECT id FROM chapters WHERE book_id = ?)', [id]);
        await tx.exec('DELETE FROM setting_inferences WHERE book_id = ?', [id]);
        await tx.exec('DELETE FROM setting_facts WHERE book_id = ?', [id]);
        await tx.exec('DELETE FROM relationships WHERE book_id = ?', [id]);
        await tx.exec('DELETE FROM timeline_events WHERE book_id = ?', [id]);
        await tx.exec('DELETE FROM worldbook_embeddings WHERE book_id = ?', [id]);
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

  /** 清空回收站：逐本 purge（顺序执行），返回清理数量 */
  async emptyTrash(): Promise<number> {
    const deleted = await this.listDeleted();
    for (const b of deleted) {
      await this.purge(b.id);
    }
    return deleted.length;
  }

  /**
   * 一次性存量清理（批次5建议1）：清除历史遗留的孤儿引用，杜绝「孤儿事实污染一致性基线」。
   * 仅对 source_ref / JSON 数组 / chapter_id 等无 FK 的引用做兜底：
   * - setting_facts：source_ref 指向已不存在的 worldbook/character/chapter 时删除（其推导链由 FK 级联）
   * - timeline_events：character_ids 中已删角色 id → 摘除；chapter_id 指向已删章节 → 置 NULL
   * - foreshadowings：planted/resolved_chapter_id 指向已删章节 → 置 NULL
   * 幂等、只碰孤儿、不动正常数据。
   */
  async sweepOrphans(): Promise<{ clearedFacts: number; clearedEvents: number; clearedForeshadows: number }> {
    const out = { clearedFacts: 0, clearedEvents: 0, clearedForeshadows: 0 };
    await this.wq.enqueue(async () => {
      await this.db.transaction(async (tx) => {
        // 1) setting_facts.source_ref 悬空（source 对应表已无该 id）
        const facts = await tx.query<{ id: string; source: string; source_ref: string }>(
          `SELECT f.id, f.source, f.source_ref FROM setting_facts f
           WHERE (f.source = 'worldbook' AND f.source_ref NOT IN (SELECT id FROM worldbook_entries))
              OR (f.source = 'character' AND f.source_ref NOT IN (SELECT id FROM characters))
              OR (f.source = 'chapter' AND f.source_ref NOT IN (SELECT id FROM chapters))`
        );
        for (const f of facts) await tx.exec('DELETE FROM setting_facts WHERE id = ?', [f.id]);
        out.clearedFacts = facts.length;

        // 2) timeline_events.character_ids 摘除已删角色 id（事件保留，防误删多角色事件）
        const allChars = new Set(
          (await tx.query<{ id: string }>('SELECT id FROM characters')).map((c) => c.id)
        );
        const events = await tx.query<{ id: string; character_ids: string }>(
          `SELECT id, character_ids FROM timeline_events WHERE character_ids IS NOT NULL`
        );
        for (const ev of events) {
          let ids: string[] = [];
          try {
            const parsed = JSON.parse(ev.character_ids) as unknown;
            if (Array.isArray(parsed)) ids = parsed.filter((v) => typeof v === 'string');
          } catch {
            continue; // 列损坏跳过
          }
          const keep = ids.filter((v) => allChars.has(v));
          if (keep.length !== ids.length) {
            await tx.exec('UPDATE timeline_events SET character_ids = ? WHERE id = ?', [
              JSON.stringify(keep),
              ev.id
            ]);
            out.clearedEvents += 1;
          }
        }

        // 3) timeline_events.chapter_id 指向已删章节 → 置 NULL
        await tx.exec(
          `UPDATE timeline_events SET chapter_id = NULL WHERE chapter_id IS NOT NULL
           AND chapter_id NOT IN (SELECT id FROM chapters)`
        );

        // 4) foreshadowings 章节引用悬空 → 置 NULL
        const foreshadowUpdates = await tx.query<{ id: string; p: string | null; r: string | null }>(
          `SELECT id, planted_chapter_id AS p, resolved_chapter_id AS r FROM foreshadowings
           WHERE (planted_chapter_id IS NOT NULL AND planted_chapter_id NOT IN (SELECT id FROM chapters))
              OR (resolved_chapter_id IS NOT NULL AND resolved_chapter_id NOT IN (SELECT id FROM chapters))`
        );
        for (const fw of foreshadowUpdates) {
          await tx.exec(
            'UPDATE foreshadowings SET planted_chapter_id = NULL, resolved_chapter_id = NULL WHERE id = ?',
            [fw.id]
          );
        }
        out.clearedForeshadows = foreshadowUpdates.length;
      });
    });
    return out;
  }

  /** 启动清理：超过保留期的已删书批量 purge，返回清理数；retentionDays<=0 表示永久保留 */
  async cleanupExpired(retentionDays: number): Promise<number> {
    if (retentionDays <= 0) return 0;
    const threshold = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    const rows = await this.db.query<{ id: string }>(
      'SELECT id FROM books WHERE deleted_at IS NOT NULL AND deleted_at < ?',
      [threshold]
    );
    for (const row of rows) {
      await this.purge(row.id);
    }
    return rows.length;
  }

  /** P6 置顶（不刷 updated_at，避免置顶动作把书顶到"最近更新"） */
  async setPinned(id: string, pinned: boolean): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.exec('UPDATE books SET pinned = ? WHERE id = ?', [pinned ? 1 : 0, id])
    );
  }

  /** P6 手动排序：orderedIds 为当前未删除书的新顺序，单事务批量回写 sort_order（index 序） */
  async reorder(orderedIds: string[]): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.transaction(async (tx) => {
        for (let i = 0; i < orderedIds.length; i++) {
          await tx.exec('UPDATE books SET sort_order = ? WHERE id = ?', [i, orderedIds[i]]);
        }
      })
    );
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
    pinned: Number(r.pinned ?? 0) === 1,
    sortOrder: Number(r.sort_order ?? 0),
    deletedAt: r.deleted_at != null ? Number(r.deleted_at) : null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    chapterCount: r.chapter_count != null ? Number(r.chapter_count) : undefined,
    totalWords: r.total_words != null ? Number(r.total_words) : undefined
  };
}
