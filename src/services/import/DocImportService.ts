/**
 * 文档导入服务：TXT / Markdown -> 新书籍
 * 章节切分见 DocParse；经 BookService / ChapterService 建书建章，
 * 复用 saveContent 落盘（字数统计 / FTS 索引 / 更新时间联动）
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { BookService } from '../book/BookService';
import type { ChapterService } from '../chapter/ChapterService';
import { blocksPlainText, blocksToDoc, parseDocument } from './DocParse';

export interface DocImportResult {
  bookId: string;
  title: string;
  chapterCount: number;
  volumeCount: number;
}

const DOC_EXT_RE = /\.(txt|md|markdown)$/i;
const MD_EXT_RE = /\.(md|markdown)$/i;

/** 文件名 -> 书名（去扩展名，空则降级「导入文档」） */
export function docTitleFromFileName(name: string): string {
  return name.replace(DOC_EXT_RE, '').trim() || '导入文档';
}

export class DocImportService {
  private bridge: NativeBridge;
  private books: BookService;
  private chapters: ChapterService;

  constructor(bridge: NativeBridge, books: BookService, chapters: ChapterService) {
    this.bridge = bridge;
    this.books = books;
    this.chapters = chapters;
  }

  /** 从文件路径导入（文件选择器入口）；书名取文件名去扩展名 */
  async importFromFile(path: string): Promise<DocImportResult> {
    const fileName = path.replace(/\\/g, '/').split('/').pop() ?? '';
    if (!DOC_EXT_RE.test(fileName)) throw new Error('仅支持导入 .txt / .md 文档');
    const content = await this.bridge.fs.readFile(path);
    const title = docTitleFromFileName(fileName);
    return this.importFromContent(content, title, MD_EXT_RE.test(fileName));
  }

  /** 从文本内容导入（拖放入口 / 单测直接调用） */
  async importFromContent(content: string, title: string, isMarkdown: boolean): Promise<DocImportResult> {
    if (!content.trim()) throw new Error('文件内容为空，无法导入');
    const parsed = parseDocument(content, { markdown: isMarkdown });
    if (parsed.every((c) => blocksPlainText(c.blocks).trim() === '' && !c.isVolume)) {
      throw new Error('未解析到正文内容，无法导入');
    }

    const book = await this.books.create({ title });
    let volumeId: string | null = null;
    let volumeTitle: string | null = null;
    let chapterCount = 0;
    let volumeCount = 0;

    for (const ch of parsed) {
      if (ch.isVolume && ch.volume) {
        // 卷头行 -> 卷节点（多卷树父章节）；卷头下若有引言正文，写入卷节点自身
        const vol = await this.chapters.create(book.id, { title: ch.volume, parentId: null });
        if (ch.blocks.length) await this.chapters.saveContent(vol.id, blocksToDoc(ch.blocks));
        volumeId = vol.id;
        volumeTitle = ch.volume;
        volumeCount += 1;
        continue;
      }
      let parentId: string | null = null;
      if (ch.volume) {
        if (ch.volume !== volumeTitle) {
          // 卷头行缺席（正文直接出现在未声明的卷下）：懒建卷节点
          const vol = await this.chapters.create(book.id, { title: ch.volume, parentId: null });
          volumeId = vol.id;
          volumeTitle = ch.volume;
          volumeCount += 1;
        }
        parentId = volumeId;
      } else {
        volumeId = null;
        volumeTitle = null;
      }
      const row = await this.chapters.create(book.id, { title: ch.title, parentId });
      await this.chapters.saveContent(row.id, blocksToDoc(ch.blocks));
      chapterCount += 1;
    }

    return { bookId: book.id, title, chapterCount, volumeCount };
  }
}
