/**
 * 章节树：多级、拖拽排序（HTML5 DnD）、大纲编辑、状态切换、字数显示
 */

import { useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { CHAPTER_STATUS_LABEL, type Chapter, type ChapterStatus } from '../../types';

const STATUS_COLOR: Record<ChapterStatus, string> = {
  draft: 'bg-ink-200 text-ink-600',
  revised: 'bg-amber-200 text-amber-700',
  final: 'bg-emerald-200 text-emerald-700'
};

export function ChapterTree(): JSX.Element {
  const chapters = useEditorStore((s) => s.chapters);
  const currentChapterId = useEditorStore((s) => s.currentChapterId);
  const setCurrentChapter = useEditorStore((s) => s.setCurrentChapter);
  const createChapter = useEditorStore((s) => s.createChapter);
  const deleteChapter = useEditorStore((s) => s.deleteChapter);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; pos: 'before' | 'child' } | null>(null);
  const [outlineEditId, setOutlineEditId] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [newParent, setNewParent] = useState<string | null>(null);

  const roots = chapters.filter((c) => c.parentId === null);

  const onDrop = async (): Promise<void> => {
    if (!dragId || !dropTarget || dragId === dropTarget.id) return;
    const { chapterService } = await import('../../context/app-context').then((m) => m.getAppContext());
    const target = chapters.find((c) => c.id === dropTarget.id);
    if (!target) return;
    if (dropTarget.pos === 'child') {
      // 成为子章节：置于目标子级末尾
      const siblings = chapters.filter((c) => c.parentId === target.id);
      const sortOrder = siblings.length + 1;
      await chapterService.update(dragId, { parentId: target.id, sortOrder });
    } else {
      // 插到目标之前（同级）
      await chapterService.update(dragId, { parentId: target.parentId, sortOrder: target.sortOrder });
      // 目标及之后的同级章节顺延
      const siblings = chapters.filter(
        (c) => c.parentId === target.parentId && c.id !== dragId && c.sortOrder >= target.sortOrder
      );
      for (const s of siblings) {
        await chapterService.update(s.id, { sortOrder: s.sortOrder + 1 });
      }
    }
    setDragId(null);
    setDropTarget(null);
    const bookId = useEditorStore.getState().bookId;
    if (bookId) await useEditorStore.getState().loadChapters(bookId);
    void chapterService;
  };

  const renderNode = (chapter: Chapter, depth: number): JSX.Element => {
    const children = chapters.filter((c) => c.parentId === chapter.id);
    const isCurrent = chapter.id === currentChapterId;
    return (
      <div key={chapter.id}>
        <div
          draggable
          onDragStart={() => setDragId(chapter.id)}
          onDragOver={(e) => {
            e.preventDefault();
            const rect = e.currentTarget.getBoundingClientRect();
            const pos = e.clientY - rect.top < rect.height / 2 ? 'before' : 'child';
            setDropTarget({ id: chapter.id, pos });
          }}
          onDragEnd={() => {
            setDragId(null);
            setDropTarget(null);
          }}
          onDrop={(e) => {
            e.preventDefault();
            void onDrop();
          }}
          className={`group flex cursor-pointer items-center gap-1.5 rounded px-2 py-1.5 text-sm ${
            isCurrent ? 'bg-violet-100 text-violet-900' : 'hover:bg-ink-100'
          } ${dropTarget?.id === chapter.id && dropTarget.pos === 'before' ? 'border-t-2 border-violet-400' : ''} ${
            dropTarget?.id === chapter.id && dropTarget.pos === 'child' ? 'ring-1 ring-violet-400' : ''
          }`}
          style={{ paddingLeft: `${8 + depth * 14}px` }}
          onClick={() => setCurrentChapter(chapter.id)}
        >
          <span className="text-ink-400">{children.length > 0 ? '▾' : '·'}</span>
          <span className="flex-1 truncate">{chapter.title}</span>
          <span
            className={`rounded px-1 text-[10px] ${STATUS_COLOR[chapter.status]}`}
            title={CHAPTER_STATUS_LABEL[chapter.status]}
          >
            {CHAPTER_STATUS_LABEL[chapter.status]}
          </span>
          <span className="text-[10px] text-ink-400">{chapter.wordCount}字</span>
          <button
            type="button"
            title="编辑大纲"
            className="hidden text-xs text-ink-400 hover:text-violet-600 group-hover:block"
            onClick={(e) => {
              e.stopPropagation();
              setOutlineEditId(outlineEditId === chapter.id ? null : chapter.id);
            }}
          >
            大纲
          </button>
          <button
            type="button"
            title="添加子章节"
            className="hidden text-xs text-ink-400 hover:text-violet-600 group-hover:block"
            onClick={(e) => {
              e.stopPropagation();
              setNewParent(chapter.id);
              setNewTitle('');
            }}
          >
            +
          </button>
          <button
            type="button"
            title="删除章节"
            className="hidden text-xs text-ink-400 hover:text-red-600 group-hover:block"
            onClick={(e) => {
              e.stopPropagation();
              if (window.confirm(`确认删除「${chapter.title}」及其子章节？`)) {
                void deleteChapter(chapter.id);
              }
            }}
          >
            ×
          </button>
        </div>
        {outlineEditId === chapter.id && (
          <OutlineEditor chapter={chapter} onDone={() => setOutlineEditId(null)} />
        )}
        {children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
        <span className="text-sm font-medium">章节</span>
      </div>
      <div className="flex-1 overflow-y-auto py-1">{roots.map((c) => renderNode(c, 0))}</div>
      <div className="border-t border-ink-200 p-2">
        <div className="mb-1 text-xs text-ink-500">
          {newParent
            ? `添加子章节（父：${chapters.find((c) => c.id === newParent)?.title}）`
            : '新建章节（顶层）'}
        </div>
        <div className="flex gap-1">
          <input
            value={newTitle}
            onChange={(e) => setNewTitle(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && newTitle.trim()) {
                void createChapter(newTitle.trim(), newParent);
                setNewTitle('');
                setNewParent(null);
              }
            }}
            placeholder="章节标题…"
            className="min-w-0 flex-1 rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
          />
          <button
            type="button"
            className="rounded bg-violet-600 px-2 py-1 text-sm text-white hover:bg-violet-700"
            onClick={() => {
              if (newTitle.trim()) {
                void createChapter(newTitle.trim(), newParent);
                setNewTitle('');
                setNewParent(null);
              }
            }}
          >
            +
          </button>
        </div>
        {newParent && (
          <button
            type="button"
            className="mt-1 text-xs text-ink-400 hover:text-ink-600"
            onClick={() => setNewParent(null)}
          >
            取消父级（改为顶层）
          </button>
        )}
      </div>
    </div>
  );
}

function OutlineEditor({ chapter, onDone }: { chapter: Chapter; onDone: () => void }): JSX.Element {
  const updateChapter = useEditorStore((s) => s.updateChapter);
  const [outline, setOutline] = useState(chapter.outline ?? '');
  const [status, setStatus] = useState<ChapterStatus>(chapter.status);

  return (
    <div className="mx-2 mb-2 rounded border border-violet-200 bg-violet-50/50 p-2">
      <textarea
        value={outline}
        onChange={(e) => setOutline(e.target.value)}
        placeholder="本章大纲 / 梗概（写作前定梗概，写作后对账）"
        rows={3}
        className="w-full resize-none rounded border border-ink-200 px-2 py-1 text-xs outline-none focus:border-violet-400"
      />
      <div className="mt-1 flex items-center gap-1">
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as ChapterStatus)}
          className="rounded border border-ink-200 px-1 py-0.5 text-xs"
        >
          {(Object.keys(CHAPTER_STATUS_LABEL) as ChapterStatus[]).map((s) => (
            <option key={s} value={s}>
              {CHAPTER_STATUS_LABEL[s]}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="ml-auto rounded bg-violet-600 px-2 py-0.5 text-xs text-white hover:bg-violet-700"
          onClick={() => {
            void updateChapter(chapter.id, { outline, status });
            onDone();
          }}
        >
          保存
        </button>
      </div>
    </div>
  );
}
