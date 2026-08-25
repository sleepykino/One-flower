/**
 * InspirationLibrary（P2.1-B）：灵感库列表
 * 类型筛选（种子/卡片/推演报告/采访摘要）+ 收藏过滤 + 关键词搜索
 * 推演报告/采访摘要按书绑定，显示所属书籍名
 */

import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, Star, BookPlus, Trash2 } from 'lucide-react';
import { getAppContext } from '../../context/app-context';
import { confirmDialog } from '../../native/dialog';
import { renderMarkdown } from '../../utils/markdown';
import {
  INSPIRATION_TYPE_LABEL,
  CARD_TYPE_LABEL,
  INTERVIEW_ANGLE_LABEL
} from '../../services/inspiration/types';
import type { InspirationType } from '../../services/inspiration/types';
import { INSPIRATIONS_REFRESH } from './StorySeedGenerator';

interface LibraryRow {
  id: string;
  bookId: string | null;
  type: InspirationType;
  title: string | null;
  content: string;
  tags: string | null;
  favorited: boolean;
  createdAt: number;
  bookTitle: string | null;
}

type TypeFilter = '' | InspirationType;

export function InspirationLibrary(): JSX.Element {
  const navigate = useNavigate();
  const [rows, setRows] = useState<LibraryRow[]>([]);
  const [typeFilter, setTypeFilter] = useState<TypeFilter>('');
  const [favOnly, setFavOnly] = useState(false);
  const [keyword, setKeyword] = useState('');
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const load = (): void => {
    void (async () => {
      const { db } = getAppContext();
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (typeFilter) {
        conditions.push('type = ?');
        params.push(typeFilter);
      }
      if (favOnly) conditions.push('favorited = 1');
      let sql = 'SELECT * FROM inspirations';
      if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
      sql += ' ORDER BY favorited DESC, created_at DESC';
      const list = await db.query<Record<string, unknown>>(sql, params);
      // 所属书籍名（按书绑定的类型；P6：排除回收站中的书）
      const books = await db.query<{ id: string; title: string }>(
        'SELECT id, title FROM books WHERE deleted_at IS NULL'
      );
      const bookMap = new Map(books.map((b) => [b.id, b.title]));
      setRows(
        list.map((r) => ({
          id: String(r.id),
          bookId: (r.book_id as string | null) ?? null,
          type: String(r.type) as InspirationType,
          title: (r.title as string | null) ?? null,
          content: String(r.content ?? ''),
          tags: (r.tags as string | null) ?? null,
          favorited: Number(r.favorited) === 1,
          createdAt: Number(r.created_at),
          bookTitle: r.book_id ? (bookMap.get(String(r.book_id)) ?? null) : null
        }))
      );
    })();
  };

  useEffect(() => {
    load();
    window.addEventListener(INSPIRATIONS_REFRESH, load);
    return () => window.removeEventListener(INSPIRATIONS_REFRESH, load);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [typeFilter, favOnly]);

  // 关键词过滤（标题 + 内容 + 标签，前端匹配即可）
  const filtered = useMemo(() => {
    const kw = keyword.trim().toLowerCase();
    if (!kw) return rows;
    return rows.filter(
      (r) =>
        (r.title ?? '').toLowerCase().includes(kw) ||
        r.content.toLowerCase().includes(kw) ||
        (r.tags ?? '').toLowerCase().includes(kw)
    );
  }, [rows, keyword]);

  const toggleFavorite = (row: LibraryRow): void => {
    void (async () => {
      const { db, wq } = getAppContext();
      await wq.enqueue(() =>
        db.exec('UPDATE inspirations SET favorited = ? WHERE id = ?', [
          row.favorited ? 0 : 1,
          row.id
        ])
      );
      load();
    })();
  };

  /** 删除单条灵感（确认后从 inspirations 表移除并刷新列表） */
  const deleteInspiration = (row: LibraryRow): void => {
    void (async () => {
      const ok = await confirmDialog(`确认删除这条${INSPIRATION_TYPE_LABEL[row.type]}？\n\n删除后不可恢复。`, '删除灵感');
      if (!ok) return;
      try {
        const { db, wq } = getAppContext();
        await wq.enqueue(() => db.exec('DELETE FROM inspirations WHERE id = ?', [row.id]));
        load();
      } catch (e) {
        void confirmDialog(`删除失败：${e instanceof Error ? e.message : String(e)}`, '错误');
      }
    })();
  };

  /** 从库内种子建书（确认框显示默认书名/类型，取自种子） */
  const createBook = (row: LibraryRow): void => {
    void (async () => {
      const parsed = safeParse(row.content);
      const title = String(parsed.title ?? row.title ?? '未命名');
      const genre = String(parsed.genre ?? '');
      const ok = await confirmDialog(
        `将以书名《${title}》${genre ? `、类型「${genre}」` : ''}创建新书，种子内容会自动写入新书世界书。确认创建？`,
        '从种子创建新书'
      );
      if (!ok) return;
      setCreating(true);
      try {
        const { storySeedService } = getAppContext();
        const bookId = await storySeedService.createBookFromSeed(row.id);
        navigate(`/editor/${bookId}`);
      } catch (e) {
        void confirmDialog(`建书失败：${e instanceof Error ? e.message : String(e)}`, '错误');
      } finally {
        setCreating(false);
      }
    })();
  };

  return (
    <section className="rounded-lg border border-ink-200 bg-white p-4">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <h2 className="font-medium">灵感库</h2>
        <span className="text-xs text-ink-400">{filtered.length} 条</span>
        <div className="ml-auto flex items-center gap-2">
          <div className="flex items-center gap-1 rounded border border-ink-200 px-2 py-1">
            <Search size={12} className="text-ink-400" />
            <input
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              placeholder="关键词搜索"
              className="w-32 text-xs outline-none"
            />
          </div>
          <button
            type="button"
            onClick={() => setFavOnly((v) => !v)}
            className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
              favOnly
                ? 'bg-amber-100 text-amber-700'
                : 'border border-ink-200 text-ink-500 hover:bg-ink-100'
            }`}
          >
            <Star size={12} className={favOnly ? 'fill-amber-500 text-amber-500' : ''} />
            只看收藏
          </button>
        </div>
      </div>

      {/* 类型筛选 */}
      <div className="mb-3 flex flex-wrap gap-1">
        <FilterChip label="全部" active={typeFilter === ''} onClick={() => setTypeFilter('')} />
        {(Object.keys(INSPIRATION_TYPE_LABEL) as InspirationType[]).map((t) => (
          <FilterChip
            key={t}
            label={INSPIRATION_TYPE_LABEL[t]}
            active={typeFilter === t}
            onClick={() => setTypeFilter(t)}
          />
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="rounded-lg border-2 border-dashed border-ink-200 p-10 text-center text-sm text-ink-400">
          {rows.length === 0
            ? '灵感库还是空的。收藏故事种子或今日灵感卡片后，会在这里显示。'
            : '没有符合筛选条件的灵感。'}
        </div>
      ) : (
        <div className="space-y-2">
          {filtered.map((row) => (
            <div key={row.id} className="rounded-lg border border-ink-200 bg-ink-50/40 p-3">
              <div className="flex items-start gap-2">
                <button
                  type="button"
                  onClick={() => setExpandedId((id) => (id === row.id ? null : row.id))}
                  className="min-w-0 flex-1 text-left"
                >
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="rounded-full bg-violet-100 px-2 py-0.5 text-[11px] text-violet-700">
                      {INSPIRATION_TYPE_LABEL[row.type]}
                    </span>
                    <span className="truncate text-sm font-medium">
                      {row.title ?? '（无标题）'}
                    </span>
                    {row.bookTitle && (
                      <span
                        className="rounded-full bg-sky-100 px-2 py-0.5 text-[11px] text-sky-700"
                        title="所属书籍"
                      >
                        《{row.bookTitle}》
                      </span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[11px] text-ink-400">
                    {new Date(row.createdAt).toLocaleString()}
                  </div>
                </button>
                {row.type === 'seed' && (
                  <button
                    type="button"
                    disabled={creating}
                    onClick={() => createBook(row)}
                    className="flex shrink-0 items-center gap-1 rounded border border-violet-200 bg-violet-50 px-2 py-1 text-[11px] text-violet-700 hover:bg-violet-100 disabled:opacity-40"
                  >
                    <BookPlus size={11} />
                    建书
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => toggleFavorite(row)}
                  title={row.favorited ? '取消收藏' : '收藏'}
                  className="shrink-0 rounded p-1 hover:bg-ink-100"
                >
                  <Star
                    size={14}
                    className={row.favorited ? 'fill-amber-500 text-amber-500' : 'text-ink-300'}
                  />
                </button>
                <button
                  type="button"
                  onClick={() => deleteInspiration(row)}
                  title="删除"
                  className="shrink-0 rounded p-1 text-ink-300 hover:bg-red-50 hover:text-red-600"
                >
                  <Trash2 size={14} />
                </button>
              </div>

              {expandedId === row.id && (
                <div className="mt-2 border-t border-ink-100 pt-2">
                  <ItemDetail row={row} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}

function FilterChip({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full px-2.5 py-1 text-xs ${
        active ? 'bg-violet-600 text-white' : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
      }`}
    >
      {label}
    </button>
  );
}

/** 展开详情：按类型渲染 */
function ItemDetail({ row }: { row: LibraryRow }): JSX.Element {
  const parsed = safeParse(row.content);

  if (row.type === 'seed') {
    return (
      <div className="space-y-1.5 text-sm text-ink-700">
        <div className="text-violet-700">{str(parsed.logline)}</div>
        {str(parsed.expansion) && <p className="leading-relaxed">{str(parsed.expansion)}</p>}
        {arr(parsed.conflictPoints).length > 0 && (
          <div className="text-xs text-ink-600">
            <span className="font-medium">关键冲突：</span>
            {arr(parsed.conflictPoints).join('；')}
          </div>
        )}
        {arr(parsed.possibleEndings).length > 0 && (
          <div className="text-xs text-ink-500">
            <span className="font-medium">结局方向：</span>
            {arr(parsed.possibleEndings).join(' / ')}
          </div>
        )}
      </div>
    );
  }

  if (row.type === 'card') {
    return (
      <div className="space-y-1.5">
        <div className="text-xs text-ink-400">
          {CARD_TYPE_LABEL[(parsed.type as keyof typeof CARD_TYPE_LABEL) ?? 'quote'] ?? ''}
        </div>
        <p
          className="md-content text-sm leading-relaxed text-ink-800"
          dangerouslySetInnerHTML={{ __html: renderMarkdown(str(parsed.content)) }}
        />
      </div>
    );
  }

  if (row.type === 'whatif_report') {
    const changes = Array.isArray(parsed.characterChanges)
      ? (parsed.characterChanges as Record<string, unknown>[])
      : [];
    const branches = Array.isArray(parsed.plotBranches)
      ? (parsed.plotBranches as Record<string, unknown>[])
      : [];
    const risks = Array.isArray(parsed.risks) ? (parsed.risks as unknown[]).map(String) : [];
    return (
      <div className="space-y-2 text-sm">
        <div className="text-xs text-ink-400">假设：{str(parsed.hypothesis)}</div>
        <div className="leading-relaxed text-ink-700">{str(parsed.impactScope)}</div>
        {changes.length > 0 && (
          <div className="space-y-1">
            <div className="text-xs font-medium text-ink-600">角色弧光变化</div>
            {changes.map((c, i) => (
              <div key={i} className="text-xs text-ink-600">
                {str(c.characterName)}：{str(c.originalArc)} <span className="text-violet-500">{'->'}</span>{' '}
                <span className="text-violet-700">{str(c.modifiedArc)}</span>
              </div>
            ))}
          </div>
        )}
        {branches.length > 0 && (
          <div className="space-y-0.5">
            <div className="text-xs font-medium text-ink-600">剧情分支</div>
            {branches.map((b, i) => (
              <div key={i} className="text-xs text-ink-600">
                第{String(b.chapterOffset)}章后：{str(b.branchPoint)} {'->'} {str(b.outcome)}
              </div>
            ))}
          </div>
        )}
        {risks.length > 0 && (
          <div className="text-xs text-amber-700">风险：{risks.join('；')}</div>
        )}
        {str(parsed.recommendation) && (
          <div className="text-xs font-medium text-emerald-700">{str(parsed.recommendation)}</div>
        )}
      </div>
    );
  }

  // interview_summary
  return (
    <div className="space-y-1.5 text-sm">
      <div className="text-xs text-ink-400">
        {str(parsed.characterName)} ·{' '}
        {INTERVIEW_ANGLE_LABEL[(parsed.angle as keyof typeof INTERVIEW_ANGLE_LABEL) ?? 'free'] ?? ''}
      </div>
      <p className="whitespace-pre-wrap leading-relaxed text-ink-800">{str(parsed.summary)}</p>
    </div>
  );
}

function safeParse(json: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(json) as unknown;
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : '';
}

function arr(v: unknown): string[] {
  return Array.isArray(v) ? v.map(String) : [];
}
