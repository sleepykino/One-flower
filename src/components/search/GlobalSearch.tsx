/**
 * 全局查找替换（Ctrl+Shift+F）：跨章节搜索 + 上下文片段 + 批量替换（确认后执行）
 */

import { useState } from 'react';
import { getAppContext } from '../../context/app-context';
import { confirmDialog } from '../../native/dialog';
import type { SearchResult } from '../../services/search/GlobalSearch';
import { useEditorStore } from '../../store/editorStore';

export function GlobalSearchModal({ bookId, onClose }: { bookId: string; onClose: () => void }): JSX.Element {
  const [query, setQuery] = useState('');
  const [replacement, setReplacement] = useState('');
  const [useRegex, setUseRegex] = useState(false);
  const [caseSensitive, setCaseSensitive] = useState(false);
  const [results, setResults] = useState<SearchResult[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [replacing, setReplacing] = useState(false);
  const [message, setMessage] = useState('');

  const setCurrentChapter = useEditorStore((s) => s.setCurrentChapter);

  const runSearch = async (): Promise<void> => {
    if (!query.trim()) return;
    setSearching(true);
    setMessage('');
    try {
      const rs = await getAppContext().search.search(query, bookId, { useRegex, caseSensitive });
      setResults(rs);
      setMessage(`命中 ${rs.length} 章`);
    } catch (e) {
      setResults(null);
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setSearching(false);
    }
  };

  const runReplace = async (): Promise<void> => {
    if (!query.trim() || !results || results.length === 0) return;
    const total = results.reduce((s, r) => s + r.matches.length, 0);
    const ok = await confirmDialog(
      `将影响 ${results.length} 个章节（约 ${total} 处），替换后自动重建索引。确认执行？`,
      '全局替换确认'
    );
    if (!ok) {
      return;
    }
    setReplacing(true);
    try {
      // 1. 先落盘编辑器中未保存的修改，确保替换基于最新内容
      await useEditorStore.getState().saveCurrentChapter();
      // 2. 执行替换（写文件 + 重建 FTS 索引）
      const r = await getAppContext().search.replace(query, replacement, bookId, {
        useRegex,
        caseSensitive
      });
      setMessage(`已替换 ${r.replacedCount} 处（${r.affectedChapters.length} 章）`);
      // 3. 刷新：当前章节若受影响则重载编辑器内容，并刷新章节列表字数
      const store = useEditorStore.getState();
      const cur = store.currentChapterId;
      if (cur && r.affectedChapters.includes(cur)) {
        const doc = await getAppContext().chapterService.getContent(cur);
        store.editorApi?.setContent(doc);
      }
      if (store.bookId) {
        await store.loadChapters(store.bookId);
      }
      await runSearch();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : String(e));
    } finally {
      setReplacing(false);
    }
  };

  const jumpTo = (chapterId: string): void => {
    setCurrentChapter(chapterId);
  };

  return (
    <div className="fixed inset-0 z-40 flex items-start justify-center bg-black/30 pt-24" onClick={onClose}>
      <div
        className="flex max-h-[70vh] w-[640px] flex-col rounded-lg bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-ink-200 p-3">
          <div className="flex gap-2">
            <input
              autoFocus
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSearch();
                if (e.key === 'Escape') onClose();
              }}
              placeholder="查找内容（支持中文 / 正则）…"
              className="min-w-0 flex-1 rounded border border-ink-200 px-2 py-1.5 text-sm outline-none focus:border-violet-400"
            />
            <input
              value={replacement}
              onChange={(e) => setReplacement(e.target.value)}
              placeholder="替换为…"
              className="min-w-0 flex-1 rounded border border-ink-200 px-2 py-1.5 text-sm outline-none focus:border-violet-400"
            />
          </div>
          <div className="mt-2 flex items-center gap-3 text-xs text-ink-600">
            <label className="flex cursor-pointer items-center gap-1">
              <input type="checkbox" checked={useRegex} onChange={(e) => setUseRegex(e.target.checked)} />
              正则
            </label>
            <label className="flex cursor-pointer items-center gap-1">
              <input
                type="checkbox"
                checked={caseSensitive}
                onChange={(e) => setCaseSensitive(e.target.checked)}
              />
              区分大小写
            </label>
            <button
              type="button"
              disabled={searching || !query.trim()}
              className="ml-auto rounded bg-violet-600 px-3 py-1 text-white hover:bg-violet-700 disabled:opacity-40"
              onClick={() => void runSearch()}
            >
              {searching ? '搜索中…' : '搜索'}
            </button>
            <button
              type="button"
              disabled={replacing || !results || results.length === 0}
              className="rounded bg-red-500 px-3 py-1 text-white hover:bg-red-600 disabled:opacity-40"
              onClick={() => void runReplace()}
            >
              {replacing ? '替换中…' : '全部替换'}
            </button>
          </div>
          {message && <div className="mt-1 text-xs text-violet-600">{message}</div>}
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {results === null && (
            <div className="p-4 text-center text-xs text-ink-400">
              Ctrl+Shift+F 唤起 · 搜索全书章节正文
            </div>
          )}
          {results?.length === 0 && (
            <div className="p-4 text-center text-xs text-ink-400">无命中</div>
          )}
          {results?.map((r) => (
            <div key={r.chapterId} className="mb-2 rounded border border-ink-100">
              <button
                type="button"
                className="flex w-full items-center gap-2 bg-ink-50 px-2 py-1.5 text-left text-sm hover:bg-ink-100"
                onClick={() => jumpTo(r.chapterId)}
              >
                <span className="font-medium">{r.chapterTitle}</span>
                <span className="text-xs text-ink-400">{r.matches.length} 处 · 点击跳转</span>
              </button>
              <div className="p-2">
                {r.matches.slice(0, 5).map((m, i) => (
                  <div key={i} className="mb-1 rounded bg-ink-50 px-2 py-1 text-xs text-ink-600">
                    {m.excerpt}
                  </div>
                ))}
                {r.matches.length > 5 && (
                  <div className="text-[11px] text-ink-400">…其余 {r.matches.length - 5} 处</div>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
