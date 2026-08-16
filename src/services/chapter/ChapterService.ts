/**
 * 章节服务：CRUD + 多级章节树 + 大纲 + 字数统计 + 正文落盘 + FTS 同步
 * 正文以 ProseMirror JSON 存书籍目录下 chapters/<id>.json，元数据在 SQLite
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { Chapter, ChapterStatus, ProseMirrorDoc } from '../../types';
import { emptyDoc, docToPlainText, countWords } from '../../utils/pmdoc';
import type { GlobalSearch } from '../search/GlobalSearch';
import { rowToBook } from '../book/BookService';

export interface ChapterInput {
  title: string;
  parentId?: string | null;
  outline?: string | null;
}

export class ChapterService {
  private bridge: NativeBridge;
  private db: Database;
  private wq: WriteQueue;
  private search: GlobalSearch;

  constructor(bridge: NativeBridge, db: Database, wq: WriteQueue, search: GlobalSearch) {
    this.bridge = bridge;
    this.db = db;
    this.wq = wq;
    this.search = search;
  }

  async list(bookId: string): Promise<Chapter[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM chapters WHERE book_id = ? ORDER BY sort_order ASC, created_at ASC',
      [bookId]
    );
    return rows.map(rowToChapter);
  }

  async get(id: string): Promise<Chapter | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM chapters WHERE id = ?',
      [id]
    );
    return row ? rowToChapter(row) : null;
  }

  private async contentPath(chapter: Chapter): Promise<string> {
    const bookRow = await this.db.queryOne<Record<string, unknown>>(
      'SELECT storage_dir FROM books WHERE id = ?',
      [chapter.bookId]
    );
    if (!bookRow) throw new Error('书籍不存在');
    const storageDir = rowToBook(bookRow).storageDir;
    return `${storageDir}/chapters/${chapter.id}.json`;
  }

  async create(bookId: string, input: ChapterInput): Promise<Chapter> {
    const id = crypto.randomUUID();
    const now = Date.now();
    // 同级最大序号 + 1
    const maxRow = await this.db.queryOne<{ n: number }>(
      'SELECT COALESCE(MAX(sort_order), 0) AS n FROM chapters WHERE book_id = ? AND parent_id IS ?',
      [bookId, input.parentId ?? null]
    );
    const sortOrder = Number(maxRow?.n ?? 0) + 1;

    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT storage_dir FROM books WHERE id = ?',
      [bookId]
    );
    if (!row) throw new Error('书籍不存在');
    const storageDir = String(row.storage_dir);
    const contentPath = `${storageDir}/chapters/` + id + `.json`;

    await this.bridge.fs.writeFile(contentPath, JSON.stringify(emptyDoc(), null, 2));

    await this.wq.enqueue(() =>
      this.db.exec(
        `INSERT INTO chapters (id, book_id, parent_id, title, outline, status, sort_order, word_count, content_path, summary, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, 'draft', ?, 0, ?, NULL, ?, ?)`,
        [id, bookId, input.parentId ?? null, input.title, input.outline ?? null, sortOrder, contentPath, now, now]
      )
    );
    return (await this.get(id))!;
  }

  async update(
    id: string,
    patch: { title?: string; outline?: string | null; status?: ChapterStatus; parentId?: string | null; sortOrder?: number }
  ): Promise<void> {
    const ch = await this.get(id);
    if (!ch) throw new Error('章节不存在');
    await this.wq.enqueue(() =>
      this.db.exec(
        'UPDATE chapters SET title = ?, outline = ?, status = ?, parent_id = ?, sort_order = ?, updated_at = ? WHERE id = ?',
        [
          patch.title ?? ch.title,
          patch.outline !== undefined ? patch.outline : ch.outline,
          patch.status ?? ch.status,
          patch.parentId !== undefined ? patch.parentId : ch.parentId,
          patch.sortOrder ?? ch.sortOrder,
          Date.now(),
          id
        ]
      )
    );
  }

  /** 删除章节（含全部子孙章节），同步删 FTS 与版本记录 */
  async remove(id: string): Promise<void> {
    const all = await this.collectDescendants(id);
    for (const chapterId of all) {
      const ch = await this.get(chapterId);
      await this.wq.enqueue(() =>
        this.db.transaction(async (tx) => {
          await tx.exec('DELETE FROM chapters_fts WHERE chapter_id = ?', [chapterId]);
          await tx.exec('DELETE FROM chapter_versions WHERE chapter_id = ?', [chapterId]);
          await tx.exec('DELETE FROM chapters WHERE id = ?', [chapterId]);
        })
      );
      if (ch?.contentPath) {
        await (this.bridge.fs as unknown as {
          deletePath?: (p: string) => Promise<void>;
        })
          .deletePath?.(ch.contentPath)
          .catch(() => undefined);
      }
    }
  }

  private async collectDescendants(id: string): Promise<string[]> {
    const out: string[] = [id];
    const children = await this.db.query<{ id: string }>(
      'SELECT id FROM chapters WHERE parent_id = ?',
      [id]
    );
    for (const c of children) {
      out.push(...(await this.collectDescendants(c.id)));
    }
    return out;
  }

  /** 读取章节正文（ProseMirror JSON 落盘文件） */
  async getContent(chapterId: string): Promise<ProseMirrorDoc> {
    const ch = await this.get(chapterId);
    if (!ch) throw new Error('章节不存在');
    const path = ch.contentPath ?? (await this.contentPath(ch));
    try {
      const raw = await this.bridge.fs.readFile(path);
      const parsed = JSON.parse(raw) as ProseMirrorDoc;
      if (parsed?.type === 'doc') return parsed;
      return emptyDoc();
    } catch {
      return emptyDoc();
    }
  }

  /** 保存正文：落盘 + 更新字数 + 同步 FTS 索引 */
  async saveContent(chapterId: string, doc: ProseMirrorDoc): Promise<number> {
    const ch = await this.get(chapterId);
    if (!ch) throw new Error('章节不存在');
    const path = ch.contentPath ?? (await this.contentPath(ch));
    const wordCount = countWords(doc);
    await this.bridge.fs.writeFile(path, JSON.stringify(doc, null, 2));
    await this.wq.enqueue(() =>
      this.db.exec('UPDATE chapters SET word_count = ?, updated_at = ? WHERE id = ?', [
        wordCount,
        Date.now(),
        chapterId
      ])
    );
    await this.search.indexChapter(chapterId, ch.bookId, ch.title, docToPlainText(doc));
    await this.db.exec('UPDATE books SET updated_at = ? WHERE id = ?', [Date.now(), ch.bookId]);
    return wordCount;
  }

  /** 滑动窗口：取当前章之前（排序靠前）的最近 n 章正文 */
  async recentChapters(
    bookId: string,
    currentChapterId: string,
    n = 3
  ): Promise<Array<{ id: string; title: string; outline?: string; content: string }>> {
    const current = await this.get(currentChapterId);
    if (!current) return [];
    const prev = await this.db.query<Record<string, unknown>>(
      `SELECT id, title FROM chapters
       WHERE book_id = ? AND id != ? AND (sort_order < ? OR (sort_order = ? AND created_at < ?))
       ORDER BY sort_order DESC, created_at DESC LIMIT ?`,
      [bookId, currentChapterId, current.sortOrder, current.sortOrder, current.createdAt, n]
    );
    const out: Array<{ id: string; title: string; outline?: string; content: string }> = [];
    for (const r of prev) {
      const doc = await this.getContent(String(r.id));
      out.push({
        id: String(r.id),
        title: String(r.title),
        content: docToPlainText(doc)
      });
    }
    // 时间正序呈现（远 → 近）
    return out.reverse();
  }

  /** 章节树扁平列表按树序展开（导出全书用） */
  async listTreeOrder(bookId: string): Promise<Chapter[]> {
    const all = await this.list(bookId);
    const out: Chapter[] = [];
    const walk = (parentId: string | null): void => {
      const children = all
        .filter((c) => c.parentId === parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder);
      for (const c of children) {
        out.push(c);
        walk(c.id);
      }
    };
    walk(null);
    return out;
  }
}

type Row = Record<string, unknown>;

export function rowToChapter(r: Row): Chapter {
  return {
    id: String(r.id),
    bookId: String(r.book_id),
    parentId: (r.parent_id as string) ?? null,
    title: String(r.title),
    outline: (r.outline as string) ?? null,
    status: (r.status as ChapterStatus) ?? 'draft',
    sortOrder: Number(r.sort_order ?? 0),
    wordCount: Number(r.word_count ?? 0),
    contentPath: (r.content_path as string) ?? null,
    summary: (r.summary as string) ?? null,
    summaryGeneratedAt: (r.summary_generated_at as number) ?? null,
    summarySourceWords: (r.summary_source_words as number) ?? null,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at)
  };
}
