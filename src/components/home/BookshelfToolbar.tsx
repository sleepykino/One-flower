/**
 * P6 M3 书架工具条：搜索（防抖）/ 类型筛选 / 排序切换
 * 排序偏好持久化 localStorage（对齐 home-sidebar-collapsed 先例）
 */

import type { BookSortMode } from '../../types';

const SORT_KEY = 'bookshelf-sort';

const SORT_OPTIONS: Array<{ value: BookSortMode; label: string }> = [
  { value: 'updated', label: '最近更新' },
  { value: 'created', label: '创建时间' },
  { value: 'title', label: '书名' },
  { value: 'manual', label: '手动排序' }
];

export function readSortMode(): BookSortMode {
  try {
    const v = localStorage.getItem(SORT_KEY);
    if (v === 'updated' || v === 'created' || v === 'title' || v === 'manual') return v;
  } catch {
    // ignore
  }
  return 'updated';
}

export function persistSortMode(mode: BookSortMode): void {
  try {
    localStorage.setItem(SORT_KEY, mode);
  } catch {
    // ignore
  }
}

export function BookshelfToolbar({
  search,
  onSearch,
  genres,
  genreFilter,
  onGenreFilter,
  sortMode,
  onSortMode
}: {
  search: string;
  onSearch: (v: string) => void;
  genres: string[];
  genreFilter: string;
  onGenreFilter: (v: string) => void;
  sortMode: BookSortMode;
  onSortMode: (v: BookSortMode) => void;
}): JSX.Element {
  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      <input
        value={search}
        onChange={(e) => onSearch(e.target.value)}
        placeholder="搜索书名 / 类型 / 作者"
        className="w-56 rounded border border-ink-200 px-2.5 py-1.5 text-sm outline-none focus:border-violet-400"
      />
      <select
        value={genreFilter}
        onChange={(e) => onGenreFilter(e.target.value)}
        className="rounded border border-ink-200 px-2 py-1.5 text-sm"
        title="按类型筛选"
      >
        <option value="">全部类型</option>
        {genres.map((g) => (
          <option key={g} value={g}>
            {g}
          </option>
        ))}
      </select>
      <select
        value={sortMode}
        onChange={(e) => onSortMode(e.target.value as BookSortMode)}
        className="rounded border border-ink-200 px-2 py-1.5 text-sm"
        title="排序方式"
      >
        {SORT_OPTIONS.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      {sortMode === 'manual' && (
        <span className="text-[11px] text-ink-400">拖拽书卡调整顺序；置顶书籍恒排最前</span>
      )}
    </div>
  );
}
