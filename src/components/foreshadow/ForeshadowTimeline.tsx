/**
 * 伏笔时间线（P1 Phase8）：章节横轴 + 伏笔区间条
 * 埋设绿点 / 回收蓝点；未回收延伸至今（琥珀高亮）；已放弃灰化；按状态过滤
 */

import { useEffect, useMemo, useState } from 'react';
import { getAppContext } from '../../context/app-context';
import { useEditorStore } from '../../store/editorStore';
import {
  FORESHADOWING_STATUS_LABEL,
  type Chapter,
  type Foreshadowing,
  type ForeshadowingStatus
} from '../../types';

type Filter = 'all' | ForeshadowingStatus;

const FILTERS: { key: Filter; label: string }[] = [
  { key: 'all', label: '全部' },
  { key: 'planted', label: '未回收' },
  { key: 'resolved', label: '已回收' },
  { key: 'abandoned', label: '已放弃' }
];

const COL_W = 46; // 每章列宽 px
const LABEL_W = 148; // 左侧伏笔描述列宽 px

export function ForeshadowTimeline({ bookId }: { bookId: string }): JSX.Element {
  const chapters = useEditorStore((s) => s.chapters);
  const setCurrentChapter = useEditorStore((s) => s.setCurrentChapter);
  const [items, setItems] = useState<Foreshadowing[]>([]);
  const [filter, setFilter] = useState<Filter>('all');

  const load = async (): Promise<void> => {
    const rows = await getAppContext().db.query<Record<string, unknown>>(
      'SELECT * FROM foreshadowings WHERE book_id = ? ORDER BY created_at ASC',
      [bookId]
    );
    setItems(
      rows.map((r) => ({
        id: String(r.id),
        bookId: String(r.book_id),
        description: String(r.description),
        plantedChapterId: (r.planted_chapter_id as string) ?? null,
        resolvedChapterId: (r.resolved_chapter_id as string) ?? null,
        status: (r.status as ForeshadowingStatus) ?? 'planted',
        createdAt: Number(r.created_at)
      }))
    );
  };

  useEffect(() => {
    void load();
  }, [bookId]);

  /** 树序扁平化（与章节树展示顺序一致） */
  const ordered: Chapter[] = useMemo(() => {
    const out: Chapter[] = [];
    const walk = (parentId: string | null): void => {
      chapters
        .filter((c) => c.parentId === parentId)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .forEach((c) => {
          out.push(c);
          walk(c.id);
        });
    };
    walk(null);
    return out;
  }, [chapters]);

  const chapterTitle = (id: string | null): string =>
    id ? (chapters.find((c) => c.id === id)?.title ?? '（章节已删除）') : '未指定';

  const visible = useMemo(
    () => items.filter((f) => filter === 'all' || f.status === filter),
    [items, filter]
  );

  const gridStyle = {
    width: ordered.length * COL_W,
    backgroundImage: `repeating-linear-gradient(to right, transparent 0, transparent ${COL_W - 1}px, rgba(0,0,0,0.06) ${COL_W - 1}px, rgba(0,0,0,0.06) ${COL_W}px)`
  };

  const unresolvedCount = items.filter((f) => f.status === 'planted').length;

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-1 border-b border-ink-100 px-2 py-1.5">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            className={`rounded px-1.5 py-0.5 text-[11px] ${
              filter === f.key ? 'bg-violet-100 text-violet-700' : 'text-ink-500 hover:bg-ink-100'
            }`}
            onClick={() => setFilter(f.key)}
          >
            {f.label}
          </button>
        ))}
        <span className="ml-auto flex items-center gap-2 text-[10px] text-ink-400">
          <span className="flex items-center gap-0.5">
            <span className="inline-block h-2 w-2 rounded-full bg-emerald-500" />
            埋设
          </span>
          <span className="flex items-center gap-0.5">
            <span className="inline-block h-2 w-2 rounded-full bg-blue-500" />
            回收
          </span>
          <span className="flex items-center gap-0.5">
            <span className="inline-block h-1.5 w-4 rounded bg-amber-300" />
            未回收延伸至今
          </span>
        </span>
      </div>
      {unresolvedCount > 0 && (
        <div className="border-b border-amber-100 bg-amber-50/60 px-2 py-1 text-[11px] text-amber-700">
          高亮提示：当前有 {unresolvedCount} 处未回收伏笔（琥珀色条延伸至最新章节）。
        </div>
      )}
      {ordered.length === 0 || items.length === 0 ? (
        <div className="px-2 py-6 text-center text-xs text-ink-400">
          {items.length === 0 ? '暂无伏笔记录，先在列表中添加。' : '暂无章节，无法定位伏笔。'}
        </div>
      ) : (
        <div className="flex-1 overflow-auto">
          <div style={{ width: LABEL_W + ordered.length * COL_W }}>
            {/* 章节横轴 */}
            <div className="flex border-b border-ink-200">
              <div
                className="sticky left-0 z-10 shrink-0 bg-white pt-6 text-[10px] text-ink-400"
                style={{ width: LABEL_W }}
              >
                伏笔（{visible.length}）
              </div>
              {ordered.map((c) => (
                <div key={c.id} className="relative shrink-0" style={{ width: COL_W, height: 78 }}>
                  <span
                    className="absolute left-1/2 top-0 -translate-x-1/2 overflow-hidden whitespace-nowrap text-[10px] text-ink-500"
                    style={{ writingMode: 'vertical-rl', height: 70 }}
                    title={c.title}
                  >
                    {c.title}
                  </span>
                </div>
              ))}
            </div>
            {/* 伏笔区间条 */}
            {visible.map((f) => {
              const start = f.plantedChapterId
                ? ordered.findIndex((c) => c.id === f.plantedChapterId)
                : -1;
              const resolvedIdx = f.resolvedChapterId
                ? ordered.findIndex((c) => c.id === f.resolvedChapterId)
                : -1;
              const s = start >= 0 ? start : 0;
              const isResolved = f.status === 'resolved';
              const isAbandoned = f.status === 'abandoned';
              const e =
                isResolved && resolvedIdx >= s ? resolvedIdx : ordered.length - 1;
              const barLeft = s * COL_W + 3;
              const barW = Math.max((e - s + 1) * COL_W - 6, 10);
              const tooltip = `${f.description}\n状态：${FORESHADOWING_STATUS_LABEL[f.status]}\n埋设：${chapterTitle(f.plantedChapterId)}\n回收：${
                isResolved ? chapterTitle(f.resolvedChapterId) : '未回收（延伸至今）'
              }`;
              return (
                <div key={f.id} className="flex border-b border-ink-100">
                  <div
                    className="sticky left-0 z-10 shrink-0 truncate border-r border-ink-100 bg-white pr-1 text-[11px] text-ink-600"
                    style={{ width: LABEL_W }}
                    title={tooltip}
                  >
                    <span
                      className={
                        isAbandoned
                          ? 'text-ink-400 line-through'
                          : f.status === 'planted'
                            ? 'text-amber-700'
                            : 'text-ink-600'
                      }
                    >
                      {f.description}
                    </span>
                  </div>
                  <div className="relative h-7 shrink-0" style={gridStyle}>
                    <button
                      type="button"
                      title={tooltip}
                      className={`absolute top-[10px] h-2 rounded-full ${
                        isAbandoned
                          ? 'bg-ink-200 opacity-60'
                          : isResolved
                            ? 'bg-blue-200'
                            : 'bg-amber-300'
                      }`}
                      style={{ left: barLeft, width: barW }}
                      onClick={() => {
                        if (f.plantedChapterId && start >= 0) setCurrentChapter(f.plantedChapterId);
                      }}
                    />
                    {/* 埋设绿点 */}
                    <span
                      className={`absolute top-[9px] h-2.5 w-2.5 rounded-full border border-white ${
                        isAbandoned ? 'bg-ink-300' : 'bg-emerald-500'
                      }`}
                      style={{ left: barLeft - 1 }}
                    />
                    {/* 回收蓝点 / 未回收脉冲端点 */}
                    {isResolved && resolvedIdx >= s ? (
                      <span
                        className={`absolute top-[9px] h-2.5 w-2.5 rounded-full border border-white ${
                          isAbandoned ? 'bg-ink-300' : 'bg-blue-500'
                        }`}
                        style={{ left: (resolvedIdx + 1) * COL_W - 10 }}
                      />
                    ) : (
                      !isAbandoned && (
                        <span
                          className="absolute top-[8px] h-3 w-3 animate-pulse rounded-full border border-amber-500 bg-amber-400"
                          style={{ left: ordered.length * COL_W - 12 }}
                          title="尚未回收"
                        />
                      )
                    )}
                  </div>
                </div>
              );
            })}
            {visible.length === 0 && (
              <div className="py-4 text-center text-xs text-ink-400">当前过滤条件下无伏笔。</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
