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
import { ChapterRef } from './nodes/ChapterRef';
import { Dialogue } from './nodes/Dialogue';
import { AITemporaryNode } from './extensions/AITemporaryNode';
import { PasteHandler } from './extensions/PasteHandler';
import { useEditorStore, type EditorApi } from '../../store/editorStore';
import { getAppContext } from '../../context/app-context';
import { docToPlainText } from '../../utils/pmdoc';
import {
  FONT_FAMILIES,
  FONT_SIZES,
  loadFontSize,
  loadFontFamily,
  saveFontSize,
  saveFontFamily
} from '../../utils/editorAppearance';
import type { ChapterBeat } from '../../services/chapter/ChapterService';
import type { ProseMirrorDoc } from '../../types';

export interface MentionItem {
  id: string;
  label: string;
}

/** P2.1-M2：引用类型（@ 分组下拉 / [[ 世界书 / ## 章节） */
export type RefKind = 'character' | 'worldbook' | 'chapter';

interface PopupState {
  /** all = @ 触发的三组列表；其余为单组快捷触发 */
  type: 'all' | RefKind;
  x: number;
  y: number;
}

/** 字体选项与持久化：P2 三期迁至 utils/editorAppearance（设置页「外观」共用） */

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
  const chapters = useEditorStore((s) => s.chapters);
  const setSaveState = useEditorStore((s) => s.setSaveState);
  const setSelectedText = useEditorStore((s) => s.setSelectedText);
  const setEditorApi = useEditorStore((s) => s.setEditorApi);
  const saveTimerRef = useRef<number | null>(null);
  const loadedChapterRef = useRef<string | null>(null);
  const replaceRangeRef = useRef<{ from: number; to: number } | null>(null);
  const lastBracketRef = useRef(0);
  /** ## 触发：第二个 # 时间戳 */
  const lastHashRef = useRef(0);
  /** AI 流式累计文本（appendAITemp 重建临时节点内容的基准） */
  const aiTextRef = useRef('');
  const [popup, setPopup] = useState<PopupState | null>(null);
  const [characters, setCharacters] = useState<MentionItem[]>([]);
  const [worldbook, setWorldbook] = useState<MentionItem[]>([]);
  const [, forceTick] = useState(0);
  // 编辑器外观：字体/字号（localStorage 持久化，与设置页「外观」共用）
  const [fontSize, setFontSize] = useState<number>(loadFontSize);
  const [fontFamily, setFontFamily] = useState<string>(loadFontFamily);

  // ============ P2.1-M5：章节节拍清单栏 ============
  const [beats, setBeats] = useState<ChapterBeat[]>([]);
  const [beatsOpen, setBeatsOpen] = useState(false);
  /** 拖拽排序：被拖项索引 */
  const dragBeatRef = useRef<number | null>(null);

  useEffect(() => {
    if (!currentChapterId) {
      setBeats([]);
      return;
    }
    void getAppContext()
      .chapterService.getBeats(currentChapterId)
      .then(setBeats);
  }, [currentChapterId]);

  /** 整体覆盖保存（过 wq），并广播刷新（AIPanel 定向开关实时读取） */
  const persistBeats = (next: ChapterBeat[]): void => {
    setBeats(next);
    if (!currentChapterId) return;
    void getAppContext().chapterService.saveBeats(currentChapterId, next);
    window.dispatchEvent(new Event('novel-beats-refresh'));
  };

  const updateBeat = (id: string, patch: Partial<ChapterBeat>, persistNow = true): void => {
    const next = beats.map((b) => (b.id === id ? { ...b, ...patch } : b));
    if (persistNow) {
      persistBeats(next);
    } else {
      // 文本输入过程仅更新本地，失焦时持久化（避免逐键写库）
      setBeats(next);
    }
  };

  const addBeat = (): void => {
    persistBeats([
      ...beats,
      { id: crypto.randomUUID(), text: '', targetWords: 300, done: false }
    ]);
  };

  const removeBeat = (id: string): void => {
    persistBeats(beats.filter((b) => b.id !== id));
  };

  const reorderBeat = (from: number, to: number): void => {
    if (from === to || from < 0 || to < 0 || from >= beats.length || to >= beats.length) return;
    const next = [...beats];
    const [moved] = next.splice(from, 1);
    next.splice(to, 0, moved);
    persistBeats(next);
  };

  // 设置页「外观」修改后同步编辑器（storage 事件 + 自定义事件兜底）
  useEffect(() => {
    const sync = (): void => {
      setFontSize(loadFontSize());
      setFontFamily(loadFontFamily());
    };
    window.addEventListener('editor-appearance-change', sync);
    return () => window.removeEventListener('editor-appearance-change', sync);
  }, []);

  const changeFontSize = (v: number): void => {
    setFontSize(v);
    saveFontSize(v);
  };
  const changeFontFamily = (v: string): void => {
    setFontFamily(v);
    saveFontFamily(v);
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
      ChapterRef,
      Dialogue,
      AITemporaryNode,
      PasteHandler
    ],
    editorProps: {
      handleKeyDown: (view, event) => {
        if (event.key === '@') {
          event.preventDefault();
          const coords = view.coordsAtPos(view.state.selection.from);
          setPopup({ type: 'all', x: coords.left, y: coords.bottom + 6 });
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
        if (event.key === '#') {
          const now = Date.now();
          if (now - lastHashRef.current < 800 && view.state.selection.from >= 1) {
            event.preventDefault();
            // 删除第一个 '#'
            const from = view.state.selection.from - 1;
            view.dispatch(view.state.tr.delete(from, from + 1));
            const coords = view.coordsAtPos(view.state.selection.from);
            setPopup({ type: 'chapter', x: coords.left, y: coords.bottom + 6 });
            lastHashRef.current = 0;
            return true;
          }
          lastHashRef.current = now;
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
      /** P2.1-M2：收集当前文档全部引用节点，按出现顺序去重 */
      getAiReferences: () => {
        const seen = new Set<string>();
        const out: Array<{ refType: RefKind; refId: string; label: string }> = [];
        editor.state.doc.descendants((node) => {
          let refType: RefKind | null = null;
          let refId = '';
          let label = '';
          if (node.type.name === 'characterMention') {
            refType = 'character';
            refId = String(node.attrs.id ?? '');
            label = String(node.attrs.name ?? '');
          } else if (node.type.name === 'worldbookRef') {
            refType = 'worldbook';
            refId = String(node.attrs.id ?? '');
            label = String(node.attrs.title ?? '');
          } else if (node.type.name === 'chapterRef') {
            refType = 'chapter';
            refId = String(node.attrs.id ?? '');
            label = String(node.attrs.title ?? '');
          }
          if (refType && refId) {
            const key = `${refType}:${refId}`;
            if (!seen.has(key)) {
              seen.add(key);
              out.push({ refType, refId, label });
            }
          }
          return true;
        });
        return out;
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
      focus: () => editor.commands.focus(),
      /** P2.1-M7：查找文本片段并滚动定位（优先长前缀，逐级缩短重试） */
      searchAndScroll: (text) => {
        const probe = text.replace(/\s/g, '').slice(0, 24);
        if (!probe) return;
        for (const len of [probe.length, 12, 6]) {
          if (len > probe.length) continue;
          const frag = probe.slice(0, len);
          let target = -1;
          editor.state.doc.descendants((node, pos) => {
            if (target >= 0) return false;
            if (node.isText && node.text && node.text.includes(frag)) {
              target = pos;
              return false;
            }
            return true;
          });
          if (target >= 0) {
            editor.chain().focus().setTextSelection(target).scrollIntoView().run();
            return;
          }
        }
      },
      /** P2.1：查找并替换第一处匹配文本（错字一键修正），替换后滚动到修改处 */
      replaceFirstOccurrence: (search, replacement) => {
        if (!search) return false;
        let from = -1;
        let to = -1;
        editor.state.doc.descendants((node, pos) => {
          if (from >= 0) return false;
          if (node.isText && node.text) {
            const idx = node.text.indexOf(search);
            if (idx >= 0) {
              from = pos + idx;
              to = from + search.length;
              return false;
            }
          }
          return true;
        });
        if (from < 0) return false;
        const tr = editor.state.tr.insertText(replacement, from, to);
        tr.scrollIntoView();
        editor.view.dispatch(tr);
        scheduleSave();
        return true;
      }
    };
    setEditorApi(api);
    return () => setEditorApi(null);
  }, [editor, setEditorApi, setSaveState]);

  // ============ 弹窗插入 ============
  const insertMention = (refType: RefKind, item: MentionItem): void => {
    if (!editor || !popup) return;
    if (refType === 'character') {
      editor.chain().focus().insertCharacterMention(item.id, item.label).run();
    } else if (refType === 'worldbook') {
      editor.chain().focus().insertWorldbookRef(item.id, item.label).run();
    } else {
      editor.chain().focus().insertChapterRef(item.id, item.label).run();
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
        <TB onClick={() => openPopupManually('all')} title="插入引用（@角色 / 世界书 / 章节）">@引用</TB>
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

      {/* 编辑区：左侧节拍清单栏（P2.1-M5）+ 正文 */}
      <div className="relative flex min-h-0 flex-1">
        {/* 节拍栏：外层变宽 + 内层固定宽（Tailwind JIT 完整类名静态可见） */}
        <aside
          className={`shrink-0 overflow-hidden border-r border-ink-200 bg-ink-50 transition-[width] duration-200 ${
            beatsOpen ? 'w-56' : 'w-0 border-r-0'
          }`}
        >
          <div className="flex h-full w-56 flex-col">
            <div className="flex items-center gap-1 border-b border-ink-200 px-2 py-1.5 text-xs">
              <span className="font-medium">章节节拍</span>
              <span className="text-ink-400">{beats.length}</span>
              <button
                type="button"
                className="ml-auto rounded border border-ink-200 px-1.5 py-0.5 text-[10px] hover:bg-ink-100"
                onClick={addBeat}
              >
                + 添加节拍
              </button>
              <button
                type="button"
                title="收起节拍栏"
                className="rounded border border-ink-200 px-1.5 py-0.5 text-[10px] hover:bg-ink-100"
                onClick={() => setBeatsOpen(false)}
              >
                ◀
              </button>
            </div>
            <div className="flex-1 overflow-y-auto p-1.5">
              {beats.length === 0 && (
                <div className="px-1 py-2 text-[11px] leading-5 text-ink-400">
                  暂无节拍。添加"场景/事件"节拍后，续写可按节拍定向生成（AI 面板开关控制）。
                </div>
              )}
              {beats.map((b, i) => (
                <div
                  key={b.id}
                  draggable
                  onDragStart={() => {
                    dragBeatRef.current = i;
                  }}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={() => {
                    if (dragBeatRef.current !== null) reorderBeat(dragBeatRef.current, i);
                    dragBeatRef.current = null;
                  }}
                  className="mb-1 cursor-grab rounded border border-ink-200 bg-white px-1.5 py-1"
                >
                  <div className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={b.done}
                      title={b.done ? '已完成' : '勾选完成'}
                      onChange={(e) => updateBeat(b.id, { done: e.target.checked })}
                    />
                    <span className="text-[10px] text-ink-400">{i + 1}</span>
                    <input
                      value={b.text}
                      placeholder="节拍描述，如：主角识破陷阱"
                      onChange={(e) => updateBeat(b.id, { text: e.target.value }, false)}
                      onBlur={() => persistBeats(beats)}
                      className={`min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-[11px] outline-none focus:border-violet-300 ${
                        b.done ? 'text-ink-400 line-through' : ''
                      }`}
                    />
                    <input
                      type="number"
                      min={0}
                      step={100}
                      value={b.targetWords ?? 300}
                      title="目标字数"
                      onChange={(e) =>
                        updateBeat(b.id, { targetWords: parseInt(e.target.value, 10) || 0 })
                      }
                      className="w-12 rounded border border-transparent px-1 py-0.5 text-[10px] text-ink-500 outline-none focus:border-violet-300"
                    />
                    <button
                      type="button"
                      title="删除节拍"
                      className="px-0.5 text-[10px] text-ink-400 hover:text-red-600"
                      onClick={() => removeBeat(b.id)}
                    >
                      ✕
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </aside>

        {/* 展开按钮（栏收起时悬浮显示） */}
        {!beatsOpen && (
          <button
            type="button"
            title="展开章节节拍栏"
            className="absolute left-0 top-2 z-10 rounded-r border border-l-0 border-ink-200 bg-white px-1 py-1 text-[10px] text-ink-500 hover:bg-ink-100"
            onClick={() => setBeatsOpen(true)}
          >
            节
            <br />
            拍
            <br />
            ▶
          </button>
        )}

        <div className="min-w-0 flex-1 overflow-y-auto bg-white px-6 py-6">
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
      </div>

      {/* @ / [[ / ## 弹窗 */}
      {popup && (
        <MentionPopup
          type={popup.type}
          x={popup.x}
          y={popup.y}
          characters={characters}
          worldbook={worldbook}
          chapters={chapters.map((c) => ({ id: c.id, label: c.title }))}
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
  characters,
  worldbook,
  chapters,
  onPick,
  onClose
}: {
  type: 'all' | RefKind;
  x: number;
  y: number;
  characters: MentionItem[];
  worldbook: MentionItem[];
  chapters: MentionItem[];
  onPick: (refType: RefKind, item: MentionItem) => void;
  onClose: () => void;
}): JSX.Element {
  const [query, setQuery] = useState('');
  const q = query.toLowerCase();
  const groups: Array<{ kind: RefKind; title: string; items: MentionItem[] }> = [];
  const characterItems = type === 'all' || type === 'character' ? characters : [];
  const worldbookItems = type === 'all' || type === 'worldbook' ? worldbook : [];
  const chapterItems = type === 'all' || type === 'chapter' ? chapters : [];
  if (characterItems.length > 0) groups.push({ kind: 'character', title: '角色', items: characterItems });
  if (worldbookItems.length > 0) groups.push({ kind: 'worldbook', title: '世界书', items: worldbookItems });
  if (chapterItems.length > 0) groups.push({ kind: 'chapter', title: '章节', items: chapterItems });
  const filtered = groups.map((g) => ({
    ...g,
    items: g.items.filter((i) => i.label.toLowerCase().includes(q))
  }));
  const first = filtered.find((g) => g.items.length > 0)?.items[0] ?? null;

  const hint =
    type === 'all'
      ? '选择引用（角色 @ / 世界书 [[ ]] / 章节 ##）'
      : type === 'character'
        ? '选择角色（@提及）'
        : type === 'worldbook'
          ? '选择世界书条目（[[引用]]）'
          : '选择章节（##引用）';

  return (
    <div
      className="fixed z-50 w-60 rounded-md border border-ink-200 bg-white p-2 shadow-lg"
      style={{ left: Math.min(x, window.innerWidth - 256), top: Math.min(y, window.innerHeight - 260) }}
    >
      <div className="mb-1 text-xs text-ink-500">{hint}</div>
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Enter' && first) {
            onPick(filtered.find((g) => g.items.length > 0)!.kind, first);
          }
        }}
        placeholder="输入过滤…"
        className="mb-1 w-full rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-ink-400"
      />
      <div className="max-h-56 overflow-y-auto">
        {filtered.every((g) => g.items.length === 0) && (
          <div className="px-2 py-1 text-xs text-ink-400">无匹配项</div>
        )}
        {filtered.map((g) => (
          <div key={g.kind} className="mb-1">
            <div className="px-1 py-0.5 text-[10px] font-medium uppercase tracking-wide text-ink-400">
              {g.title}
            </div>
            {g.items.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => onPick(g.kind, item)}
                className="block w-full truncate rounded px-2 py-1 text-left text-sm hover:bg-ink-100"
              >
                {item.label}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
