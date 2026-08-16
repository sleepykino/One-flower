/**
 * 伏笔追踪表（P0 简版）：描述 + 埋设章节 + 回收章节 + 状态
 */

import { useEffect, useState } from 'react';
import { getAppContext } from '../../context/app-context';
import { useEditorStore } from '../../store/editorStore';
import {
  FORESHADOWING_STATUS_LABEL,
  type Foreshadowing,
  type ForeshadowingStatus
} from '../../types';

const STATUS_STYLE: Record<ForeshadowingStatus, string> = {
  planted: 'bg-amber-100 text-amber-700',
  resolved: 'bg-emerald-100 text-emerald-700',
  abandoned: 'bg-ink-200 text-ink-600'
};

export function ForeshadowPanel({ bookId }: { bookId: string }): JSX.Element {
  const chapters = useEditorStore((s) => s.chapters);
  const [items, setItems] = useState<Foreshadowing[]>([]);
  const [description, setDescription] = useState('');
  const [planted, setPlanted] = useState('');
  const [resolved, setResolved] = useState('');

  const load = async (): Promise<void> => {
    const rows = await getAppContext().db.query<Record<string, unknown>>(
      'SELECT * FROM foreshadowings WHERE book_id = ? ORDER BY created_at DESC',
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

  const add = async (): Promise<void> => {
    if (!description.trim()) return;
    const { db, wq } = getAppContext();
    await wq.enqueue(() =>
      db.exec(
        'INSERT INTO foreshadowings (id, book_id, description, planted_chapter_id, resolved_chapter_id, status, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
        [
          crypto.randomUUID(),
          bookId,
          description.trim(),
          planted || null,
          resolved || null,
          resolved ? 'resolved' : 'planted',
          Date.now()
        ]
      )
    );
    setDescription('');
    setPlanted('');
    setResolved('');
    await load();
  };

  const setStatus = async (id: string, status: ForeshadowingStatus): Promise<void> => {
    await getAppContext().wq.enqueue(() =>
      getAppContext().db.exec('UPDATE foreshadowings SET status = ? WHERE id = ?', [status, id])
    );
    await load();
  };

  const remove = async (id: string): Promise<void> => {
    await getAppContext().wq.enqueue(() =>
      getAppContext().db.exec('DELETE FROM foreshadowings WHERE id = ?', [id])
    );
    await load();
  };

  const chapterTitle = (id: string | null): string =>
    id ? (chapters.find((c) => c.id === id)?.title ?? '未知章节') : '—';

  return (
    <div className="flex h-full flex-col">
      <div className="border-b border-ink-200 px-3 py-2 text-sm font-medium">
        伏笔追踪（{items.length}）
      </div>
      <div className="border-b border-ink-100 p-2">
        <input
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="伏笔描述，如：主角背上的胎记"
          className="mb-1 w-full rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
        />
        <div className="flex gap-1">
          <select
            value={planted}
            onChange={(e) => setPlanted(e.target.value)}
            className="min-w-0 flex-1 rounded border border-ink-200 px-1 py-1 text-xs"
          >
            <option value="">埋设章节…</option>
            {chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <select
            value={resolved}
            onChange={(e) => setResolved(e.target.value)}
            className="min-w-0 flex-1 rounded border border-ink-200 px-1 py-1 text-xs"
          >
            <option value="">回收章节（可空）…</option>
            {chapters.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
          </select>
          <button
            type="button"
            className="rounded bg-violet-600 px-2 py-1 text-xs text-white hover:bg-violet-700"
            onClick={() => void add()}
          >
            添加
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {items.length === 0 && (
          <div className="px-2 py-4 text-center text-xs text-ink-400">暂无伏笔记录。</div>
        )}
        {items.map((f) => (
          <div key={f.id} className="group mb-1 rounded border border-ink-100 bg-white px-2 py-1.5">
            <div className="flex items-center gap-1">
              <span className={`rounded px-1 text-[10px] ${STATUS_STYLE[f.status]}`}>
                {FORESHADOWING_STATUS_LABEL[f.status]}
              </span>
              <span className="min-w-0 flex-1 truncate text-sm">{f.description}</span>
              <button
                type="button"
                className="hidden text-xs text-ink-400 hover:text-red-600 group-hover:block"
                onClick={() => void remove(f.id)}
              >
                删除
              </button>
            </div>
            <div className="mt-0.5 text-[11px] text-ink-400">
              埋设：{chapterTitle(f.plantedChapterId)} · 回收：
              {chapterTitle(f.resolvedChapterId)}
            </div>
            {f.status !== 'resolved' && (
              <div className="mt-0.5 flex gap-2 text-[11px]">
                {f.status !== 'abandoned' && (
                  <button
                    type="button"
                    className="text-emerald-600 hover:underline"
                    onClick={() => void setStatus(f.id, 'resolved')}
                  >
                    标记已回收
                  </button>
                )}
                {f.status !== 'planted' && (
                  <button
                    type="button"
                    className="text-ink-500 hover:underline"
                    onClick={() => void setStatus(f.id, 'planted')}
                  >
                    标记已埋设
                  </button>
                )}
                <button
                  type="button"
                  className="text-ink-400 hover:underline"
                  onClick={() => void setStatus(f.id, 'abandoned')}
                >
                  放弃
                </button>
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
