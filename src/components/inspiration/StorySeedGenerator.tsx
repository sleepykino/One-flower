/**
 * StorySeedGenerator（P2.1-B M1）：故事种子生成面板（灵感库页内嵌）
 * 题材 + 元素组合 + 语气 + 数量 -> 种子卡片列表，每张可收藏 / 从种子建书
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Sparkles, Star, BookPlus, Dices } from 'lucide-react';
import { getAppContext } from '../../context/app-context';
import { alertDialog } from '../../native/dialog';
import { SEED_TONES } from '../../services/inspiration/types';
import type { StorySeed } from '../../services/inspiration/types';

/** 灵感库变更广播（列表组件监听后刷新） */
export const INSPIRATIONS_REFRESH = 'inspirations-refresh';
export function notifyInspirationsChanged(): void {
  window.dispatchEvent(new CustomEvent(INSPIRATIONS_REFRESH));
}

export function StorySeedGenerator(): JSX.Element {
  const navigate = useNavigate();
  const [genre, setGenre] = useState('');
  const [elementsText, setElementsText] = useState('');
  const [tone, setTone] = useState('serious');
  const [count, setCount] = useState(5);
  const [hints, setHints] = useState('');
  const [seeds, setSeeds] = useState<StorySeed[]>([]);
  const [savedIds, setSavedIds] = useState<Set<string>>(new Set());
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState('');
  // 骰子随机填写：AI 提供随机题材 + 元素（reason 为搭配理由提示）
  const [randomizing, setRandomizing] = useState(false);
  const [randomHint, setRandomHint] = useState('');
  // 建书确认弹窗（书名/类型默认取种子）
  const [creating, setCreating] = useState<{ seed: StorySeed; title: string; genre: string } | null>(null);
  const [bookCreating, setBookCreating] = useState(false);

  /** 骰子：AI 随机提供题材 + 元素组合（覆盖当前输入） */
  const randomize = async (): Promise<void> => {
    setRandomizing(true);
    setError('');
    try {
      const { storySeedService } = getAppContext();
      const r = await storySeedService.randomize();
      setGenre(r.genre);
      setElementsText(r.elements.join('、'));
      setRandomHint(r.reason);
    } catch (e) {
      setError(`随机灵感获取失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setRandomizing(false);
    }
  };

  const generate = async (): Promise<void> => {
    if (!genre.trim()) {
      void alertDialog('请先填写题材');
      return;
    }
    const elements = elementsText
      .split(/[,，、\s]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (elements.length === 0) {
      void alertDialog('请至少填写一个元素，如：时间循环、复仇');
      return;
    }
    setGenerating(true);
    setError('');
    try {
      const { storySeedService } = getAppContext();
      const list = await storySeedService.generate({
        genre: genre.trim(),
        elements,
        count,
        tone,
        hints: hints.trim() || undefined
      });
      setSeeds(list);
      setSavedIds(new Set());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const saveSeed = async (seed: StorySeed): Promise<void> => {
    try {
      const { storySeedService } = getAppContext();
      await storySeedService.saveToInspirations(seed);
      setSavedIds((s) => new Set(s).add(seed.id));
      notifyInspirationsChanged();
    } catch (e) {
      void alertDialog(`收藏失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const confirmCreateBook = async (): Promise<void> => {
    if (!creating) return;
    setBookCreating(true);
    try {
      const { storySeedService } = getAppContext();
      const bookId = await storySeedService.createBookFromSeed(creating.seed, {
        title: creating.title,
        genre: creating.genre
      });
      setCreating(null);
      navigate(`/editor/${bookId}`);
    } catch (e) {
      void alertDialog(`建书失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBookCreating(false);
    }
  };

  return (
    <section className="rounded-lg border border-ink-200 bg-white p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles size={16} className="text-violet-600" />
        <h2 className="font-medium">故事种子生成器</h2>
        <span className="text-xs text-ink-400">题材 + 元素组合，卡文构思期的起点</span>
        <button
          type="button"
          title="让 AI 随机提供一组题材与元素组合"
          disabled={randomizing || generating}
          onClick={() => void randomize()}
          className={`ml-auto flex items-center gap-1 rounded px-2 py-1 text-xs transition ${
            randomizing
              ? 'bg-violet-100 text-violet-700'
              : 'border border-ink-200 text-ink-600 hover:border-violet-300 hover:bg-violet-50 hover:text-violet-700'
          } disabled:opacity-50`}
        >
          <Dices size={13} className={randomizing ? 'animate-spin' : ''} />
          {randomizing ? '掷骰中…' : '随机灵感'}
        </button>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <input
          value={genre}
          onChange={(e) => {
            setGenre(e.target.value);
            setRandomHint('');
          }}
          placeholder="题材 *，如：武侠 / 科幻 / 悬疑"
          className="rounded border border-ink-200 px-2 py-1.5 text-sm outline-none focus:border-violet-400"
        />
        <input
          value={elementsText}
          onChange={(e) => {
            setElementsText(e.target.value);
            setRandomHint('');
          }}
          placeholder="元素组合 *，如：时间循环、复仇、背叛"
          className="rounded border border-ink-200 px-2 py-1.5 text-sm outline-none focus:border-violet-400"
        />
        <select
          value={tone}
          onChange={(e) => setTone(e.target.value)}
          className="rounded border border-ink-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-violet-400"
        >
          {SEED_TONES.map((t) => (
            <option key={t.value} value={t.value}>
              语气：{t.label}
            </option>
          ))}
        </select>
        <select
          value={count}
          onChange={(e) => setCount(Number(e.target.value))}
          className="rounded border border-ink-200 bg-white px-2 py-1.5 text-sm outline-none focus:border-violet-400"
        >
          {[3, 5, 8, 10].map((n) => (
            <option key={n} value={n}>
              数量：{n} 个
            </option>
          ))}
        </select>
      </div>

      {/* 随机搭配理由（骰子生成后展示，手动编辑输入即消失） */}
      {randomHint && (
        <div className="mt-2 rounded border border-violet-100 bg-violet-50/60 px-2 py-1.5 text-xs text-violet-700">
          <Dices size={11} className="mr-1 inline" />
          {randomHint}
        </div>
      )}
      <input
        value={hints}
        onChange={(e) => setHints(e.target.value)}
        placeholder="额外提示（可选），如：主角是反派、双主角结构"
        className="mt-2 w-full rounded border border-ink-200 px-2 py-1.5 text-sm outline-none focus:border-violet-400"
      />

      <button
        type="button"
        disabled={generating}
        className="mt-3 w-full rounded bg-violet-600 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
        onClick={() => void generate()}
      >
        {generating ? '生成中…（约需数十秒）' : '生成故事种子'}
      </button>

      {error && (
        <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-600">
          {error}
        </div>
      )}

      {/* 种子卡片列表 */}
      {seeds.length > 0 && (
        <div className="mt-4 space-y-3">
          {seeds.map((seed) => (
            <div key={seed.id} className="rounded-lg border border-ink-200 bg-ink-50/50 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="font-medium">{seed.title}</div>
                  <div className="mt-0.5 text-sm text-violet-700">{seed.logline}</div>
                </div>
                <div className="flex shrink-0 gap-1">
                  <button
                    type="button"
                    title={savedIds.has(seed.id) ? '已收藏' : '收藏到灵感库'}
                    disabled={savedIds.has(seed.id)}
                    onClick={() => void saveSeed(seed)}
                    className={`flex items-center gap-1 rounded px-2 py-1 text-xs ${
                      savedIds.has(seed.id)
                        ? 'bg-amber-100 text-amber-700'
                        : 'border border-ink-200 bg-white hover:bg-ink-100'
                    }`}
                  >
                    <Star size={12} className={savedIds.has(seed.id) ? 'fill-amber-500 text-amber-500' : ''} />
                    {savedIds.has(seed.id) ? '已收藏' : '收藏'}
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setCreating({ seed, title: seed.title, genre: seed.genre })
                    }
                    className="flex items-center gap-1 rounded border border-violet-200 bg-violet-50 px-2 py-1 text-xs text-violet-700 hover:bg-violet-100"
                  >
                    <BookPlus size={12} />
                    建书
                  </button>
                </div>
              </div>
              {seed.expansion && (
                <p className="mt-2 text-sm leading-relaxed text-ink-700">{seed.expansion}</p>
              )}
              {seed.conflictPoints.length > 0 && (
                <div className="mt-2 text-xs text-ink-600">
                  <span className="font-medium">关键冲突：</span>
                  {seed.conflictPoints.join('；')}
                </div>
              )}
              {seed.possibleEndings.length > 0 && (
                <div className="mt-1 text-xs text-ink-500">
                  <span className="font-medium">结局方向：</span>
                  {seed.possibleEndings.join(' / ')}
                </div>
              )}
              <div className="mt-2 flex flex-wrap gap-1">
                {[seed.genre, ...seed.elements].filter(Boolean).map((t, i) => (
                  <span key={`${t}-${i}`} className="rounded-full bg-ink-200/60 px-2 py-0.5 text-[11px] text-ink-600">
                    {t}
                  </span>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* 建书确认弹窗（书名/类型默认取种子） */}
      {creating && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-sm rounded-lg border border-ink-200 bg-white p-4 shadow-lg">
            <h3 className="mb-1 font-medium">从种子创建新书</h3>
            <p className="mb-3 text-xs text-ink-500">
              种子内容将自动写入新书世界书（分类「故事种子」），AI 上下文立即可用。
            </p>
            <input
              autoFocus
              value={creating.title}
              onChange={(e) => setCreating({ ...creating, title: e.target.value })}
              placeholder="书名 *"
              className="mb-2 w-full rounded border border-ink-200 px-2 py-1.5 text-sm outline-none focus:border-violet-400"
            />
            <input
              value={creating.genre}
              onChange={(e) => setCreating({ ...creating, genre: e.target.value })}
              placeholder="类型"
              className="mb-4 w-full rounded border border-ink-200 px-2 py-1.5 text-sm outline-none focus:border-violet-400"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
                onClick={() => setCreating(null)}
              >
                取消
              </button>
              <button
                type="button"
                disabled={bookCreating || !creating.title.trim()}
                className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
                onClick={() => void confirmCreateBook()}
              >
                {bookCreating ? '创建中…' : '创建并打开'}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}
