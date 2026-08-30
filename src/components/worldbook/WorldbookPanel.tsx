/**
 * 世界书面板（P0 简版）：条目 CRUD + 分类 + 标签
 * 供 [[条目]] 引用与一致性检查使用
 */

import { useEffect, useState } from 'react';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { getAppContext } from '../../context/app-context';
import { confirmDialog, pickSavePath } from '../../native/dialog';
import { toast } from '../common/toast';
import { useEditorStore } from '../../store/editorStore';
import { removeWorldbookRefs } from '../../utils/pmdoc';
import type { WorldbookEntry } from '../../types';
import { SettingFactsView } from './SettingFactsView';

const CATEGORIES = ['地点', '势力', '物品', '事件', '其他'];

type WbTab = 'entries' | 'facts';

export function WorldbookPanel({ bookId }: { bookId: string }): JSX.Element {
  // P2.1-M6：面板标签页（条目 / 设定事实）
  const [tab, setTab] = useState<WbTab>('entries');
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
        enabled: Number(r.enabled ?? 1) !== 0,
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
      void toast.info('标题不能为空');
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
    if (!(await confirmDialog('确认删除该条目？正文中的 [[引用]] 将一并移除。'))) return;
    const { db, wq, ragService, chapterService } = getAppContext();
    // 联动清理各章节正文中指向该条目的引用节点（避免悬挂引用）
    const chRows = await db.query<{ id: string }>(
      'SELECT id FROM chapters WHERE book_id = ?',
      [bookId]
    );
    const affected: string[] = [];
    let removedRefs = 0;
    for (const ch of chRows) {
      try {
        const doc = await chapterService.getContent(ch.id);
        const { doc: newDoc, count } = removeWorldbookRefs(doc, id);
        if (count > 0) {
          await chapterService.saveContent(ch.id, newDoc);
          affected.push(ch.id);
          removedRefs += count;
        }
      } catch {
        // 单章读取失败不阻塞删除主流程
      }
    }
    // 批次5建议1：世界书删除在事务内级联清理 setting_facts(source='worldbook')（source_ref 无 FK，
    // 须显式删，防孤儿事实污染一致性基线；其推导链 setting_inferences 由 FK 级联）。
    // worldbook_embeddings 由 entry_id FK 级联，另显式 removeEmbedding 兜底。
    await wq.enqueue(() =>
      db.transaction(async (tx) => {
        await tx.exec('DELETE FROM setting_facts WHERE source = ? AND source_ref = ?', [
          'worldbook',
          id
        ]);
        await tx.exec('DELETE FROM worldbook_entries WHERE id = ?', [id]);
      })
    );
    await ragService.removeEmbedding(id).catch(() => undefined);
    await load();
    window.dispatchEvent(new Event('novel-mentions-refresh'));
    // 当前打开章节若受影响，重载编辑器内容与磁盘一致
    const store = useEditorStore.getState();
    if (store.currentChapterId && affected.includes(store.currentChapterId)) {
      try {
        const doc = await chapterService.getContent(store.currentChapterId);
        store.editorApi?.setContent(doc);
      } catch {
        // 忽略重载失败
      }
    }
    if (affected.length > 0 && store.bookId) {
      await store.loadChapters(store.bookId);
    }
    if (removedRefs > 0) {
      void toast.info(`已同步移除 ${affected.length} 个章节中的 ${removedRefs} 处引用`);
    }
  };

  /** 启用/禁用开关：禁用条目不参与 AI 注入 / RAG 检索 / [[ 新增引用列表 */
  const toggleEnabled = async (id: string, next: boolean): Promise<void> => {
    const { db, wq } = getAppContext();
    await wq.enqueue(() =>
      db.exec('UPDATE worldbook_entries SET enabled = ?, updated_at = ? WHERE id = ?', [
        next ? 1 : 0,
        Date.now(),
        id
      ])
    );
    await load();
    window.dispatchEvent(new Event('novel-mentions-refresh'));
  };

  /** 导出本书世界书为 JSON 文件（含启用状态；原生 save 对话框） */
  const exportJson = async (): Promise<void> => {
    if (entries.length === 0) {
      void toast.info('暂无条目可导出');
      return;
    }
    try {
      const path = await pickSavePath({
        fileName: '世界书.json',
        title: '导出世界书',
        filters: [{ name: '世界书', extensions: ['json'] }]
      });
      if (!path) return;
      const payload = JSON.stringify(
        {
          kind: 'oneflower-worldbook',
          version: 1,
          exportedAt: Date.now(),
          count: entries.length,
          entries: entries.map((e) => ({
            title: e.title,
            category: e.category ?? '其他',
            content: e.content,
            tags: e.tags ?? '[]',
            enabled: e.enabled
          }))
        },
        null,
        2
      );
      await getAppContext().bridge.fs.writeFile(path, payload);
      void toast.success(`已导出 ${entries.length} 个条目`);
    } catch (e) {
      void toast.error(`导出失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** 从 JSON 文件导入条目（生成新 id 归入本书；不自动向量化，可稍后批量处理） */
  const importJson = async (): Promise<void> => {
    try {
      const path = await openDialog({
        title: '导入世界书',
        multiple: false,
        filters: [{ name: '世界书', extensions: ['json'] }]
      });
      if (!path || Array.isArray(path)) return;
      const text = await getAppContext().bridge.fs.readFile(path);
      const parsed = JSON.parse(text) as { kind?: string; entries?: unknown };
      const list = Array.isArray(parsed?.entries)
        ? parsed.entries
        : Array.isArray(parsed)
          ? parsed
          : null;
      if (!list || (parsed?.kind && parsed.kind !== 'oneflower-worldbook')) {
        void toast.error('文件格式不符：需要 OneFlower 世界书导出的 JSON');
        return;
      }
      type ImportRow = { title?: unknown; category?: unknown; content?: unknown; tags?: unknown; enabled?: unknown };
      const rows = (list as ImportRow[]).filter((r) => r && typeof r.title === 'string' && String(r.title).trim());
      if (rows.length === 0) {
        void toast.info('文件中没有可导入的条目');
        return;
      }
      const { db, wq } = getAppContext();
      const now = Date.now();
      let inserted = 0;
      for (const r of rows) {
        await wq.enqueue(() =>
          db.exec(
            'INSERT INTO worldbook_entries (id, book_id, title, category, content, tags, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [
              crypto.randomUUID(),
              bookId,
              String(r.title),
              typeof r.category === 'string' && CATEGORIES.includes(r.category) ? r.category : '其他',
              typeof r.content === 'string' ? r.content : '',
              typeof r.tags === 'string' ? r.tags : '[]',
              r.enabled === false ? 0 : 1,
              now,
              now
            ]
          )
        );
        inserted += 1;
      }
      await load();
      window.dispatchEvent(new Event('novel-mentions-refresh'));
      void toast.success(`已导入 ${inserted} 个条目，可用「批量向量化」纳入检索`);
    } catch (e) {
      void toast.error(`导入失败：${e instanceof Error ? e.message : String(e)}`);
    }
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
      void toast.error(`向量化失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setEmbedBatch({ done, total, running: false, errorCount });
      void loadEmbedded();
    }
  };

  if (tab === 'facts') {
    return (
      <div className="flex h-full flex-col">
        <div className="flex border-b border-ink-200 text-xs">
          <button type="button" onClick={() => setTab('entries')} className="flex-1 py-2 text-ink-500 hover:text-ink-800">条目</button>
          <button type="button" onClick={() => setTab('facts')} className="flex-1 border-b-2 border-violet-600 font-medium py-2 text-violet-700">设定事实</button>
        </div>
        <div className="min-h-0 flex-1">
          <SettingFactsView bookId={bookId} />
        </div>
      </div>
    );
  }

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
      <div className="flex border-b border-ink-200 text-xs">
        <button type="button" onClick={() => setTab('entries')} className="flex-1 border-b-2 border-violet-600 font-medium py-2 text-violet-700">条目</button>
        <button type="button" onClick={() => setTab('facts')} className="flex-1 py-2 text-ink-500 hover:text-ink-800">设定事实</button>
      </div>
      <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
        <span className="text-sm font-medium">
          世界书（{entries.length}{entries.some((e) => !e.enabled) ? ` · 启用 ${entries.filter((e) => e.enabled).length}` : ''}）
        </span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-100"
            onClick={() => void exportJson()}
          >
            导出
          </button>
          <button
            type="button"
            className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-100"
            onClick={() => void importJson()}
          >
            导入
          </button>
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
            className={`group mb-1 cursor-pointer rounded border border-ink-100 bg-white px-2 py-1.5 hover:border-violet-300 ${
              w.enabled ? '' : 'opacity-60'
            }`}
            onClick={() => setEditing(w)}
          >
            <div className="flex items-center gap-1">
              <span className="rounded bg-sky-50 px-1 text-[10px] text-sky-600">
                {w.category ?? '其他'}
              </span>
              <span className="text-sm font-medium">{w.title}</span>
              {!w.enabled && (
                <span className="rounded bg-ink-100 px-1 text-[10px] text-ink-500">已禁用</span>
              )}
              {embeddedIds.has(w.id) && (
                <span
                  title="已向量化（参与 RAG 检索）"
                  className="inline-block h-1.5 w-1.5 rounded-full bg-emerald-500"
                />
              )}
              <label
                className="ml-auto flex cursor-pointer items-center gap-0.5"
                title={w.enabled ? '已启用：参与 AI 注入 / 检索 / 引用' : '已禁用：暂停参与 AI 注入 / 检索 / 引用'}
                onClick={(e) => e.stopPropagation()}
              >
                <input
                  type="checkbox"
                  className="h-3 w-3 accent-violet-600"
                  checked={w.enabled}
                  onChange={(e) => void toggleEnabled(w.id, e.target.checked)}
                />
                <span className="text-[10px] text-ink-400">启用</span>
              </label>
              <button
                type="button"
                className="hidden text-xs text-ink-400 hover:text-red-600 group-hover:block"
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
