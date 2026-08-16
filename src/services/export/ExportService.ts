/**
 * 导出服务：单章 / 全书导出（Markdown / TXT / EPUB / .zip 备份包）
 * ExportService 统一入口，按 format 分发到对应 Exporter
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { ProseMirrorDoc } from '../../types';
import { ZipWriter } from '../../utils/zipbuilder';
import type { ChapterService } from '../chapter/ChapterService';
import type { MarkdownExporter } from './MarkdownExporter';
import type { TxtExporter } from './TxtExporter';
import type { EpubExporter } from './EpubExporter';

export type ExportFormat = 'markdown' | 'txt' | 'epub' | 'backup';

/** ProseMirror → 各格式转换器接口 */
export interface DocExporter {
  /** 将单个 ProseMirror 文档转为目标格式字符串 */
  convertDoc(doc: ProseMirrorDoc, chapterTitle: string): string;
  /** 全书合并时的文件扩展名 */
  readonly extension: string;
  /** 是否为二进制输出 */
  readonly binary: boolean;
}

export class ExportService {
  private bridge: NativeBridge & {
    fs: { writeBinaryFile(p: string, d: Uint8Array): Promise<void> };
  };
  private db: Database;
  private chapterService: ChapterService;
  private markdownExporter: MarkdownExporter;
  private txtExporter: TxtExporter;
  private epubExporter: EpubExporter;

  constructor(
    bridge: NativeBridge,
    db: Database,
    chapterService: ChapterService,
    markdownExporter: MarkdownExporter,
    txtExporter: TxtExporter,
    epubExporter: EpubExporter
  ) {
    this.bridge = bridge as never;
    this.db = db;
    this.chapterService = chapterService;
    this.markdownExporter = markdownExporter;
    this.txtExporter = txtExporter;
    this.epubExporter = epubExporter;
  }

  /** 导出单章为指定格式 */
  async exportChapter(chapterId: string, format: ExportFormat, outputPath: string): Promise<void> {
    const chapter = await this.chapterService.get(chapterId);
    if (!chapter) throw new Error('章节不存在');
    const doc = await this.chapterService.getContent(chapterId);

    if (format === 'backup') {
      throw new Error('备份导出请使用 exportBook');
    }
    if (format === 'epub') {
      const book = await this.db.queryOne<{ title: string; author: string | null }>(
        'SELECT title, author FROM books WHERE id = ?',
        [chapter.bookId]
      );
      const buf = await this.epubExporter.exportEpub(
        chapter.title,
        book?.author ?? '',
        [{ title: chapter.title, doc }]
      );
      await this.bridge.fs.writeBinaryFile(outputPath, new Uint8Array(buf));
      return;
    }
    const exporter = format === 'markdown' ? this.markdownExporter : this.txtExporter;
    await this.bridge.fs.writeFile(outputPath, exporter.convertDoc(doc, chapter.title));
  }

  /** 导出全书为指定格式（按章节树序合并，含目录页） */
  async exportBook(
    bookId: string,
    format: ExportFormat,
    outputPath: string,
    onProgress?: (done: number, total: number) => void
  ): Promise<void> {
    const bookRow = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM books WHERE id = ?',
      [bookId]
    );
    if (!bookRow) throw new Error('书籍不存在');
    const bookTitle = String(bookRow.title);
    const bookAuthor = String(bookRow.author ?? '');

    if (format === 'backup') {
      await this.exportBackup(bookId, outputPath, onProgress);
      return;
    }

    const chapters = await this.chapterService.listTreeOrder(bookId);
    const total = chapters.length;

    if (format === 'epub') {
      const parts: Array<{ title: string; doc: ProseMirrorDoc }> = [];
      let i = 0;
      for (const ch of chapters) {
        parts.push({ title: ch.title, doc: await this.chapterService.getContent(ch.id) });
        i++;
        onProgress?.(i, total);
      }
      const buf = await this.epubExporter.exportEpub(bookTitle, bookAuthor, parts);
      await this.bridge.fs.writeBinaryFile(outputPath, new Uint8Array(buf));
      return;
    }

    const exporter = format === 'markdown' ? this.markdownExporter : this.txtExporter;
    const sep = format === 'markdown' ? '\n\n---\n\n' : '\n\n\n';
    const parts: string[] = [
      format === 'markdown' ? `# ${bookTitle}\n\n${bookAuthor ? `> ${bookAuthor}\n` : ''}` : `${bookTitle}\n${'='.repeat(bookTitle.length)}`
    ];
    let i = 0;
    for (const ch of chapters) {
      const heading = format === 'markdown' ? `## ${ch.title}` : ch.title;
      const doc = await this.chapterService.getContent(ch.id);
      const body = exporter.convertDoc(doc, '').trim();
      parts.push(`${heading}\n\n${body}`);
      i++;
      onProgress?.(i, total);
    }
    await this.bridge.fs.writeFile(outputPath, parts.join(sep));
  }

  /**
   * .zip 备份包导出：
   * meta.json（书籍元数据 + 章节树 + 角色卡 + 世界书 + 伏笔）
   * chapters/NNN.json（每章独立 ProseMirror 文档，流式逐章写入）
   */
  private async exportBackup(
    bookId: string,
    outputPath: string,
    onProgress?: (done: number, total: number) => void
  ): Promise<void> {
    const bookRow = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM books WHERE id = ?',
      [bookId]
    );
    if (!bookRow) throw new Error('书籍不存在');

    const chapters = await this.chapterService.listTreeOrder(bookId);
    const [characters, schemas, worldbook, foreshadowings] = await Promise.all([
      this.db.query('SELECT * FROM characters WHERE book_id = ?', [bookId]),
      this.db.query('SELECT * FROM character_schemas WHERE book_id = ?', [bookId]),
      this.db.query('SELECT * FROM worldbook_entries WHERE book_id = ?', [bookId]),
      this.db.query('SELECT * FROM foreshadowings WHERE book_id = ?', [bookId])
    ]);

    const meta = {
      version: 1,
      book: bookRow,
      chapters: chapters.map((c) => ({
        id: c.id,
        parentId: c.parentId,
        title: c.title,
        outline: c.outline,
        status: c.status,
        sortOrder: c.sortOrder,
        wordCount: c.wordCount,
        summary: c.summary,
        createdAt: c.createdAt,
        updatedAt: c.updatedAt
      })),
      characters,
      characterSchemas: schemas,
      worldbook,
      foreshadowings
    };

    // fflate Zip 流式：逐章 add，避免全量内存驻留
    const zip = new ZipWriter();
    zip.addText('meta.json', JSON.stringify(meta, null, 2));

    let i = 0;
    for (const ch of chapters) {
      const doc = await this.chapterService.getContent(ch.id);
      zip.addText(`chapters/${String(i + 1).padStart(3, '0')}.json`, JSON.stringify(doc));
      i++;
      onProgress?.(i, chapters.length);
    }
    const out = await zip.finish();
    await this.bridge.fs.writeBinaryFile(outputPath, out);
  }
}
