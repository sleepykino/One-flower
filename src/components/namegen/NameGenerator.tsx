/**
 * 命名生成器（P2）：全屏 overlay
 * - 生成视图：类型/题材/性别/数量/提示 -> LLM 批量生成，可收藏 / 创建角色卡 / 存入世界书
 * - 收藏夹视图：查看与删除已收藏的名字
 */

import { useEffect, useMemo, useState } from 'react';
import { getAppContext } from '../../context/app-context';
import { toast } from '../common/toast';
import { NameGeneratorService } from '../../services/namegen/NameGeneratorService';
import type { Gender, GeneratedName, NameFavorite, NameType } from '../../services/namegen/types';
import { GENRES, TYPE_LABEL } from '../../services/namegen/types';

interface Props {
  bookId: string;
  onClose: () => void;
}

const GENDER_OPTIONS: { value: Gender; label: string }[] = [
  { value: 'male', label: '男性' },
  { value: 'female', label: '女性' },
  { value: 'neutral', label: '中性' }
];

/** 非角色类型存入世界书时的分类映射 */
const WORLDBOOK_CATEGORY: Record<Exclude<NameType, 'character'>, string> = {
  location: '地点',
  skill: '功法',
  faction: '势力'
};

/** 收藏判重键：类型 + 名字 */
const favKey = (type: NameType, name: string): string => `${type}:${name}`;

export function NameGenerator({ bookId, onClose }: Props): JSX.Element {
  const service = useMemo(() => {
    const { bridge, db, wq } = getAppContext();
    return new NameGeneratorService(bridge, db, wq);
  }, []);

  const [view, setView] = useState<'gen' | 'fav'>('gen');
  const [type, setType] = useState<NameType>('character');
  const [genre, setGenre] = useState<string>(GENRES[0]);
  const [gender, setGender] = useState<Gender>('male');
  const [count, setCount] = useState<number>(10);
  const [hints, setHints] = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<GeneratedName[]>([]);
  const [favorites, setFavorites] = useState<NameFavorite[]>([]);

  const favNames = useMemo(
    () => new Set(favorites.map((f) => favKey(f.type, f.name))),
    [favorites]
  );

  const loadFavorites = async (): Promise<void> => {
    try {
      setFavorites(await service.listFavorites(bookId));
    } catch (e) {
      console.warn('[NameGenerator] 收藏夹加载失败:', e);
    }
  };

  useEffect(() => {
    void loadFavorites();
  }, [bookId]);

  /** 生成名字（loading 态 + 错误弹窗） */
  const handleGenerate = async (): Promise<void> => {
    if (loading) return;
    setLoading(true);
    try {
      const list = await service.generate(bookId, {
        type,
        genre,
        count,
        ...(type === 'character' ? { gender } : {}),
        ...(hints.trim() ? { hints: hints.trim() } : {})
      });
      setResults(list);
      if (list.length === 0) void toast.info('未生成任何名字，请调整参数重试');
    } catch (e) {
      void toast.error(`生成失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  };

  /** 收藏 / 已收藏则忽略 */
  const handleFavorite = async (n: GeneratedName): Promise<void> => {
    if (favNames.has(favKey(n.type, n.name))) return;
    try {
      await service.saveFavorite(bookId, n, genre);
      await loadFavorites();
    } catch (e) {
      void toast.error(`收藏失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** 创建角色卡（含义写入背景字段） */
  const createCharacterCard = async (n: GeneratedName): Promise<void> => {
    try {
      await getAppContext().characterService.create(bookId, {
        name: n.name,
        data: { background: n.meaning }
      });
      void toast.success(`已创建角色卡「${n.name}」`);
    } catch (e) {
      void toast.error(`创建角色卡失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** 存入世界书（与 WorldbookPanel 相同方式：直接写 worldbook_entries + 通知刷新） */
  const saveToWorldbook = async (n: GeneratedName): Promise<void> => {
    if (n.type === 'character') return;
    try {
      const { db, wq } = getAppContext();
      const id = crypto.randomUUID();
      const now = Date.now();
      // 闭包外先取值：n.type 的类型收窄不会传入 wq.enqueue 的回调
      const category = WORLDBOOK_CATEGORY[n.type];
      await wq.enqueue(() =>
        db.exec(
          'INSERT INTO worldbook_entries (id, book_id, title, category, content, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [id, bookId, n.name, category, n.meaning, '[]', now, now]
        )
      );
      window.dispatchEvent(new Event('novel-mentions-refresh'));
      void toast.success(`已存入世界书「${n.name}」`);
    } catch (e) {
      void toast.error(`存入世界书失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const removeFav = async (id: string): Promise<void> => {
    try {
      await service.removeFavorite(id);
      await loadFavorites();
    } catch (e) {
      void toast.error(`删除失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex h-[90vh] w-[min(900px,94vw)] flex-col rounded bg-white">
        {/* 顶部：标题 + 视图切换 + 关闭 */}
        <div className="flex items-center justify-between border-b border-ink-200 px-4 py-3">
          <div className="flex items-center gap-4">
            <span className="text-base font-medium">命名生成器</span>
            <div className="flex gap-1">
              <button
                type="button"
                className={
                  view === 'gen'
                    ? 'rounded bg-violet-600 px-3 py-1 text-sm text-white'
                    : 'rounded border border-ink-200 px-3 py-1 text-sm hover:bg-ink-100'
                }
                onClick={() => setView('gen')}
              >
                生成
              </button>
              <button
                type="button"
                className={
                  view === 'fav'
                    ? 'rounded bg-violet-600 px-3 py-1 text-sm text-white'
                    : 'rounded border border-ink-200 px-3 py-1 text-sm hover:bg-ink-100'
                }
                onClick={() => setView('fav')}
              >
                收藏夹（{favorites.length}）
              </button>
            </div>
          </div>
          <button
            type="button"
            className="rounded px-2 py-1 text-lg leading-none text-ink-400 hover:bg-ink-100 hover:text-ink-600"
            onClick={onClose}
          >
            ×
          </button>
        </div>

        {view === 'gen' ? (
          <>
            {/* 表单行 */}
            <div className="flex flex-wrap items-center gap-2 border-b border-ink-100 px-4 py-2">
              <select
                value={type}
                onChange={(e) => setType(e.target.value as NameType)}
                className="rounded border border-ink-200 px-2 py-1 text-sm"
              >
                {(Object.keys(TYPE_LABEL) as NameType[]).map((t) => (
                  <option key={t} value={t}>
                    {TYPE_LABEL[t]}
                  </option>
                ))}
              </select>
              <select
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                className="rounded border border-ink-200 px-2 py-1 text-sm"
              >
                {GENRES.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
              {type === 'character' && (
                <select
                  value={gender}
                  onChange={(e) => setGender(e.target.value as Gender)}
                  className="rounded border border-ink-200 px-2 py-1 text-sm"
                >
                  {GENDER_OPTIONS.map((g) => (
                    <option key={g.value} value={g.value}>
                      {g.label}
                    </option>
                  ))}
                </select>
              )}
              <input
                type="number"
                min={1}
                max={20}
                value={count}
                onChange={(e) => {
                  const v = Number(e.target.value);
                  setCount(Math.min(20, Math.max(1, Number.isNaN(v) ? 1 : v)));
                }}
                className="w-16 rounded border border-ink-200 px-2 py-1 text-sm"
              />
              <input
                value={hints}
                onChange={(e) => setHints(e.target.value)}
                placeholder="如：姓林，单字 / 带'星'字"
                className="min-w-40 flex-1 rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
              />
              <button
                type="button"
                disabled={loading}
                className="rounded bg-violet-600 px-3 py-1 text-sm text-white hover:bg-violet-700 disabled:opacity-50"
                onClick={() => void handleGenerate()}
              >
                {loading ? '生成中…' : '生成'}
              </button>
            </div>

            {/* 结果卡片网格 */}
            <div className="flex-1 overflow-y-auto p-4">
              {results.length === 0 ? (
                <div className="px-2 py-8 text-center text-sm text-ink-400">
                  选择类型与题材后点击「生成」，为角色、地点、招式、势力批量起名。
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-2">
                  {results.map((n) => {
                    const isFav = favNames.has(favKey(n.type, n.name));
                    return (
                      <div key={favKey(n.type, n.name)} className="rounded border border-ink-200 p-2">
                        <div className="text-base font-medium">{n.name}</div>
                        <div className="mt-1 line-clamp-2 text-xs text-ink-400">{n.meaning}</div>
                        <div className="mt-2 flex flex-wrap gap-1">
                          <button
                            type="button"
                            className={
                              isFav
                                ? 'rounded border border-violet-300 px-2 py-1 text-sm text-violet-600'
                                : 'rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100'
                            }
                            onClick={() => void handleFavorite(n)}
                          >
                            {isFav ? '★已收藏' : '☆收藏'}
                          </button>
                          {n.type === 'character' ? (
                            <button
                              type="button"
                              className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100"
                              onClick={() => void createCharacterCard(n)}
                            >
                              创建角色卡
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100"
                              onClick={() => void saveToWorldbook(n)}
                            >
                              存入世界书
                            </button>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        ) : (
          /* 收藏夹视图 */
          <div className="flex-1 overflow-y-auto p-4">
            {favorites.length === 0 ? (
              <div className="px-2 py-8 text-center text-sm text-ink-400">
                暂无收藏，去生成视图点亮 ☆ 吧。
              </div>
            ) : (
              favorites.map((f) => (
                <div
                  key={f.id}
                  className="mb-1 flex items-center gap-2 rounded border border-ink-100 px-2 py-1.5"
                >
                  <span className="shrink-0 rounded bg-violet-50 px-1 text-[10px] text-violet-600">
                    {TYPE_LABEL[f.type]}
                  </span>
                  {f.genre && (
                    <span className="shrink-0 rounded bg-sky-50 px-1 text-[10px] text-sky-600">
                      {f.genre}
                    </span>
                  )}
                  <span className="shrink-0 text-sm font-medium">{f.name}</span>
                  <span className="line-clamp-1 text-xs text-ink-400">{f.meaning}</span>
                  <button
                    type="button"
                    className="ml-auto shrink-0 text-xs text-ink-400 hover:text-red-600"
                    onClick={() => void removeFav(f.id)}
                  >
                    删除
                  </button>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
