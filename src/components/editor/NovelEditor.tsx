/**
 * TipTap 主编辑器：
 * - 章节虚拟化（一次只载入当前章，切换时保存旧章并卸载）
 * - 自动保存（防抖 3 秒，保存触发版本快照 + FTS 同步）
 * - @角色 / [[条目]] 触发弹窗
 * - AI 流式临时节点操控（供 AIPanel 调用）
 */

import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import type { JSONContent } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { CharacterMention } from './nodes/CharacterMention';
import { WorldbookRef } from './nodes/WorldbookRef';
import { Dialogue } from './nodes/Dialogue';
import { AITemporaryNode } from './extensions/AITemporaryNode';
import { PasteHandler } from './extensions/PasteHandler';
import { useEditorStore, type EditorApi } from '../../store/editorStore';
import { getAppContext } from '../../context/app-context';
import { docToPlainText } from '../../utils/pmdoc';
import type { ProseMirrorDoc } from '../../types';

export interface MentionItem {
  id: string;
  label: string;
}

interface PopupState {
  type: 'character' | 'worldbook';
  x: number;
  y: number;
}

/** 字体选项（Windows 常见中文字体 + 西文衬线） */
const FONT_FAMILIES: Array<{ value: string; label: string; css: string }> = [
  { value: 'default', label: '默认', css: "'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif" },
  { value: 'simsun', label: '宋体', css: 'SimSun, serif' },
  { value: 'kaiti', label: '楷体', css: 'KaiTi, serif' },
  { value: 'fangsong', label: '仿宋', css: 'FangSong, serif' },
  { value: 'simhei', label: '黑体', css: 'SimHei, sans-serif' },
  { value: 'yahei', label: '微软雅黑', css: "'Microsoft YaHei', sans-serif" },
  { value: 'dengxian', label: '等线', css: 'DengXian, sans-serif' },
  { value: 'georgia', label: 'Georgia', css: 'Georgia, serif' },
  { value: 'times', label: 'Times New Roman', css: "'Times New Roman', serif" }
];

const FONT_SIZES = [14, 15, 16, 17, 18, 20, 22, 24];

const FONT_SIZE_KEY = 'novel-editor-font-size';
const FONT_FAMILY_KEY = 'novel-editor-font-family';

interface TempFound {
  node: import('@tiptap/pm/model').Node;
  pos: number;
}

function findTemp(editor: Editor, requireNotDone = false): TempFound | null {
  let found: TempFound | null = null;
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'aiTemp' && (!requireNotDone || !node.attrs.done)) {
      found = { node, pos };
      return false;
    }
    return true;
  });
  return found;
}

/**
 * 将累计的生成文本构建为段落块：
 * 换行（含连续空行）合并为一次段落分隔，段落文本去除首尾空白
 */
function buildTempParagraphs(schema: Editor['state']['schema'], raw: string) {
  const texts = raw
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (texts.length === 0) {
    return [schema.nodes.paragraph.create()];
  }
  return texts.map((t) => schema.nodes.paragraph.create(null, schema.text(t)));
}

export function NovelEditor({ bookId }: { bookId: string }) {
  const currentChapterId = useEditorStore((s) => s.currentChapterId);
  const setSaveState = useEditorStore((s) => s.setSaveState);
  const setSelectedText = useEditorStore((s) => s.setSelectedText);
  const setEditorApi = useEditorStore((s) => s.setEditorApi);
  const saveTimerRef = useRef<number | null>(null);
  const loadedChapterRef = useRef<string | null>(null);
  const replaceRangeRef = useRef<{ from: number; to: number } | null>(null);
  const lastBracketRef = useRef(0);
  /** AI 流式累计文本（appendAITemp 重建临时节点内容的基准） */
  const aiTextRef = useRef('');
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [characters, setCharacters] = useState<MentionItem[]>([]);
  const [worldbook, setWorldbook] = useState<MentionItem[]>([]);
  const [, forceTick] = useState(0);
  // 编辑器外观：字体/字号（localStorage 持久化）
  const [fontSize, setFontSize] = useState<number>(() => {
    const v = Number(localStorage.getItem(FONT_SIZE_KEY));
    return FONT_SIZES.includes(v) ? v : 16;
  });
  const [fontFamily, setFontFamily] = useState<string>(
    () => localStorage.getItem(FONT_FAMILY_KEY) || 'default'
  );

  const changeFontSize = (v: number): void => {
    setFontSize(v);
    localStorage.setItem(FONT_SIZE_KEY, String(v));
  };
  const changeFontFamily = (v: string): void => {
    setFontFamily(v);
    localStorage.setItem(FONT_FAMILY_KEY, v);
  };
  const fontCss = FONT_FAMILIES.find((f) => f.value === fontFamily)?.css ?? FONT_FAMILIES[0].css;

  // 拉取 @ / [[ 弹窗数据；监听面板保存后的刷新事件
  useEffect(() => {
    const load = async (): Promise<void> => {
      const ctx = getAppContext();
      const chars = await ctx.characterService.list(bookId);
      setCharacters(chars.map((c) => ({ id: c.id, label: c.name })));
      const wb = await ctx.db.query<{ id: string; title: string }>(
        'SELECT id, title FROM worldbook_entries WHERE book_id = ?',
        [bookId]
      );
      setWorldbook(wb.map((w) => ({ id: String(w.id), label: String(w.title) })));
    };
    void load();
    const onRefresh = (): void => {
      void load();
    };
    window.addEventListener('novel-mentions-refresh', onRefresh);
    return () => window.removeEventListener('novel-mentions-refresh', onRefresh);
  }, [bookId]);

  /** 调度防抖 3 秒自动保存 */
  const scheduleSave = (): void => {
    setSaveState('dirty');
    if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
    saveTimerRef.current = window.setTimeout(() => {
      void useEditorStore.getState().saveCurrentChapter();
    }, 3000);
  };

  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      CharacterMention,
      WorldbookRef,
      Dialogue,
      AITemporaryNode,
      PasteHandler
    ],
    editorProps: {
      handleKeyDown: (view, event) => {
        if (event.key === '@') {
          event.preventDefault();
          const coords = view.coordsAtPos(view.state.selection.from);
          setPopup({ type: 'character', x: coords.left, y: coords.bottom + 6 });
          return true;
        }
        if (event.key === '[') {
          const now = Date.now();
          if (now - lastBracketRef.current < 800 && view.state.selection.from >= 1) {
            event.preventDefault();
            // 删除第一个 '['
            const from = view.state.selection.from - 1;
            view.dispatch(view.state.tr.delete(from, from + 1));
            const coords = view.coordsAtPos(view.state.selection.from);
            setPopup({ type: 'worldbook', x: coords.left, y: coords.bottom + 6 });
            lastBracketRef.current = 0;
            return true;
          }
          lastBracketRef.current = now;
        }
        if (event.key === 'Escape') setPopup(null);
        return false;
      }
    },
    onUpdate: () => scheduleSave(),
    onSelectionUpdate: ({ editor: e }) => {
      const { from, to, empty } = e.state.selection;
      setSelectedText(empty ? '' : e.state.doc.textBetween(from, to, '\n'));
    },
    onTransaction: () => forceTick((t) => t + 1)
  });

  // ============ 章节虚拟化：切换章节时保存旧章 + 载入新章 ============
  useEffect(() => {
    if (!editor) return;
    let cancelled = false;
    const run = async (): Promise<void> => {
      const prevId = loadedChapterRef.current;
      if (prevId && prevId !== currentChapterId) {
        // 切换前 flush 保存（仅当有未保存修改）
        if (useEditorStore.getState().saveState === 'dirty') {
          const doc = editor.getJSON() as ProseMirrorDoc;
          const { chapterService, versionStore } = getAppContext();
          try {
            await chapterService.saveContent(prevId, doc);
            await versionStore.saveVersion(prevId, doc);
            const ch = await chapterService.get(prevId);
            if (ch) {
              useEditorStore.setState((s) => ({
                chapters: s.chapters.map((c) => (c.id === ch.id ? ch : c))
              }));
            }
          } catch (e) {
            console.error('切换章节前保存失败', e);
          }
        }
        loadedChapterRef.current = null;
      }
      if (!currentChapterId) {
        editor.commands.clearContent();
        return;
      }
      const { chapterService } = getAppContext();
      const doc = await chapterService.getContent(currentChapterId);
      if (cancelled) return;
      editor.commands.setContent(doc as unknown as JSONContent);
      loadedChapterRef.current = currentChapterId;
      setSaveState('saved');
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [currentChapterId, editor, setSaveState]);

  // ============ 卸载时 flush 保存 ============
  useEffect(() => {
    return () => {
      if (saveTimerRef.current) window.clearTimeout(saveTimerRef.current);
      const chapterId = loadedChapterRef.current;
      if (chapterId && editor && useEditorStore.getState().saveState === 'dirty') {
        const doc = editor.getJSON() as ProseMirrorDoc;
        const { chapterService, versionStore } = getAppContext();
        void chapterService
          .saveContent(chapterId, doc)
          .then(() => versionStore.saveVersion(chapterId, doc))
          .catch((e) => console.error('卸载保存失败', e));
      }
    };
  }, [editor]);

  // ============ 注册编辑器 API（AI 面板调用） ============
  useEffect(() => {
    if (!editor) return;
    const api: EditorApi = {
      getDoc: () => editor.getJSON() as ProseMirrorDoc,
      getPlainText: () => docToPlainText(editor.getJSON() as ProseMirrorDoc),
      setContent: (doc) => {
        editor.commands.setContent(doc as unknown as JSONContent);
        setSaveState('saved');
      },
      getSelectedText: () => {
        const { from, to, empty } = editor.state.selection;
        return empty ? '' : editor.state.doc.textBetween(from, to, '\n');
      },
      getSelectionRange: () => {
        const { from, to, empty } = editor.state.selection;
        return empty ? null : { from, to };
      },
      startAITemp: (replaceRange) => {
        replaceRangeRef.current = replaceRange ?? null;
        aiTextRef.current = '';
        const at = replaceRange ? replaceRange.to : editor.state.selection.to;
        editor.chain().command(({ tr }) => {
          const schema = editor.state.schema;
          const para = schema.nodes.paragraph.create();
          const temp = schema.nodes.aiTemp.create(null, [para]);
          tr.insert(at, temp);
          return true;
        }).run();
      },
      appendAITemp: (text) => {
        if (!text) return;
        let found = findTemp(editor, true);
        if (!found) {
          // 继续补完：重新打开已完成的临时节点（aiTextRef 仍保留上次累计文本）
          const anyTemp = findTemp(editor);
          if (!anyTemp) return;
          editor.view.dispatch(
            editor.state.tr.setNodeMarkup(anyTemp.pos, undefined, {
              ...anyTemp.node.attrs,
              done: false
            })
          );
          found = { node: anyTemp.node, pos: anyTemp.pos };
        }
        // 累计全文后整体重建临时节点内容：
        // 段落切分完全确定（换行=分段、连续空行合并），不受流式 chunk 边界影响
        aiTextRef.current += text;
        const schema = editor.state.schema;
        const paras = buildTempParagraphs(schema, aiTextRef.current);
        const tr = editor.state.tr.replaceWith(
          found.pos + 1,
          found.pos + found.node.nodeSize - 1,
          paras
        );
        editor.view.dispatch(tr);
      },
      finishAITemp: () => {
        const found = findTemp(editor, true);
        if (!found) return null;
        const text = found.node.textContent;
        editor.view.dispatch(
          editor.state.tr.setNodeMarkup(found.pos, undefined, {
            ...found.node.attrs,
            done: true
          })
        );
        return text;
      },
      acceptAITemp: () => {
        const found = findTemp(editor);
        if (!found) return;
        const { node, pos } = found;
        const range = replaceRangeRef.current;
        replaceRangeRef.current = null;
        const tr = editor.state.tr;
        // 直接保留临时节点内已生成的段落结构
        const content = node.content;
        if (range) {
          // 改写：删除临时节点，用生成段落替换原选区
          tr.delete(pos, pos + node.nodeSize);
          if (content.size > 0) {
            tr.replaceWith(range.from, range.to, content);
          }
        } else if (content.size > 0) {
          // 续写/对白：临时节点内容解开为正常内容
          tr.replaceWith(pos, pos + node.nodeSize, content);
        }
        editor.view.dispatch(tr);
        aiTextRef.current = '';
        scheduleSave();
      },
      discardAITemp: () => {
        const found = findTemp(editor);
        if (!found) return;
        replaceRangeRef.current = null;
        aiTextRef.current = '';
        editor.view.dispatch(editor.state.tr.delete(found.pos, found.pos + found.node.nodeSize));
      },
      focus: () => editor.commands.focus()
    };
    setEditorApi(api);
    return () => setEditorApi(null);
  }, [editor, setEditorApi, setSaveState]);

  // ============ 弹窗插入 ============
  const insertMention = (item: MentionItem): void => {
    if (!editor || !popup) return;
    if (popup.type === 'character') {
      editor.chain().focus().insertCharacterMention(item.id, item.label).run();
    } else {
      editor.chain().focus().insertWorldbookRef(item.id, item.label).run();
    }
    setPopup(null);
  };

  const openPopupManually = (type: PopupState['type']): void => {
    if (!editor) return;
    const coords = editor.view.coordsAtPos(editor.state.selection.from);
    setPopup({ type, x: coords.left, y: coords.bottom + 6 });
  };

  if (!editor) {
    return <div className="p-8 text-ink-400">编辑器加载中…</div>;
  }

  return (
    <div className="novel-editor flex h-full flex-col">
      {/* 工具栏 */}
      <div className="flex flex-wrap items-center gap-1 border-b border-ink-200 bg-white px-3 py-1.5 text-sm">
        <TB onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()} active={editor.isActive('heading', { level: 1 })}>H1</TB>
        <TB onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()} active={editor.isActive('heading', { level: 2 })}>H2</TB>
        <TB onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()} active={editor.isActive('heading', { level: 3 })}>H3</TB>
        <Sep />
        <TB onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive('bold')}>B</TB>
        <TB onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive('italic')}>I</TB>
        <Sep />
        <TB onClick={() => editor.chain().focus().toggleBlockquote().run()} active={editor.isActive('blockquote')} title="引用">❝</TB>
        <TB onClick={() => editor.chain().focus().toggleDialogue().run()} active={editor.isActive('dialogue')} title="对白">对白</TB>
        <TB onClick={() => editor.chain().focus().setHorizontalRule().run()} title="分隔线">—</TB>
        <Sep />
        <TB onClick={() => openPopupManually('character')} title="插入角色提及">@角色</TB>
        <TB onClick={() => openPopupManually('worldbook')} title="插入世界书引用">[[条目]]</TB>
        {/* 字体 / 字号（编辑区显示设置，持久化） */}
        <span className="ml-auto flex items-center gap-1 text-xs">
          <select
            value={fontFamily}
            onChange={(e) => changeFontFamily(e.target.value)}
            title="字体"
            className="rounded border border-ink-200 bg-white px-1 py-0.5 text-xs outline-none focus:border-violet-400"
          >
            {FONT_FAMILIES.map((f) => (
              <option key={f.value} value={f.value}>
                {f.label}
              </option>
            ))}
          </select>
          <select
            value={fontSize}
            onChange={(e) => changeFontSize(Number(e.target.value))}
            title="字号"
            className="rounded border border-ink-200 bg-white px-1 py-0.5 text-xs outline-none focus:border-violet-400"
          >
            {FONT_SIZES.map((s) => (
              <option key={s} value={s}>
                {s}px
              </option>
            ))}
          </select>
        </span>
      </div>

      {/* 编辑区 */}
      <div className="flex-1 overflow-y-auto bg-white px-6 py-6">
        <div
          className="mx-auto max-w-3xl"
          style={
            {
              '--editor-font-size': `${fontSize}px`,
              '--editor-font-family': fontCss
            } as React.CSSProperties
          }
        >
          <EditorContent editor={editor} />
        </div>
      </div>

      {/* @ / [[ 弹窗 */}
      {popup && (
        <MentionPopup
          type={popup.type}
          x={popup.x}
          y={popup.y}
          items={popup.type === 'character' ? characters : worldbook}
          onPick={insertMention}
          onClose={() => setPopup(null)}
        />
      )}
    </div>
  );
}

function TB({
  children,
  onClick,
  active,
  title
}: {
  children: React.ReactNode;
  onClick: () => void;
  active?: boolean;
  title?: string;
}): JSX.Element {
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      className={`rounded px-2 py-1 hover:bg-ink-100 ${
        active ? 'bg-ink-900 text-white hover:bg-ink-800' : 'text-ink-700'
      }`}
    >
      {children}
    </button>
  );
}

function Sep(): JSX.Element {
  return <span className="mx-1 h-4 w-px bg-ink-200" />;
}

function MentionPopup({
  type,
  x,
  y,
  items,
  onPick,
  onClose
}: {
  type: 'character' | 'worldbook';
  x: number;
  y: number;
  items: MentionItem[];
  onPick: (item: MentionItem) => void;
  onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const filtered = items.filter((i) => i.label.toLowerCase().includes(query.toLowerCase())).slice(0, 8);

  return (
    <div
      className="fixed z-50 w-56 rounded-md border border-ink-200 bg-white p-2 shadow-lg"
      style={{ left: Math.min(x, window.innerWidth - 240), top: Math.min(y, window.innerHeight - 240) }}
    >
      <div className="mb-1 text-xs text-ink-500">
        {type === 'character' ? '选择角色（@提及）' : '选择世界书条目（[[引用]]）'}
      </div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && filtered[0]) {
            onPick(filtered[0]);
          }
        }}
        placeholder="输入过滤…"
        className="mb-1 w-full rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-ink-400"
      />
      <div className="max-h-44 overflow-y-auto">
        {filtered.length === 0 && <div className="px-2 py-1 text-xs text-ink-400">无匹配项</div>}
        {filtered.map((item) => (
          <button
            key={item.id}
            type="button"
            onClick={() => onPick(item)}
            className="block w-full rounded px-2 py-1 text-left text-sm hover:bg-ink-100"
          >
            {item.label}
          </button>
        ))}
      </div>
    </div>
  );
}
