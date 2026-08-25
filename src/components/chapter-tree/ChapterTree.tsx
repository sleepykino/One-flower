/**
 * 章节树：多级、拖拽排序（HTML5 DnD）、大纲编辑、状态切换、字数显示
 */

import { useEffect, useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { getAppContext } from '../../context/app-context';
import { confirmDialog } from '../../native/dialog';
import { CHAPTER_STATUS_LABEL, type Chapter, type ChapterStatus } from '../../types';

const STATUS_COLOR: Record<ChapterStatus, string> = {
  draft: 'bg-ink-200 text-ink-600',
  revised: 'bg-amber-200 text-amber-700',
  final: 'bg-emerald-200 text-emerald-700'
};

export function ChapterTree(): JSX.Element {
  const chapters = useEditorStore((s) => s.chapters);
  const bookId = useEditorStore((s) => s.bookId);
  const currentChapterId = useEditorStore((s) => s.currentChapterId);
  const setCurrentChapter = useEditorStore((s) => s.setCurrentChapter);
  const createChapter = useEditorStore((s) => s.createChapter);
  const deleteChapter = useEditorStore((s) => s.deleteChapter);
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<{ id: string; pos: 'before' | 'child' } | null>(null);
  const [outlineEditId, setOutlineEditId] = useState<string | null>(null);
  const [renameId, setRenameId] = useState<string | null>(null);
  /** 已收起章节 id 集合（仅影响展示，不影响数据） */
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<string>>(new Set());
  const [newTitle, setNewTitle] = useState('');
  const [newParent, setNewParent] = useState<string | null>(null);
  const [batch, setBatch] = useState<{ done: number; total: number; running: boolean; errorCount: number } | null>(null);
  /** 章节伏笔标记：埋设（绿）/ 回收（蓝）计数 */
  const [foreshadowMarks, setForeshadowMarks] = useState<Map<string, { planted: number; resolved: number }>>(
    new Map()
  );

  const loadForeshadowMarks = async (): Promise<void> => {
    const bid = useEditorStore.getState().bookId;
    if (!bid) {
      setForeshadowMarks(new Map());
      return;
    }
    const rows = await getAppContext().db.query<Record<string, unknown>>(
      'SELECT planted_chapter_id, resolved_chapter_id FROM foreshadowings WHERE book_id = ? AND status != ?',
      [bid, 'abandoned']
    );
    const m = new Map<string, { planted: number; resolved: number }>();
    for (const r of rows) {
      const p = (r.planted_chapter_id as string) ?? null;
      const res = (r.resolved_chapter_id as string) ?? null;
      if (p) {
        const e = m.get(p) ?? { planted: 0, resolved: 0 };
        e.planted += 1;
        m.set(p, e);
      }
      if (res) {
        const e = m.get(res) ?? { planted: 0, resolved: 0 };
        e.resolved += 1;
        m.set(res, e);
      }
    }
    setForeshadowMarks(m);
  };

  useEffect(() => {
    void loadForeshadowMarks();
    const onRefresh = (): void => {
      void loadForeshadowMarks();
    };
    window.addEventListener('novel-foreshadow-refresh', onRefresh);
    return () => window.removeEventListener('novel-foreshadow-refresh', onRefresh);
  }, [bookId]);

  const roots = chapters.filter((c) => c.parentId === null);

  const toggleCollapse = (id: string): void => {
    setCollapsedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  /** 批量补全全书摘要（导入旧书 / 首次启用摘要链） */
  const runBatchSummaries = async (): Promise<void> => {
    const bookId = useEditorStore.getState().bookId;
    if (!bookId || batch?.running) return;
    const { summaryService } = getAppContext();
    const total = useEditorStore.getState().chapters.length;
    setBatch({ done: 0, total, running: true, errorCount: 0 });
    let done = 0;
    let errorCount = 0;
    try {
      for await (const p of summaryService.generateAllSummaries(bookId)) {
        if (p.status === 'done' || p.status === 'error') {
          done += 1;
          if (p.status === 'error') errorCount += 1;
          setBatch({ done, total, running: true, errorCount });
        }
      }
    } finally {
      setBatch({ done, total, running: false, errorCount });
      const b = useEditorStore.getState().bookId;
      if (b) await useEditorStore.getState().loadChapters(b);
    }
  };

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
    const mark = foreshadowMarks.get(chapter.id);
    const isCollapsed = collapsedIds.has(chapter.id);
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
          <span
            className={`text-ink-400 ${children.length > 0 ? 'cursor-pointer hover:text-violet-600' : ''}`}
            title={children.length > 0 ? (isCollapsed ? '展开子章节' : '收起子章节') : undefined}
            onClick={(e) => {
              if (children.length === 0) return;
              e.stopPropagation();
              toggleCollapse(chapter.id);
            }}
          >
            {children.length > 0 ? (isCollapsed ? '▸' : '▾') : '·'}
          </span>
          <span className="flex-1 truncate">{chapter.title}</span>
          {mark && mark.planted > 0 && (
            <span
              className="text-[10px] text-emerald-600"
              title={`埋设伏笔 ${mark.planted} 处（详见伏笔追踪）`}
            >
              ●{mark.planted > 1 ? mark.planted : ''}
            </span>
          )}
          {mark && mark.resolved > 0 && (
            <span
              className="text-[10px] text-blue-600"
              title={`回收伏笔 ${mark.resolved} 处（详见伏笔追踪）`}
            >
              ●{mark.resolved > 1 ? mark.resolved : ''}
            </span>
          )}
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
            title="重命名章节"
            className="hidden text-xs text-ink-400 hover:text-violet-600 group-hover:block"
            onClick={(e) => {
              e.stopPropagation();
              setRenameId(renameId === chapter.id ? null : chapter.id);
            }}
          >
            ✎
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
              void confirmDialog(`确认删除「${chapter.title}」及其子章节？`).then((ok) => {
                if (ok) void deleteChapter(chapter.id);
              });
            }}
          >
            ×
          </button>
        </div>
        {outlineEditId === chapter.id && (
          <OutlineEditor chapter={chapter} onDone={() => setOutlineEditId(null)} />
        )}
        {renameId === chapter.id && (
          <RenameEditor chapter={chapter} onDone={() => setRenameId(null)} />
        )}
        {!isCollapsed && children.map((c) => renderNode(c, depth + 1))}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
        <span className="text-sm font-medium">章节</span>
        {batch ? (
          <span className="text-[11px] text-ink-500">
            摘要 {batch.done}/{batch.total}
            {batch.errorCount > 0 ? `（失败 ${batch.errorCount}）` : ''}
            {batch.running ? '…' : ' 完成'}
          </span>
        ) : (
          <button
            type="button"
            title="为缺少摘要或内容已变更的章节批量生成摘要"
            className="text-[11px] text-violet-600 hover:underline"
            onClick={() => void runBatchSummaries()}
          >
            批量摘要
          </button>
        )}
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
  const [summaryBusy, setSummaryBusy] = useState(false);
  const [summaryErr, setSummaryErr] = useState<string | null>(null);
  /** 摘要展开查看（默认折叠 4 行） */
  const [summaryOpen, setSummaryOpen] = useState(false);

  const refreshChapters = async (): Promise<void> => {
    const bookId = useEditorStore.getState().bookId;
    if (bookId) await useEditorStore.getState().loadChapters(bookId);
  };

  const regenerateSummary = async (): Promise<void> => {
    setSummaryBusy(true);
    setSummaryErr(null);
    try {
      const { summaryService } = getAppContext();
      await summaryService.regenerate(chapter.id);
      await refreshChapters();
    } catch (e) {
      setSummaryErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSummaryBusy(false);
    }
  };

  return (
    <div className="mx-2 mb-2 rounded border border-violet-200 bg-violet-50/50 p-2">
      <textarea
        value={outline}
        onChange={(e) => setOutline(e.target.value)}
        placeholder="本章大纲 / 梗概（写作前定梗概，写作后对账）"
        rows={3}
        className="w-full resize-none rounded border border-ink-200 px-2 py-1 text-xs outline-none focus:border-violet-400"
      />
      <div className="mt-2 rounded border border-ink-200 bg-white/70 p-1.5">
        <div className="flex items-center gap-1">
          <span className="text-[11px] font-medium text-ink-500">AI 摘要（前情链）</span>
          <button
            type="button"
            disabled={summaryBusy}
            className="ml-auto text-[11px] text-violet-600 hover:underline disabled:text-ink-400"
            onClick={() => void regenerateSummary()}
          >
            {summaryBusy ? '生成中…' : chapter.summary ? '重新生成' : '生成摘要'}
          </button>
        </div>
        <div
          className={`mt-0.5 cursor-pointer whitespace-pre-wrap text-[11px] leading-relaxed text-ink-600 ${
            summaryOpen ? '' : 'line-clamp-4'
          }`}
          onClick={() => setSummaryOpen((v) => !v)}
          title={summaryOpen ? '点击收起' : '点击展开查看完整摘要'}
        >
          {chapter.summary ?? '尚未生成。章节保存后将自动在后台生成，用于 AI 前情上下文。'}
        </div>
        {chapter.summary && (
          <button
            type="button"
            className="mt-0.5 text-[11px] text-violet-600 hover:underline"
            onClick={() => setSummaryOpen((v) => !v)}
          >
            {summaryOpen ? '收起' : '展开全部'}
          </button>
        )}
        {summaryErr && <div className="mt-0.5 text-[11px] text-red-500">{summaryErr}</div>}
      </div>
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

/** 章节重命名：行内输入，Enter/失焦保存，Esc 取消（与书籍重命名交互一致） */
function RenameEditor({ chapter, onDone }: { chapter: Chapter; onDone: () => void }): JSX.Element {
  const updateChapter = useEditorStore((s) => s.updateChapter);
  const [title, setTitle] = useState(chapter.title);

  const save = (): void => {
    const t = title.trim();
    if (t && t !== chapter.title) {
      void updateChapter(chapter.id, { title: t });
    }
    onDone();
  };

  return (
    <div className="mx-2 mb-2 flex items-center gap-1.5 rounded border border-violet-200 bg-violet-50/50 p-1.5">
      <input
        autoFocus
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') save();
          if (e.key === 'Escape') onDone();
        }}
        onBlur={save}
        placeholder="章节标题…"
        className="min-w-0 flex-1 rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
      />
      <button
        type="button"
        className="shrink-0 rounded bg-violet-600 px-2 py-1 text-xs text-white hover:bg-violet-700"
        onClick={save}
      >
        保存
      </button>
    </div>
  );
}
