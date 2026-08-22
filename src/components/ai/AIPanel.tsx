/**
 * AI 面板：四模式 tab（续写 / 改写 / 对白 / 检查）
 * 流式输出到编辑器 AI 临时节点，中断后三选项：保留 / 丢弃 / 继续补完
 */

import { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { getAppContext } from '../../context/app-context';
import { alertDialog } from '../../native/dialog';
import { useEditorStore } from '../../store/editorStore';
import { useAIStore } from '../../store/aiStore';
import type { AIMode } from '../../services/skill/types';
import type { ChapterBeat } from '../../services/chapter/ChapterService';
import type { Character } from '../../types';
import { ConsistencyReportView } from './ConsistencyReport';
import { TypoReportView } from './TypoReportView';
import { LongFormPanel } from './LongFormPanel';
import { DirectiveModal } from './DirectiveModal';
import { applyHookRules } from '../../services/ai/ProjectDirectiveService';
import type { HookHit, HookRule } from '../../services/ai/ProjectDirectiveService';
import type { AvailablePerspective } from '../../services/inspiration/types';

const MODES: Array<{ key: AIMode; label: string }> = [
  { key: 'continue', label: '续写' },
  { key: 'rewrite', label: '改写' },
  { key: 'dialogue', label: '对白' },
  { key: 'check', label: '检查' }
];

export function AIPanel({ bookId, initialTab }: { bookId: string; initialTab?: 'longform' }): JSX.Element {
  const mode = useAIStore((s) => s.mode);
  const setMode = useAIStore((s) => s.setMode);
  const phase = useAIStore((s) => s.phase);
  const error = useAIStore((s) => s.error);
  const report = useAIStore((s) => s.report);
  const typoReport = useAIStore((s) => s.typoReport);
  const chapters = useEditorStore((s) => s.chapters);
  const currentChapterId = useEditorStore((s) => s.currentChapterId);
  const selectedText = useEditorStore((s) => s.selectedText);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharIds, setSelectedCharIds] = useState<string[]>([]);
  const [instruction, setInstruction] = useState('');
  // P2.1-B M5：多视角重写（改写 tab 视角下拉，'' = 不切换视角 = 原有改写行为）
  const [perspectives, setPerspectives] = useState<AvailablePerspective[]>([]);
  const [perspectiveId, setPerspectiveId] = useState('');
  // 续写要求（可选）：引导续写方向，随提示词以【要求】段注入
  const [continueReq, setContinueReq] = useState('');
  const [scene, setScene] = useState('');
  // P2.1-M5：按节拍定向续写（当前章节存在未完成节拍时可选，默认开）
  const [beats, setBeats] = useState<ChapterBeat[]>([]);
  const [beatDirect, setBeatDirect] = useState(true);
  // P2.1-M7：长文模式视图（第 5 tab；rail 'longform' 入口经 initialTab 打开）
  const [longform, setLongform] = useState(initialTab === 'longform');
  // 生成参数：单次回复 token 上限（约等于中文字数）与采样温度
  const [maxTokens, setMaxTokens] = useState(2048);
  const [temperature, setTemperature] = useState('0.8');
  const tempValue = (): number | undefined => {
    const t = parseFloat(temperature);
    return Number.isFinite(t) && t >= 0 && t <= 2 ? t : undefined;
  };
  // hook.md 后处理命中（replace/warn/block 结构化展示）
  const [hookHits, setHookHits] = useState<HookHit[] | null>(null);
  // block 命中后自动重试的原因（透明化：用户需知道发生过拦截重试）
  const [hookRetried, setHookRetried] = useState<string | null>(null);
  // 本书指令（agents.md / hook.md）编辑弹窗
  const [directivesOpen, setDirectivesOpen] = useState(false);
  // 指令生效提示：agents.md 注入标记与 hook.md 规则数（指令弹窗保存后刷新）
  const [agentsActive, setAgentsActive] = useState(false);
  const [hookCount, setHookCount] = useState(0);

  const refreshDirectiveHints = (): void => {
    void getAppContext()
      .projectDirectives.getStatus(bookId)
      .then((st) => {
        setAgentsActive(st.agentsActive);
        setHookCount(st.hookRuleCount);
      })
      .catch(() => {
        setAgentsActive(false);
        setHookCount(0);
      });
  };

  useEffect(() => {
    refreshDirectiveHints();
  }, [bookId]);
  const tokenValue = (): number | undefined =>
    Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : undefined;

  useEffect(() => {
    void getAppContext()
      .characterService.list(bookId)
      .then(setCharacters);
  }, [bookId]);

  // P2.1-B M5：加载本书可用视角（角色卡 + 固定非角色视角）
  useEffect(() => {
    setPerspectiveId('');
    void getAppContext()
      .multiPerspectiveRewriter.listPerspectives(bookId)
      .then(setPerspectives)
      .catch(() => setPerspectives([]));
  }, [bookId]);

  // P2.1-M5：读取当前章节节拍（编辑器节拍栏保存后广播刷新）
  useEffect(() => {
    const load = (): void => {
      if (!currentChapterId) {
        setBeats([]);
        return;
      }
      void getAppContext()
        .chapterService.getBeats(currentChapterId)
        .then(setBeats);
    };
    load();
    window.addEventListener('novel-beats-refresh', load);
    return () => window.removeEventListener('novel-beats-refresh', load);
  }, [currentChapterId, bookId]);

  const streaming = phase === 'streaming';
  const deciding = phase === 'deciding';
  const currentChapter = chapters.find((c) => c.id === currentChapterId);
  /** 第一个未完成节拍（定向续写目标） */
  const pendingBeat = beats.find((b) => !b.done && b.text.trim() !== '');

  /** 收集前情（滑动窗口最近 3 章） */
  const gatherRecent = async () => {
    if (!currentChapterId) return [];
    return getAppContext().chapterService.recentChapters(bookId, currentChapterId, 3);
  };

  /** 读取本书 hook.md 规则（读取失败按无规则处理，不打断生成） */
  const loadHookRules = async (): Promise<HookRule[]> => {
    try {
      return await getAppContext().projectDirectives.hookRules(bookId);
    } catch {
      return [];
    }
  };

  /**
   * hook.md 后处理：对累计全文应用规则
   * - replace：直接替换临时节点与 store 中的文本
   * - warn：仅记录提示
   * - block：返回违规原因（由调用方决定是否带反馈重试）
   */
  const applyHooks = (): Promise<string | null> => {
    return (async () => {
      const rules = await loadHookRules();
      if (rules.length === 0) return null;
      const api = useEditorStore.getState().editorApi;
      const res = applyHookRules(rules, useAIStore.getState().generatedText);
      if (res.replaced) {
        api?.setAITempText(res.text);
        useAIStore.getState().setText(res.text);
      }
      setHookHits(res.hits.length > 0 ? res.hits : null);
      const blocked = res.blocked.map((h) => h.rule.value).filter(Boolean).join('；');
      return blocked !== '' ? blocked : null;
    })().catch(() => null);
  };

  /** 统一流式执行器：临时节点承载输出；hook block 命中时带反馈自动重试一次 */
  const runStream = async (
    kind: 'continue' | 'rewrite' | 'dialogue',
    range: { from: number; to: number } | null
  ): Promise<void> => {
    const { orchestrator, multiPerspectiveRewriter } = getAppContext();
    const api = useEditorStore.getState().editorApi;
    if (!api || !currentChapterId) {
      void alertDialog('请先选择要编辑的章节');
      return;
    }
    const controller = useAIStore.getState().startStream();
    setHookHits(null);
    setHookRetried(null);

    // P2.1-M2：透传当前文档引用标记（orchestrator 注入 forcedRefs 全文）
    const aiReferences = api.getAiReferences();

    try {
      const recent = await gatherRecent();
      const makeIterable = (feedback?: string): AsyncIterable<{ delta: string; done: boolean }> => {
        if (kind === 'continue') {
          const req = [continueReq.trim(), feedback].filter(Boolean).join('\n') || undefined;
          return orchestrator.continueWriting({
            bookId,
            chapterId: currentChapterId,
            currentContent: api.getPlainText(),
            recentChapters: recent,
            selectedCharacterIds: selectedCharIds,
            requirement: req,
            aiReferences,
            beat: beatDirect ? pendingBeat : undefined,
            maxTokens: tokenValue(),
            temperature: tempValue(),
            signal: controller.signal
          });
        }
        if (kind === 'rewrite') {
          // P2.1-B M5：选了视角 -> 多视角重写（复用 rewrite 功能键，流式写临时节点）
          const perspective = perspectives.find((p) => p.label === perspectiveId);
          if (perspective) {
            return multiPerspectiveRewriter.rewrite({
              bookId,
              chapterId: currentChapterId,
              selectedText,
              perspective: perspective.label,
              characterId: perspective.characterId,
              tone: [instruction.trim(), feedback].filter(Boolean).join('\n') || undefined,
              maxTokens: tokenValue(),
              temperature: tempValue(),
              signal: controller.signal
            });
          }
          return orchestrator.rewrite({
            bookId,
            chapterId: currentChapterId,
            selectedText: selectedText,
            instruction: [instruction.trim(), feedback].filter(Boolean).join('\n'),
            recentChapters: recent,
            aiReferences,
            maxTokens: tokenValue(),
            temperature: tempValue(),
            signal: controller.signal
          });
        }
        return orchestrator.generateDialogue({
          bookId,
          chapterId: currentChapterId,
          scene,
          characterIds: selectedCharIds,
          recentChapters: recent,
          aiReferences,
          maxTokens: tokenValue(),
          temperature: tempValue(),
          signal: controller.signal
        });
      };

      let feedback: string | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        api.startAITemp(range ?? undefined);
        if (attempt > 0) useAIStore.getState().setText('');
        const iterable = makeIterable(feedback);
        for await (const chunk of iterable) {
          if (chunk.delta) {
            useAIStore.getState().appendText(chunk.delta);
            api.appendAITemp(chunk.delta);
          }
        }
        // hook.md 后处理（block 命中且可重试时带反馈再来一次）
        const blocked = await applyHooks();
        if (blocked && attempt === 0 && kind !== 'dialogue') {
          api.discardAITemp();
          setHookRetried(blocked);
          feedback = `上一次生成违反了本书规则：${blocked}。请重新生成，严格避免上述问题。`;
          continue;
        }
        break;
      }
      api.finishAITemp();
      useAIStore.getState().finishStream('done');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const aborted = controller.signal.aborted || msg.includes('Abort');
      if (aborted) {
        // 中断：保留临时节点，交由三选项处理
        api.finishAITemp();
        useAIStore.getState().finishStream('aborted');
      } else {
        api.discardAITemp();
        useAIStore.getState().finishStream('error', msg);
      }
    }
  };

  const stop = (): void => {
    useAIStore.getState().abortController?.abort();
  };

  const onContinue = async (): Promise<void> => {
    // 继续补完（P1-M8）：以已生成半截内容为上文再次调 LLM，结果合并进同一临时节点
    const { orchestrator } = getAppContext();
    const api = useEditorStore.getState().editorApi;
    if (!api || !currentChapterId) return;
    // 必须在 startStream（会清空 generatedText）之前读取半截内容
    const base = useAIStore.getState().generatedText;
    const controller = useAIStore.getState().startStream();
    try {
      const recent = await gatherRecent();
      // 重新登记半截内容：多轮补完时 base 连续，"已生成 N 字"统计不回零
      if (base) useAIStore.getState().appendText(base);
      const iterable = orchestrator.continueWriting({
        bookId,
        chapterId: currentChapterId,
        currentContent: `${api.getPlainText()}${base ? `\n\n${base}` : ''}`,
        recentChapters: recent,
        selectedCharacterIds: selectedCharIds,
        requirement: continueReq.trim() || undefined,
        maxTokens: tokenValue(),
        temperature: tempValue(),
        signal: controller.signal
      });
      for await (const chunk of iterable) {
        if (chunk.delta) {
          useAIStore.getState().appendText(chunk.delta);
          api.appendAITemp(chunk.delta);
        }
      }
      // hook.md 后处理（补完场景只做替换与提醒，不再重试）
      await applyHooks();
      api.finishAITemp();
      useAIStore.getState().finishStream('done');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const aborted = controller.signal.aborted || msg.includes('Abort');
      if (aborted) {
        // 补完途中再次中断：保留合并后的半截内容，回到三选项
        api.finishAITemp();
        useAIStore.getState().finishStream('aborted');
      } else {
        api.discardAITemp();
        useAIStore.getState().finishStream('error', msg);
      }
    }
  };

  const runCheck = async (): Promise<void> => {
    const { orchestrator } = getAppContext();
    const api = useEditorStore.getState().editorApi;
    if (!api || !currentChapterId) {
      void alertDialog('请先选择要检查的章节');
      return;
    }
    const store = useAIStore.getState();
    store.setChecking(true);
    store.setReport(null);
    try {
      const r = await orchestrator.checkConsistency({
        bookId,
        chapterId: currentChapterId,
        chapterContent: api.getPlainText(),
        aiReferences: api.getAiReferences()
      });
      useAIStore.getState().setReport(r);
    } catch (e) {
      void alertDialog(`检查失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      useAIStore.getState().setChecking(false);
    }
  };

  /** 本章节错字检查：纯校对任务，报告含定位与一键修正 */
  const runTypoCheck = async (): Promise<void> => {
    const { orchestrator } = getAppContext();
    const api = useEditorStore.getState().editorApi;
    if (!api || !currentChapterId) {
      void alertDialog('请先选择要检查的章节');
      return;
    }
    const text = api.getPlainText();
    if (!text.trim()) {
      void alertDialog('当前章节为空');
      return;
    }
    const store = useAIStore.getState();
    store.setChecking(true);
    store.setTypoReport(null);
    try {
      const r = await orchestrator.checkTypos({
        bookId,
        chapterId: currentChapterId,
        chapterContent: text
      });
      useAIStore.getState().setTypoReport(r);
    } catch (e) {
      void alertDialog(`错字检查失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      useAIStore.getState().setChecking(false);
    }
  };

  const toggleChar = (id: string): void => {
    setSelectedCharIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  return (
    <div className="flex h-full flex-col">
      {/* 模式 tab（四模式 + 长文） */}
      <div className="flex border-b border-ink-200">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => {
              setMode(m.key);
              setLongform(false);
            }}
            className={`flex-1 px-2 py-2 text-sm ${
              !longform && mode === m.key
                ? 'border-b-2 border-violet-600 font-medium text-violet-700'
                : 'text-ink-500 hover:text-ink-800'
            }`}
          >
            {m.label}
          </button>
        ))}
        <button
          type="button"
          onClick={() => setLongform(true)}
          className={`flex-1 px-2 py-2 text-sm ${
            longform
              ? 'border-b-2 border-violet-600 font-medium text-violet-700'
              : 'text-ink-500 hover:text-ink-800'
          }`}
        >
          长文
        </button>
      </div>

      {/* 本书指令入口（agents.md 全局指令 + hook.md 输出规则）+ 生效状态提示（窄栏单行） */}
      {!longform && (
        <div className="flex shrink-0 items-center justify-between whitespace-nowrap border-b border-ink-100 px-3 py-1.5">
          <button
            type="button"
            title="agents.md 全局指令 · hook.md 输出规则"
            className="flex shrink-0 items-center gap-1.5 rounded px-1.5 py-0.5 text-xs text-ink-500 hover:bg-ink-100 hover:text-violet-600"
            onClick={() => setDirectivesOpen(true)}
          >
            <BookOpen size={13} />
            本书指令
          </button>
          <div className="flex shrink-0 items-center gap-2 text-[10px]">
            {agentsActive && (
              <span
                className="flex items-center gap-1 text-emerald-600"
                title="agents.md 有实质内容，已注入本书所有 AI 生成"
              >
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
                已注入
              </span>
            )}
            {hookCount > 0 && (
              <span className="flex items-center gap-1 text-amber-600" title="hook.md 输出规则生效中，每次生成后自动执行">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-current" />
                校验{hookCount}条
              </span>
            )}
          </div>
        </div>
      )}

      {/* P2.1-M7：长文模式四步向导 */}
      {longform ? (
        <LongFormPanel bookId={bookId} />
      ) : (
      <div className="flex-1 overflow-y-auto">
        {/* 续写 */}
        {mode === 'continue' && (
          <div className="p-3">
            <div className="mb-2 text-xs text-ink-500">
              当前：{currentChapter?.title ?? '未选择章节'} · 前情自动取最近 3 章
            </div>
            <CharPicker characters={characters} selected={selectedCharIds} onToggle={toggleChar} />
            {/* P2.1-M5：按节拍定向开关（存在未完成节拍时显示） */}
            {pendingBeat && (
              <label className="mt-2 flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50/50 px-2 py-1.5 text-xs text-emerald-800">
                <input
                  type="checkbox"
                  checked={beatDirect}
                  onChange={(e) => setBeatDirect(e.target.checked)}
                />
                <span className="min-w-0 flex-1">
                  按节拍定向：
                  <span className="font-medium">{pendingBeat.text.slice(0, 24)}</span>
                  <span className="ml-1 text-emerald-600">（约 {pendingBeat.targetWords ?? 300} 字）</span>
                </span>
              </label>
            )}
            <textarea
              rows={3}
              value={continueReq}
              onChange={(e) => setContinueReq(e.target.value)}
              placeholder="续写要求（可选），如：主角识破陷阱，引出幕后黑手"
              className="mt-2 mb-1 w-full resize-none rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
            />
            <GenParams
              maxTokens={maxTokens}
              setMaxTokens={setMaxTokens}
              temperature={temperature}
              setTemperature={setTemperature}
            />
            <button
              type="button"
              disabled={streaming || !currentChapterId}
              className="mt-3 w-full rounded bg-violet-600 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
              onClick={() => void runStream('continue', null)}
            >
              {streaming ? '生成中…' : '开始续写'}
            </button>
          </div>
        )}

        {/* 改写 */}
        {mode === 'rewrite' && (
          <div className="p-3">
            <div className="mb-2 rounded bg-ink-50 p-2 text-xs text-ink-600">
              {selectedText ? `已选中（${selectedText.length}字）：${selectedText.slice(0, 60)}…` : '请先在编辑器中选中要改写的文本'}
            </div>
            {/* P2.1-B M5：视角下拉（默认"不切换视角"= 原有改写行为） */}
            <div className="mb-2">
              <div className="mb-1 text-xs font-medium text-ink-600">叙述视角</div>
              <select
                value={perspectiveId}
                onChange={(e) => setPerspectiveId(e.target.value)}
                disabled={streaming}
                className="w-full rounded border border-ink-200 bg-white px-2 py-1 text-sm outline-none focus:border-violet-400 disabled:opacity-50"
              >
                <option value="">不切换视角（普通改写）</option>
                {perspectives.map((p) => (
                  <option key={p.label} value={p.label}>
                    {p.label}
                  </option>
                ))}
              </select>
            </div>
            <textarea
              rows={3}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder={
                perspectiveId
                  ? '改写要求（可选），如：更口语化、压缩篇幅'
                  : '改写要求，如：改为更紧张的氛围'
              }
              className="mb-2 w-full resize-none rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
            />
            <GenParams
              maxTokens={maxTokens}
              setMaxTokens={setMaxTokens}
              temperature={temperature}
              setTemperature={setTemperature}
            />
            <button
              type="button"
              disabled={streaming || !selectedText || (!instruction.trim() && !perspectiveId)}
              className="mt-3 w-full rounded bg-violet-600 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
              onClick={() => {
                const api = useEditorStore.getState().editorApi;
                const range = api?.getSelectionRange() ?? null;
                void runStream('rewrite', range);
              }}
            >
              {streaming ? '生成中…' : perspectiveId ? `从${perspectiveId}重写` : '开始改写'}
            </button>
          </div>
        )}

        {/* 对白 */}
        {mode === 'dialogue' && (
          <div className="p-3">
            <textarea
              rows={3}
              value={scene}
              onChange={(e) => setScene(e.target.value)}
              placeholder="场景描述，如：客栈中，主角与神秘剑客对峙"
              className="mb-2 w-full resize-none rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
            />
            <CharPicker characters={characters} selected={selectedCharIds} onToggle={toggleChar} />
            <button
              type="button"
              disabled={streaming || !scene.trim() || selectedCharIds.length === 0}
              className="mt-3 w-full rounded bg-violet-600 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
              onClick={() => void runStream('dialogue', null)}
            >
              {streaming ? '生成中…' : '生成对白'}
            </button>
          </div>
        )}

        {/* 检查 */}
        {mode === 'check' && (
          <div className="p-3">
            <div className="mb-2 text-xs text-ink-500">
              一致性检查比对角色卡 / 世界书（不注入文风 Skill）；错字检查校对当前章节错别字
            </div>
            <div className="flex gap-1">
              <button
                type="button"
                disabled={phase === 'checking' || !currentChapterId}
                className="flex-1 rounded bg-violet-600 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
                onClick={() => void runCheck()}
              >
                {phase === 'checking' ? '检查中…' : '一致性检查'}
              </button>
              <button
                type="button"
                disabled={phase === 'checking' || !currentChapterId}
                className="flex-1 rounded bg-amber-600 py-1.5 text-sm text-white hover:bg-amber-700 disabled:opacity-40"
                onClick={() => void runTypoCheck()}
              >
                {phase === 'checking' ? '检查中…' : '错字检查'}
              </button>
            </div>
            {typoReport && (
              <div className="mt-2">
                <TypoReportView key={typoReport.checkedAt} report={typoReport} />
              </div>
            )}
            {report && (
              <div className="mt-2">
                <ConsistencyReportView report={report} />
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="m-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-600">
            {error}
          </div>
        )}

        {/* hook.md 后处理命中卡片 */}
        {(hookHits?.length || hookRetried) && (
          <div className="mx-3 mb-3 rounded-lg border border-amber-200 bg-amber-50/70 p-2.5">
            <div className="mb-1.5 text-xs font-medium text-amber-700">hook 规则已应用</div>
            {hookRetried && (
              <div className="mb-1.5 rounded border border-red-100 bg-red-50/70 px-2 py-1 text-[11px] leading-relaxed text-red-600">
                首次生成被阻断规则拦截（{hookRetried}），已按规则自动重新生成。如非预期，请检查「本书指令 → hook.md」。
              </div>
            )}
            <div className="space-y-1">
              {hookHits?.map((h, i) => (
                <div key={i} className="flex items-center gap-2 text-xs">
                  <span
                    className={`shrink-0 rounded px-1.5 py-0.5 font-medium ${
                      h.rule.action === 'replace'
                        ? 'bg-violet-100 text-violet-700'
                        : h.rule.action === 'warn'
                          ? 'bg-amber-100 text-amber-700'
                          : 'bg-red-100 text-red-700'
                    }`}
                  >
                    {h.rule.action === 'replace' ? '已替换' : h.rule.action === 'warn' ? '提醒' : '已阻断'}
                  </span>
                  <span className="min-w-0 truncate font-mono text-ink-600">{h.rule.source}</span>
                  <span className="shrink-0 text-ink-400">× {h.count}</span>
                  {h.rule.value && (
                    <span className="min-w-0 flex-1 truncate text-ink-500" title={h.rule.value}>
                      {h.rule.value}
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 续写 tab 底部引导：切换长文模式（P2.1-M7） */}
        {mode === 'continue' && !streaming && !deciding && (
          <button
            type="button"
            className="m-3 mt-0 rounded border border-violet-200 bg-violet-50/50 py-1.5 text-center text-xs text-violet-700 hover:bg-violet-100"
            onClick={() => setLongform(true)}
          >
            需要整章生成？切换长文模式 →
          </button>
        )}
      </div>
      )}

      {/* 流式中断三选项 */}
      {!longform && (streaming || deciding) && (
        <div className="border-t border-ink-200 bg-ink-50 p-2">
          {streaming && (
            <button
              type="button"
              onClick={stop}
              className="w-full rounded bg-red-500 py-1.5 text-sm text-white hover:bg-red-600"
            >
              停止
            </button>
          )}
          {deciding && (
            <>
              <div className="mb-1 text-xs text-ink-500">
                已生成 {useAIStore.getState().generatedText.length} 字，请选择：
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  className="flex-1 rounded bg-emerald-600 py-1 text-xs text-white hover:bg-emerald-700"
                  onClick={() => {
                    useEditorStore.getState().editorApi?.acceptAITemp();
                    useAIStore.getState().reset();
                  }}
                >
                  保留
                </button>
                <button
                  type="button"
                  className="flex-1 rounded bg-red-500 py-1 text-xs text-white hover:bg-red-600"
                  onClick={() => {
                    useEditorStore.getState().editorApi?.discardAITemp();
                    useAIStore.getState().reset();
                  }}
                >
                  丢弃
                </button>
                <button
                  type="button"
                  className="flex-1 rounded bg-violet-600 py-1 text-xs text-white hover:bg-violet-700"
                  onClick={() => void onContinue()}
                >
                  继续补完
                </button>
              </div>
            </>
          )}
        </div>
      )}
      {/* 本书指令编辑弹窗（关闭时刷新生效状态提示） */}
      {directivesOpen && (
        <DirectiveModal
          bookId={bookId}
          onClose={() => {
            setDirectivesOpen(false);
            refreshDirectiveHints();
          }}
        />
      )}
    </div>
  );
}

function GenParams({
  maxTokens,
  setMaxTokens,
  temperature,
  setTemperature
}: {
  maxTokens: number;
  setMaxTokens: (v: number) => void;
  temperature: string;
  setTemperature: (v: string) => void;
}): JSX.Element {
  return (
    <div className="mt-3 flex items-center gap-2 text-xs text-ink-600">
      <label className="flex items-center gap-1">
        字数上限
        <input
          type="number"
          min={1}
          step={128}
          value={maxTokens}
          onChange={(e) => setMaxTokens(parseInt(e.target.value, 10) || 0)}
          className="w-20 rounded border border-ink-200 px-1.5 py-1 outline-none focus:border-violet-400"
        />
      </label>
      <label className="flex items-center gap-1" title="0 = 严谨确定，2 = 发散大胆">
        温度
        <input
          type="number"
          min={0}
          max={2}
          step={0.1}
          value={temperature}
          onChange={(e) => setTemperature(e.target.value)}
          className="w-16 rounded border border-ink-200 px-1.5 py-1 outline-none focus:border-violet-400"
        />
      </label>
    </div>
  );
}

function CharPicker({
  characters,
  selected,
  onToggle
}: {
  characters: Character[];
  selected: string[];
  onToggle: (id: string) => void;
}): JSX.Element {
  if (characters.length === 0) {
    return <div className="text-xs text-ink-400">本书暂无角色卡，可先在「角色」面板创建。</div>;
  }
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-ink-600">参与角色（注入角色卡）</div>
      <div className="flex flex-wrap gap-1">
        {characters.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onToggle(c.id)}
            className={`rounded-full px-2 py-0.5 text-xs ${
              selected.includes(c.id)
                ? 'bg-violet-600 text-white'
                : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}
