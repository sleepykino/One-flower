/**
 * 用量统计（G4）：AI 用量流水累计视图（设置页「用量统计」）
 * - 汇总卡片：今日 / 近 7 天 / 累计（合计 token = prompt + completion）与调用次数
 * - 近 14 天逐日柱状图 + 按功能点 / 按书分布
 * - 口径说明：stream 调用与缺失 usage 时按字符估算（estimated 标记）；嵌入与生图不在账内
 */

import { useCallback, useEffect, useState } from 'react';
import { getAppContext } from '../../context/app-context';
import { confirmDialog } from '../../native/dialog';
import { toast } from '../common/toast';
import type { UsageDayPoint, UsageGroupRow, UsageTotals } from '../../services/usage/UsageService';

const RETENTION_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 30, label: '保留 30 天' },
  { value: 90, label: '保留 90 天（默认）' },
  { value: 180, label: '保留 180 天' },
  { value: 365, label: '保留 365 天' },
  { value: 0, label: '永久保留' }
];

const FEATURE_LABEL: Record<string, string> = {
  continue: '续写',
  rewrite: '改写',
  dialogue: '对白',
  check: '一致性检查',
  'typo-check': '错字检查',
  summary: '章节摘要',
  'longform-draft': '长文·节拍规划',
  'longform-seam': '长文·接缝自检',
  'screenplay-outline': '剧本·大纲',
  'screenplay-scene': '剧本·逐场',
  'story-seed': '故事种子',
  'daily-card': '每日灵感',
  interview: '角色采访',
  whatif: '假设推演',
  perspective: '多视角重写',
  namegen: '命名生成',
  'image-prompt': '生图转写',
  'fact-extract': '设定抽取',
  'fact-infer': '设定推导'
};

function fmtTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1000) return `${(n / 1000).toFixed(1)}K`;
  return String(n);
}

/** 近 14 天柱状图（SVG，写法对齐 WritingStats.TrendChart） */
function DayBars({ data }: { data: UsageDayPoint[] }): JSX.Element {
  const W = 480;
  const H = 96;
  const max = Math.max(1, ...data.map((d) => d.tokens));
  const bw = W / Math.max(1, data.length);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-2 w-full">
      <line x1={0} y1={H - 1} x2={W} y2={H - 1} stroke="#e5e7eb" strokeWidth={1} />
      {data.map((d, i) => {
        const h = (d.tokens / max) * (H - 14);
        return (
          <g key={d.day}>
            <rect
              x={i * bw + bw * 0.15}
              y={H - 2 - h}
              width={bw * 0.7}
              height={Math.max(d.tokens > 0 ? 2 : 0, h)}
              rx={2}
              fill="#7c3aed"
              opacity={d.tokens > 0 ? 0.85 : 0.15}
            >
              <title>{`${d.day}：${fmtTokens(d.tokens)} tok / ${d.calls} 次`}</title>
            </rect>
            {i % 2 === 0 && (
              <text x={i * bw + bw / 2} y={H - 4} textAnchor="middle" fontSize={8} fill="#9ca3af">
                {d.day.slice(5)}
              </text>
            )}
          </g>
        );
      })}
    </svg>
  );
}

function GroupBars({ rows }: { rows: UsageGroupRow[] }): JSX.Element {
  const max = Math.max(1, ...rows.map((r) => r.tokens));
  return (
    <div className="space-y-1.5">
      {rows.length === 0 && <div className="text-xs text-ink-400">暂无数据</div>}
      {rows.map((r) => (
        <div key={r.key}>
          <div className="flex items-baseline justify-between text-xs">
            <span className="min-w-0 truncate text-ink-700">{r.title}</span>
            <span className="shrink-0 text-ink-400">
              {fmtTokens(r.tokens)} tok · {r.calls} 次
            </span>
          </div>
          <div className="mt-0.5 h-1.5 w-full overflow-hidden rounded bg-ink-100">
            <div className="h-full rounded bg-violet-500" style={{ width: `${(r.tokens / max) * 100}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}

export function UsageSection(): JSX.Element {
  const [totals, setTotals] = useState<UsageTotals | null>(null);
  const [days, setDays] = useState<UsageDayPoint[]>([]);
  const [features, setFeatures] = useState<UsageGroupRow[]>([]);
  const [books, setBooks] = useState<UsageGroupRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [retention, setRetention] = useState<number | null>(null); // null = 尚未读取
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (): Promise<void> => {
    try {
      const svc = getAppContext().usageService;
      const [t, d, f, b, r] = await Promise.all([
        svc.totals(),
        svc.byDay(14),
        svc.byFeature(),
        svc.byBook(8),
        svc.getRetentionDays()
      ]);
      setTotals(t);
      setDays(d);
      setFeatures(f);
      setBooks(b);
      setRetention(r);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const changeRetention = async (days: number): Promise<void> => {
    try {
      await getAppContext().usageService.setRetentionDays(days);
      setRetention(days);
      toast.success(days > 0 ? `已设为保留 ${days} 天，过期明细将自动清理` : '已设为永久保留');
    } catch (e) {
      toast.error(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const pruneNow = async (): Promise<void> => {
    if (retention == null || retention <= 0) {
      void toast.info('当前为永久保留，无过期记录可清理');
      return;
    }
    setBusy(true);
    try {
      const r = await getAppContext().usageService.prune(retention);
      toast.success(r.deleted > 0 ? `已清理 ${r.deleted} 条过期记录` : '没有过期记录');
      await load();
    } catch (e) {
      toast.error(`清理失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  const clearAll = async (): Promise<void> => {
    const ok = await confirmDialog(
      '确认清空全部用量明细？\n\n明细删除后「今日 / 近 7 天」统计归零；「累计」合计已并入锚点、不会缩水。此操作不可撤销。'
    );
    if (!ok) return;
    setBusy(true);
    try {
      const r = await getAppContext().usageService.clearAll();
      toast.success(`已清空 ${r.deleted} 条明细，累计已保留`);
      await load();
    } catch (e) {
      toast.error(`清空失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between gap-3">
        <p className="text-xs text-ink-500">
          对话类 AI 调用的 token 累计（含流式估算）。生成不受记账影响；覆盖范围不含向量嵌入与图片生成。
        </p>
        <button
          type="button"
          className="shrink-0 rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-100"
          onClick={() => void load()}
        >
          刷新
        </button>
      </div>

      {/* 保留期与清理 */}
      <div className="mb-3 flex flex-wrap items-center gap-2 rounded border border-ink-100 bg-white px-3 py-2">
        <span className="text-xs font-medium text-ink-600">明细保留期</span>
        <select
          value={retention ?? 90}
          onChange={(e) => void changeRetention(Number(e.target.value))}
          disabled={retention == null}
          className="rounded border border-ink-200 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-violet-400 disabled:opacity-50"
        >
          {RETENTION_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
        <span className="min-w-0 flex-1 text-[11px] text-ink-400">
          到期明细自动清理并并入「累计」锚点，累计数字不缩水
        </span>
        <button
          type="button"
          disabled={busy || retention == null}
          className="rounded border border-ink-200 px-2 py-0.5 text-xs hover:bg-ink-100 disabled:opacity-40"
          onClick={() => void pruneNow()}
        >
          立即清理过期
        </button>
        <button
          type="button"
          disabled={busy}
          className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-40"
          onClick={() => void clearAll()}
        >
          清空全部明细
        </button>
      </div>

      {error && <div className="mb-2 rounded bg-red-50 px-3 py-2 text-xs text-red-600">读取失败：{error}</div>}

      {/* 汇总卡片 */}
      <div className="mb-3 grid grid-cols-4 gap-2">
        {(
          [
            ['今日', totals?.today ?? 0],
            ['近 7 天', totals?.week ?? 0],
            ['累计', totals?.total ?? 0]
          ] as Array<[string, number]>
        ).map(([label, v]) => (
          <div key={label} className="rounded border border-ink-100 bg-white p-3">
            <div className="text-xs text-ink-400">{label}</div>
            <div className="text-lg font-semibold tabular-nums text-ink-900">{fmtTokens(v)}</div>
            <div className="text-[10px] text-ink-400">tokens</div>
          </div>
        ))}
        <div className="rounded border border-ink-100 bg-white p-3">
          <div className="text-xs text-ink-400">调用次数</div>
          <div className="text-lg font-semibold tabular-nums text-ink-900">{totals?.calls ?? 0}</div>
          <div className="text-[10px] text-ink-400">次（累计）</div>
        </div>
      </div>

      {/* 近 14 天 */}
      <div className="mb-3 rounded border border-ink-100 bg-white p-3">
        <div className="mb-1 text-xs font-medium text-ink-600">近 14 天</div>
        <DayBars data={days} />
      </div>

      {/* 分布 */}
      <div className="grid grid-cols-2 gap-3">
        <div className="rounded border border-ink-100 bg-white p-3">
          <div className="mb-2 text-xs font-medium text-ink-600">按功能点</div>
          <GroupBars rows={features.map((r) => ({ ...r, title: FEATURE_LABEL[r.key] ?? r.key }))} />
        </div>
        <div className="rounded border border-ink-100 bg-white p-3">
          <div className="mb-2 text-xs font-medium text-ink-600">按书（Top 8）</div>
          <GroupBars rows={books} />
        </div>
      </div>
    </div>
  );
}
