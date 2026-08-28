/**
 * 批次8建议1（2026-08-29）：编辑保存链路竞态 + 防抖过期闭包跨集写错
 *
 * 内存桩 + 真实 WriteQueue 验证 ScreenplayService 修复：
 *   - mutate 读-改-写整体入队列：并发结构操作串行化，不再「后写覆盖先写」丢更新
 *   - saveScene 按 sceneId 全局定位：场所在集变化也能正确更新
 *   - saveScene 移除 push 兜底：找不到目标场即失败，不把场复制进错误集
 *   - saveScene baseJson 校验：目标场已被外部改动时拒绝覆盖（切场/外部改动保护）
 */
import { describe, expect, it } from 'vitest';
import type { DatabaseAdapter, NativeBridge } from '../../src/native/NativeBridge';
import type { Database } from '../../src/db/Database';
import { WriteQueue } from '../../src/db/WriteQueue';
import { ScreenplayService } from '../../src/services/screenplay/ScreenplayService';
import type { ScreenplayDoc, Scene } from '../../src/services/screenplay/types';

function scene(id: string, synopsis = ''): Scene {
  return { id, interior: 'INT', location: 'L', timeOfDay: '日', synopsis, shots: [], status: 'outline' };
}

/** 内存桩：queryOne 返回当前行，exec 应用 save 的 UPDATE（data 为第 4 参、updated_at 为第 5 参） */
function makeHarness(doc: ScreenplayDoc): { svc: ScreenplayService; read: () => ScreenplayDoc; update: (d: ScreenplayDoc) => void } {
  let row = {
    id: 'sp1',
    book_id: 'b1',
    title: 'T',
    status: 'draft',
    source_range: null,
    data: JSON.stringify(doc),
    created_at: 0,
    updated_at: 0
  };
  const db = {
    queryOne: async <T>(): Promise<T | null> => row as unknown as T,
    exec: async (_sql: string, params?: unknown[]): Promise<void> => {
      row = { ...row, data: String(params?.[3] ?? row.data), updated_at: Number(params?.[4] ?? row.updated_at) };
    }
  } as unknown as Database;
  const bridge = {} as unknown as NativeBridge;
  const wq = new WriteQueue(db as unknown as DatabaseAdapter);
  const svc = new ScreenplayService(bridge, db, wq);
  const read = (): ScreenplayDoc => JSON.parse(row.data) as ScreenplayDoc;
  const update = (d: ScreenplayDoc): void => {
    row = { ...row, data: JSON.stringify(d) };
  };
  return { svc, read, update };
}

describe('批次8建议1：编辑保存链路竞态 + saveScene 全局定位/去 push 兜底', () => {
  it('mutate 读-改-写整体入队列：并发两次加场不丢更新', async () => {
    const { svc, read } = makeHarness({ episodes: [{ id: 'ep1', number: 1, title: '第1集', scenes: [scene('s0')] }] });
    const [a, b] = await Promise.all([svc.addScene('sp1', 'ep1'), svc.addScene('sp1', 'ep1')]);
    const ep = read().episodes[0];
    // 串行化后两场都落库（旧实现「get 在队列外」会互相同读旧快照，后写覆盖先写丢一场）
    expect(ep.scenes).toHaveLength(3);
    const ids = ep.scenes.map((s) => s.id);
    expect(ids).toContain(a!.scene.id);
    expect(ids).toContain(b!.scene.id);
  });

  it('saveScene 按 sceneId 全局定位：场所在集变化也能正确更新', async () => {
    const { svc, read } = makeHarness({
      episodes: [
        { id: 'ep1', number: 1, title: 'A', scenes: [scene('sA')] },
        { id: 'ep2', number: 2, title: 'B', scenes: [scene('sB')] }
      ]
    });
    const sp = await svc.saveScene('sp1', { ...scene('sA'), synopsis: 'A改' });
    expect(sp).not.toBeNull();
    const doc = read();
    expect(doc.episodes[0].scenes.find((s) => s.id === 'sA')!.synopsis).toBe('A改');
    expect(doc.episodes[0].scenes).toHaveLength(1);
    expect(doc.episodes[1].scenes.map((s) => s.id)).toEqual(['sB']);
  });

  it('saveScene 找不到目标场即失败，不做 push 兜底（不复制进错误集）', async () => {
    const { svc, read } = makeHarness({ episodes: [{ id: 'ep1', number: 1, title: 'A', scenes: [scene('sA')] }] });
    const sp = await svc.saveScene('sp1', { ...scene('ghost'), synopsis: '不存在' });
    expect(sp).toBeNull();
    const doc = read();
    expect(doc.episodes[0].scenes).toHaveLength(1);
    expect(doc.episodes[0].scenes[0].id).toBe('sA');
  });

  it('saveScene baseJson 校验：目标场被外部改动后拒绝覆盖（切场/外部改动保护）', async () => {
    const { svc, read, update } = makeHarness({ episodes: [{ id: 'ep1', number: 1, title: 'A', scenes: [scene('sA')] }] });
    const base = JSON.stringify(scene('sA'));
    // 正常保存 A→A2
    const ok = await svc.saveScene('sp1', { ...scene('sA'), synopsis: 'A2' }, base);
    expect(ok).not.toBeNull();
    expect(read().episodes[0].scenes[0].synopsis).toBe('A2');
    // 外部把 sA 覆盖为 A_ext（模拟 AI 生成/恢复落库），再用旧 base 提交 A3 → 失败且不覆盖
    update({ episodes: [{ id: 'ep1', number: 1, title: 'A', scenes: [{ ...scene('sA'), synopsis: 'A_ext' }] }] });
    const sp = await svc.saveScene('sp1', { ...scene('sA'), synopsis: 'A3' }, base);
    expect(sp).toBeNull();
    expect(read().episodes[0].scenes[0].synopsis).toBe('A_ext');
  });
});
