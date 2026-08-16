/**
 * 一致性检查报告展示：矛盾列表（严重度着色 + 原文片段）
 */

import type { ConsistencyReport } from '../../services/ai/types';

const SEVERITY_STYLE: Record<string, { label: string; badge: string; border: string }> = {
  high: { label: '高', badge: 'bg-red-100 text-red-700', border: 'border-l-red-400' },
  medium: { label: '中', badge: 'bg-amber-100 text-amber-700', border: 'border-l-amber-400' },
  low: { label: '低', badge: 'bg-sky-100 text-sky-700', border: 'border-l-sky-400' }
};

export function ConsistencyReportView({ report }: { report: ConsistencyReport }): JSX.Element {
  return (
    <div className="p-3">
      <div className="mb-2 text-xs text-ink-500">
        检查时间：{new Date(report.checkedAt).toLocaleString()} · 发现 {report.contradictions.length} 处矛盾
      </div>
      {report.contradictions.length === 0 && (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          未发现与角色卡 / 世界书的矛盾。
        </div>
      )}
      {report.contradictions.map((c, i) => {
        const style = SEVERITY_STYLE[c.severity] ?? SEVERITY_STYLE.medium;
        return (
          <div
            key={i}
            className={`mb-2 rounded border border-ink-100 border-l-4 bg-white p-2 ${style.border}`}
          >
            <div className="mb-1 flex items-center gap-1">
              <span className={`rounded px-1.5 py-0.5 text-[10px] ${style.badge}`}>
                {style.label}
              </span>
              {c.relatedSetting && (
                <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[10px] text-ink-600">
                  {c.relatedSetting}
                </span>
              )}
            </div>
            <div className="text-sm">{c.description}</div>
            {c.chapterExcerpt && (
              <div className="mt-1 rounded bg-ink-50 p-1.5 text-xs italic text-ink-500">
                「{c.chapterExcerpt}」
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
