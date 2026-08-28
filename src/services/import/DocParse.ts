/**
 * TXT / Markdown 文档导入解析（纯函数，无 IO 与运行时依赖，服务层与单测直接可用）
 *
 * 章节切分（行首锚定，标题取整行去除前后空白）：
 * - 卷：第X卷 / 第X部 / 卷X（X 支持汉字与阿拉伯数字）
 * - 章：第X章 / 第X节（标题可与序号连写）｜第X回（序号后必须接空白，避免「第二回合」误判）｜
 *      Chapter N｜序章 / 序幕 / 楔子 / 引子 / 尾声 / 终章 / 番外 / 前言 / 后记
 * - Markdown 标题行剥掉 # 前缀后同样参与匹配；未命中边界的标题保留为正文标题块
 * - 全文无章节边界时降级为单章（标题「全文」）
 *
 * 文本块规则：
 * - TXT：非空行即段落（剥首部全角/半角缩进）；整行「…」或"…"识别为对白块（存裸文本）
 * - Markdown：标题层级压到 1-3（对齐编辑器 Heading levels 配置）、连续引用行合并为一个
 *   引用块、分隔线、单层列表、行内 **粗体** / *斜体* / `代码`；图片行降级为占位文本段落，
 *   代码围栏标记行剥除、围栏内行按普通段落保留
 */

import type { ProseMirrorDoc } from '../../types';

/** 序号字符集（汉字 + 阿拉伯数字） */
const CN_NUM = '0-9〇零一二三四五六七八九十百千万两';

const VOLUME_RE = new RegExp(`^(?:第\\s*[${CN_NUM}]+\\s*[卷部]|卷\\s*[${CN_NUM}]+)(?:\\s.*|)$`);
// 章/节：连写标题（「第三章节奏」）一律按边界处理、整行作标题——正文段几乎不以「第X章」开头，
// 漏切的代价（全书一章）远高于误切；回需要分隔（「第二回合」不是章）
const CHAPTER_RE = new RegExp(`^第\\s*[${CN_NUM}]+\\s*[章节]`);
const HUI_RE = new RegExp(`^第\\s*[${CN_NUM}]+\\s*回(?:\\s.*|)$`);
// 固定章名：后接空白标题 / 序号（可带标题）/ 行尾
const SPECIAL_RE = new RegExp(
  `^(?:序章|序幕|楔子|引子|尾声|终章|番外|前言|后记)(?:\\s.*|[${CN_NUM}]+(?:\\s.*|)|)$`
);
const EN_CHAPTER_RE = /^Chapter\s+\d+(?:\s.*|)$/i;
const MD_HEADING_RE = /^#{1,6}\s+/;

export interface ParsedChapter {
  title: string;
  /** 所属卷标题；null 为不属于任何卷 */
  volume: string | null;
  /** 卷头行自身（即多卷树中的卷节点，标题与 volume 相同）；卷头行不重复派生子章 */
  isVolume?: boolean;
  blocks: BlockNode[];
}

export type InlineNode = { type: 'text'; text: string; marks?: Array<{ type: string }> };

export type BlockNode =
  | { type: 'paragraph'; content?: InlineNode[] }
  | { type: 'heading'; attrs: { level: number }; content?: InlineNode[] }
  | { type: 'blockquote'; content: Array<{ type: 'paragraph'; content?: InlineNode[] }> }
  | { type: 'dialogue'; content?: InlineNode[] }
  | { type: 'horizontalRule' }
  | { type: 'bulletList'; content: Array<{ type: 'listItem'; content: BlockNode[] }> }
  | { type: 'orderedList'; content: Array<{ type: 'listItem'; content: BlockNode[] }> };

/** 行首章节/卷边界检测；返回 null 表示正文行。MD 模式先剥标题前缀 */
export function detectBoundary(rawLine: string, markdown: boolean): { kind: 'volume' | 'chapter'; title: string } | null {
  let line = rawLine.trim();
  if (!line) return null;
  if (markdown) line = line.replace(MD_HEADING_RE, '').trim();
  if (!line) return null;
  if (VOLUME_RE.test(line)) return { kind: 'volume', title: line };
  if (CHAPTER_RE.test(line) || HUI_RE.test(line) || SPECIAL_RE.test(line) || EN_CHAPTER_RE.test(line)) {
    return { kind: 'chapter', title: line };
  }
  return null;
}

/** 行内标记解析：**粗体** / *斜体* / _斜体_ / `代码`，其余为纯文本 */
export function parseInline(text: string): InlineNode[] {
  if (!text) return [];
  const out: InlineNode[] = [];
  const re = /\*\*([^*]+)\*\*|\*([^*]+)\*|_([^_]+)_|`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ type: 'text', text: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ type: 'text', text: m[1], marks: [{ type: 'bold' }] });
    else if (m[2] !== undefined) out.push({ type: 'text', text: m[2], marks: [{ type: 'italic' }] });
    else if (m[3] !== undefined) out.push({ type: 'text', text: m[3], marks: [{ type: 'italic' }] });
    else if (m[4] !== undefined) out.push({ type: 'text', text: m[4], marks: [{ type: 'code' }] });
    last = re.lastIndex;
  }
  if (last < text.length) out.push({ type: 'text', text: text.slice(last) });
  return out;
}

type ParaNode = { type: 'paragraph'; content?: InlineNode[] };

const para = (content: InlineNode[]): ParaNode => ({ type: 'paragraph', content });

/** 整行「…」或"…" -> 对白块（剥外侧引号存裸文本，导出侧 docToMarkdown 会补回「」） */
function txtLineBlock(rawLine: string): BlockNode | null {
  const t = rawLine.replace(/^[\s\u3000]+/, '').replace(/\s+$/, '');
  if (!t) return null;
  const quoted = /^「(.*)」$/.exec(t) ?? /^“(.*)”$/.exec(t);
  if (quoted) return { type: 'dialogue', content: parseInline(quoted[1].trim()) };
  return para(parseInline(t));
}

interface MdGroupState {
  quote: Array<{ type: 'paragraph'; content?: InlineNode[] }> | null;
  list: { ordered: boolean; items: BlockNode[] } | null;
}

function mdLineBlock(rawLine: string, st: MdGroupState, blocks: BlockNode[]): void {
  const line = rawLine.replace(/\s+$/, '');
  const flushQuote = (): void => {
    if (st.quote) {
      blocks.push({ type: 'blockquote', content: st.quote });
      st.quote = null;
    }
  };
  const flushList = (): void => {
    if (st.list) {
      blocks.push({
        type: st.list.ordered ? 'orderedList' : 'bulletList',
        content: st.list.items.map((p) => ({ type: 'listItem', content: [p] }))
      });
      st.list = null;
    }
  };

  if (/^\s*>/.test(line)) {
    flushList();
    (st.quote ??= []).push(para(parseInline(line.replace(/^\s*>\s?/, '').trim())));
    return;
  }
  flushQuote();
  const ul = /^\s*[-*+]\s+(.*)$/.exec(line);
  const ol = /^\s*\d+[.、)]\s+(.*)$/.exec(line);
  if (ul || ol) {
    const ordered = !!ol;
    if (st.list && st.list.ordered !== ordered) flushList();
    (st.list ??= { ordered, items: [] }).items.push(para(parseInline((ul ?? ol)![1])));
    return;
  }
  // 非列表行（含空行/标题/分隔线）终止当前列表分组
  flushList();
  if (/^\s*(?:-{3,}|\*{3,}|_{3,})\s*$/.test(line)) {
    blocks.push({ type: 'horizontalRule' });
    return;
  }
  const heading = /^(#{1,6})\s+(.*)$/.exec(line);
  if (heading) {
    blocks.push({
      type: 'heading',
      attrs: { level: Math.min(heading[1].length, 3) },
      content: parseInline(heading[2].trim())
    });
    return;
  }
  const img = /^!\[([^\]]*)\]\([^)]*\)\s*$/.exec(line.trim());
  if (img) {
    blocks.push(para([{ type: 'text', text: `[图片: ${img[1]}]` }]));
    return;
  }
  if (/^\s*```/.test(line)) return; // 代码围栏标记行剥除，围栏内行按普通段落保留
  if (!line.trim()) return;
  blocks.push(para(parseInline(line.trim())));
}

/** 文本 -> 解析章节列表（含无边界降级单章与首章前置内容归并） */
export function parseDocument(content: string, opts: { markdown: boolean }): ParsedChapter[] {
  const lines = content.replace(/\r\n?/g, '\n').split('\n');
  const chapters: ParsedChapter[] = [];
  const mdState: MdGroupState = { quote: null, list: null };
  let pending: BlockNode[] = []; // 首个章节边界前的内容（无前言标题时归并进首章）
  let curVolume: string | null = null; // 当前卷标题，传播给后续章节条目

  for (const raw of lines) {
    const header = detectBoundary(raw, opts.markdown);
    if (header) {
      if (header.kind === 'volume') curVolume = header.title;
      // 冲掉未完成的 MD 分组，避免引用/列表跨章节边界粘连
      if (mdState.quote) {
        pending.push({ type: 'blockquote', content: mdState.quote });
        mdState.quote = null;
      }
      if (mdState.list) {
        pending.push({
          type: mdState.list.ordered ? 'orderedList' : 'bulletList',
          content: mdState.list.items.map((p) => ({ type: 'listItem', content: [p] }))
        });
        mdState.list = null;
      }
      chapters.push({
        title: header.title,
        volume: header.kind === 'volume' ? header.title : curVolume,
        isVolume: header.kind === 'volume',
        blocks: [...pending]
      });
      pending = [];
      continue;
    }
    if (opts.markdown) mdLineBlock(raw, mdState, chapters.length ? chapters[chapters.length - 1].blocks : pending);
    else {
      const block = txtLineBlock(raw);
      if (block) (chapters.length ? chapters[chapters.length - 1].blocks : pending).push(block);
    }
  }
  // 收尾：未闭合的引用/列表分组归入末章（无章节时归入 pending，随单章降级输出）
  const tail = chapters.length ? chapters[chapters.length - 1].blocks : pending;
  if (mdState.quote) tail.push({ type: 'blockquote', content: mdState.quote });
  if (mdState.list) {
    tail.push({
      type: mdState.list.ordered ? 'orderedList' : 'bulletList',
      content: mdState.list.items.map((p) => ({ type: 'listItem', content: [p] }))
    });
  }
  if (chapters.length === 0) {
    return [{ title: '全文', volume: null, blocks: pending }];
  }
  return chapters;
}

/** 块列表 -> ProseMirror doc（空块降级为单个空段落，与 emptyDoc 语义一致） */
export function blocksToDoc(blocks: BlockNode[]): ProseMirrorDoc {
  const content: unknown[] = blocks.length ? blocks : [{ type: 'paragraph' }];
  return { type: 'doc', content };
}

/** 块列表纯文本（导空判与他人展示用） */
export function blocksPlainText(blocks: BlockNode[]): string {
  const walk = (node: { content?: unknown[]; text?: string }): string => {
    if (typeof node.text === 'string') return node.text;
    if (!node.content) return '';
    return node.content.map((c) => walk(c as { content?: unknown[]; text?: string })).join('\n');
  };
  return blocks.map((b) => walk(b as unknown as { content?: unknown[] })).join('\n');
}
