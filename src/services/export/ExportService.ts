/**
 * 导出服务：单章 / 全书导出（Markdown / TXT / EPUB / .docx 备份包）
 * ExportService 统一入口，按 format 分发到对应 Exporter
 *
 * P3：
 * - EPUB / DOCX / MD 默认内嵌图片（options.includeImages 可关闭）
 * - 封面（books.cover_path）内嵌到 EPUB/DOCX 首页
 * - Markdown 图片复制到输出目录 images/ 并用相对路径引用
 * - backup v2：assets/ 目录二进制入包 + meta.images；图片缺失降级占位，不中断导出
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { ProseMirrorDoc } from '../../types';
import { ZipWriter } from '../../utils/zipbuilder';
import { collectImageAssetIds } from '../../utils/pmdoc';
import { extOfMime, parseImageSize, sniffImageMime } from '../../utils/imageMeta';
import type { ChapterService } from '../chapter/ChapterService';
import type { MarkdownExporter } from './MarkdownExporter';
import type { TxtExporter } from './TxtExporter';
import type { EpubExporter } from './EpubExporter';
import type { DocxExporter } from './DocxExporter';

export type ExportFormat = 'markdown' | 'txt' | 'epub' | 'docx' | 'backup';

/** 导出期的图片（字节已读入，供各导出器内嵌） */
export interface ExportImage {
  assetId: string;
  fileName: string;
  bytes: Uint8Array;
  mimeType: string;
  width: number;
  height: number;
}

/** 导出选项（P3）：是否包含图片（EPUB/DOCX/MD 默认 true，TXT 恒忽略） */
export interface ExportBookOptions {
  includeImages?: boolean;
}

/** 单章/全书 Markdown 转换选项：图片 -> 相对引用路径（null 表示缺失） */
export interface MarkdownConvertOptions {
  resolveImageSrc?: (attrs: { assetId: string; fileName: string; caption: string; width: number; align: string }) => string | null;
}

/** ProseMirror -> 各格式转换器接口 */
export interface DocExporter {
  /** 将单个 ProseMirror 文档转为目标格式字符串 */
  convertDoc(doc: ProseMirrorDoc, chapterTitle: string, opts?: MarkdownConvertOptions): string;
  /** 全书合并时的文件扩展名 */
  readonly extension: string;
  /** 是否为二进制输出 */
  readonly binary: boolean;
}

export class ExportService {
  private bridge: NativeBridge & {
    fs: {
      readBinaryFile(p: string): Promise<Uint8Array>;
      writeBinaryFile(p: string, d: Uint8Array): Promise<void>;
      ensureDir(p: string): Promise<void>;
    };
  };
  private db: Database;
  private chapterService: ChapterService;
  private markdownExporter: MarkdownExporter;
  private txtExporter: TxtExporter;
  private epubExporter: EpubExporter;
  private docxExporter: DocxExporter;

  constructor(
    bridge: NativeBridge,
    db: Database,
    chapterService: ChapterService,
    markdownExporter: MarkdownExporter,
    txtExporter: TxtExporter,
    epubExporter: EpubExporter,
    docxExporter: DocxExporter
  ) {
    this.bridge = bridge as never;
    this.db = db;
    this.chapterService = chapterService;
    this.markdownExporter = markdownExporter;
    this.txtExporter = txtExporter;
    this.epubExporter = epubExporter;
    this.docxExporter = docxExporter;
  }

  /** 导出单章为指定格式（P3：EPUB/DOCX/MD 含正文插图，MD 图片落盘到输出目录 images/） */
  async exportChapter(chapterId: string, format: ExportFormat, outputPath: string): Promise<void> {
    const chapter = await this.chapterService.get(chapterId);
    if (!chapter) throw new Error('章节不存在');
    const doc = await this.chapterService.getContent(chapterId);

    if (format === 'backup') {
      throw new Error('备份导出请使用 exportBook');
    }

    const bookRow = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM books WHERE id = ?',
      [chapter.bookId]
    );
    const storageDir = String(bookRow?.storage_dir ?? '').replace(/\\/g, '/');
    const bundle = await this.loadExportImages(chapter.bookId, storageDir, '', [{ title: chapter.title, doc }]);
    const getImage = (assetId: string): ExportImage | null => bundle.images.get(assetId) ?? null;

    if (format === 'epub') {
      const buf = await this.epubExporter.exportEpub(chapter.title, String(bookRow?.author ?? ''), [
        { title: chapter.title, doc }
      ], { getImage });
      await this.bridge.fs.writeBinaryFile(outputPath, new Uint8Array(buf));
      return;
    }
    if (format === 'docx') {
      const buf = await this.docxExporter.convertDoc(doc, chapter.title, { getImage });
      await this.bridge.fs.writeBinaryFile(outputPath, buf);
      return;
    }
    if (format === 'markdown') {
      // 图片复制到输出目录 images/，正文相对路径引用
      const mdImages = new Map<string, ExportImage>();
      const resolveImageSrc = (attrs: { assetId: string }): string | null => {
        const img = getImage(attrs.assetId);
        if (!img) return null;
        const src = `images/${img.assetId}.${extOfMime(img.mimeType)}`;
        mdImages.set(src, img);
        return src;
      };
      const text = this.markdownExporter.convertDoc(doc, chapter.title, { resolveImageSrc });
      await this.bridge.fs.writeFile(outputPath, text);
      if (mdImages.size > 0) {
        const outDir = outputPath.replace(/[\\/][^\\/]+$/, '');
        await this.bridge.fs.ensureDir(`${outDir}/images`);
        for (const [src, img] of mdImages) {
          await this.bridge.fs.writeBinaryFile(`${outDir}/${src}`, img.bytes);
        }
      }
      return;
    }
    await this.bridge.fs.writeFile(outputPath, this.txtExporter.convertDoc(doc, chapter.title));
  }

  /** 导出全书为指定格式（按章节树序合并，含目录页）；P3：EPUB/DOCX/MD 默认含图片与封面 */
  async exportBook(
    bookId: string,
    format: ExportFormat,
    outputPath: string,
    onProgress?: (done: number, total: number) => void,
    options?: ExportBookOptions
  ): Promise<void> {
    const bookRow = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM books WHERE id = ?',
      [bookId]
    );
    if (!bookRow) throw new Error('书籍不存在');
    const bookTitle = String(bookRow.title);
    const bookAuthor = String(bookRow.author ?? '');
    const storageDir = String(bookRow.storage_dir ?? '').replace(/\\/g, '/');
    const includeImages = options?.includeImages !== false;

    if (format === 'backup') {
      await this.exportBackup(bookId, outputPath, onProgress);
      return;
    }

    const chapters = await this.chapterService.listTreeOrder(bookId);
    const total = chapters.length;

    // 预载全部章节（图片解析需要先拿到文档）
    const parts: Array<{ title: string; doc: ProseMirrorDoc }> = [];
    let i = 0;
    for (const ch of chapters) {
      parts.push({ title: ch.title, doc: await this.chapterService.getContent(ch.id) });
      i++;
      onProgress?.(i, total);
    }

    // P3：预载图片（封面 + 正文引用的插图；文件缺失返回 null -> 导出降级占位）
    const imageBundle = includeImages
      ? await this.loadExportImages(bookId, storageDir, String(bookRow.cover_path ?? ''), parts)
      : { images: new Map<string, ExportImage>(), cover: null as ExportImage | null };
    const getImage = (assetId: string): ExportImage | null => imageBundle.images.get(assetId) ?? null;

    if (format === 'epub') {
      const buf = await this.epubExporter.exportEpub(bookTitle, bookAuthor, parts, {
        cover: imageBundle.cover,
        getImage
      });
      await this.bridge.fs.writeBinaryFile(outputPath, new Uint8Array(buf));
      return;
    }

    if (format === 'docx') {
      const buf = await this.docxExporter.convertBook(
        { title: bookTitle, author: bookAuthor, genre: String(bookRow.genre ?? '') },
        parts,
        { cover: imageBundle.cover, getImage }
      );
      await this.bridge.fs.writeBinaryFile(outputPath, buf);
      return;
    }

    const exporter = format === 'markdown' ? this.markdownExporter : this.txtExporter;
    const sep = format === 'markdown' ? '\n\n---\n\n' : '\n\n\n';
    const partsText: string[] = [
      format === 'markdown' ? `# ${bookTitle}\n\n${bookAuthor ? `> ${bookAuthor}\n` : ''}` : `${bookTitle}\n${'='.repeat(bookTitle.length)}`
    ];

    // Markdown：图片复制到输出目录 images/，正文用相对路径引用（TXT 忽略图片）
    const mdImages = new Map<string, ExportImage>(); // 相对 src -> 图片
    const mdResolveImageSrc =
      format === 'markdown' && includeImages
        ? (attrs: { assetId: string }): string | null => {
            const img = getImage(attrs.assetId);
            if (!img) return null;
            const src = `images/${img.assetId}.${extOfMime(img.mimeType)}`;
            mdImages.set(src, img);
            return src;
          }
        : undefined;

    for (const ch of parts) {
      const heading = format === 'markdown' ? `## ${ch.title}` : ch.title;
      const body = exporter.convertDoc(ch.doc, '', mdResolveImageSrc ? { resolveImageSrc: mdResolveImageSrc } : undefined).trim();
      partsText.push(`${heading}\n\n${body}`);
    }
    await this.bridge.fs.writeFile(outputPath, partsText.join(sep));

    // Markdown 图片落盘到输出目录 images/
    if (mdImages.size > 0) {
      const outDir = outputPath.replace(/[\\/][^\\/]+$/, '');
      await this.bridge.fs.ensureDir(`${outDir}/images`);
      for (const [src, img] of mdImages) {
        await this.bridge.fs.writeBinaryFile(`${outDir}/${src}`, img.bytes);
      }
    }
  }

  /**
   * 预载导出所需图片：封面（cover_path）+ 各章节 imageBlock 引用的插图
   * 文件缺失（被手动删除等）返回 null 条目，导出侧降级为占位文字
   */
  private async loadExportImages(
    bookId: string,
    storageDir: string,
    coverPath: string,
    parts: Array<{ title: string; doc: ProseMirrorDoc }>
  ): Promise<{ images: Map<string, ExportImage | null>; cover: ExportImage | null }> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM images WHERE book_id = ?',
      [bookId]
    );
    const byId = new Map<string, Record<string, unknown>>();
    for (const r of rows) byId.set(String(r.id), r);

    const readFile = async (absPath: string): Promise<Uint8Array | null> => {
      try {
        return await this.bridge.fs.readBinaryFile(absPath);
      } catch {
        return null;
      }
    };
    const toImage = (assetId: string, fileName: string, bytes: Uint8Array, mimeType: string, width: number, height: number): ExportImage => ({
      assetId,
      fileName,
      bytes,
      mimeType,
      width,
      height
    });

    // 正文插图
    const assetIds = new Set<string>();
    for (const p of parts) {
      for (const id of collectImageAssetIds(p.doc)) assetIds.add(id);
    }
    const images = new Map<string, ExportImage | null>();
    for (const id of assetIds) {
      const row = byId.get(id);
      if (!row) {
        images.set(id, null);
        continue;
      }
      const fileName = String(row.file_name);
      const bytes = await readFile(`${storageDir}/${fileName}`);
      if (!bytes) {
        images.set(id, null);
        continue;
      }
      images.set(
        id,
        toImage(id, fileName, bytes, String(row.mime_type), Number(row.width), Number(row.height))
      );
    }

    // 封面：优先按 images 表记录，无记录时按文件路径直读（宽高/类型按字节嗅探）
    let cover: ExportImage | null = null;
    if (coverPath) {
      const normalizedCover = coverPath.replace(/\\/g, '/');
      const coverRow = rows.find((r) => String(r.file_name).replace(/\\/g, '/') === normalizedCover);
      const bytes = await readFile(`${storageDir}/${normalizedCover}`);
      if (bytes) {
        if (coverRow) {
          cover = toImage(
            String(coverRow.id),
            normalizedCover,
            bytes,
            String(coverRow.mime_type),
            Number(coverRow.width),
            Number(coverRow.height)
          );
        } else {
          const size = parseImageSize(bytes) ?? { width: 0, height: 0 };
          cover = toImage('cover', normalizedCover, bytes, sniffImageMime(bytes), size.width, size.height);
        }
      }
    }

    return { images, cover };
  }

  /**
   * .zip 备份包导出（P3 v2）：
   * meta.json（书籍元数据 + 章节树 + 角色卡 + 世界书 + 伏笔 + 图片资产数组）
   * chapters/NNN.json（每章独立 ProseMirror 文档，流式逐章写入）
   * assets/xxx.png（图片二进制，ZipWriter.addBinary）
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
    const storageDir = String(bookRow.storage_dir ?? '').replace(/\\/g, '/');

    const chapters = await this.chapterService.listTreeOrder(bookId);
    const [
      characters,
      schemas,
      worldbook,
      foreshadowings,
      images,
      maps,
      screenplays,
      relationships,
      timelineEvents,
      settingFacts,
      settingInferences,
      inspirations,
      writingStats,
      writingGoals,
      longformSessions
    ] = await Promise.all([
      this.db.query('SELECT * FROM characters WHERE book_id = ?', [bookId]),
      this.db.query('SELECT * FROM character_schemas WHERE book_id = ?', [bookId]),
      this.db.query('SELECT * FROM worldbook_entries WHERE book_id = ?', [bookId]),
      this.db.query('SELECT * FROM foreshadowings WHERE book_id = ?', [bookId]),
      this.db.query('SELECT * FROM images WHERE book_id = ?', [bookId]),
      // v3：P2-P5 各模块补齐（此前备份恢复会丢失）
      this.db.query('SELECT * FROM maps WHERE book_id = ?', [bookId]),
      this.db.query('SELECT * FROM screenplays WHERE book_id = ?', [bookId]),
      this.db.query('SELECT * FROM relationships WHERE book_id = ?', [bookId]),
      this.db.query('SELECT * FROM timeline_events WHERE book_id = ?', [bookId]),
      this.db.query('SELECT * FROM setting_facts WHERE book_id = ?', [bookId]),
      this.db.query(
        'SELECT si.* FROM setting_inferences si JOIN setting_facts sf ON sf.id = si.fact_id WHERE si.book_id = ?',
        [bookId]
      ),
      this.db.query('SELECT * FROM inspirations WHERE book_id = ?', [bookId]),
      this.db.query('SELECT * FROM writing_stats WHERE book_id = ?', [bookId]),
      this.db.query('SELECT * FROM writing_goals WHERE book_id = ?', [bookId]),
      this.db.query('SELECT * FROM longform_sessions WHERE book_id = ?', [bookId])
    ]);

    const meta = {
      version: 3,
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
      foreshadowings,
      // P3 v2：图片资产元数据（文件本体在 zip 的 assets/ 目录）
      images,
      // v3：地图（data JSON 在表内；底图二进制在 zip 的 mapbg/ 目录）
      maps,
      // v3：剧本（data JSON 内 sourceChapterId / imageAssetId 由导入侧重映射）
      screenplays,
      relationships,
      timelineEvents,
      settingFacts,
      settingInferences,
      // v3：按书绑定的灵感（推演报告 / 采访摘要）；全局种子与收藏卡片不在单书备份范围
      inspirations,
      writingStats,
      writingGoals,
      longformSessions
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

    // P3 v2：图片二进制入包（文件缺失跳过，导入侧按缺失降级）
    let j = 0;
    for (const img of images) {
      const fileName = String(img.file_name).replace(/\\/g, '/');
      try {
        const bytes = await this.bridge.fs.readBinaryFile(`${storageDir}/${fileName}`);
        zip.addBinary(fileName, bytes); // 'assets/xxx.png'（与 file_name 相对路径一致）
      } catch {
        /* 图片文件缺失：跳过，不中断备份 */
      }
      j++;
      onProgress?.(chapters.length + j, chapters.length + images.length);
    }

    // v3：项目级指令文件 + 全书大纲（storageDir 根，缺失跳过；outline.md 为 G1 兼容扩展）
    for (const name of ['agents.md', 'hook.md', 'outline.md']) {
      try {
        const text = await this.bridge.fs.readFile(`${storageDir}/${name}`);
        if (text.trim() !== '') zip.addText(`directives/${name}`, text);
      } catch {
        /* 未创建则跳过 */
      }
    }

    // v3：地图底图二进制（background_path 相对 appData，如 maps/<id>_bg.png；入包为 mapbg/<文件名>）
    if (maps.length > 0) {
      const appDir = await this.bridge.storage.appDataDir();
      for (const m of maps) {
        const rel = String(m.background_path ?? '').replace(/\\/g, '/');
        if (!rel) continue;
        try {
          const bytes = await this.bridge.fs.readBinaryFile(`${appDir}/${rel}`);
          zip.addBinary(`mapbg/${rel.split('/').pop()}`, bytes);
        } catch {
          /* 底图缺失：跳过，导入侧降级为无底图 */
        }
      }
    }

    const out = await zip.finish();
    await this.bridge.fs.writeBinaryFile(outputPath, out);
  }
}
