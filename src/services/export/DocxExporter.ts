/**
 * DocxExporter（P1-M? 导出 Word）：ProseMirror -> .docx（纯 JS docx 库，无 pandoc 依赖）
 * 全书导出：封面标题页 + 目录页 + 页眉（书名）+ 页脚（页码）
 */

import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  TableOfContents,
  TextRun
} from 'docx';
import type { ProseMirrorDoc } from '../../types';

export interface BookMeta {
  title: string;
  author: string;
  genre: string;
}

interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
}

function inlineText(node: PMNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'characterMention') return String(node.attrs?.name ?? '');
  if (node.type === 'worldbookRef') return String(node.attrs?.title ?? '');
  if (node.type === 'chapterRef') return String(node.attrs?.title ?? '');
  if (node.content) return node.content.map(inlineText).join('');
  return '';
}

function blockText(block: PMNode): string {
  if (block.content) return block.content.map(inlineText).join('');
  return '';
}

/** PM 文档 -> docx 段落（标题/引用/对白/普通段落；跳过 AI 临时节点） */
function docParagraphs(doc: ProseMirrorDoc): Paragraph[] {
  const out: Paragraph[] = [];
  for (const block of (doc.content ?? []) as PMNode[]) {
    switch (block.type) {
      case 'heading': {
        const level = Number(block.attrs?.level ?? 2);
        out.push(
          new Paragraph({
            text: blockText(block),
            heading: level <= 1 ? HeadingLevel.HEADING_1 : level === 2 ? HeadingLevel.HEADING_2 : HeadingLevel.HEADING_3
          })
        );
        break;
      }
      case 'blockquote':
        for (const sub of block.content ?? []) {
          out.push(
            new Paragraph({
              children: [new TextRun({ text: blockText(sub), italics: true })],
              indent: { left: 480 }
            })
          );
        }
        break;
      case 'dialogue':
        out.push(new Paragraph({ text: `「${blockText(block)}」` }));
        break;
      case 'aiTemp':
        break;
      default:
        out.push(new Paragraph({ text: blockText(block) }));
    }
  }
  return out;
}

const FONT = { ascii: 'SimSun', eastAsia: '宋体', hAnsi: 'SimSun' };

function run(text: string, opts: { bold?: boolean; size?: number } = {}): TextRun {
  return new TextRun({ text, bold: opts.bold, size: opts.size, font: FONT });
}

export class DocxExporter {
  readonly extension = 'docx';
  readonly binary = true;

  /** 单章导出 */
  async convertDoc(doc: ProseMirrorDoc, chapterTitle: string): Promise<Uint8Array> {
    const document = new Document({
      styles: {
        default: {
          document: { run: { font: FONT, size: 24 } }
        }
      },
      sections: [
        {
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              spacing: { after: 400 },
              children: [run(chapterTitle, { bold: true, size: 32 })]
            }),
            ...docParagraphs(doc)
          ]
        }
      ]
    });
    return new Uint8Array(await (await Packer.toBlob(document)).arrayBuffer());
  }

  /** 全书导出：标题页 + 目录页 + 各章（页眉书名 / 页脚页码） */
  async convertBook(
    bookMeta: BookMeta,
    chapters: Array<{ title: string; doc: ProseMirrorDoc }>
  ): Promise<Uint8Array> {
    const children: (Paragraph | TableOfContents)[] = [];

    // 标题页
    children.push(
      new Paragraph({ text: '', spacing: { before: 2400 } }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
        children: [run(bookMeta.title, { bold: true, size: 56 })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 200 },
        children: [run(bookMeta.author ? `${bookMeta.author} 著` : '', { size: 28 })]
      }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [run(bookMeta.genre ? `类型：${bookMeta.genre}` : '', { size: 22 })]
      }),
      new Paragraph({ children: [new PageBreak()] })
    );

    // 目录页（打开时 Word 提示更新域生成）
    children.push(
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { after: 300 },
        children: [run('目录', { bold: true, size: 32 })]
      }),
      new TableOfContents('目录', { hyperlink: true, headingStyleRange: '1-1' }),
      new Paragraph({ children: [new PageBreak()] })
    );

    // 各章
    for (let i = 0; i < chapters.length; i++) {
      const ch = chapters[i];
      children.push(
        new Paragraph({
          heading: HeadingLevel.HEADING_1,
          alignment: AlignmentType.CENTER,
          spacing: { after: 300 },
          children: [run(ch.title, { bold: true, size: 32 })]
        }),
        ...docParagraphs(ch.doc)
      );
      if (i < chapters.length - 1) {
        children.push(new Paragraph({ children: [new PageBreak()] }));
      }
    }

    const document = new Document({
      features: { updateFields: true },
      styles: {
        default: {
          document: { run: { font: FONT, size: 24 } }
        }
      },
      sections: [
        {
          headers: {
            default: new Header({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [run(bookMeta.title, { size: 18 })]
                })
              ]
            })
          },
          footers: {
            default: new Footer({
              children: [
                new Paragraph({
                  alignment: AlignmentType.CENTER,
                  children: [
                    new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 18 })
                  ]
                })
              ]
            })
          },
          children
        }
      ]
    });

    return new Uint8Array(await (await Packer.toBlob(document)).arrayBuffer());
  }
}
