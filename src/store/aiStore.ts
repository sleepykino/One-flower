/** AI 交互状态：流式输出、中断、三选项、多候选（G3）、会话块（P7.3b） */

import { create } from 'zustand';
import type { AIMode } from '../services/skill/types';
import type { ConsistencyReport, TypoReport } from '../services/ai/types';
import type { ChatMessage } from '../services/ai/providers/LLMProvider';
import { DEFAULT_TOKEN_BUDGET, truncateHistoryLatestFirst } from '../services/ai/PromptAssembler';

/** P7.3b：会话块轨迹 token 上限（与 PromptAssembler history 预算一致，防内存无限增长） */
const SESSION_HISTORY_BUDGET = DEFAULT_TOKEN_BUDGET.history;

/**
 * P7.3b：会话块——一次「生成 →（多轮微调，可按需对比择优）→ 采用/丢弃」的候选迭代。
 * 内存态（重启即失）；块内单临时节点、微调轮原地重写；块结束（采用/丢弃）自动清账。
 */
export interface SessionBlock {
  /** `${bookId}:${chapterId}`（归属校验与切换隔离） */
  sessionKey: string;
  /** 当前轮次（从 1 起；微调轮开始时 +1，退回时 -1；补完属于当前轮的延续） */
  round: number;
  /** 块轨迹：各轮 (指令, 输出) 原子对，末条 assistant 恒等于节点当前内容 */
  history: ChatMessage[];
  /** 上一版（最近一次被完整替换的候选，对比框左卡；中断半截永不写入） */
  prevCandidate: string | null;
}

export type AIPhase =
  | 'idle' // 空闲
  | 'streaming' // 流式输出中
  | 'deciding' // 流式结束/中断，等待用户三选项（保留/丢弃/继续）
  | 'checking'; // 一致性检查 / 错字检查中

interface AIStore {
  mode: AIMode;
  phase: AIPhase;
  abortController: AbortController | null;
  generatedText: string; // 本次流式累计文本
  error: string | null;
  report: ConsistencyReport | null;
  typoReport: TypoReport | null; // 错字检查结果
  /** G3：多候选。candidateTotal=1 为单候选（现状）；>1 时 candidates 按序累积 */
  candidateTotal: number;
  candidates: string[];
  activeCandidate: number; // 流式中=正在生成的第几条；deciding 多候选=临时节点当前展示的下标
  /** P7.3b：当前会话块（null = 无会话；仅续写维护） */
  sessionBlock: SessionBlock | null;

  setMode: (mode: AIMode) => void;
  startStream: () => AbortController;
  finishStream: (reason: 'done' | 'aborted' | 'error', error?: string) => void;
  appendText: (delta: string) => void;
  /** 整体替换本次累计文本（hook.md 后处理替换用） */
  setText: (text: string) => void;
  /** G3：开始一次多候选生成（重置候选集合） */
  beginCandidates: (total: number) => void;
  /** G3：当前 generatedText 完成一条候选，入列并指向它 */
  pushCandidate: () => void;
  /** G3：切换临时节点展示的候选（多候选挑选） */
  setActiveCandidate: (index: number) => void;
  /** P7.3b：开始会话块（首轮；已有块时幂等） */
  beginBlock: (sessionKey: string) => void;
  /**
   * P7.3b：微调轮开始（原地重写同一节点）。
   * 仅当 nodeContent 是完整候选（= 历史末条 assistant）时存为 prevCandidate；
   * 中断半截不覆盖 prevCandidate，保住"退回上一版"能力。
   */
  beginRewriteRound: (nodeContent: string) => void;
  /**
   * P7.3b：轮完成落史（微调轮/补完轮通用）——原子对 (指令, 输出)。
   * output 缺省取当前 generatedText（hook 替换后的最终内容）；空文本不落史。
   */
  completeRound: (instruction: string, output?: string) => void;
  /**
   * P7.3b：对比择优选"上一版"——回滚到 prevCandidate 所在轮（移除其后所有轮次对，
   * 含补完轮），round 随之回退；返回 prevCandidate 供组件回填节点，prevCandidate 置 null。
   */
  revertToPrevCandidate: () => string | null;
  /** P7.3b：结束会话块（采用/丢弃/切换章节），轨迹随块清空 */
  endBlock: () => void;
  reset: () => void;
  setReport: (report: ConsistencyReport | null) => void;
  setTypoReport: (typoReport: TypoReport | null) => void;
  setChecking: (checking: boolean) => void;
}

export const useAIStore = create<AIStore>((set, get) => ({
  mode: 'continue',
  phase: 'idle',
  abortController: null,
  generatedText: '',
  error: null,
  report: null,
  typoReport: null,
  candidateTotal: 1,
  candidates: [],
  activeCandidate: 0,
  sessionBlock: null,

  setMode: (mode) => set({ mode }),

  startStream: () => {
    const abortController = new AbortController();
    set({ phase: 'streaming', abortController, generatedText: '', error: null });
    return abortController;
  },

  finishStream: (reason, error) =>
    set({
      phase: reason === 'error' ? 'idle' : 'deciding',
      abortController: null,
      error: error ?? null
    }),

  appendText: (delta) =>
    set((s) => ({ generatedText: s.generatedText + delta })),

  setText: (text) => set({ generatedText: text }),

  beginCandidates: (total) => set({ candidateTotal: total, candidates: [], activeCandidate: 0 }),

  pushCandidate: () =>
    set((s) => {
      const candidates = [...s.candidates, s.generatedText];
      return { candidates, activeCandidate: candidates.length - 1 };
    }),

  setActiveCandidate: (index) => set({ activeCandidate: index }),

  beginBlock: (sessionKey) =>
    set((s) =>
      s.sessionBlock
        ? {}
        : { sessionBlock: { sessionKey, round: 1, history: [], prevCandidate: null } }
    ),

  beginRewriteRound: (nodeContent) =>
    set((s) => {
      if (!s.sessionBlock) return {};
      const lastAsst = [...s.sessionBlock.history].reverse().find((m) => m.role === 'assistant');
      const isCompleteCandidate = nodeContent.trim() !== '' && lastAsst?.content === nodeContent;
      return {
        sessionBlock: {
          ...s.sessionBlock,
          round: s.sessionBlock.round + 1,
          prevCandidate: isCompleteCandidate ? nodeContent : s.sessionBlock.prevCandidate
        }
      };
    }),

  completeRound: (instruction, output) =>
    set((s) => {
      if (!s.sessionBlock) return {};
      const text = output ?? s.generatedText;
      if (text.trim() === '') return {};
      const block = s.sessionBlock;
      return {
        sessionBlock: {
          ...block,
          history: truncateHistoryLatestFirst(
            [
              ...block.history,
              { role: 'user' as const, content: instruction },
              { role: 'assistant' as const, content: text }
            ],
            SESSION_HISTORY_BUDGET
          )
        }
      };
    }),

  revertToPrevCandidate: () => {
    const block = get().sessionBlock;
    if (!block || block.prevCandidate == null) return null;
    const prev = block.prevCandidate;
    const h = [...block.history];
    // 回滚到 prevCandidate 所在轮：移除其后所有轮次对（含补完轮），保留配对的 user
    while (h.length > 0) {
      const last = h[h.length - 1];
      if (last.role === 'assistant' && last.content === prev) break;
      h.pop();
    }
    set({
      sessionBlock: {
        ...block,
        history: h,
        round: Math.max(1, Math.ceil(h.length / 2)),
        prevCandidate: null
      }
    });
    return prev;
  },

  endBlock: () => set({ sessionBlock: null }),

  reset: () =>
    set({
      phase: 'idle',
      abortController: null,
      generatedText: '',
      error: null,
      candidateTotal: 1,
      candidates: [],
      activeCandidate: 0
      // 注意：sessionBlock 不在 reset 范围——块生命周期由 endBlock 显式控制（采用/丢弃/切章）
    }),

  setReport: (report) => set({ report }),
  setTypoReport: (typoReport) => set({ typoReport }),

  setChecking: (checking) => set({ phase: checking ? 'checking' : 'idle' })
}));
