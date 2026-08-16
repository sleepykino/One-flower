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
  const [embeddedIds, setEmbeddedIds] = useState<Set<string>>(new Set());
  const [embedBatch, setEmbedBatch] = useState<{
    done: number;
    total: number;
    running: boolean;
    errorCount: number;
  } | null>(null);

  const loadEmbedded = async (): Promise<void> => {
    try {
      const ids = await getAppContext().ragService.embeddedEntryIds(bookId);
      setEmbeddedIds(ids);
    } catch {
      setEmbeddedIds(new Set());
    }
  };

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
    void loadEmbedded();
  };

  useEffect(() => {
    void load();
  }, [bookId]);

  /** 保存后自动向量化（后台，失败不影响保存） */
  const autoEmbed = (entryId: string): void => {
    void getAppContext()
      .ragService.embedEntry(entryId)
      .then(() => loadEmbedded())
      .catch((e) => console.warn('[RAG] 自动向量化失败:', e));
  };

  const save = async (): Promise<void> => {
    if (!editing?.title?.trim()) {
      void alertDialog('标题不能为空');
      return;
    }
    const { db, wq } = getAppContext();
    const now = Date.now();
    let savedId: string;
    if (editing.id) {
      savedId = editing.id;
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
      savedId = crypto.randomUUID();
      await wq.enqueue(() =>
        db.exec(
          'INSERT INTO worldbook_entries (id, book_id, title, category, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [
            savedId,
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
    autoEmbed(savedId);
    await load();
    window.dispatchEvent(new Event('novel-mentions-refresh'));
  };

  const remove = async (id: string): Promise<void> => {
    if (!(await confirmDialog('确认删除该条目？'))) return;
    const { db, wq, ragService } = getAppContext();
    await wq.enqueue(() => db.exec('DELETE FROM worldbook_entries WHERE id = ?', [id]));
    await ragService.removeEmbedding(id).catch(() => undefined);
    await load();
    window.dispatchEvent(new Event('novel-mentions-refresh'));
  };

  /** 批量向量化（首次启用 RAG / 内容更新后补全） */
  const runEmbedAll = async (): Promise<void> => {
    if (embedBatch?.running) return;
    const { ragService } = getAppContext();
    const total = entries.length;
    setEmbedBatch({ done: 0, total, running: true, errorCount: 0 });
    let done = 0;
    let errorCount = 0;
    try {
      for await (const p of ragService.embedAll(bookId)) {
        if (p.status === 'done' || p.status === 'error') {
          done += 1;
          if (p.status === 'error') errorCount += 1;
          setEmbedBatch({ done, total, running: true, errorCount });
        }
      }
    } catch (e) {
      void alertDialog(`向量化失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setEmbedBatch({ done, total, running: false, errorCount });
      void loadEmbedded();
    }
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
        <div className="flex items-center gap-2">
          {embedBatch ? (
            <span className="text-[11px] text-ink-400">
              {embedBatch.running
                ? `向量化 ${embedBatch.done}/${embedBatch.total}…`
                : `完成 ${embedBatch.done}/${embedBatch.total}${embedBatch.errorCount ? `（失败 ${embedBatch.errorCount}）` : ''}`}
            </span>
          ) : (
            <button
              type="button"
              disabled={entries.length === 0}
              className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-100 disabled:opacity-40"
              onClick={() => void runEmbedAll()}
            >
              批量向量化
            </button>
          )}
          <button
            type="button"
            className="rounded bg-violet-600 px-2 py-1 text-xs text-white hover:bg-violet-700"
            onClick={() => setEditing({ category: '其他' })}
          >
            新建
          </button>
        </div>
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
              {embeddedIds.has(w.id) && (
                <span
                  title="已向量化（参与 RAG 检索）"
                  className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
                />
              )}
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
