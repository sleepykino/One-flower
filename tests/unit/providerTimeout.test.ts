import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  LLM_FIRST_BYTE_MS,
  LLM_TOTAL_MS,
  withNetworkTimeout
} from '../../src/services/ai/providers/sse';

// 优化建议记录 批次3 建议1（2026-08-28）：
// Provider 网络调用（chat/stream/embed）补「首包 60s + 总超时 10min」，合并调用方 signal。
// 用 fake timers 推进时间验证：首包超时不误杀长流式（markFirstByte 后清除）、总超时兜底、
// 调用方 signal 取消照常生效、dispose 释放计时器。

/** 监听 signal 首次 abort 的 promise */
function onAbort(signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve();
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
}

describe('withNetworkTimeout', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('首包超时：未收首包超过 60s 触发 abort 并抛“超时”错误', async () => {
    const nt = withNetworkTimeout('测试');
    const aborted = onAbort(nt.fetchSignal);
    await vi.advanceTimersByTimeAsync(LLM_FIRST_BYTE_MS);
    await aborted;
    expect(nt.fetchSignal.aborted).toBe(true);
    expect(() => nt.rethrowTimeout()).toThrow(/超时/);
    nt.dispose();
  });

  it('markFirstByte() 后清除首包计时器：60s 首包不中断，总超时仍兜底', async () => {
    const nt = withNetworkTimeout('测试');
    nt.markFirstByte();
    await vi.advanceTimersByTimeAsync(LLM_FIRST_BYTE_MS);
    expect(nt.fetchSignal.aborted).toBe(false);
    // 继续推进到总超时 → 中断
    const aborted = onAbort(nt.fetchSignal);
    await vi.advanceTimersByTimeAsync(LLM_TOTAL_MS - LLM_FIRST_BYTE_MS);
    await aborted;
    expect(nt.fetchSignal.aborted).toBe(true);
    expect(() => nt.rethrowTimeout()).toThrow(/超时/);
    nt.dispose();
  });

  it('readSignal 不含首包超时：首包超时只中断 fetch 阶段，流式 body 读取不受首包限制', async () => {
    const nt = withNetworkTimeout('测试');
    const fetchAborted = onAbort(nt.fetchSignal);
    await vi.advanceTimersByTimeAsync(LLM_FIRST_BYTE_MS);
    await fetchAborted;
    expect(nt.fetchSignal.aborted).toBe(true);
    expect(nt.readSignal.aborted).toBe(false);
    nt.dispose();
  });

  it('调用方 signal 取消会传播到 fetch/read；非超时不抛“超时”错误', async () => {
    const ctrl = new AbortController();
    const nt = withNetworkTimeout('测试', ctrl.signal);
    ctrl.abort();
    expect(nt.fetchSignal.aborted).toBe(true);
    expect(nt.readSignal.aborted).toBe(true);
    expect(() => nt.rethrowTimeout()).not.toThrow();
    nt.dispose();
  });

  it('dispose 后计时器释放，不再触发中断', async () => {
    const nt = withNetworkTimeout('测试');
    nt.dispose();
    await vi.advanceTimersByTimeAsync(LLM_TOTAL_MS + LLM_FIRST_BYTE_MS);
    expect(nt.fetchSignal.aborted).toBe(false);
    expect(nt.readSignal.aborted).toBe(false);
  });
});