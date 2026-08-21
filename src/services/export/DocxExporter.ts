/**
 * DocxExporter（P1-M? 导出 Word）：ProseMirror -> .docx（纯 JS docx 库，无 pandoc 依赖）
 * 全书导出：封面标题页 + 目录页 + 页眉（书名）+ 页脚（页码）
 *
 * P3：封面首页内嵌 + 正文插图 ImageRun 内嵌；WebP 经 canvas 转 PNG（Word 不支持 WebP）；
 * 图片缺失时降级为占位文字，不中断导出。
 */

import {
  AlignmentType,
  Document,
  Footer,
  Header,
  HeadingLevel,
  ImageRun,
  PageBreak,
  PageNumber,
  Packer,
  Paragraph,
  TableOfContents,
  TextRun
} from 'docx';
import type { ProseMirrorDoc } from '../../types';
import type { ExportImage } from './ExportService';

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

/** docx 可用的图片（WebP 已转 PNG） */
interface DocxImage {
  data: Uint8Array;
  type: 'png' | 'jpg' | 'gif' | 'bmp';
  width: number;
  height: number;
}

async function prepareImage(img: ExportImage): Promise<DocxImage> {
  if (img.mimeType === 'image/webp') {
    try {
      const blob = new Blob([img.bytes as unknown as BlobPart], { type: 'image/webp' });
      const bitmap = await createImageBitmap(blob);
      const canvas = document.createElement('canvas');
      canvas.width = bitmap.width;
      canvas.height = bitmap.height;
      const ctx = canvas.getContext('2d');
      if (ctx) ctx.drawImage(bitmap, 0, 0);
      const pngBlob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/png'));
      if (pngBlob) {
        return {
          data: new Uint8Array(await pngBlob.arrayBuffer()),
          type: 'png',
          width: bitmap.width,
          height: bitmap.height
        };
      }
    } catch {
      /* 转换失败走 png 直写（Word 可能无法渲染，但不中断导出） */
    }
  }
  const type: DocxImage['type'] =
    img.mimeType === 'image/jpeg'
      ? 'jpg'
      : img.mimeType === 'image/gif'
        ? 'gif'
        : img.mimeType === 'image/bmp'
          ? 'bmp'
          : 'png';
  return { data: img.bytes, type, width: img.width, height: img.height };
}

/** 导出选项：封面图片 + 按资产 ID 解析插图 */
export interface DocxExportOptions {
  cover?: ExportImage | null;
  getImage?: (assetId: string) => ExportImage | null;
}

/** PM 文档 -> docx 段落（标题/引用/对白/插图/普通段落；跳过 AI 临时节点） */
function docParagraphs(doc: ProseMirrorDoc, images?: Map<string, DocxImage>): Paragraph[] {
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
      case 'imageBlock': {
        const assetId = String(block.attrs?.assetId ?? '');
        const fileName = String(block.attrs?.fileName ?? '');
        const caption = String(block.attrs?.caption ?? '');
        const pct = Math.max(25, Math.min(100, Number(block.attrs?.width) || 100));
        const align = String(block.attrs?.align ?? 'center');
        const alignment =
          align === 'left' ? AlignmentType.LEFT : align === 'right' ? AlignmentType.RIGHT : AlignmentType.CENTER;
        const img = images?.get(assetId);
        if (!img) {
          // 缺图降级：占位文字，不中断导出
          out.push(
            new Paragraph({
              alignment,
              children: [new TextRun({ text: `[图片缺失: ${fileName || assetId}]`, italics: true, color: '999999' })]
            })
          );
          break;
        }
        // 尺寸：目标宽 = 正文宽（~580px）* 宽度百分比，不放大超过原图；高限制 720px
        const natW = img.width > 0 ? img.width : 400;
        const natH = img.height > 0 ? img.height : 300;
        const targetW = Math.round((580 * pct) / 100);
        let dispW = Math.min(natW, targetW);
        let dispH = Math.round((dispW * natH) / natW);
        if (dispH > 720) {
          dispH = 720;
          dispW = Math.round((dispH * natW) / natH);
        }
        out.push(
          new Paragraph({
            alignment,
            spacing: { before: 200, after: caption ? 80 : 200 },
            children: [
              new ImageRun({
                type: img.type,
                data: img.data,
                transformation: { width: dispW, height: dispH }
              })
            ]
          })
        );
        if (caption) {
          out.push(
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [new TextRun({ text: caption, size: 18, color: '666666' })]
            })
          );
        }
        break;
      }
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

  /** 单章导出（可含插图） */
  async convertDoc(doc: ProseMirrorDoc, chapterTitle: string, opts?: DocxExportOptions): Promise<Uint8Array> {
    const images = await this.prepareImages(doc, opts);
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
            ...docParagraphs(doc, images)
          ]
        }
      ]
    });
    return new Uint8Array(await (await Packer.toBlob(document)).arrayBuffer());
  }

  /** 全书导出：标题页（含封面图）+ 目录页 + 各章（页眉书名 / 页脚页码，插图内嵌） */
  async convertBook(
    bookMeta: BookMeta,
    chapters: Array<{ title: string; doc: ProseMirrorDoc }>,
    opts?: DocxExportOptions
  ): Promise<Uint8Array> {
    // 预载全部章节引用的图片（含 WebP -> PNG 转换）
    const images = new Map<string, DocxImage>();
    for (const ch of chapters) {
      await this.collectImages(ch.doc, opts, images);
    }

    // 封面图（标题页内嵌）
    let coverImage: DocxImage | null = null;
    if (opts?.cover) {
      coverImage = await prepareImage(opts.cover);
    }

    const children: (Paragraph | TableOfContents)[] = [];

    // 标题页
    children.push(
      new Paragraph({ text: '', spacing: { before: coverImage ? 600 : 2400 } }),
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
      })
    );
    if (coverImage) {
      // 封面首页：居中嵌入（约 380px 宽，等比缩放）
      const natW = coverImage.width > 0 ? coverImage.width : 400;
      const natH = coverImage.height > 0 ? coverImage.height : 300;
      const dispW = Math.min(natW, 380);
      const dispH = Math.round((dispW * natH) / natW);
      children.push(
        new Paragraph({
          alignment: AlignmentType.CENTER,
          spacing: { before: 400 },
          children: [
            new ImageRun({
              type: coverImage.type,
              data: coverImage.data,
              transformation: { width: dispW, height: dispH }
            })
          ]
        })
      );
    }
    children.push(new Paragraph({ children: [new PageBreak()] }));

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
        ...docParagraphs(ch.doc, images)
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

  /** 收集文档引用的图片并转换为 docx 可用形态 */
  private async collectImages(
    doc: ProseMirrorDoc,
    opts: DocxExportOptions | undefined,
    images: Map<string, DocxImage>
  ): Promise<void> {
    const assetIds = collectAssetIds(doc);
    for (const id of assetIds) {
      if (images.has(id)) continue;
      const img = opts?.getImage?.(id);
      if (img) {
        images.set(id, await prepareImage(img));
      }
    }
  }

  private async prepareImages(
    doc: ProseMirrorDoc,
    opts: DocxExportOptions | undefined
  ): Promise<Map<string, DocxImage>> {
    const images = new Map<string, DocxImage>();
    await this.collectImages(doc, opts, images);
    return images;
  }
}

/** 遍历文档收集 imageBlock 的 assetId（DocxExporter 内部轻量实现） */
function collectAssetIds(doc: ProseMirrorDoc): string[] {
  const out: string[] = [];
  const walk = (node: PMNode): void => {
    if (node.type === 'imageBlock') {
      const id = String(node.attrs?.assetId ?? '');
      if (id) out.push(id);
      return;
    }
    for (const child of node.content ?? []) walk(child);
  };
  for (const block of (doc.content ?? []) as PMNode[]) walk(block);
  return out;
}
