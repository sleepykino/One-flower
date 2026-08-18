/**
 * WritingStats（P1-M5）：写作统计面板
 * 今日字数 / 日更目标进度 / 近 30 天趋势折线（SVG）/ 连续天数 / 会话时长
 */

import { useCallback, useEffect, useState } from 'react';
import { getAppContext } from '../../context/app-context';
import type { WritingStats as StatsEntry } from '../../services/stats/types';

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function shift(dateStr: string, days: number): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const dt = new Date(y, m - 1, d);
  dt.setDate(dt.getDate() + days);
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

const W = 280;
const H = 90;

function TrendChart({ data }: { data: StatsEntry[] }): JSX.Element {
  const max = Math.max(1, ...data.map((d) => d.wordsWritten));
  const step = data.length > 1 ? W / (data.length - 1) : W;
  const points = data.map((d, i) => `${i * step},${H - (d.wordsWritten / max) * (H - 8) - 4}`);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-1 w-full">
      {/* 目标线 */}
      <line x1={0} y1={H - 4} x2={W} y2={H - 4} stroke="#e5e7eb" strokeWidth={1} />
      <polyline
        points={points.join(' ')}
        fill="none"
        stroke="#7c3aed"
        strokeWidth={1.5}
        strokeLinejoin="round"
      />
      {data.map((d, i) => (
        <circle
          key={d.date}
          cx={i * step}
          cy={H - (d.wordsWritten / max) * (H - 8) - 4}
          r={d.wordsWritten > 0 ? 2 : 1.2}
          fill={d.wordsWritten > 0 ? '#7c3aed' : '#d1d5db'}
        >
          <title>{`${d.date}：${d.wordsWritten} 字`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function WritingStatsPanel({ bookId }: { bookId: string }): JSX.Element {
  const [today, setToday] = useState<StatsEntry | null>(null);
  const [range, setRange] = useState<StatsEntry[]>([]);
  const [streak, setStreak] = useState(0);
  const [goal, setGoal] = useState<{ dailyTarget: number; totalTarget: number }>({
    dailyTarget: 3000,
    totalTarget: 0
  });
  const [totalWords, setTotalWords] = useState(0);
  const [editingGoal, setEditingGoal] = useState(false);
  const [draft, setDraft] = useState({ dailyTarget: 3000, totalTarget: 0 });

  const load = useCallback(async (): Promise<void> => {
    const { statsService, db } = getAppContext();
    const t = todayStr();
    const [daily, r, s, g, tw] = await Promise.all([
      statsService.getDailyStats(bookId, t),
      statsService.getRangeStats(bookId, shift(t, -29), t),
      statsService.getStreak(bookId),
      statsService.getGoal(bookId),
      db.queryOne<{ total: number | null }>(
        'SELECT COALESCE(SUM(word_count),0) AS total FROM chapters WHERE book_id = ?',
        [bookId]
      )
    ]);
    setToday(daily);
    setRange(r);
    setStreak(s);
    if (g) {
      setGoal({ dailyTarget: g.dailyTarget, totalTarget: g.totalTarget });
      setDraft({ dailyTarget: g.dailyTarget, totalTarget: g.totalTarget });
    }
    setTotalWords(Number(tw?.total ?? 0));
  }, [bookId]);

  // 初次加载 + 周期刷新（写作中保存即时落库，面板 15s 自动同步）
  useEffect(() => {
    void load();
    const t = setInterval(() => void load(), 15000);
    return () => clearInterval(t);
  }, [load]);

  const saveGoal = async (): Promise<void> => {
    await getAppContext().statsService.setGoal({
      bookId,
      dailyTarget: Number(draft.dailyTarget) || 0,
      totalTarget: Number(draft.totalTarget) || 0
    });
    setEditingGoal(false);
    await load();
  };

  const todayWords = today?.wordsWritten ?? 0;
  const pct = Math.min(100, goal.dailyTarget > 0 ? Math.round((todayWords / goal.dailyTarget) * 100) : 0);
  const durationMin = Math.round((today?.sessionDuration ?? 0) / 60);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
        <span className="text-sm font-medium">写作统计</span>
        <button
          type="button"
          className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-100"
          onClick={() => void load()}
        >
          刷新
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-3 text-xs">
        {/* 今日 */}
        <div className="mb-3 rounded border border-ink-100 bg-white p-3">
          <div className="flex items-end justify-between">
            <div>
              <div className="text-2xl font-bold text-violet-700">{todayWords}</div>
              <div className="text-ink-400">今日字数</div>
            </div>
            <div className="text-right text-ink-500">
              <div>连续 {streak} 天</div>
              <div>今日时长 {durationMin} 分钟</div>
            </div>
          </div>
          <div className="mt-2 h-2 overflow-hidden rounded bg-ink-100">
            <div className="h-full rounded bg-violet-500" style={{ width: `${pct}%` }} />
          </div>
          <div className="mt-1 flex items-center justify-between text-ink-400">
            <span>日更目标 {goal.dailyTarget} 字（{pct}%）</span>
            <button
              type="button"
              className="text-violet-600 hover:underline"
              onClick={() => setEditingGoal((v) => !v)}
            >
              {editingGoal ? '收起' : '设置'}
            </button>
          </div>
          {editingGoal && (
            <div className="mt-2 space-y-1 border-t border-ink-100 pt-2">
              <div className="flex items-center gap-2">
                <span className="w-16 text-ink-500">日更目标</span>
                <input
                  type="number"
                  min={0}
                  value={draft.dailyTarget}
                  onChange={(e) => setDraft({ ...draft, dailyTarget: Number(e.target.value) })}
                  className="flex-1 rounded border border-ink-200 px-2 py-1"
                />
              </div>
              <div className="flex items-center gap-2">
                <span className="w-16 text-ink-500">全书目标</span>
                <input
                  type="number"
                  min={0}
                  value={draft.totalTarget}
                  onChange={(e) => setDraft({ ...draft, totalTarget: Number(e.target.value) })}
                  className="flex-1 rounded border border-ink-200 px-2 py-1"
                />
              </div>
              <button
                type="button"
                className="rounded bg-violet-600 px-3 py-1 text-white hover:bg-violet-700"
                onClick={() => void saveGoal()}
              >
                保存目标
              </button>
            </div>
          )}
        </div>

        {/* 全书进度 */}
        {goal.totalTarget > 0 && (
          <div className="mb-3 rounded border border-ink-100 bg-white p-3">
            <div className="mb-1 flex justify-between text-ink-500">
              <span>全书进度</span>
              <span>
                {totalWords} / {goal.totalTarget} 字
              </span>
            </div>
            <div className="h-2 overflow-hidden rounded bg-ink-100">
              <div
                className="h-full rounded bg-emerald-500"
                style={{ width: `${Math.min(100, Math.round((totalWords / goal.totalTarget) * 100))}%` }}
              />
            </div>
          </div>
        )}

        {/* 近 30 天趋势 */}
        <div className="rounded border border-ink-100 bg-white p-3">
          <div className="mb-1 text-ink-500">近 30 天趋势</div>
          <TrendChart data={range} />
          <div className="mt-1 flex justify-between text-[10px] text-ink-400">
            <span>{range[0]?.date.slice(5) ?? ''}</span>
            <span>峰值 {Math.max(0, ...range.map((d) => d.wordsWritten))} 字/天</span>
            <span>今天</span>
          </div>
        </div>
      </div>
    </div>
  );
}
