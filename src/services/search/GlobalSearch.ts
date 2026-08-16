/**
 * 全局查找替换：SQLite FTS5 索引 + 中文兜底 LIKE/instr + 正则支持
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import { replaceInDoc } from '../../utils/pmdoc';
import type { ChapterService } from '../chapter/ChapterService';

export interface SearchOptions {
  useRegex?: boolean;
  caseSensitive?: boolean;
  limit?: number;
}

export interface SearchResult {
  chapterId: string;
  chapterTitle: string;
  matches: Array<{ excerpt: string; position: number }>;
}

export interface ReplaceOptions {
  useRegex?: boolean;
  caseSensitive?: boolean;
  chapterIds?: string[]; // 不传则全书
}

export interface ReplaceResult {
  replacedCount: number;
  affectedChapters: string[];
}

export class GlobalSearch {
  private bridge: NativeBridge;
  private db: Database;
  private wq: WriteQueue;
  private chapterService: ChapterService | null = null;

  constructor(bridge: NativeBridge, db: Database, wq: WriteQueue) {
    this.bridge = bridge;
    this.db = db;
    this.wq = wq;
  }

  /** 延迟注入（ChapterService 与 GlobalSearch 相互引用） */
  setChapterService(cs: ChapterService): void {
    this.chapterService = cs;
  }

  /** 章节内容变更后重建索引（delete + insert） */
  async indexChapter(
    chapterId: string,
    bookId: string,
    title: string,
    content: string
  ): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.transaction(async (tx) => {
        await tx.exec('DELETE FROM chapters_fts WHERE chapter_id = ?', [chapterId]);
        await tx.exec(
          'INSERT INTO chapters_fts (chapter_id, book_id, title, content) VALUES (?, ?, ?, ?)',
          [chapterId, bookId, title, content]
        );
      })
    );
  }

  /** 删除章节索引 */
  async removeChapter(chapterId: string): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.exec('DELETE FROM chapters_fts WHERE chapter_id = ?', [chapterId])
    );
  }

  /** 全局搜索：返回命中章节 + 上下文片段 */
  async search(query: string, bookId: string, options?: SearchOptions): Promise<SearchResult[]> {
    if (!query) return [];
    const limit = options?.limit ?? 200;

    if (options?.useRegex) {
      return this.searchRegex(query, bookId, options.caseSensitive ?? false, limit);
    }
    return this.searchPlain(query, bookId, options?.caseSensitive ?? false, limit);
  }

  /** 正则模式：遍历该书章节正文逐个匹配 */
  private async searchRegex(
    query: string,
    bookId: string,
    caseSensitive: boolean,
    limit: number
  ): Promise<SearchResult[]> {
    let re: RegExp;
    try {
      re = new RegExp(query, caseSensitive ? 'g' : 'gi');
    } catch {
      throw new Error('无效的正则表达式');
    }
    const chapters = await this.db.query<{ chapter_id: string; title: string }>(
      'SELECT chapter_id, title FROM chapters_fts WHERE book_id = ?',
      [bookId]
    );
    const results: SearchResult[] = [];
    for (const ch of chapters.slice(0, limit * 4)) {
      const content = await this.getIndexedContent(ch.chapter_id);
      const matches = this.collectRegexMatches(content, re);
      if (matches.length > 0) {
        results.push({ chapterId: ch.chapter_id, chapterTitle: ch.title, matches });
      }
    }
    return results;
  }

  private collectRegexMatches(
    content: string,
    re: RegExp
  ): Array<{ excerpt: string; position: number }> {
    const out: Array<{ excerpt: string; position: number }> = [];
    const rx = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
    let m: RegExpExecArray | null;
    let guard = 0;
    while ((m = rx.exec(content)) !== null && out.length < 10 && guard < 1000) {
      out.push(this.makeExcerpt(content, m.index, m[0].length || 1));
      if (m[0].length === 0) rx.lastIndex++;
      guard++;
    }
    return out;
  }

  /** 普通模式：LIKE（不区分大小写）/ instr（区分大小写），中文子串可命中 */
  private async searchPlain(
    query: string,
    bookId: string,
    caseSensitive: boolean,
    limit: number
  ): Promise<SearchResult[]> {
    const rows = await this.db.query<{ chapter_id: string; title: string }>(
      caseSensitive
        ? `SELECT chapter_id, title FROM chapters_fts WHERE book_id = ? AND instr(content, ?) > 0 LIMIT ?`
        : `SELECT chapter_id, title FROM chapters_fts WHERE book_id = ? AND content LIKE ? ESCAPE '\\' LIMIT ?`,
      caseSensitive ? [bookId, query, limit] : [bookId, `%${escapeLike(query)}%`, limit]
    );

    const results: SearchResult[] = [];
    const needle = caseSensitive ? query : query.toLowerCase();
    for (const ch of rows) {
      const content = await this.getIndexedContent(ch.chapter_id);
      const hay = caseSensitive ? content : content.toLowerCase();
      const matches: Array<{ excerpt: string; position: number }> = [];
      let idx = hay.indexOf(needle);
      while (idx >= 0 && matches.length < 10) {
        matches.push(this.makeExcerpt(content, idx, query.length));
        idx = hay.indexOf(needle, idx + query.length);
      }
      if (matches.length > 0) {
        results.push({ chapterId: ch.chapter_id, chapterTitle: ch.title, matches });
      }
    }
    return results;
  }

  private async getIndexedContent(chapterId: string): Promise<string> {
    const row = await this.db.queryOne<{ content: string }>(
      'SELECT content FROM chapters_fts WHERE chapter_id = ?',
      [chapterId]
    );
    return row?.content ?? '';
  }

  private makeExcerpt(
    content: string,
    pos: number,
    len: number
  ): { excerpt: string; position: number } {
    const start = Math.max(0, pos - 30);
    const end = Math.min(content.length, pos + len + 30);
    return {
      excerpt:
        (start > 0 ? '…' : '') + content.slice(start, end) + (end < content.length ? '…' : ''),
      position: pos
    };
  }

  /** 全局替换：批量更新各章 ProseMirror JSON + 重建索引 */
  async replace(
    query: string,
    replacement: string,
    bookId: string,
    options?: ReplaceOptions
  ): Promise<ReplaceResult> {
    if (!this.chapterService) throw new Error('ChapterService 未注入');

    const candidates = await this.search(query, bookId, {
      useRegex: options?.useRegex,
      caseSensitive: options?.caseSensitive
    }).then((rs) =>
      options?.chapterIds ? rs.filter((r) => options.chapterIds!.includes(r.chapterId)) : rs
    );

    let replacedCount = 0;
    const affected: string[] = [];

    const escaped = options?.useRegex ? query : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const flags = options?.caseSensitive ? 'g' : 'gi';
    const re = new RegExp(escaped, flags);

    for (const c of candidates) {
      const doc = await this.chapterService.getContent(c.chapterId);
      const { doc: newDoc, count } = replaceInDoc(doc, re, replacement);
      if (count > 0) {
        await this.chapterService.saveContent(c.chapterId, newDoc);
        replacedCount += count;
        affected.push(c.chapterId);
      }
    }
    return { replacedCount, affectedChapters: affected };
  }
}

function escapeLike(s: string): string {
  return s.replace(/[\\%_]/g, (c) => '\\' + c);
}
