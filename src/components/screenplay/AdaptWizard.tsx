/**
 * 转化向导（P5-M2，剧本工作台 overlay 内居中对话框）
 * 三步：配置（章节范围/集数/提示）→ 大纲生成（可编辑）→ 成本确认 → 逐场生成
 */

import { useEffect, useMemo, useState } from 'react';
import { getAppContext } from '../../context/app-context';
import type { Chapter } from '../../types';
import type { ScreenplayEpisode } from '../../services/screenplay/types';

interface Props {
  bookId: string;
  chapters: Chapter[];
  onClose: () => void;
  /** 大纲确认并启动逐场生成后回调（打开编辑视图） */
  onStarted: (screenplayId: string) => void;
}

type Step = 'config' | 'outlining' | 'outline' | 'starting';

export function AdaptWizard({ bookId, chapters, onClose, onStarted }: Props): JSX.Element {
  const [step, setStep] = useState<Step>('config');
  const [fromId, setFromId] = useState('');
  const [toId, setToId] = useState('');
  const [episodeCount, setEpisodeCount] = useState(1);
  const [scenesPer, setScenesPer] = useState(6);
  const [hints, setHints] = useState('');
  const [screenplayId, setScreenplayId] = useState<string | null>(null);
  const [episodes, setEpisodes] = useState<ScreenplayEpisode[]>([]);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    if (chapters.length > 0 && !fromId) {
      setFromId(chapters[0].id);
      setToId(chapters[chapters.length - 1].id);
    }
  }, [chapters, fromId]);

  const estimate = useMemo(() => {
    const calls = episodes.reduce((n, ep) => n + ep.scenes.length, 0);
    return { calls, tokens: calls * 2400 };
  }, [episodes]);

  const runOutline = (): void => {
    if (!fromId || !toId) {
      setErr('请选择章节范围');
      return;
    }
    setStep('outlining');
    setErr(null);
    void (async () => {
      try {
        const { screenplayService, screenplayAdapt } = getAppContext();
        const sp =
          screenplayId !== null
            ? await screenplayService.get(screenplayId)
            : await screenplayService.create(bookId, `改编剧本 ${new Date().toLocaleDateString('zh-CN')}`);
        if (!sp) throw new Error('剧本创建失败');
        setScreenplayId(sp.id);
        const eps = await screenplayAdapt.draftOutline({
          bookId,
          screenplayId: sp.id,
          fromChapterId: fromId,
          toChapterId: toId,
          episodeCount,
          scenesPerEpisode: scenesPer,
          hints: hints.trim() || undefined
        });
        setEpisodes(eps);
        setStep('outline');
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setStep('config');
      }
    })();
  };

  const startGeneration = (): void => {
    if (!screenplayId || episodes.length === 0) return;
    setStep('starting');
    void (async () => {
      try {
        const { screenplayService, screenplayAdapt } = getAppContext();
        // 大纲编辑结果写回剧本（编辑只影响未完成场）
        const sp = await screenplayService.get(screenplayId);
        if (!sp) throw new Error('剧本不存在');
        sp.data.episodes = episodes;
        if (sp.status === 'draft' || sp.status === 'outlining') sp.status = 'review';
        await screenplayService.save(sp);
        screenplayAdapt.generateScenes(screenplayId);
        onStarted(screenplayId);
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e));
        setStep('outline');
      }
    })();
  };

  /** 大纲编辑辅助 */
  const patchEpisode = (epIdx: number, patch: Partial<ScreenplayEpisode>): void => {
    setEpisodes((prev) => prev.map((ep, i) => (i === epIdx ? { ...ep, ...patch } : ep)));
  };
  const patchScene = (epIdx: number, scIdx: number, patch: Partial<ScreenplayEpisode['scenes'][number]>): void => {
    setEpisodes((prev) =>
      prev.map((ep, i) =>
        i === epIdx ? { ...ep, scenes: ep.scenes.map((sc, j) => (j === scIdx ? { ...sc, ...patch } : sc)) } : ep
      )
    );
  };
  const removeScene = (epIdx: number, scIdx: number): void => {
    setEpisodes((prev) =>
      prev.map((ep, i) => (i === epIdx ? { ...ep, scenes: ep.scenes.filter((_, j) => j !== scIdx) } : ep))
    );
  };
  const addScene = (epIdx: number): void => {
    setEpisodes((prev) =>
      prev.map((ep, i) =>
        i === epIdx
          ? {
              ...ep,
              scenes: [
                ...ep.scenes,
                {
                  id: crypto.randomUUID(),
                  interior: 'INT' as const,
                  location: '新地点',
                  timeOfDay: '日',
                  synopsis: '',
                  shots: [],
                  status: 'outline' as const
                }
              ]
            }
          : ep
      )
    );
  };

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/30">
      <div className="flex max-h-[86vh] w-[720px] flex-col rounded-lg bg-white shadow-2xl">
        <div className="border-b border-ink-100 px-4 py-3">
          <div className="text-sm font-medium">从章节转化剧本</div>
          <div className="mt-0.5 text-xs text-ink-400">
            {step === 'config' && '第一步：选择章节范围与集数'}
            {step === 'outlining' && '正在生成大纲…（依据章节摘要、角色卡、世界书与 agents.md）'}
            {step === 'outline' && '第二步：检查并编辑大纲（编辑只影响未生成的场）'}
            {step === 'starting' && '正在启动逐场生成…'}
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
          {(step === 'config' || step === 'outlining') && (
            <div className="space-y-3">
              <div className="flex gap-3">
                <label className="flex-1 text-xs text-ink-500">
                  起始章节
                  <select
                    className="mt-1 w-full rounded border border-ink-200 px-2 py-1 text-sm"
                    value={fromId}
                    onChange={(e) => setFromId(e.target.value)}
                    disabled={step === 'outlining'}
                  >
                    {chapters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="flex-1 text-xs text-ink-500">
                  结束章节
                  <select
                    className="mt-1 w-full rounded border border-ink-200 px-2 py-1 text-sm"
                    value={toId}
                    onChange={(e) => setToId(e.target.value)}
                    disabled={step === 'outlining'}
                  >
                    {chapters.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.title}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex gap-3">
                <label className="flex-1 text-xs text-ink-500">
                  集数（{episodeCount}）
                  <input
                    type="range"
                    min={1}
                    max={12}
                    step={1}
                    value={episodeCount}
                    className="mt-1 w-full accent-violet-600"
                    disabled={step === 'outlining'}
                    onChange={(e) => setEpisodeCount(Number(e.target.value))}
                  />
                </label>
                <label className="flex-1 text-xs text-ink-500">
                  每集场次数（{scenesPer}）
                  <input
                    type="range"
                    min={3}
                    max={10}
                    step={1}
                    value={scenesPer}
                    className="mt-1 w-full accent-violet-600"
                    disabled={step === 'outlining'}
                    onChange={(e) => setScenesPer(Number(e.target.value))}
                  />
                </label>
              </div>
              <label className="block text-xs text-ink-500">
                补充提示（可选：节奏 / 侧重 / 删改自由度）
                <textarea
                  rows={2}
                  className="mt-1 w-full resize-none rounded border border-ink-200 p-2 text-sm outline-none focus:border-violet-300"
                  placeholder="如：快节奏改编，合并支线，保留主线冲突"
                  value={hints}
                  disabled={step === 'outlining'}
                  onChange={(e) => setHints(e.target.value)}
                />
              </label>
              {step === 'outlining' && (
                <div className="flex items-center justify-center gap-2 py-4 text-sm text-violet-600">
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
                  大纲生成中…
                </div>
              )}
            </div>
          )}

          {step === 'outline' && (
            <div className="space-y-3">
              {episodes.map((ep, epIdx) => (
                <div key={ep.id} className="rounded border border-ink-100 p-2">
                  <div className="flex gap-2">
                    <span className="shrink-0 self-center rounded bg-violet-100 px-1.5 py-0.5 text-[11px] text-violet-700">
                      第 {ep.number} 集
                    </span>
                    <input
                      className="min-w-0 flex-1 rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-300"
                      value={ep.title}
                      onChange={(e) => patchEpisode(epIdx, { title: e.target.value })}
                    />
                    <input
                      className="min-w-0 flex-1 rounded border border-ink-200 px-2 py-1 text-xs text-ink-500 outline-none focus:border-violet-300"
                      placeholder="一句话梗概（可选）"
                      value={ep.logline ?? ''}
                      onChange={(e) => patchEpisode(epIdx, { logline: e.target.value })}
                    />
                  </div>
                  <div className="mt-2 space-y-1.5">
                    {ep.scenes.map((sc, scIdx) => (
                      <div key={sc.id} className="flex items-center gap-1.5">
                        <select
                          className="shrink-0 rounded border border-ink-200 px-1 py-1 text-xs"
                          value={sc.interior}
                          onChange={(e) => patchScene(epIdx, scIdx, { interior: e.target.value as 'INT' | 'EXT' })}
                        >
                          <option value="INT">INT</option>
                          <option value="EXT">EXT</option>
                        </select>
                        <input
                          className="w-28 shrink-0 rounded border border-ink-200 px-1.5 py-1 text-xs outline-none focus:border-violet-300"
                          value={sc.location}
                          placeholder="地点"
                          onChange={(e) => patchScene(epIdx, scIdx, { location: e.target.value })}
                        />
                        <input
                          className="w-16 shrink-0 rounded border border-ink-200 px-1.5 py-1 text-xs outline-none focus:border-violet-300"
                          value={sc.timeOfDay}
                          placeholder="时间"
                          onChange={(e) => patchScene(epIdx, scIdx, { timeOfDay: e.target.value })}
                        />
                        <input
                          className="min-w-0 flex-1 rounded border border-ink-200 px-1.5 py-1 text-xs outline-none focus:border-violet-300"
                          value={sc.synopsis}
                          placeholder="本场概要"
                          onChange={(e) => patchScene(epIdx, scIdx, { synopsis: e.target.value })}
                        />
                        <button
                          type="button"
                          className="shrink-0 text-xs text-ink-300 hover:text-red-600"
                          onClick={() => removeScene(epIdx, scIdx)}
                        >
                          ✕
                        </button>
                      </div>
                    ))}
                    <button
                      type="button"
                      className="w-full rounded border border-dashed border-ink-200 py-1 text-xs text-ink-400 hover:border-violet-300 hover:text-violet-600"
                      onClick={() => addScene(epIdx)}
                    >
                      + 加一场
                    </button>
                  </div>
                </div>
              ))}
              <div className="rounded bg-ink-50 px-3 py-2 text-xs text-ink-500">
                预估：{estimate.calls} 次模型调用 · 约 {estimate.tokens.toLocaleString()} tokens（逐场生成，任务中心可暂停/恢复，已完成场不重做）
              </div>
            </div>
          )}
          {step === 'starting' && (
            <div className="flex items-center justify-center gap-2 py-8 text-sm text-violet-600">
              <span className="h-4 w-4 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
              启动逐场生成…
            </div>
          )}

          {err && <div className="mt-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-600">{err}</div>}
        </div>

        <div className="flex justify-end gap-2 border-t border-ink-100 px-4 py-3">
          <button type="button" className="rounded border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100" onClick={onClose}>
            取消
          </button>
          {step === 'config' && (
            <button
              type="button"
              className="rounded bg-violet-600 px-4 py-1.5 text-sm text-white hover:bg-violet-700"
              disabled={chapters.length === 0}
              onClick={runOutline}
            >
              生成大纲
            </button>
          )}
          {step === 'outline' && (
            <>
              <button
                type="button"
                className="rounded border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
                onClick={runOutline}
              >
                重新生成大纲
              </button>
              <button
                type="button"
                className="rounded bg-violet-600 px-4 py-1.5 text-sm text-white hover:bg-violet-700"
                onClick={startGeneration}
              >
                确认并开始逐场生成
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
