/**
 * LongFormPanel（P2.1-M7）：长文模式四步向导
 * ① 节拍表 -> ② 成本确认 -> ③ 生成进度 -> ④ 接缝审阅
 * 流式写入编辑器经 hooks 桥接；切走章节时自动改为直接落盘（任务后台化）
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { getAppContext } from '../../context/app-context';
import { confirmDialog } from '../../native/dialog';
import { toast } from '../common/toast';
import { useEditorStore } from '../../store/editorStore';
import type { LongFormBeat, LongFormSession, SeamIssue } from '../../services/longform/types';

type Step = 'draft' | 'confirm' | 'running' | 'seam';

const KIND_LABEL: Record<SeamIssue['kind'], string> = {
  tone: '语气',
  address: '称呼',
  timeline: '时间线',
  repetition: '重复',
  other: '其他'
};

/** 后台写盘：把一拍正文追加到章节文档（用户切走章节时） */
async function appendBeatToChapter(chapterId: string, text: string): Promise<void> {
  const { chapterService } = getAppContext();
  const doc = await chapterService.getContent(chapterId);
  const paras = text
    .replace(/\r/g, '')
    .split(/\n+/)
    .map((s) => s.trim())
    .filter(Boolean)
    .map((t) => ({ type: 'paragraph', content: [{ type: 'text', text: t }] }));
  doc.content = [...(doc.content ?? []), ...paras];
  await chapterService.saveContent(chapterId, doc);
}

export function LongFormPanel({ bookId }: { bookId: string }): JSX.Element {
  const currentChapterId = useEditorStore((s) => s.currentChapterId);

  const [step, setStep] = useState<Step>('draft');
  const [beatCount, setBeatCount] = useState(5);
  const [totalWords, setTotalWords] = useState(4000);
  const [hints, setHints] = useState('');
  const [beats, setBeats] = useState<LongFormBeat[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [runningBeat, setRunningBeat] = useState(-1);
  const [session, setSession] = useState<LongFormSession | null>(null);
  const [issues, setIssues] = useState<SeamIssue[]>([]);
  const [err, setErr] = useState('');
  /** 本书角色卡（参与角色选择；不勾选则默认注入全书角色） */
  const [characters, setCharacters] = useState<Array<{ id: string; name: string }>>([]);
  const [selectedCharIds, setSelectedCharIds] = useState<string[]>([]);
  const dragIndexRef = useRef<number | null>(null);

  // 加载本书角色卡（参与角色选择用）
  useEffect(() => {
    void getAppContext()
      .characterService.list(bookId)
      .then((cs) => setCharacters(cs.map((c) => ({ id: c.id, name: c.name }))))
      .catch(() => setCharacters([]));
  }, [bookId]);

  const toggleChar = (id: string): void => {
    setSelectedCharIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  // 挂载：检测本书进行中的长文会话（恢复入口）
  const checkActive = useCallback((): void => {
    void getAppContext()
      .longformService.findActive(bookId)
      .then((s) => {
        if (s) {
          setSession(s);
          setBeats(s.beats);
          setStep('running');
        }
      });
  }, [bookId]);

  useEffect(() => {
    setStep('draft');
    setBeats([]);
    setSession(null);
    setIssues([]);
    setErr('');
    checkActive();
  }, [checkActive, currentChapterId]);

  // 生成中轮询会话状态（切走再切回、后台完成时同步）
  useEffect(() => {
    if (step !== 'running' || !session) return;
    const timer = window.setInterval(() => {
      void getAppContext()
        .longformService.getSession(session.id)
        .then((s) => {
          if (!s) return;
          setSession(s);
          setBeats(s.beats);
          if (s.status === 'done') {
            setIssues(getAppContext().longformService.getSeamIssues(s.id));
            setRunningBeat(-1);
            setStep('seam');
          }
        });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [step, session?.id]);

  // ---------- 步骤 ①：节拍表 ----------

  const draft = async (): Promise<void> => {
    if (!currentChapterId) {
      void toast.info('请先选择要生成的章节');
      return;
    }
    setDrafting(true);
    setErr('');
    try {
      const list = await getAppContext().longformService.draftBeats({
        bookId,
        chapterId: currentChapterId,
        beatCount,
        totalWords,
        hints
      });
      setBeats(list);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setDrafting(false);
    }
  };

  const importFromChapterBeats = async (): Promise<void> => {
    if (!currentChapterId) return;
    const list = await getAppContext().chapterService.getBeats(currentChapterId);
    if (list.length === 0) {
      void toast.info('当前章节暂无节拍（可在编辑器左侧节拍栏添加）');
      return;
    }
    setBeats(
      list.map((b) => ({
        id: b.id,
        text: b.text,
        targetWords: b.targetWords ?? 300,
        status: 'pending'
      }))
    );
  };

  const updateBeat = (id: string, patch: Partial<LongFormBeat>): void => {
    setBeats((s) => s.map((b) => (b.id === id ? { ...b, ...patch } : b)));
  };

  const reorderBeat = (from: number, to: number): void => {
    setBeats((s) => {
      if (from === to || from < 0 || to < 0 || from >= s.length || to >= s.length) return s;
      const next = [...s];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  };

  // ---------- 步骤 ②③：确认并启动 ----------

  const est = getAppContext().longformService.estimate(beats);

  const startGenerate = async (): Promise<void> => {
    if (!currentChapterId) return;
    const { longformService } = getAppContext();
    try {
      const s = await longformService.createSession(currentChapterId, beats, {
        hints,
        characterIds: selectedCharIds
      });
      setSession(s);
      launchRun(s);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  };

  /** 组装 hooks 并启动（恢复与首次启动共用） */
  const launchRun = (s: LongFormSession): void => {
    const { longformService } = getAppContext();
    const editorOnChapter = (): boolean =>
      useEditorStore.getState().currentChapterId === s.chapterId &&
      !!useEditorStore.getState().editorApi;

    longformService.start(
      s.id,
      {
        onBeatStart: (i) => {
          setRunningBeat(i);
          if (editorOnChapter()) useEditorStore.getState().editorApi?.startAITemp();
        },
        onChunk: (_i, delta) => {
          if (editorOnChapter()) useEditorStore.getState().editorApi?.appendAITemp(delta);
        },
        onBeatDone: (_i, _beat, fullText) => {
          if (editorOnChapter()) {
            // 临时节点落正文（既有保存/版本链路接管）
            useEditorStore.getState().editorApi?.acceptAITemp();
          } else {
            // 用户切走章节：直接落盘，保证后台生成不丢
            void appendBeatToChapter(s.chapterId, fullText);
          }
        },
        onBeatInterrupted: () => {
          if (editorOnChapter()) useEditorStore.getState().editorApi?.finishAITemp();
          setRunningBeat(-1);
        }
      },
      {
        aiReferences:
          useEditorStore.getState().editorApi?.getAiReferences().filter((r) => r.refType !== 'chapter' || r.refId === s.chapterId) ??
          []
      }
    );
    setStep('running');
  };

  const resume = (): void => {
    if (!session) return;
    launchRun(session);
  };

  const dropSession = (): void => {
    if (!session) return;
    void confirmDialog('丢弃该长文会话？（已生成并落正文的内容保留）').then((ok) => {
      if (!ok) return;
      void getAppContext().longformService.deleteSession(session.id);
      setSession(null);
      setBeats([]);
      setIssues([]);
      setStep('draft');
    });
  };

  const pause = (): void => {
    if (!session) return;
    getAppContext().longformService.pause(session.id);
  };

  const scrollToSeam = (issue: SeamIssue): void => {
    useEditorStore.getState().editorApi?.searchAndScroll?.(issue.excerpt);
  };

  const chapterTitle =
    useEditorStore((s) => s.chapters.find((c) => c.id === (session?.chapterId ?? currentChapterId))?.title) ?? '';

  const doneCount = beats.filter((b) => b.status === 'done').length;
  const isPaused = session?.status === 'paused';
  // 进度按已完成拍数计算（不依赖任务状态，暂停/后台化时进度条不消失）
  const progressPct = beats.length > 0 ? (doneCount / beats.length) * 100 : 0;

  return (
    <div className="flex h-full flex-col text-sm">
      {/* 步骤条 */}
      <div className="flex items-center gap-1 border-b border-ink-200 px-3 py-2 text-[10px]">
        {[
          { key: 'draft', label: '① 节拍表' },
          { key: 'confirm', label: '② 成本确认' },
          { key: 'running', label: '③ 生成进度' },
          { key: 'seam', label: '④ 接缝审阅' }
        ].map((s, i) => {
          const order: Record<Step, number> = { draft: 0, confirm: 1, running: 2, seam: 3 };
          const active = order[step] === i;
          const passed = order[step] > i;
          return (
            <span
              key={s.key}
              className={`rounded px-1.5 py-0.5 ${
                active
                  ? 'bg-violet-600 text-white'
                  : passed
                    ? 'bg-violet-50 text-violet-600'
                    : 'text-ink-400'
              }`}
            >
              {s.label}
            </span>
          );
        })}
        <span className="ml-auto max-w-[110px] truncate text-ink-400" title={chapterTitle}>
          {chapterTitle}
        </span>
      </div>

      <div className="flex-1 overflow-y-auto p-3">
        {err && (
          <div className="mb-2 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-600">
            {err}
          </div>
        )}

        {/* ① 节拍表 */}
        {step === 'draft' && (
          <div>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <label className="flex items-center gap-1">
                拍数
                <input
                  type="number"
                  min={3}
                  max={8}
                  value={beatCount}
                  onChange={(e) => setBeatCount(Math.min(8, Math.max(3, parseInt(e.target.value, 10) || 3)))}
                  className="w-16 rounded border border-ink-200 px-1.5 py-1 outline-none focus:border-violet-400"
                />
              </label>
              <label className="flex items-center gap-1">
                总字数
                <input
                  type="number"
                  min={3000}
                  max={8000}
                  step={500}
                  value={totalWords}
                  onChange={(e) =>
                    setTotalWords(Math.min(8000, Math.max(3000, parseInt(e.target.value, 10) || 3000)))
                  }
                  className="w-20 rounded border border-ink-200 px-1.5 py-1 outline-none focus:border-violet-400"
                />
              </label>
            </div>
            <textarea
              rows={2}
              value={hints}
              onChange={(e) => setHints(e.target.value)}
              placeholder="补充提示（可选）：本章基调 / 必须出现的事件 / 禁止内容…（会透传逐拍生成）"
              className="mt-2 w-full resize-none rounded border border-ink-200 px-2 py-1 text-xs outline-none focus:border-violet-400"
            />

            {/* 参与角色（不勾选则默认注入本书全部角色卡） */}
            {characters.length > 0 && (
              <div className="mt-2">
                <div className="mb-1 text-[11px] text-ink-500">
                  参与角色（书中共 {characters.length} 位，选 {selectedCharIds.length}）
                </div>
                <div className="max-h-24 overflow-y-auto rounded border border-ink-100 p-1.5">
                  {characters.map((c) => (
                    <label key={c.id} className="flex items-center gap-1.5 py-0.5 text-xs">
                      <input
                        type="checkbox"
                        checked={selectedCharIds.includes(c.id)}
                        onChange={() => toggleChar(c.id)}
                      />
                      <span className="truncate">{c.name}</span>
                    </label>
                  ))}
                </div>
                <div className="mt-1 text-[10px] text-ink-400">不勾选则默认注入本书全部角色卡</div>
              </div>
            )}

            <div className="mt-1 flex gap-1">
              <button
                type="button"
                disabled={drafting || !currentChapterId}
                className="rounded bg-violet-600 px-2 py-1 text-xs text-white hover:bg-violet-700 disabled:opacity-40"
                onClick={() => void draft()}
              >
                {drafting ? '生成中…' : 'AI 生成初稿'}
              </button>
              <button
                type="button"
                disabled={!currentChapterId}
                className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-100 disabled:opacity-40"
                onClick={() => void importFromChapterBeats()}
                title="导入编辑器左侧节拍栏的章节节拍（B4）"
              >
                从章节节拍导入
              </button>
            </div>

            {/* 可编辑节拍列表 */}
            {beats.length > 0 && (
              <div className="mt-2 space-y-1">
                {beats.map((b, i) => (
                  <div
                    key={b.id}
                    draggable
                    onDragStart={() => {
                      dragIndexRef.current = i;
                    }}
                    onDragOver={(e) => e.preventDefault()}
                    onDrop={() => {
                      if (dragIndexRef.current !== null) reorderBeat(dragIndexRef.current, i);
                      dragIndexRef.current = null;
                    }}
                    className="flex cursor-grab items-center gap-1 rounded border border-ink-100 bg-white px-1.5 py-1"
                  >
                    <span className="text-[10px] text-ink-400">{i + 1}</span>
                    <input
                      value={b.text}
                      onChange={(e) => updateBeat(b.id, { text: e.target.value })}
                      className="min-w-0 flex-1 rounded border border-transparent px-1 py-0.5 text-xs outline-none focus:border-violet-300"
                    />
                    <input
                      type="number"
                      min={100}
                      step={100}
                      value={b.targetWords}
                      title="目标字数"
                      onChange={(e) =>
                        updateBeat(b.id, { targetWords: parseInt(e.target.value, 10) || 300 })
                      }
                      className="w-14 rounded border border-transparent px-1 py-0.5 text-[10px] text-ink-500 outline-none focus:border-violet-300"
                    />
                    <button
                      type="button"
                      className="px-0.5 text-[10px] text-ink-400 hover:text-red-600"
                      onClick={() => setBeats((s) => s.filter((x) => x.id !== b.id))}
                    >
                      ✕
                    </button>
                  </div>
                ))}
                <button
                  type="button"
                  className="w-full rounded border border-dashed border-ink-200 py-1 text-[11px] text-ink-500 hover:bg-ink-50"
                  onClick={() =>
                    setBeats((s) => [
                      ...s,
                      {
                        id: crypto.randomUUID(),
                        text: '',
                        targetWords: Math.round(totalWords / beatCount),
                        status: 'pending'
                      }
                    ])
                  }
                >
                  + 添加节拍
                </button>
              </div>
            )}

            <button
              type="button"
              disabled={beats.filter((b) => b.text.trim()).length === 0}
              className="mt-3 w-full rounded bg-ink-900 py-1.5 text-sm text-white hover:bg-ink-800 disabled:opacity-40"
              onClick={() => setStep('confirm')}
            >
              下一步：成本确认
            </button>
            <div className="mt-2 text-center text-[10px] text-ink-400">
              目标章节：《{chapterTitle || '未选择'}》，生成内容逐拍落入正文
            </div>
          </div>
        )}

        {/* ② 成本确认 */}
        {step === 'confirm' && (
          <div>
            <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs leading-6 text-amber-900">
              <div>
                预计 <span className="font-bold">{est.calls}</span> 次 LLM 调用（含节拍初稿 × 1 + 逐拍生成 + 接缝自检，接缝按每批 4 条分批）
              </div>
              <div>预计消耗约 <span className="font-bold">{est.estimatedTokens}</span> token（按各拍字数 × 2.2 + 单次上下文开销 + 初稿/自检估算）</div>
              <div className="mt-1 text-amber-700">
                生成期间可切章继续写作（任务后台化）；每拍完成自动落正文并保存。
              </div>
            </div>
            <div className="mt-2 rounded border border-ink-100 p-2 text-[11px] leading-5 text-ink-500">
              {beats.map((b, i) => (
                <div key={b.id}>
                  {i + 1}. {b.text}（约 {b.targetWords} 字）
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              <button
                type="button"
                className="flex-1 rounded border border-ink-200 py-1.5 text-sm hover:bg-ink-100"
                onClick={() => setStep('draft')}
              >
                返回编辑节拍
              </button>
              <button
                type="button"
                className="flex-1 rounded bg-violet-600 py-1.5 text-sm font-medium text-white hover:bg-violet-700"
                onClick={() => void startGenerate()}
              >
                确认并开始生成
              </button>
            </div>
          </div>
        )}

        {/* ③ 生成进度 */}
        {step === 'running' && session && (
          <div>
            <div className="mb-2 flex items-center gap-2 text-xs">
              <span className={isPaused ? 'text-amber-600' : 'text-violet-600'}>
                {isPaused ? '已暂停' : '生成中'}
              </span>
              <span className="text-ink-400">
                {doneCount}/{beats.length} 拍 · 已用约 {session.usedTokens} / 预估 {session.estimatedTokens} token
              </span>
            </div>
            <div className="mb-2">
              <div className="h-1.5 overflow-hidden rounded bg-ink-100">
                {progressPct > 0 ? (
                  <div
                    className="h-full rounded bg-violet-600 transition-[width]"
                    style={{ width: `${Math.min(100, Math.max(0, progressPct))}%` }}
                  />
                ) : (
                  <div className="h-full w-1/2 animate-pulse rounded bg-violet-400" />
                )}
              </div>
            </div>
            <div className="space-y-1">
              {beats.map((b, i) => (
                <div
                  key={b.id}
                  className={`flex items-center gap-1.5 rounded border px-2 py-1 text-xs ${
                    b.status === 'done'
                      ? 'border-emerald-200 bg-emerald-50/50 text-emerald-800'
                      : i === runningBeat
                        ? 'border-violet-300 bg-violet-50'
                        : 'border-ink-100 text-ink-500'
                  }`}
                >
                  <span>{b.status === 'done' ? '✓' : i === runningBeat ? '…' : '○'}</span>
                  <span className="min-w-0 flex-1 truncate">{b.text}</span>
                  <span className="text-[10px] text-ink-400">{b.targetWords} 字</span>
                </div>
              ))}
            </div>
            <div className="mt-3 flex gap-2">
              {isPaused ? (
                <>
                  <button
                    type="button"
                    className="flex-1 rounded bg-violet-600 py-1.5 text-sm text-white hover:bg-violet-700"
                    onClick={resume}
                  >
                    恢复生成（从第 {Math.min(session.currentBeatIndex + 1, beats.length)} 拍）
                  </button>
                  <button
                    type="button"
                    className="rounded border border-red-200 px-2 py-1.5 text-sm text-red-600 hover:bg-red-50"
                    onClick={dropSession}
                  >
                    丢弃
                  </button>
                </>
              ) : (
                <button
                  type="button"
                  className="w-full rounded bg-red-500 py-1.5 text-sm text-white hover:bg-red-600"
                  onClick={pause}
                >
                  暂停（当前拍中断，完成后拍已保留）
                </button>
              )}
            </div>
            {isPaused && (
              <div className="mt-2 text-[10px] leading-5 text-ink-400">
                中断的半拍文本已停在编辑器临时节点（保留 / 丢弃 / 继续补完三选项可用）。
                切换到其他章节写作时，生成中的拍将直接落盘到目标章节。
              </div>
            )}
          </div>
        )}

        {/* ④ 接缝审阅 */}
        {step === 'seam' && (
          <div>
            <div className="mb-2 rounded border border-emerald-200 bg-emerald-50 px-2 py-1.5 text-xs text-emerald-800">
              全章生成完成（{beats.length} 拍，已用约 {session?.usedTokens ?? 0} token）。
            </div>
            {issues.length === 0 ? (
              <div className="rounded border border-ink-100 p-3 text-center text-xs text-ink-400">
                接缝自检未发现问题。
              </div>
            ) : (
              <div className="space-y-1">
                {issues.map((it, i) => (
                  <button
                    key={i}
                    type="button"
                    className="block w-full rounded border border-ink-100 bg-white px-2 py-1.5 text-left text-xs hover:border-violet-300"
                    onClick={() => scrollToSeam(it)}
                    title="点击滚动编辑器到接缝位置"
                  >
                    <div className="flex items-center gap-1.5">
                      <span className="rounded bg-amber-50 px-1 text-[10px] text-amber-700">
                        {KIND_LABEL[it.kind]}
                      </span>
                      <span className="text-ink-400">
                        接缝 {it.beatIndex + 1}（第 {it.beatIndex + 1} 拍 → 第 {it.beatIndex + 2} 拍）
                      </span>
                    </div>
                    <div className="mt-0.5 text-ink-700">{it.description}</div>
                    {it.excerpt && (
                      <div className="mt-0.5 line-clamp-2 text-[10px] text-ink-400">{it.excerpt}</div>
                    )}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className="mt-3 w-full rounded border border-ink-200 py-1.5 text-sm hover:bg-ink-100"
              onClick={() => {
                if (session) void getAppContext().longformService.deleteSession(session.id);
                setSession(null);
                setBeats([]);
                setIssues([]);
                setStep('draft');
              }}
            >
              结束并清理会话
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
