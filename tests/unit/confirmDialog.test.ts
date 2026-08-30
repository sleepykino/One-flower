/**
 * P7.2 单测：软件内确认弹窗 store 的串行队列语义
 * confirmDialog -> useConfirmStore.confirm/settle 为纯 zustand 状态机，不依赖 Tauri 运行时。
 */

import { describe, expect, it } from 'vitest';
import { useConfirmStore } from '../../src/components/common/confirm-dialog/store';

/** 重置为初始状态（每用例独立） */
function reset(): void {
  useConfirmStore.setState({ open: false, text: '', title: '确认操作', resolveCurrent: null, pending: [] });
}

describe('confirm store 串行队列', () => {
  it('单请求：confirm 返回 Promise，settle(true) 解析为 true', async () => {
    reset();
    const p = useConfirmStore.getState().confirm('删除该书？', '确认删除');
    expect(useConfirmStore.getState().open).toBe(true);
    expect(useConfirmStore.getState().title).toBe('确认删除');
    useConfirmStore.getState().settle(true);
    await expect(p).resolves.toBe(true);
    expect(useConfirmStore.getState().open).toBe(false);
  });

  it('并发请求：同一时刻仅展示一个，后续进 pending 串行解决', async () => {
    reset();
    const s = useConfirmStore.getState();
    const a = s.confirm('请求 A');
    const b = s.confirm('请求 B');
    const c = s.confirm('请求 C');

    // 第一个展示中，后两个入队
    expect(useConfirmStore.getState().open).toBe(true);
    expect(useConfirmStore.getState().text).toBe('请求 A');
    expect(useConfirmStore.getState().pending).toHaveLength(2);

    // 依次 settle：A 被解析，B 自动展示
    useConfirmStore.getState().settle(true);
    expect(useConfirmStore.getState().text).toBe('请求 B');
    useConfirmStore.getState().settle(false);
    expect(useConfirmStore.getState().text).toBe('请求 C');
    useConfirmStore.getState().settle(true);

    await expect(a).resolves.toBe(true);
    await expect(b).resolves.toBe(false);
    await expect(c).resolves.toBe(true);
    expect(useConfirmStore.getState().open).toBe(false);
    expect(useConfirmStore.getState().pending).toHaveLength(0);
  });

  it('默认标题为「确认操作」', () => {
    reset();
    const s = useConfirmStore.getState();
    const p = s.confirm('默认标题');
    expect(useConfirmStore.getState().title).toBe('确认操作');
    useConfirmStore.getState().settle(false);
    void p;
  });
});
