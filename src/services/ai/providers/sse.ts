/**
 * SSE 流解析工具（fetch ReadableStream → SSE data 事件）
 */

/** @vite-ignore */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

/**
 * Provider 网络超时阈值（优化建议批次3建议1，2026-08-28）：
 * 首包 60s（建立连接/收首个响应头），总超时 10min（整次调用含流式读取）。
 * 首包阈值宽容（勿误杀长文/长流式生成），总阈值放宽（正常长文生成能跑完）。
 */
export const LLM_FIRST_BYTE_MS = 60_000;
export const LLM_TOTAL_MS = 600_000;

/** 手动组合多个 AbortSignal：任一来源 abort 即全部中断，并支持 dispose 释放监听 */
function combineAbortSignals(signals: Array<AbortSignal | undefined>): AbortSignal & { dispose(): void } {
  const list = signals.filter((s): s is AbortSignal => !!s);
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  for (const s of list) {
    if (s.aborted) {
      ctrl.abort();
      break;
    }
    s.addEventListener('abort', onAbort);
  }
  const disposed = { done: false };
  return Object.assign(ctrl.signal, {
    dispose() {
      if (disposed.done) return;
      disposed.done = true;
      for (const s of list) s.removeEventListener('abort', onAbort);
    }
  }) as AbortSignal & { dispose(): void };
}

/**
 * 为一次 Provider 网络调用建立超时中断源：
 * - 首包超时：从调用开始到响应头到达；markFirstByte() 后清除，避免误杀长流式生成；
 * - 总超时：整次调用（含 stream 的 body 读取）上限；
 * - 同时合并调用方 signal（任务取消/组件卸载 abort 照常生效）。
 *
 * 用法：
 *   const nt = withNetworkTimeout(label, options.signal);
 *   const res = await tauriFetch(url, { ..., signal: nt.fetchSignal }); // 含首包超时
 *   nt.markFirstByte();                                                // 拿到响应头
 *   for await (const d of sseLines(res, nt.readSignal)) { ... }        // 流式读取，仅总超时
 *   // catch 里：nt.rethrowTimeout(e) 统一把超时/原错误向上抛
 *   // 结束（finally）里：nt.dispose() 释放计时器与监听
 */
export function withNetworkTimeout(label: string, callerSignal?: AbortSignal) {
  const total = new AbortController();
  const first = new AbortController();
  let timedOut = false;
  let firstDone = false;

  const totalTimer = setTimeout(() => {
    timedOut = true;
    total.abort();
  }, LLM_TOTAL_MS);
  const firstTimer = setTimeout(() => {
    timedOut = true;
    first.abort();
  }, LLM_FIRST_BYTE_MS);

  const baseSignals: Array<AbortSignal | undefined> = [total.signal];
  if (callerSignal) baseSignals.push(callerSignal);

  const fetchCombined = combineAbortSignals([...baseSignals, first.signal]);
  const readCombined = combineAbortSignals(baseSignals);

  return {
    /** 发起 fetch 用（含首包超时） */
    fetchSignal: fetchCombined,
    /** 拿到响应头后 body/流式读取用（仅总超时 + 调用方 signal） */
    readSignal: readCombined,
    /** 响应头到达后调用，清除首包计时器 */
    markFirstByte(): void {
      if (firstDone) return;
      firstDone = true;
      clearTimeout(firstTimer);
    },
    /** catch 收口：若本次调用已超时则抛“超时”错误；否则不抛（由调用方原样抛原错误） */
    rethrowTimeout(): void {
      if (timedOut) {
        throw new Error(
          `${label} 无响应超时（首包 ${LLM_FIRST_BYTE_MS / 1000}s，总 ${LLM_TOTAL_MS / 1000}s）`
        );
      }
    },
    /** 调用结束（finally）调用，释放计时器与监听 */
    dispose(): void {
      clearTimeout(totalTimer);
      clearTimeout(firstTimer);
      fetchCombined.dispose();
      readCombined.dispose();
    }
  };
}

export async function* sseLines(
  response: Response,
  signal?: AbortSignal
): AsyncGenerator<string, void, undefined> {
  const body = response.body;
  if (!body) throw new Error('响应无内容（流式响应需要 body）');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE 事件以空行分隔
      let sep: number;
      while ((sep = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, sep).replace(/\r$/, '');
        buffer = buffer.slice(sep + 1);
        if (line.startsWith('data:')) {
          yield line.slice(5).trim();
        }
      }
    }
    const rest = buffer.trim();
    if (rest.startsWith('data:')) {
      yield rest.slice(5).trim();
    }
  } finally {
    reader.releaseLock();
  }
}

export { tauriFetch };
