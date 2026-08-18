/**
 * ProseMirror 文档 JSON 的纯数据操作：
 * 文本提取 / Markdown·HTML·纯文本转换 / 文本替换 / 空文档
 * （不依赖 TipTap 运行时，可在服务层直接处理落盘 JSON）
 */

import type { ProseMirrorDoc } from '../types';

interface PMNode {
  type: string;
  attrs?: Record<string, unknown>;
  content?: PMNode[];
  text?: string;
  marks?: Array<{ type: string; attrs?: Record<string, unknown> }>;
}

export function emptyDoc(): ProseMirrorDoc {
  return { type: 'doc', content: [{ type: 'paragraph' }] };
}

export function isPMDoc(v: unknown): v is ProseMirrorDoc {
  return (
    typeof v === 'object' &&
    v !== null &&
    (v as { type?: string }).type === 'doc' &&
    Array.isArray((v as { content?: unknown }).content)
  );
}

/** 内联节点 -> 纯文本（提及/引用转为名称文本） */
function inlineText(node: PMNode): string {
  if (node.type === 'text') return node.text ?? '';
  if (node.type === 'characterMention') return String(node.attrs?.name ?? '');
  if (node.type === 'worldbookRef') return String(node.attrs?.title ?? '');
  if (node.type === 'chapterRef') return String(node.attrs?.title ?? '');
  if (node.content) return node.content.map(inlineText).join('');
  return '';
}

/** 块级段落文本列表（跳过 AI 临时节点） */
export function blockTexts(doc: ProseMirrorDoc): string[] {
  const out: string[] = [];
  for (const block of (doc.content ?? []) as PMNode[]) {
    if (block.type === 'aiTemp') continue;
    if (block.type === 'heading') {
      out.push(`## ${blockText(block)}`);
    } else if (block.type === 'blockquote') {
      for (const sub of block.content ?? []) {
        out.push(`> ${blockText(sub)}`);
      }
    } else {
      out.push(blockText(block));
    }
  }
  return out;
}

function blockText(block: PMNode): string {
  if (block.content) return block.content.map(inlineText).join('');
  return '';
}

/** 文档 → 纯文本（段落空行分隔） */
export function docToPlainText(doc: ProseMirrorDoc): string {
  return blockTexts(doc).join('\n\n');
}

/** 文档 → Markdown */
export function docToMarkdown(doc: ProseMirrorDoc): string {
  const lines: string[] = [];
  for (const block of (doc.content ?? []) as PMNode[]) {
    switch (block.type) {
      case 'heading': {
        const level = Number(block.attrs?.level ?? 2);
        lines.push(`${'#'.repeat(Math.min(level, 6))} ${blockText(block)}`);
        break;
      }
      case 'blockquote': {
        for (const sub of block.content ?? []) {
          lines.push(`> ${blockText(sub)}`);
        }
        break;
      }
      case 'horizontalRule':
        lines.push('---');
        break;
      case 'dialogue':
        lines.push(`「${blockText(block)}」`);
        break;
      case 'aiTemp':
        break;
      default:
        lines.push(blockText(block));
    }
    lines.push('');
  }
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 文档 → HTML（EPUB 用） */
export function docToHtml(doc: ProseMirrorDoc): string {
  const parts: string[] = [];
  for (const block of (doc.content ?? []) as PMNode[]) {
    switch (block.type) {
      case 'heading': {
        const level = Math.min(Number(block.attrs?.level ?? 2), 3);
        parts.push(`<h${level}>${escapeHtml(blockText(block))}</h${level}>`);
        break;
      }
      case 'blockquote':
        parts.push(`<blockquote>${escapeHtml(blockText(block))}</blockquote>`);
        break;
      case 'horizontalRule':
        parts.push('<hr/>');
        break;
      case 'dialogue':
        parts.push(`<p class="dialogue">${escapeHtml(blockText(block))}</p>`);
        break;
      case 'aiTemp':
        break;
      default:
        parts.push(`<p>${escapeHtml(blockText(block))}</p>`);
    }
  }
  return parts.join('\n');
}

/** 文档内文本替换（含提及/引用节点的 attrs），返回新文档与替换次数 */
export function replaceInDoc(
  doc: ProseMirrorDoc,
  search: RegExp,
  replacement: string
): { doc: ProseMirrorDoc; count: number } {
  let count = 0;
  const cloned = structuredClone(doc) as ProseMirrorDoc;

  const walkInline = (node: PMNode): void => {
    if (node.type === 'text' && node.text) {
      const matches = node.text.match(search);
      if (matches) {
        count += matches.length;
        node.text = node.text.replace(search, replacement);
      }
    }
    if (node.type === 'characterMention' || node.type === 'worldbookRef' || node.type === 'chapterRef') {
      const attrKey = node.type === 'characterMention' ? 'name' : 'title';
      const val = node.attrs?.[attrKey];
      if (typeof val === 'string') {
        const matches = val.match(search);
        if (matches) {
          count += matches.length;
          node.attrs = { ...node.attrs, [attrKey]: val.replace(search, replacement) };
        }
      }
    }
    for (const child of node.content ?? []) walkInline(child);
  };

  for (const block of (cloned.content ?? []) as PMNode[]) {
    walkInline(block);
  }
  return { doc: cloned, count };
}

/** 字数统计（去空白后字符数） */
export function countWords(doc: ProseMirrorDoc): number {
  return docToPlainText(doc).replace(/\s/g, '').length;
}
