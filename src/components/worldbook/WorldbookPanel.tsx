/**
 * 世界书面板（P0 简版）：条目 CRUD + 分类 + 标签
 * 供 [[条目]] 引用与一致性检查使用
 */

import { useEffect, useState } from 'react';
import { getAppContext } from '../../context/app-context';
import { alertDialog, confirmDialog } from '../../native/dialog';
import type { WorldbookEntry } from '../../types';

const CATEGORIES = ['地点', '势力', '物品', '事件', '其他'];

export function WorldbookPanel({ bookId }: { bookId: string }): JSX.Element {
  const [entries, setEntries] = useState<WorldbookEntry[]>([]);
  const [editing, setEditing] = useState<Partial<WorldbookEntry> | null>(null);

  const load = async (): Promise<void> => {
    const rows = await getAppContext().db.query<Record<string, unknown>>(
      'SELECT * FROM worldbook_entries WHERE book_id = ? ORDER BY created_at DESC',
      [bookId]
    );
    setEntries(
      rows.map((r) => ({
        id: String(r.id),
        bookId: String(r.book_id),
        title: String(r.title),
        category: (r.category as string) ?? null,
        content: String(r.content ?? ''),
        tags: (r.tags as string) ?? '[]',
        createdAt: Number(r.created_at),
        updatedAt: Number(r.updated_at)
      }))
    );
  };

  useEffect(() => {
    void load();
  }, [bookId]);

  const save = async (): Promise<void> => {
    if (!editing?.title?.trim()) {
      void alertDialog('标题不能为空');
      return;
    }
    const { db, wq } = getAppContext();
    const now = Date.now();
    if (editing.id) {
      await wq.enqueue(() =>
        db.exec(
          'UPDATE worldbook_entries SET title = ?, category = ?, content = ?, tags = ?, updated_at = ? WHERE id = ?',
          [
            editing.title,
            editing.category ?? null,
            editing.content ?? '',
            editing.tags ?? '[]',
            now,
            editing.id
          ]
        )
      );
    } else {
      await wq.enqueue(() =>
        db.exec(
          'INSERT INTO worldbook_entries (id, book_id, title, category, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [
            crypto.randomUUID(),
            bookId,
            editing.title,
            editing.category ?? null,
            editing.content ?? '',
            editing.tags ?? '[]',
            now,
            now
          ]
        )
      );
    }
    setEditing(null);
    await load();
    window.dispatchEvent(new Event('novel-mentions-refresh'));
  };

  const remove = async (id: string): Promise<void> => {
    if (!(await confirmDialog('确认删除该条目？'))) return;
    await getAppContext().wq.enqueue(() =>
      getAppContext().db.exec('DELETE FROM worldbook_entries WHERE id = ?', [id])
    );
    await load();
    window.dispatchEvent(new Event('novel-mentions-refresh'));
  };

  if (editing) {
    return (
      <div className="flex h-full flex-col p-3">
        <div className="mb-2 text-sm font-medium">{editing.id ? '编辑条目' : '新建条目'}</div>
        <input
          value={editing.title ?? ''}
          onChange={(e) => setEditing({ ...editing, title: e.target.value })}
          placeholder="标题，如：青云剑派"
          className="mb-2 w-full rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
        />
        <select
          value={editing.category ?? '其他'}
          onChange={(e) => setEditing({ ...editing, category: e.target.value })}
          className="mb-2 w-full rounded border border-ink-200 px-2 py-1 text-sm"
        >
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <textarea
          rows={8}
          value={editing.content ?? ''}
          onChange={(e) => setEditing({ ...editing, content: e.target.value })}
          placeholder="设定内容（一致性检查与后续 RAG 的素材）"
          className="mb-2 w-full flex-1 resize-none rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
        />
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700"
            onClick={() => void save()}
          >
            保存
          </button>
          <button
            type="button"
            className="rounded border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
            onClick={() => setEditing(null)}
          >
            取消
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
        <span className="text-sm font-medium">世界书（{entries.length}）</span>
        <button
          type="button"
          className="rounded bg-violet-600 px-2 py-1 text-xs text-white hover:bg-violet-700"
          onClick={() => setEditing({ category: '其他' })}
        >
          新建
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {entries.length === 0 && (
          <div className="px-2 py-4 text-center text-xs text-ink-400">
            世界书记录地点 / 势力 / 物品 / 事件设定，供 [[引用]] 与一致性检查。
          </div>
        )}
        {entries.map((w) => (
          <div
            key={w.id}
            className="group mb-1 cursor-pointer rounded border border-ink-100 bg-white px-2 py-1.5 hover:border-violet-300"
            onClick={() => setEditing(w)}
          >
            <div className="flex items-center gap-1">
              <span className="rounded bg-sky-50 px-1 text-[10px] text-sky-600">
                {w.category ?? '其他'}
              </span>
              <span className="text-sm font-medium">{w.title}</span>
              <button
                type="button"
                className="ml-auto hidden text-xs text-ink-400 hover:text-red-600 group-hover:block"
                onClick={(e) => {
                  e.stopPropagation();
                  void remove(w.id);
                }}
              >
                删除
              </button>
            </div>
            <div className="mt-0.5 line-clamp-2 text-xs text-ink-400">{w.content}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
