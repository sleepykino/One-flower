/**
 * WhatIfPanel（P2.1-B M4）："如果…会怎样"推演器面板（编辑器 rail「灵感」分组）
 * 假设输入 + 锚点章节（默认最新章）+ 范围（3/5/10 章）-> 非流式结构化报告
 * 过程显示阶段性提示（组装上下文 -> 推演中 -> 解析报告），报告可存入灵感库
 */

import { useEffect, useState } from 'react';
import { FlaskConical, Save, History, ArrowRight } from 'lucide-react';
import { getAppContext } from '../../context/app-context';
import { alertDialog } from '../../native/dialog';
import { useEditorStore } from '../../store/editorStore';
import type { WhatIfReport } from '../../services/inspiration/types';
import { notifyInspirationsChanged } from './StorySeedGenerator';

type Stage = 'idle' | 'context' | 'running' | 'parsing' | 'done';

const STAGE_LABEL: Record<Stage, string> = {
  idle: '',
  context: '正在组装上下文（摘要链 + 角色卡 + 世界书）…',
  running: '推演中…（完整生成后展示，约需一分钟）',
  parsing: '正在解析推演报告…',
  done: ''
};

export function WhatIfPanel({ bookId }: { bookId: string }): JSX.Element {
  const chapters = useEditorStore((s) => s.chapters);
  const [hypothesis, setHypothesis] = useState('');
  const [anchorId, setAnchorId] = useState('');
  const [range, setRange] = useState<3 | 5 | 10>(5);
  const [stage, setStage] = useState<Stage>('idle');
  const [report, setReport] = useState<WhatIfReport | null>(null);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [history, setHistory] = useState<WhatIfReport[]>([]);
  const [showHistory, setShowHistory] = useState(false);

  // 锚点默认最新章
  useEffect(() => {
    if (chapters.length > 0 && !chapters.some((c) => c.id === anchorId)) {
      setAnchorId(chapters[chapters.length - 1].id);
    }
  }, [chapters, anchorId]);

  useEffect(() => {
    void loadHistory();
  }, [bookId]);

  const loadHistory = async (): Promise<void> => {
    try {
      setHistory(await getAppContext().whatIfSimulator.listByBook(bookId));
    } catch {
      setHistory([]);
    }
  };

  const simulate = async (): Promise<void> => {
    if (!hypothesis.trim()) {
      void alertDialog('请先填写假设，如：如果主角在第三章就死了');
      return;
    }
    setError('');
    setReport(null);
    setSaved(false);
    setStage('context');
    try {
      const { whatIfSimulator } = getAppContext();
      const r = await whatIfSimulator.simulate({
        bookId,
        hypothesis: hypothesis.trim(),
        range,
        fromChapterId: anchorId || undefined,
        onStage: (s) => setStage(s)
      });
      setReport(r);
      setStage('done');
    } catch (e) {
      setStage('idle');
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const saveReport = async (): Promise<void> => {
    if (!report) return;
    try {
      await getAppContext().whatIfSimulator.saveReport(report);
      setSaved(true);
      notifyInspirationsChanged();
      void loadHistory();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const anchorChapter = chapters.find((c) => c.id === anchorId);
  const busy = stage === 'context' || stage === 'running' || stage === 'parsing';

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-2 border-b border-ink-200 px-3 py-2">
        <FlaskConical size={15} className="text-violet-600" />
        <span className="text-sm font-medium">如果…会怎样</span>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        <div className="mb-2 text-xs text-ink-500">
          给定一个剧情假设，AI 基于章节摘要 + 角色卡 + 世界书推演其对后续剧情的影响。
        </div>

        <textarea
          rows={3}
          value={hypothesis}
          onChange={(e) => setHypothesis(e.target.value)}
          placeholder="假设，如：如果主角在第三章就死了 / 如果反派其实是主角的父亲"
          className="mb-2 w-full resize-none rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
        />

        <div className="mb-2 flex gap-2">
          <select
            value={anchorId}
            onChange={(e) => setAnchorId(e.target.value)}
            disabled={busy}
            className="min-w-0 flex-1 rounded border border-ink-200 bg-white px-2 py-1 text-xs outline-none focus:border-violet-400 disabled:opacity-50"
            title="假设发生在该章之后（摘要链取该章及之前）"
          >
            {chapters.length === 0 && <option value="">本书暂无章节</option>}
            {chapters.map((c, i) => (
              <option key={c.id} value={c.id}>
                锚点：{i + 1}. {c.title}
              </option>
            ))}
          </select>
          <select
            value={range}
            onChange={(e) => setRange(Number(e.target.value) as 3 | 5 | 10)}
            disabled={busy}
            className="rounded border border-ink-200 bg-white px-2 py-1 text-xs outline-none focus:border-violet-400 disabled:opacity-50"
          >
            {[3, 5, 10].map((n) => (
              <option key={n} value={n}>
                推演 {n} 章
              </option>
            ))}
          </select>
        </div>

        <button
          type="button"
          disabled={busy || chapters.length === 0}
          className="w-full rounded bg-violet-600 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
          onClick={() => void simulate()}
        >
          {busy ? '推演中…' : '开始推演'}
        </button>

        {/* 阶段性进度提示 */}
        {busy && (
          <div className="mt-3 rounded border border-violet-200 bg-violet-50 p-2 text-xs text-violet-700">
            {STAGE_LABEL[stage]}
          </div>
        )}

        {error && (
          <div className="mt-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-600">
            {error}
          </div>
        )}

        {/* 推演报告 */}
        {report && (
          <div className="mt-3 space-y-3">
            <div className="rounded-lg border border-ink-200 bg-white p-3">
              <div className="mb-2 text-xs text-ink-400">
                假设「{report.hypothesis}」· 锚点：{report.anchorChapterTitle} · 后续{' '}
                {report.range} 章
              </div>

              <Section title="影响范围">{report.impactScope}</Section>

              {report.characterChanges.length > 0 && (
                <Section title="角色弧光变化">
                  <div className="space-y-2">
                    {report.characterChanges.map((c, i) => (
                      <div key={i} className="rounded border border-ink-100 bg-ink-50/60 p-2">
                        <div className="text-xs font-medium text-ink-700">{c.characterName}</div>
                        <div className="mt-1 flex items-start gap-1 text-xs text-ink-600">
                          <span className="min-w-0 flex-1">{c.originalArc}</span>
                          <ArrowRight size={12} className="mt-0.5 shrink-0 text-violet-500" />
                          <span className="min-w-0 flex-1 text-violet-700">{c.modifiedArc}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {report.plotBranches.length > 0 && (
                <Section title="剧情分支点">
                  <div className="space-y-1.5">
                    {report.plotBranches.map((b, i) => (
                      <div key={i} className="text-xs text-ink-600">
                        <span className="mr-1 rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">
                          锚点后第 {b.chapterOffset} 章
                        </span>
                        {b.branchPoint}
                        <span className="ml-1 text-ink-400">{'->'} {b.outcome}</span>
                      </div>
                    ))}
                  </div>
                </Section>
              )}

              {report.risks.length > 0 && (
                <Section title="潜在风险">
                  <ul className="list-disc space-y-0.5 pl-4 text-xs text-amber-700">
                    {report.risks.map((r, i) => (
                      <li key={i}>{r}</li>
                    ))}
                  </ul>
                </Section>
              )}

              <Section title="AI 建议">
                <p className="text-xs font-medium text-emerald-700">{report.recommendation}</p>
              </Section>

              <button
                type="button"
                disabled={saved}
                onClick={() => void saveReport()}
                className={`mt-2 flex w-full items-center justify-center gap-1 rounded py-1.5 text-xs ${
                  saved
                    ? 'bg-ink-100 text-ink-400'
                    : 'bg-violet-600 text-white hover:bg-violet-700'
                }`}
              >
                <Save size={12} />
                {saved ? '已存入灵感库' : '存入灵感库'}
              </button>
            </div>
          </div>
        )}

        {/* 推演历史 */}
        {history.length > 0 && (
          <div className="mt-4">
            <button
              type="button"
              onClick={() => setShowHistory((v) => !v)}
              className="flex items-center gap-1 text-xs text-ink-500 hover:text-ink-800"
            >
              <History size={12} />
              推演历史（{history.length}）
            </button>
            {showHistory && (
              <div className="mt-1 space-y-1">
                {history.map((r) => (
                  <button
                    key={r.id}
                    type="button"
                    onClick={() => {
                      setReport(r);
                      setSaved(true);
                      setStage('done');
                    }}
                    className="w-full rounded border border-ink-200 bg-white px-2 py-1.5 text-left text-xs hover:border-violet-300 hover:bg-violet-50"
                  >
                    <div className="truncate">{r.hypothesis}</div>
                    <div className="mt-0.5 text-ink-400">
                      {new Date(r.generatedAt).toLocaleString()} · 后续{r.range}章
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {chapters.length === 0 && (
          <div className="mt-3 rounded border border-dashed border-ink-200 p-3 text-center text-xs text-ink-400">
            本书还没有章节，先写点什么再来推演吧
          </div>
        )}
      </div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="mb-3 last:mb-0">
      <div className="mb-1 text-xs font-medium text-ink-600">{title}</div>
      <div className="text-sm leading-relaxed text-ink-800">{children}</div>
    </div>
  );
}
