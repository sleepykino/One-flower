/**
 * 错字检查报告展示：疑似错字列表（原文 → 建议 + 定位 / 一键修正）
 * 修正走 editorApi.replaceFirstOccurrence，未找到原文时标记提示
 */

import { useState } from 'react';
import { useEditorStore } from '../../store/editorStore';
import { toast } from '../common/toast';
import type { TypoReport } from '../../services/ai/types';

export function TypoReportView({ report }: { report: TypoReport }): JSX.Element {
  /** 已修正 / 原文未找到 的条目索引（本次报告内有效） */
  const [fixed, setFixed] = useState<Set<number>>(new Set());
  const [missing, setMissing] = useState<Set<number>>(new Set());

  const locate = (text: string): void => {
    useEditorStore.getState().editorApi?.searchAndScroll?.(text);
  };

  const applyFix = (i: number, original: string, suggestion: string): void => {
    const api = useEditorStore.getState().editorApi;
    if (!api?.replaceFirstOccurrence) {
      void toast.info('当前编辑器不支持一键修正，请手动定位修改。');
      return;
    }
    const ok = api.replaceFirstOccurrence(original, suggestion);
    if (ok) {
      setFixed((s) => new Set(s).add(i));
    } else {
      setMissing((s) => new Set(s).add(i));
      void toast.error('未在正文中找到该片段，可能已被修改，建议重新检查。');
    }
  };

  return (
    <div>
      <div className="mb-2 text-xs text-ink-500">
        检查时间：{new Date(report.checkedAt).toLocaleString()} · 发现 {report.typos.length} 处疑似错字
      </div>
      {report.typos.length === 0 && (
        <div className="rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
          未发现错别字。
        </div>
      )}
      {report.typos.map((t, i) => {
        const isFixed = fixed.has(i);
        const isMissing = missing.has(i);
        return (
          <div
            key={`${i}-${t.original}`}
            className={`mb-2 rounded border border-ink-100 border-l-4 border-l-amber-400 bg-white p-2 ${
              isFixed ? 'opacity-60' : ''
            }`}
          >
            <div className="text-sm">
              <span className="text-red-600 line-through">{t.original}</span>
              <span className="mx-1 text-ink-400">→</span>
              <span className="font-medium text-emerald-700">{t.suggestion}</span>
            </div>
            {t.reason && <div className="mt-1 text-xs text-ink-400">{t.reason}</div>}
            <div className="mt-1.5 flex items-center gap-2">
              {isFixed ? (
                <span className="text-xs text-emerald-600">已修正 ✓</span>
              ) : isMissing ? (
                <span className="text-xs text-ink-400">原文未找到（可能已修改）</span>
              ) : (
                <>
                  <button
                    type="button"
                    className="rounded border border-ink-200 px-1.5 py-0.5 text-[11px] hover:bg-ink-100"
                    onClick={() => locate(t.original)}
                  >
                    定位
                  </button>
                  <button
                    type="button"
                    className="rounded bg-emerald-600 px-1.5 py-0.5 text-[11px] text-white hover:bg-emerald-700"
                    onClick={() => applyFix(i, t.original, t.suggestion)}
                  >
                    修正
                  </button>
                </>
              )}
            </div>
          </div>
        );
      })}
      {report.typos.length > 0 && (
        <div className="mt-1 text-[10px] leading-4 text-ink-300">
          提示：AI 校对存在误报可能，修正前请确认上下文。
        </div>
      )}
    </div>
  );
}
