/**
 * AI 面板：四模式 tab（续写 / 改写 / 对白 / 检查）
 * 流式输出到编辑器 AI 临时节点，中断后三选项：保留 / 丢弃 / 继续补完
 */

import { useEffect, useState } from 'react';
import { BookOpen } from 'lucide-react';
import { getAppContext } from '../../context/app-context';
import { toast } from '../common/toast';
import { useEditorStore } from '../../store/editorStore';
import type { EditorApi } from '../../store/editorStore';
import { useAIStore } from '../../store/aiStore';
import { countTokens, trimToTargetWords } from '../../utils/tokens';
import type { AIMode } from '../../services/skill/types';
import type { ChapterBeat } from '../../services/chapter/ChapterService';
import type { AiReference } from '../../services/ai/types';
import type { ChatChunk, ChatMessage } from '../../services/ai/providers/LLMProvider';
import type { Character } from '../../types';
import { ConsistencyReportView } from './ConsistencyReport';
import { TypoReportView } from './TypoReportView';
import { LongFormPanel } from './LongFormPanel';
import { DirectiveModal } from './DirectiveModal';
import { TourHintButton } from '../onboarding/TourHintButton';
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
  // G3：多候选（候选总数 / 已完成集合 / 临时节点当前展示下标）
  const candidates = useAIStore((s) => s.candidates);
  const activeCandidate = useAIStore((s) => s.activeCandidate);
  const candidateTotal = useAIStore((s) => s.candidateTotal);
  // P7.3b：会话块（响应式：决策条与轮次显示）
  const sessionBlock = useAIStore((s) => s.sessionBlock);
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
  // P7.3-M1：多轮会话开关（默认关，存量零感知；设置键 ai.session.enabled 持久化）
  const [sessionEnabled, setSessionEnabled] = useState(false);
  // P7.3b：对比态（决策条内版本切换，参考 G3 多候选交互；离开决定态自动退出）
  const [comparing, setComparing] = useState(false);
  const [comparePreview, setComparePreview] = useState<'prev' | 'current'>('current');
  // P2.1-M7：长文模式视图（第 5 tab；rail 'longform' 入口经 initialTab 打开）
  const [longform, setLongform] = useState(initialTab === 'longform');
  // 生成参数：P7.6 目标字数（档位 + 自由输入，持久化 ai.targetWords）与采样温度
  const [targetWords, setTargetWords] = useState(1000);
  const [temperature, setTemperature] = useState('0.8');
  // G3：候选数（续写 / 改写；1 = 单候选与现状一致，>1 逐条生成后挑选）
  const [candidateCount, setCandidateCount] = useState(1);
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
  // P7.6：有效值过滤（>= 100 的整数；非法不传 = 缺省行为：无注入、2048 兜底）
  const targetWordsValue = (): number | undefined =>
    Number.isFinite(targetWords) && targetWords >= 100 ? Math.floor(targetWords) : undefined;

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

  // P7.3-M1：读取多轮会话开关（app_settings 持久化，默认关）
  useEffect(() => {
    void getAppContext()
      .appSettings.get('ai.session.enabled')
      .then((v) => setSessionEnabled(v === 'true'))
      .catch(() => setSessionEnabled(false));
  }, []);

  // P7.6：读取持久化目标字数（>= 100 的整数，非法回退 1000）
  useEffect(() => {
    void getAppContext()
      .appSettings.get('ai.targetWords')
      .then((v) => {
        const n = v === null ? NaN : parseInt(v, 10);
        setTargetWords(Number.isFinite(n) && n >= 100 ? n : 1000);
      })
      .catch(() => setTargetWords(1000));
  }, []);

  /** P7.6：设定目标字数并持久化（档位 chips 点击 / 数字输入 onBlur；十进制字符串沿用 ai.session.enabled 约定） */
  const applyTargetWords = (n: number): void => {
    setTargetWords(n);
    void getAppContext()
      .appSettings.set('ai.targetWords', String(n))
      .catch(() => undefined);
  };

  const streaming = phase === 'streaming';
  const deciding = phase === 'deciding';
  const currentChapter = chapters.find((c) => c.id === currentChapterId);
  /** 第一个未完成节拍（定向续写目标） */
  const pendingBeat = beats.find((b) => !b.done && b.text.trim() !== '');
  /** P7.3b：本章节会话 key 与当前活跃块（章节切换后旧块不归属本章，由 runStream 守卫清账） */
  const sessionKey = bookId && currentChapterId ? `${bookId}:${currentChapterId}` : null;
  const curBlock =
    sessionBlock && sessionKey && sessionBlock.sessionKey === sessionKey ? sessionBlock : null;

  // P7.3b：离开决定态时退出对比态
  useEffect(() => {
    if (phase !== 'deciding') setComparing(false);
  }, [phase]);

  /** P7.3-M1：切换多轮会话开关（持久化到 app_settings） */
  const toggleSession = (on: boolean): void => {
    setSessionEnabled(on);
    void getAppContext()
      .appSettings.set('ai.session.enabled', on ? 'true' : 'false')
      .catch(() => undefined);
  };

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

  /**
   * P7.6：消费一条生成流；targetWords 有效时启用优雅停（累计达标即停止消费，按段/句边界收束回填）。
   * 返回是否触发优雅停（仅内部信息，不改 aborted 语义与 finishStream 路径；手动停止与 provider 自然结束不受影响）。
   */
  const consumeStream = async (
    iterable: AsyncIterable<ChatChunk>,
    target: number | undefined,
    api: EditorApi
  ): Promise<boolean> => {
    let buffer = '';
    let stopped = false;
    for await (const chunk of iterable) {
      if (!chunk.delta) continue;
      buffer += chunk.delta;
      useAIStore.getState().appendText(chunk.delta);
      api.appendAITemp(chunk.delta);
      if (target && target > 0 && countTokens(buffer) >= target) {
        stopped = true;
        break; // 停止消费：剩余流与底层连接由 provider abort 语义之外的自然放弃处理
      }
    }
    if (stopped) {
      const fit = trimToTargetWords(buffer, target!);
      if (fit.text !== buffer) {
        useAIStore.getState().setText(fit.text); // store 与临时节点同步回填
        api.setAITempText(fit.text);
      }
    }
    return stopped;
  };

  /**
   * 生成一条候选：临时节点承载输出；hook block 命中时带反馈自动重试一次。
   * 不落 store 终态（phase 由调用方统一 settle），返回文本与中断/错误标记。
   * P7.3b：会话块续写原地重写同一节点（setAITempText 复用），并按 R2 组装请求历史；
   * 返回本轮实际使用的要求（reqUsed，completeRound 落史用）。
   */
  const generateOne = async (
    kind: 'continue' | 'rewrite' | 'dialogue',
    range: { from: number; to: number } | null,
    aiReferences: AiReference[],
    useSession: boolean,
    nodeContent: string
  ): Promise<{ text: string; aborted: boolean; error?: string; reqUsed?: string }> => {
    const { orchestrator, multiPerspectiveRewriter } = getAppContext();
    const api = useEditorStore.getState().editorApi!;
    const controller = useAIStore.getState().startStream();
    let reqUsed: string | undefined;
    try {
      const recent = await gatherRecent();
      const makeIterable = (feedback?: string): AsyncIterable<{ delta: string; done: boolean }> => {
        if (kind === 'continue') {
          const req = [continueReq.trim(), feedback].filter(Boolean).join('\n') || undefined;
          reqUsed = req;
          // P7.3b R2：请求历史 = 块轨迹 +（末条 assistant ≠ 工作副本时注入节点当前内容）
          let history: ChatMessage[] | undefined;
          if (useSession) {
            const block = useAIStore.getState().sessionBlock;
            if (block) {
              const h = [...block.history];
              const lastAsst = [...h].reverse().find((m) => m.role === 'assistant');
              if (nodeContent.trim() !== '' && lastAsst?.content !== nodeContent) {
                h.push({ role: 'assistant', content: nodeContent });
              }
              history = h;
            }
          }
          return orchestrator.continueWriting({
            bookId,
            chapterId: currentChapterId!,
            currentContent: api.getPlainText(),
            recentChapters: recent,
            selectedCharacterIds: selectedCharIds,
            requirement: req,
            history,
            aiReferences,
            beat: beatDirect ? pendingBeat : undefined,
            targetWords: targetWordsValue(),
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
              chapterId: currentChapterId!,
              selectedText,
              perspective: perspective.label,
              characterId: perspective.characterId,
              tone: [instruction.trim(), feedback].filter(Boolean).join('\n') || undefined,
              targetWords: targetWordsValue(),
              temperature: tempValue(),
              signal: controller.signal
            });
          }
          return orchestrator.rewrite({
            bookId,
            chapterId: currentChapterId!,
            selectedText: selectedText,
            instruction: [instruction.trim(), feedback].filter(Boolean).join('\n'),
            recentChapters: recent,
            aiReferences,
            targetWords: targetWordsValue(),
            temperature: tempValue(),
            signal: controller.signal
          });
        }
        return orchestrator.generateDialogue({
          bookId,
          chapterId: currentChapterId!,
          scene,
          characterIds: selectedCharIds,
          recentChapters: recent,
          aiReferences,
          targetWords: targetWordsValue(),
          temperature: tempValue(),
          signal: controller.signal
        });
      };

      let feedback: string | undefined;
      for (let attempt = 0; attempt < 2; attempt++) {
        // P7.3b：会话块续写原地重写同一节点（setAITempText 复用既有临时节点；无节点时回退新建）
        if (useSession) {
          const reused = api.setAITempText('');
          if (!reused) api.startAITemp(range ?? undefined);
        } else {
          api.startAITemp(range ?? undefined);
        }
        if (attempt > 0) useAIStore.getState().setText('');
        const iterable = makeIterable(feedback);
        // P7.6：优雅停接入（hook 重试 attempt 与多候选每次迭代从空 buffer 重新计数）
        await consumeStream(iterable, targetWordsValue(), api);
        // hook.md 后处理（block 命中且可重试时带反馈再来一次）
        const blocked = await applyHooks();
        if (blocked && attempt === 0 && kind !== 'dialogue') {
          if (!useSession) api.discardAITemp(); // 会话块保留节点，重试时原地清空重写
          setHookRetried(blocked);
          feedback = `上一次生成违反了本书规则：${blocked}。请重新生成，严格避免上述问题。`;
          continue;
        }
        break;
      }
      api.finishAITemp();
      return { text: useAIStore.getState().generatedText, aborted: false, reqUsed };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const aborted = controller.signal.aborted || msg.includes('Abort');
      if (aborted) {
        // 中断：保留临时节点半截内容（多候选时作为一条候选进入挑选）
        api.finishAITemp();
        return { text: useAIStore.getState().generatedText, aborted: true, reqUsed };
      }
      // P7.3b：会话块轮次失败——恢复轮前内容（节点与 generatedText 同步回填，保住"上一版"链路）
      if (useSession) {
        if (nodeContent.trim() !== '') {
          api.setAITempText(nodeContent);
          api.finishAITemp();
        } else {
          api.discardAITemp();
        }
        useAIStore.getState().setText(nodeContent);
      } else {
        api.discardAITemp();
      }
      return { text: '', aborted: false, error: msg, reqUsed };
    }
  };

  /** 统一流式执行器：候选数 n=1 与现状完全一致；n>1 逐条顺序生成后进入多候选挑选 */
  const runStream = async (
    kind: 'continue' | 'rewrite' | 'dialogue',
    range: { from: number; to: number } | null,
    candidateCount = 1
  ): Promise<void> => {
    const api = useEditorStore.getState().editorApi;
    if (!api || !currentChapterId) {
      void toast.info('请先选择要编辑的章节');
      return;
    }
    setHookHits(null);
    setHookRetried(null);

    // P2.1-M2：透传当前文档引用标记（orchestrator 注入 forcedRefs 全文）
    const aiReferences = api.getAiReferences();

    // P7.3b：会话块归属守卫（切换章节后旧块清账）+ 会话判定（块存活期间不受开关影响）
    const storeBlock = useAIStore.getState().sessionBlock;
    if (storeBlock && sessionKey && storeBlock.sessionKey !== sessionKey) {
      useAIStore.getState().endBlock();
    }
    const blockActive = !!useAIStore.getState().sessionBlock;
    const useSession = kind === 'continue' && (sessionEnabled || blockActive);
    // P7.3b：会话模式固定单候选（多候选挑选与会话块轮次语义冲突，列为后续项）
    const effCandidates = useSession ? 1 : candidateCount;
    // 会话续写：在 startStream 清空 generatedText 前捕获节点当前内容（R2 注入与 prevCandidate 判定用）
    const nodeContent = useAIStore.getState().generatedText;
    if (useSession && sessionKey) {
      if (!blockActive) useAIStore.getState().beginBlock(sessionKey);
      else useAIStore.getState().beginRewriteRound(nodeContent);
    }

    if (effCandidates <= 1) {
      // 清残留候选态：多候选挑选中途放弃（未点保留/丢弃）时 candidates 会残留，
      // 不清会导致下一次单候选生成完成后误弹旧候选的挑选界面
      useAIStore.getState().beginCandidates(1);
      const r = await generateOne(kind, range, aiReferences, useSession, nodeContent);
      if (r.error) {
        useAIStore.getState().finishStream('error', r.error);
        return;
      }
      // P7.3b R1：轮完成原子对落史（中断/出错不落，半截内容交决策条处置）
      if (useSession && !r.aborted) {
        useAIStore
          .getState()
          .completeRound(r.reqUsed?.trim() || '（无特别要求，按前文自然续写）');
      }
      useAIStore.getState().finishStream(r.aborted ? 'aborted' : 'done');
      return;
    }

    // G3 多候选：每条独立过 hook 校验与中断处置；完成后临时节点停留在最后一条，进入挑选
    useAIStore.getState().beginCandidates(candidateCount);
    for (let i = 0; i < candidateCount; i++) {
      useAIStore.getState().setActiveCandidate(i);
      if (i > 0) api.discardAITemp();
      const r = await generateOne(kind, range, aiReferences, useSession, nodeContent);
      if (r.error) {
        // 单条失败：已有可用候选则以现有候选进入挑选，否则回到单发错误态
        if (useAIStore.getState().candidates.length > 0) break;
        useAIStore.getState().finishStream('error', r.error);
        return;
      }
      if (r.text.trim() !== '' || r.aborted) useAIStore.getState().pushCandidate();
      if (r.aborted) break; // 用户停止：以已完成候选进入挑选
    }
    useAIStore.getState().finishStream('done');
  };

  const stop = (): void => {
    useAIStore.getState().abortController?.abort();
  };

  const onContinue = async (): Promise<void> => {
    // 继续补完（P1-M8）：以已生成半截内容为上文再次调 LLM，结果合并进同一临时节点
    // P7.3b：会话块内补完——半截内容按 R2 注入请求（末条 assistant ≠ 半截时），正文不再拼接 base
    const { orchestrator } = getAppContext();
    const api = useEditorStore.getState().editorApi;
    if (!api || !currentChapterId) return;
    // 必须在 startStream（会清空 generatedText）之前读取半截内容
    const base = useAIStore.getState().generatedText;
    const block = useAIStore.getState().sessionBlock;
    const useSession = !!block && !!sessionKey && block.sessionKey === sessionKey;
    const controller = useAIStore.getState().startStream();
    try {
      const recent = await gatherRecent();
      // 重新登记半截内容：多轮补完时 base 连续，"已生成 N 字"统计不回零
      if (base) useAIStore.getState().appendText(base);
      let history: ChatMessage[] | undefined;
      let requirement = continueReq.trim() || undefined;
      let currentContent = `${api.getPlainText()}${base ? `\n\n${base}` : ''}`;
      if (useSession && block) {
        // P7.3b R2：块轨迹 +（末条 assistant ≠ 半截内容时注入工作副本）
        const h = [...block.history];
        const lastAsst = [...h].reverse().find((m) => m.role === 'assistant');
        if (base.trim() !== '' && lastAsst?.content !== base) {
          h.push({ role: 'assistant', content: base });
        }
        history = h;
        currentContent = api.getPlainText();
        requirement = [
          '继续补完：从上次中断处接着写，保持已生成内容为正文，不要重复输出已有内容。',
          continueReq.trim()
        ]
          .filter(Boolean)
          .join('\n');
      }
      const iterable = orchestrator.continueWriting({
        bookId,
        chapterId: currentChapterId,
        currentContent,
        history,
        recentChapters: recent,
        selectedCharacterIds: selectedCharIds,
        requirement,
        // P7.6：补完豁免——不传 targetWords（无篇幅注入与停机目标；maxTokens 由服务层缺省 2048 兜底）
        temperature: tempValue(),
        signal: controller.signal
      });
      // P7.6：补完只保流式体验，target 传 undefined（不设停机目标）
      await consumeStream(iterable, undefined, api);
      // hook.md 后处理（补完场景只做替换与提醒，不再重试）
      await applyHooks();
      api.finishAITemp();
      // P7.3b R1：补完完成原子对落史（指令=补完说明，输出=合并后全文）
      if (useSession) {
        useAIStore.getState().completeRound(requirement ?? '（继续补完）');
      }
      useAIStore.getState().finishStream('done');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const aborted = controller.signal.aborted || msg.includes('Abort');
      if (aborted) {
        // 补完途中再次中断：保留合并后的半截内容，回到决策条
        api.finishAITemp();
        useAIStore.getState().finishStream('aborted');
      } else {
        api.discardAITemp();
        useAIStore.getState().finishStream('error', msg);
      }
    }
  };

  /** P7.3b：对比态——版本预览切换（参考 G3 多候选：setAITempText 在编辑器直接显示所选版本） */
  const previewVersion = (v: 'prev' | 'current'): void => {
    if (!curBlock) return;
    const api = useEditorStore.getState().editorApi;
    if (!api) return;
    const text = v === 'prev' ? (curBlock.prevCandidate ?? '') : useAIStore.getState().generatedText;
    api.setAITempText(text);
    api.finishAITemp();
    setComparePreview(v);
  };

  /** 对比择优：选上一版 = 回滚本轮轨迹并回填节点（胜者进入下一轮） */
  const pickPrevVersion = (): void => {
    const prev = useAIStore.getState().revertToPrevCandidate();
    const api = useEditorStore.getState().editorApi;
    if (prev != null && api) {
      api.setAITempText(prev);
      api.finishAITemp();
      useAIStore.getState().setText(prev);
    }
    setComparing(false);
  };

  /** 对比择优：保持当前版 = 关闭对比继续微调 */
  const keepCurrentVersion = (): void => {
    const api = useEditorStore.getState().editorApi;
    if (api) {
      api.setAITempText(useAIStore.getState().generatedText);
      api.finishAITemp();
    }
    setComparing(false);
  };

  /** P7.3b：块内采用进正文（正文落位、块清账） */
  const adoptBlock = (): void => {
    useEditorStore.getState().editorApi?.acceptAITemp();
    useAIStore.getState().endBlock();
    useAIStore.getState().reset();
  };

  /** P7.3b：丢弃整块（节点移除、轨迹清空） */
  const discardBlock = (): void => {
    useEditorStore.getState().editorApi?.discardAITemp();
    useAIStore.getState().endBlock();
    useAIStore.getState().reset();
  };

  const runCheck = async (): Promise<void> => {
    const { orchestrator } = getAppContext();
    const api = useEditorStore.getState().editorApi;
    if (!api || !currentChapterId) {
      void toast.info('请先选择要检查的章节');
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
      void toast.error(`检查失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      useAIStore.getState().setChecking(false);
    }
  };

  /** 本章节错字检查：纯校对任务，报告含定位与一键修正 */
  const runTypoCheck = async (): Promise<void> => {
    const { orchestrator } = getAppContext();
    const api = useEditorStore.getState().editorApi;
    if (!api || !currentChapterId) {
      void toast.info('请先选择要检查的章节');
      return;
    }
    const text = api.getPlainText();
    if (!text.trim()) {
      void toast.info('当前章节为空');
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
      void toast.error(`错字检查失败：${e instanceof Error ? e.message : String(e)}`);
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
      <div className="flex border-b border-ink-200" data-tour="ai-modes">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            data-ai-mode={m.key}
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
          data-ai-mode="longform"
          onClick={() => setLongform(true)}
          className={`flex-1 px-2 py-2 text-sm ${
            longform
              ? 'border-b-2 border-violet-600 font-medium text-violet-700'
              : 'text-ink-500 hover:text-ink-800'
          }`}
        >
          长文
        </button>
        <TourHintButton tourId="ai-panel" className="mt-2" />
      </div>

      {/* 本书指令入口（agents.md 全局指令 + hook.md 输出规则）+ 生效状态提示（窄栏单行） */}
      {!longform && (
        <div
          className="flex shrink-0 items-center justify-between whitespace-nowrap border-b border-ink-100 px-3 py-1.5"
          data-tour="ai-directives"
        >
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
          <div className="p-3" data-tour="ai-continue-params">
            <div className="mb-2 text-xs text-ink-500">
              当前：{currentChapter?.title ?? '未选择章节'} · 前情自动取最近 3 章
            </div>
            {/* P7.3b：多轮会话开关（默认关；开启后以会话块迭代候选——微调原地替换、可按需与上一版对比） */}
            <label
              className="mb-2 flex items-center gap-2 rounded border border-violet-200 bg-violet-50/50 px-2 py-1.5 text-xs text-violet-800"
              data-tour="ai-session"
              title="开启后续写进入会话块：新一轮原地替换当前候选（内存态，重启即失）；可随时与上一版对比择优，采用/丢弃后自动清账"
            >
              <input
                type="checkbox"
                checked={sessionEnabled}
                onChange={(e) => toggleSession(e.target.checked)}
              />
              <span className="min-w-0 flex-1">多轮会话（生成后可连续微调）</span>
            </label>
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
              placeholder={
                curBlock
                  ? '微调指令（可选），如：再压抑一点、节奏更快；留空则按前文重新生成'
                  : '续写要求（可选），如：主角识破陷阱，引出幕后黑手'
              }
              className="mt-2 mb-1 w-full resize-none rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
            />
            <GenParams
              targetWords={targetWords}
              setTargetWords={setTargetWords}
              commitTargetWords={applyTargetWords}
              temperature={temperature}
              setTemperature={setTemperature}
            />
            {/* P7.3b：会话模式固定单候选（多候选挑选与会话块轮次语义冲突，列为后续项） */}
            {!sessionEnabled && (
              <CandidatePicker value={candidateCount} onChange={setCandidateCount} disabled={streaming} />
            )}
            <button
              type="button"
              disabled={streaming || !currentChapterId || (deciding && !!curBlock)}
              className="mt-3 w-full rounded bg-violet-600 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
              onClick={() => void runStream('continue', null, sessionEnabled ? 1 : candidateCount)}
            >
              {streaming
                ? candidateTotal > 1
                  ? `生成候选 ${Math.min(activeCandidate + 1, candidateTotal)}/${candidateTotal}…`
                  : '生成中…'
                : !sessionEnabled && candidateCount > 1
                  ? `开始续写（${candidateCount} 条候选）`
                  : '开始续写'}
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
              targetWords={targetWords}
              setTargetWords={setTargetWords}
              commitTargetWords={applyTargetWords}
              temperature={temperature}
              setTemperature={setTemperature}
            />
            <CandidatePicker value={candidateCount} onChange={setCandidateCount} disabled={streaming} />
            <button
              type="button"
              disabled={streaming || !selectedText || (!instruction.trim() && !perspectiveId)}
              className="mt-3 w-full rounded bg-violet-600 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
              onClick={() => {
                const api = useEditorStore.getState().editorApi;
                const range = api?.getSelectionRange() ?? null;
                void runStream('rewrite', range, candidateCount);
              }}
            >
              {streaming
                ? candidateTotal > 1
                  ? `生成候选 ${Math.min(activeCandidate + 1, candidateTotal)}/${candidateTotal}…`
                  : '生成中…'
                : perspectiveId
                  ? `从${perspectiveId}重写`
                  : candidateCount > 1
                    ? `开始改写（${candidateCount} 条候选）`
                    : '开始改写'}
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
            data-tour="ai-longform-entry"
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
          {deciding && candidates.length > 1 ? (
            <>
              {/* G3：多候选挑选——点击切换临时节点预览，采纳/全部丢弃 */}
              <div className="mb-1 text-xs text-ink-500">
                已生成 {candidates.length} 条候选，点击切换预览：
              </div>
              <div className="mb-1.5 flex gap-1">
                {candidates.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`flex-1 rounded border py-1 text-xs ${
                      i === activeCandidate
                        ? 'border-violet-400 bg-violet-50 font-medium text-violet-700'
                        : 'border-ink-200 text-ink-500 hover:bg-ink-100'
                    }`}
                    onClick={() => {
                      useAIStore.getState().setActiveCandidate(i);
                      const api = useEditorStore.getState().editorApi;
                      if (!api) return;
                      // 整体替换临时节点内容（setAITempText 会重置为流式态，需重新标记完成）
                      api.setAITempText(c);
                      api.finishAITemp();
                    }}
                  >
                    候选 {i + 1}
                    <span className="ml-0.5 text-[10px] text-ink-400">{c.length}字</span>
                  </button>
                ))}
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
                  保留此候选
                </button>
                <button
                  type="button"
                  className="flex-1 rounded bg-red-500 py-1 text-xs text-white hover:bg-red-600"
                  onClick={() => {
                    useEditorStore.getState().editorApi?.discardAITemp();
                    useAIStore.getState().reset();
                  }}
                >
                  全部丢弃
                </button>
              </div>
            </>
          ) : deciding && curBlock ? (
            comparing ? (
              <>
                {/* P7.3b：对比态——版本切换预览（参考 G3 多候选交互，编辑器直接显示所选版本） */}
                <div className="mb-1 text-xs text-ink-500">版本对比，点击在编辑器中切换预览：</div>
                <div className="mb-1.5 flex gap-1">
                  <button
                    type="button"
                    className={`flex-1 rounded border py-1 text-xs ${
                      comparePreview === 'prev'
                        ? 'border-violet-400 bg-violet-50 font-medium text-violet-700'
                        : 'border-ink-200 text-ink-500 hover:bg-ink-100'
                    }`}
                    onClick={() => previewVersion('prev')}
                  >
                    上一版（第 {Math.max(1, curBlock.round - 1)} 轮）
                    <span className="ml-0.5 text-[10px] text-ink-400">
                      {curBlock.prevCandidate?.length ?? 0}字
                    </span>
                  </button>
                  <button
                    type="button"
                    className={`flex-1 rounded border py-1 text-xs ${
                      comparePreview === 'current'
                        ? 'border-violet-400 bg-violet-50 font-medium text-violet-700'
                        : 'border-ink-200 text-ink-500 hover:bg-ink-100'
                    }`}
                    onClick={() => previewVersion('current')}
                  >
                    当前版（第 {curBlock.round} 轮）
                    <span className="ml-0.5 text-[10px] text-ink-400">
                      {useAIStore.getState().generatedText.length}字
                    </span>
                  </button>
                </div>
                <div className="flex gap-1">
                  <button
                    type="button"
                    className="flex-1 rounded bg-emerald-600 py-1 text-xs text-white hover:bg-emerald-700"
                    onClick={pickPrevVersion}
                  >
                    用上一版
                  </button>
                  <button
                    type="button"
                    className="flex-1 rounded bg-violet-600 py-1 text-xs text-white hover:bg-violet-700"
                    onClick={keepCurrentVersion}
                  >
                    保持当前版
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="mb-1 text-xs text-ink-500">
                  会话块 · 第 {curBlock.round} 轮 · 已生成{' '}
                  {useAIStore.getState().generatedText.length} 字，请选择：
                </div>
                <button
                  type="button"
                  className="w-full rounded bg-violet-600 py-1.5 text-xs text-white hover:bg-violet-700"
                  onClick={() => void runStream('continue', null, 1)}
                >
                  微调下一轮
                </button>
                {curBlock.prevCandidate != null && (
                  <button
                    type="button"
                    className="mt-1 w-full rounded border border-violet-200 bg-white py-1 text-xs text-violet-700 hover:bg-violet-50"
                    onClick={() => {
                      setComparePreview('current');
                      setComparing(true);
                    }}
                  >
                    与上一版对比
                  </button>
                )}
                <div className="mt-1.5 flex gap-1">
                  <button
                    type="button"
                    className="flex-1 rounded bg-emerald-600 py-1 text-xs text-white hover:bg-emerald-700"
                    onClick={adoptBlock}
                  >
                    采用进正文
                  </button>
                  <button
                    type="button"
                    className="flex-1 rounded bg-red-500 py-1 text-xs text-white hover:bg-red-600"
                    onClick={discardBlock}
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
            )
          ) : deciding ? (
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
          ) : null}
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

/** G3：候选数选择（1 = 单候选与现状一致；>1 逐条生成后挑选，耗时与消耗按倍数增加） */
function CandidatePicker({
  value,
  onChange,
  disabled
}: {
  value: number;
  onChange: (v: number) => void;
  disabled: boolean;
}): JSX.Element {
  return (
    <div className="mt-2 flex items-center gap-2" data-tour="ai-candidates">
      <span className="text-xs text-ink-500">候选数</span>
      <select
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        disabled={disabled}
        className="rounded border border-ink-200 bg-white px-1.5 py-0.5 text-xs outline-none focus:border-violet-400 disabled:opacity-50"
      >
        {[1, 2, 3].map((n) => (
          <option key={n} value={n}>
            {n === 1 ? '1 条' : `${n} 条`}
          </option>
        ))}
      </select>
      {value > 1 && <span className="text-[11px] text-amber-600">生成 {value} 次，挑选后只保留一条</span>}
    </div>
  );
}

/** P7.6：生成参数——目标字数（档位 chips + 自由输入）与温度；chips 点击与输入 onBlur 持久化 */
function GenParams({
  targetWords,
  setTargetWords,
  commitTargetWords,
  temperature,
  setTemperature
}: {
  targetWords: number;
  setTargetWords: (v: number) => void;
  commitTargetWords: (v: number) => void;
  temperature: string;
  setTemperature: (v: string) => void;
}): JSX.Element {
  const chips = [500, 1000, 2000, 3000];
  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-ink-600">
      <span title="单次生成目标字数；整章生成请用长文模式">目标字数</span>
      <div className="flex gap-1">
        {chips.map((g) => (
          <button
            key={g}
            type="button"
            onClick={() => commitTargetWords(g)}
            className={`rounded-full px-2 py-0.5 ${
              targetWords === g
                ? 'bg-violet-600 text-white'
                : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
            }`}
          >
            {g}
          </button>
        ))}
      </div>
      <input
        type="number"
        min={100}
        step={100}
        value={targetWords}
        onChange={(e) => setTargetWords(parseInt(e.target.value, 10) || 0)}
        onBlur={() => {
          if (Number.isFinite(targetWords) && targetWords > 0) commitTargetWords(targetWords);
        }}
        title="单次生成目标字数；整章生成请用长文模式"
        className="w-20 rounded border border-ink-200 px-1.5 py-1 outline-none focus:border-violet-400"
      />
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
