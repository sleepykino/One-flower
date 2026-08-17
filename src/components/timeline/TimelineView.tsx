/**
 * 时间线管理（P2）：全屏 overlay 泳道视图
 * 每条时间线一个横向泳道；卡片可拖拽排序（同线 reorder）或跨线移动（改 timeline）；
 * 支持新建/编辑事件（标题 / 描述 / 时间线 / 关联章节 / 关联角色）
 */

import { Fragment, useEffect, useMemo, useState } from 'react';
import { getAppContext } from '../../context/app-context';
import { TimelineService } from '../../services/timeline/TimelineService';
import type { TimelineEvent } from '../../services/timeline/types';
import type { Chapter, Character } from '../../types';

/** 新建/编辑事件表单状态（id 存在则为编辑模式） */
interface EventForm {
  id?: string;
  title: string;
  description: string;
  timeline: string;
  chapterId: string; // '' 表示未关联
  characterIds: string[];
}

export function TimelineView({ bookId, onClose }: { bookId: string; onClose: () => void }): JSX.Element {
  const ctx = getAppContext();
  const service = useMemo(() => new TimelineService(ctx.db, ctx.wq), [ctx.db, ctx.wq]);

  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [chapters, setChapters] = useState<Chapter[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [timelines, setTimelines] = useState<string[]>([]); // 数据库顺序 + 本地新建未落库的线
  const [activeTab, setActiveTab] = useState<string>('全部');
  const [form, setForm] = useState<EventForm | null>(null);
  const [newLine, setNewLine] = useState<string | null>(null); // 非 null 时显示新线输入框
  const [dragId, setDragId] = useState<string | null>(null);
  const [dropHint, setDropHint] = useState<{ lane: string; beforeId: string | null } | null>(null);

  const load = async (): Promise<void> => {
    const [evs, chs, cs, tls] = await Promise.all([
      service.listByBook(bookId),
      ctx.chapterService.list(bookId),
      ctx.characterService.list(bookId),
      service.listTimelines(bookId)
    ]);
    setEvents(evs);
    setChapters(chs);
    setCharacters(cs);
    // 保留本地新建但还没有事件的时间线
    setTimelines((prev) => [...tls, ...prev.filter((t) => !tls.includes(t))]);
  };

  useEffect(() => {
    void load();
  }, [bookId]);

  const chapterMap = useMemo(() => new Map(chapters.map((c) => [c.id, c])), [chapters]);
  const characterMap = useMemo(() => new Map(characters.map((c) => [c.id, c])), [characters]);

  /** 某条泳道内的事件（按 sort_order 升序） */
  const laneEvents = (lane: string): TimelineEvent[] =>
    events.filter((e) => e.timeline === lane).sort((a, b) => a.sortOrder - b.sortOrder);

  // ============ 新建 / 编辑 / 删除 ============

  const openCreate = (): void => {
    const defaultLane = activeTab !== '全部' ? activeTab : (timelines[0] ?? 'main');
    setForm({ title: '', description: '', timeline: defaultLane, chapterId: '', characterIds: [] });
  };

  const openEdit = (ev: TimelineEvent): void => {
    setForm({
      id: ev.id,
      title: ev.title,
      description: ev.description,
      timeline: ev.timeline,
      chapterId: ev.chapterId ?? '',
      characterIds: ev.characterIds
    });
  };

  const save = async (): Promise<void> => {
    if (!form || !form.title.trim()) return;
    const payload = {
      title: form.title.trim(),
      description: form.description,
      timeline: form.timeline,
      chapterId: form.chapterId,
      characterIds: form.characterIds
    };
    if (form.id) {
      await service.update(form.id, payload);
    } else {
      await service.create({ bookId, ...payload });
    }
    setForm(null);
    await load();
  };

  const remove = async (): Promise<void> => {
    if (!form?.id) return;
    await service.delete(form.id);
    setForm(null);
    await load();
  };

  // ============ 新建时间线 ============

  const confirmNewLine = (): void => {
    const name = newLine?.trim();
    if (!name) return;
    if (!timelines.includes(name)) {
      setTimelines((prev) => [...prev, name]);
    }
    setActiveTab(name);
    setNewLine(null);
  };

  // ============ 拖拽：同线排序 / 跨线移动 ============

  const resetDrag = (): void => {
    setDragId(null);
    setDropHint(null);
  };

  /** 仅在插入位置变化时更新，避免 dragover 高频触发重渲染 */
  const setHint = (lane: string, beforeId: string | null): void => {
    if (dropHint?.lane !== lane || dropHint?.beforeId !== beforeId) {
      setDropHint({ lane, beforeId });
    }
  };

  const handleDrop = async (lane: string): Promise<void> => {
    if (!dragId) return;
    const dragged = events.find((e) => e.id === dragId);
    if (!dragged) {
      resetDrag();
      return;
    }
    const beforeId = dropHint?.lane === lane ? dropHint.beforeId : null;
    if (dragged.timeline === lane) {
      // 同线：插到目标卡片前（无目标则移到末尾），重写整条泳道顺序
      if (beforeId === dragId) {
        resetDrag();
        return;
      }
      const ids = laneEvents(lane)
        .map((e) => e.id)
        .filter((id) => id !== dragId);
      const idx = beforeId ? ids.indexOf(beforeId) : ids.length;
      ids.splice(idx < 0 ? ids.length : idx, 0, dragId);
      await service.reorder(ids);
    } else {
      // 跨线：修改事件所属时间线，放到目标线末尾
      const maxOrder = laneEvents(lane).reduce((m, e) => Math.max(m, e.sortOrder), 0);
      await service.update(dragId, { timeline: lane, sortOrder: maxOrder + 1 });
    }
    resetDrag();
    await load();
  };

  // ============ 渲染 ============

  const visibleLanes = activeTab === '全部' ? timelines : [activeTab];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="relative flex h-[92vh] w-[min(1200px,96vw)] flex-col overflow-hidden rounded bg-white shadow-xl">
        {/* 顶部：标题 + 新建事件 + 关闭 */}
        <div className="flex items-center justify-between border-b border-ink-200 px-4 py-2">
          <span className="text-base font-bold">时间线</span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="rounded bg-violet-600 px-2 py-1 text-sm text-white hover:bg-violet-700"
              onClick={openCreate}
            >
              新建事件
            </button>
            <button
              type="button"
              className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100"
              onClick={onClose}
            >
              ×
            </button>
          </div>
        </div>

        {/* 时间线标签页 + 新线 */}
        <div className="flex flex-wrap items-center gap-1 border-b border-ink-200 px-4 py-1.5">
          {['全部', ...timelines].map((t) => (
            <button
              key={t}
              type="button"
              className={`rounded border px-2 py-1 text-sm hover:bg-ink-100 ${
                activeTab === t ? 'border-violet-300 text-violet-700' : 'border-ink-200'
              }`}
              onClick={() => setActiveTab(t)}
            >
              {t}
            </button>
          ))}
          {newLine === null ? (
            <button
              type="button"
              className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100"
              onClick={() => setNewLine('')}
            >
              ＋新线
            </button>
          ) : (
            <span className="flex items-center gap-1">
              <input
                autoFocus
                className="rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-300"
                placeholder="如 subplot_c"
                value={newLine}
                onChange={(e) => setNewLine(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') confirmNewLine();
                  if (e.key === 'Escape') setNewLine(null);
                }}
              />
              <button
                type="button"
                className="rounded bg-violet-600 px-2 py-1 text-sm text-white hover:bg-violet-700"
                onClick={confirmNewLine}
              >
                确定
              </button>
              <button
                type="button"
                className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100"
                onClick={() => setNewLine(null)}
              >
                取消
              </button>
            </span>
          )}
        </div>

        {/* 主体：每条时间线一个泳道行，横向滚动 */}
        <div className="flex-1 overflow-auto">
          <div className="min-w-max">
            {visibleLanes.length === 0 && (
              <div className="px-4 py-6 text-center text-sm text-ink-400">
                暂无时间线，点击「＋新线」或「新建事件」开始。
              </div>
            )}
            {visibleLanes.map((lane) => {
              const list = laneEvents(lane);
              return (
                <div
                  key={lane}
                  className="flex border-b border-ink-100"
                  onDragOver={(e) => {
                    e.preventDefault();
                    setHint(lane, null);
                  }}
                  onDrop={(e) => {
                    e.preventDefault();
                    void handleDrop(lane);
                  }}
                >
                  {/* 泳道标签（横向滚动时吸左） */}
                  <div className="sticky left-0 z-10 w-28 shrink-0 border-r border-ink-100 bg-white px-2 py-2 text-sm font-medium">
                    {lane}
                  </div>
                  <div className="flex items-center gap-2 p-2">
                    {list.length === 0 && (
                      <span className="whitespace-nowrap text-xs text-ink-400">
                        暂无事件，可拖拽卡片到此时间线
                      </span>
                    )}
                    {list.map((ev, i) => (
                      <Fragment key={ev.id}>
                        {/* 插入位置指示条 */}
                        {dropHint?.lane === lane && dropHint.beforeId === ev.id && dragId !== ev.id && (
                          <span className="h-12 w-0.5 shrink-0 rounded bg-violet-400" />
                        )}
                        <div
                          className={`min-w-[180px] max-w-[220px] shrink-0 cursor-pointer rounded border border-ink-200 bg-white p-2 hover:border-violet-300 ${
                            dragId === ev.id ? 'opacity-40' : ''
                          }`}
                          draggable
                          title={`${ev.title}\n点击编辑；拖拽排序或换线`}
                          onClick={() => openEdit(ev)}
                          onDragStart={(e) => {
                            setDragId(ev.id);
                            e.dataTransfer.effectAllowed = 'move';
                            e.dataTransfer.setData('text/plain', ev.id);
                          }}
                          onDragEnd={resetDrag}
                          onDragOver={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            setHint(lane, ev.id);
                          }}
                          onDrop={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            void handleDrop(lane);
                          }}
                        >
                          <div className="text-sm font-bold">{ev.title}</div>
                          <div className="mt-1 line-clamp-2 min-h-[2em] text-xs text-ink-500">
                            {ev.description || '（无描述）'}
                          </div>
                          {ev.chapterId && chapterMap.get(ev.chapterId) && (
                            <div className="mt-1 truncate text-xs text-violet-600">
                              《{chapterMap.get(ev.chapterId)!.title}》
                            </div>
                          )}
                          {ev.characterIds.length > 0 && (
                            <div className="mt-1 flex flex-wrap gap-1">
                              {ev.characterIds
                                .map((id) => characterMap.get(id)?.name)
                                .filter((n): n is string => Boolean(n))
                                .map((name) => (
                                  <span key={name} className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px]">
                                    {name}
                                  </span>
                                ))}
                            </div>
                          )}
                        </div>
                        {/* 卡片间箭头连接示意 */}
                        {i < list.length - 1 && <span className="text-ink-300">{'->'}</span>}
                      </Fragment>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* 新建/编辑事件弹层 */}
        {form && (
          <div className="absolute inset-0 z-20 flex items-center justify-center bg-black/30 p-4">
            <div className="flex max-h-full w-[460px] flex-col rounded bg-white p-4 shadow-lg">
              <div className="mb-3 text-sm font-bold">{form.id ? '编辑事件' : '新建事件'}</div>
              <label className="mb-1 block text-xs text-ink-500">标题</label>
              <input
                autoFocus
                className="mb-3 rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-300"
                value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
              />
              <label className="mb-1 block text-xs text-ink-500">描述</label>
              <textarea
                className="mb-3 min-h-[96px] rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-300"
                value={form.description}
                onChange={(e) => setForm({ ...form, description: e.target.value })}
              />
              <div className="mb-3 flex gap-3">
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-ink-500">所属时间线</label>
                  <select
                    className="w-full rounded border border-ink-200 px-2 py-1 text-sm"
                    value={form.timeline}
                    onChange={(e) => setForm({ ...form, timeline: e.target.value })}
                  >
                    {[...new Set([form.timeline, ...timelines])].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="flex-1">
                  <label className="mb-1 block text-xs text-ink-500">关联章节</label>
                  <select
                    className="w-full rounded border border-ink-200 px-2 py-1 text-sm"
                    value={form.chapterId}
                    onChange={(e) => setForm({ ...form, chapterId: e.target.value })}
                  >
                    <option value="">（不关联）</option>
                    {chapters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
              <label className="mb-1 block text-xs text-ink-500">关联角色</label>
              <div className="mb-3 max-h-32 overflow-y-auto rounded border border-ink-100 p-2">
                {characters.length === 0 && <span className="text-xs text-ink-400">暂无角色</span>}
                {characters.map((c) => (
                  <label key={c.id} className="flex items-center gap-2 py-0.5 text-sm">
                    <input
                      type="checkbox"
                      checked={form.characterIds.includes(c.id)}
                      onChange={(e) =>
                        setForm({
                          ...form,
                          characterIds: e.target.checked
                            ? [...form.characterIds, c.id]
                            : form.characterIds.filter((id) => id !== c.id)
                        })
                      }
                    />
                    {c.name}
                  </label>
                ))}
              </div>
              <div className="flex items-center justify-between">
                {form.id ? (
                  <button
                    type="button"
                    className="rounded border border-red-300 px-2 py-1 text-sm text-red-600 hover:bg-red-50"
                    onClick={() => void remove()}
                  >
                    删除
                  </button>
                ) : (
                  <span />
                )}
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100"
                    onClick={() => setForm(null)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="rounded bg-violet-600 px-2 py-1 text-sm text-white hover:bg-violet-700"
                    onClick={() => void save()}
                  >
                    保存
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
