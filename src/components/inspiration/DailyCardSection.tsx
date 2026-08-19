/**
 * DailyCardSection（P2.1-B M2）：今日灵感区块（灵感库页顶部）
 * - 入口条常驻（显示今日状态小标记），手动点击展开，不自动弹出、不打断启动
 * - 展开后显示卡片 + 收藏 / 换一张 / 不再推荐此类 / 收起
 * - 模型未配置 / 生成失败时展示默认兜底卡，引导用户配置模型
 */

import { useEffect, useState } from 'react';
import { ChevronDown, ChevronUp, RefreshCw, Star, Ban, Lightbulb } from 'lucide-react';
import { getAppContext } from '../../context/app-context';
import { renderMarkdown } from '../../utils/markdown';
import { CARD_TYPE_LABEL } from '../../services/inspiration/types';
import type { InspirationCard, CardType } from '../../services/inspiration/types';
import { INSPIRATIONS_REFRESH, notifyInspirationsChanged } from './StorySeedGenerator';

export function DailyCardSection(): JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [card, setCard] = useState<InspirationCard | null>(null);
  const [isToday, setIsToday] = useState(false); // 当日卡片是否已 AI 生成
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [favorited, setFavorited] = useState(false);

  useEffect(() => {
    void (async () => {
      const { dailyCardService } = getAppContext();
      setCard(await dailyCardService.getToday());
      setIsToday(await dailyCardService.hasToday());
    })();
  }, []);

  /** 显式生成（首次生成 / 换一张共用；当日重复调用替换旧卡） */
  const generate = async (): Promise<void> => {
    setLoading(true);
    setError('');
    try {
      const { dailyCardService } = getAppContext();
      const c = await dailyCardService.generateToday();
      setCard(c);
      setIsToday(true);
      setFavorited(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      // 失败时保持当前卡片（未生成过则为默认兜底卡）
      if (!card) {
        const { dailyCardService } = getAppContext();
        setCard(await dailyCardService.getToday());
      }
    } finally {
      setLoading(false);
    }
  };

  const favorite = async (): Promise<void> => {
    if (!card || favorited) return;
    try {
      const { dailyCardService } = getAppContext();
      await dailyCardService.favorite(card);
      setFavorited(true);
      notifyInspirationsChanged();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  /** 不再推荐此类：屏蔽类型后重新生成一张其他类型的卡片 */
  const blockAndRegenerate = async (): Promise<void> => {
    if (!card) return;
    setLoading(true);
    setError('');
    try {
      const { dailyCardService } = getAppContext();
      await dailyCardService.blockType(card.type as CardType);
      const c = await dailyCardService.generateToday();
      setCard(c);
      setFavorited(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  };

  return (
    <section className="rounded-lg border border-ink-200 bg-white">
      {/* 入口条（常驻，点击展开） */}
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        className="flex w-full items-center gap-2 px-4 py-3 text-left hover:bg-ink-50"
      >
        <Lightbulb size={16} className="text-amber-500" />
        <span className="font-medium">今日灵感</span>
        {isToday ? (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-[11px] text-emerald-700">
            已生成
          </span>
        ) : (
          <span className="rounded-full bg-ink-100 px-2 py-0.5 text-[11px] text-ink-500">
            未生成
          </span>
        )}
        <span className="ml-auto flex items-center gap-1 text-xs text-ink-400">
          {expanded ? '收起' : '展开'}
          {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
        </span>
      </button>

      {/* 展开区 */}
      {expanded && (
        <div className="border-t border-ink-100 p-4">
          {card ? (
            <div className="rounded-lg bg-gradient-to-br from-amber-50 to-violet-50 p-4">
              <div className="mb-1 flex items-center gap-2">
                <span className="rounded-full bg-violet-600 px-2 py-0.5 text-[11px] text-white">
                  {CARD_TYPE_LABEL[card.type]}
                </span>
                {card.source === 'builtin' && (
                  <span className="rounded-full bg-ink-200/60 px-2 py-0.5 text-[11px] text-ink-500">
                    默认卡片
                  </span>
                )}
                <span className="font-medium">{card.title}</span>
              </div>
              <p className="md-content text-sm leading-relaxed text-ink-800" dangerouslySetInnerHTML={{ __html: renderMarkdown(card.content) }} />
              {card.tags.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {card.tags.map((t, i) => (
                    <span
                      key={`${t}-${i}`}
                      className="rounded-full bg-white/70 px-2 py-0.5 text-[11px] text-ink-500"
                    >
                      {t}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="py-8 text-center text-sm text-ink-400">加载中…</div>
          )}

          {error && (
            <div className="mt-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-600">
              {error}
              {error.includes('未配置') && (
                <span>。可到「设置 → 模型接入」添加 Provider 配置，再到「模型分工 · 灵感」绑定卡片生成。</span>
              )}
            </div>
          )}

          {/* 操作区 */}
          <div className="mt-3 flex flex-wrap gap-2">
            {isToday ? (
              <>
                <button
                  type="button"
                  disabled={loading || favorited}
                  onClick={() => void favorite()}
                  className={`flex items-center gap-1 rounded px-3 py-1.5 text-xs ${
                    favorited
                      ? 'bg-amber-100 text-amber-700'
                      : 'border border-ink-200 bg-white hover:bg-ink-100'
                  }`}
                >
                  <Star size={12} className={favorited ? 'fill-amber-500 text-amber-500' : ''} />
                  {favorited ? '已收藏' : '收藏'}
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void generate()}
                  className="flex items-center gap-1 rounded border border-ink-200 bg-white px-3 py-1.5 text-xs hover:bg-ink-100 disabled:opacity-40"
                >
                  <RefreshCw size={12} />
                  {loading ? '生成中…' : '换一张'}
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void blockAndRegenerate()}
                  className="flex items-center gap-1 rounded border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-500 hover:bg-ink-100 disabled:opacity-40"
                  title="屏蔽该类型，AI 生成时将不再推荐此类卡片"
                >
                  <Ban size={12} />
                  不再推荐此类
                </button>
              </>
            ) : (
              <button
                type="button"
                disabled={loading}
                onClick={() => void generate()}
                className="flex items-center gap-1 rounded bg-violet-600 px-3 py-1.5 text-xs text-white hover:bg-violet-700 disabled:opacity-40"
              >
                <RefreshCw size={12} />
                {loading ? '生成中…（约需数十秒）' : '生成今日卡片'}
              </button>
            )}
            <button
              type="button"
              onClick={() => setExpanded(false)}
              className="ml-auto rounded border border-ink-200 bg-white px-3 py-1.5 text-xs text-ink-500 hover:bg-ink-100"
            >
              收起
            </button>
          </div>

          {/* 屏蔽状态提示（有屏蔽类型时显示，监听灵感库刷新保持同步） */}
          <BlockedTypesHint listenKey={INSPIRATIONS_REFRESH} />
        </div>
      )}
    </section>
  );
}

/** 屏蔽类型提示（可点击解除屏蔽） */
function BlockedTypesHint({ listenKey }: { listenKey: string }): JSX.Element | null {
  const [blocked, setBlocked] = useState<string[]>([]);

  const load = (): void => {
    void getAppContext()
      .dailyCardService.getBlockedTypes()
      .then((types) => setBlocked(types));
  };

  useEffect(() => {
    load();
    window.addEventListener(listenKey, load);
    return () => window.removeEventListener(listenKey, load);
  }, [listenKey]);

  if (blocked.length === 0) return null;

  const unblock = (t: string): void => {
    void getAppContext()
      .dailyCardService.unblockType(t as CardType)
      .then(load);
  };

  return (
    <div className="mt-2 flex flex-wrap items-center gap-1 text-[11px] text-ink-400">
      <span>已屏蔽：</span>
      {blocked.map((t) => (
        <button
          key={t}
          type="button"
          onClick={() => unblock(t)}
          className="rounded-full bg-ink-100 px-2 py-0.5 hover:bg-ink-200"
          title="点击解除屏蔽"
        >
          {CARD_TYPE_LABEL[t as CardType] ?? t} ✕
        </button>
      ))}
    </div>
  );
}
