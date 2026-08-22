/** AI 交互状态：流式输出、中断、三选项 */

import { create } from 'zustand';
import type { AIMode } from '../services/skill/types';
import type { ConsistencyReport, TypoReport } from '../services/ai/types';

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

  setMode: (mode: AIMode) => void;
  startStream: () => AbortController;
  finishStream: (reason: 'done' | 'aborted' | 'error', error?: string) => void;
  appendText: (delta: string) => void;
  /** 整体替换本次累计文本（hook.md 后处理替换用） */
  setText: (text: string) => void;
  reset: () => void;
  setReport: (report: ConsistencyReport | null) => void;
  setTypoReport: (report: TypoReport | null) => void;
  setChecking: (checking: boolean) => void;
}

export const useAIStore = create<AIStore>((set) => ({
  mode: 'continue',
  phase: 'idle',
  abortController: null,
  generatedText: '',
  error: null,
  report: null,
  typoReport: null,

  setMode: (mode) => set({ mode }),

  startStream: () => {
    const abortController = new AbortController();
    set({ phase: 'streaming', abortController, generatedText: '', error: null });
    return abortController;
  },

  finishStream: (reason, error) =>
    set((s) => ({
      phase: reason === 'error' ? 'idle' : 'deciding',
      abortController: null,
      error: error ?? null,
      generatedText: reason === 'error' ? s.generatedText : s.generatedText
    })),

  appendText: (delta) =>
    set((s) => ({ generatedText: s.generatedText + delta })),

  setText: (text) => set({ generatedText: text }),

  reset: () => set({ phase: 'idle', abortController: null, generatedText: '', error: null }),

  setReport: (report) => set({ report }),
  setTypoReport: (typoReport) => set({ typoReport }),

  setChecking: (checking) => set({ phase: checking ? 'checking' : 'idle' })
}));
