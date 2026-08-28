import { describe, expect, it, vi } from 'vitest';
import { LongFormService } from '../../src/services/longform/LongFormService';
import type { NativeBridge } from '../../src/native/NativeBridge';
import type { WriteQueue } from '../../src/db/WriteQueue';
import type { SeamIssue } from '../../src/services/longform/types';

// 优化建议记录 批次4建议2（2026-08-28）：
// seamIssues 仅存内存 Map，重启后清空 → status=done 会话 getSeamIssues 返回 []，面板④误显"未发现问题"。
// 现持久化到 longform_sessions.seams 列：saveSeamIssues 写库 + 同步内存；getSeamIssues 内存未命中回退读库。
// 全用 mock db/wq 断言 SQL 行为，不起真库。

type Row = Record<string, unknown>;

function makeFixture() {
  let rowOne: Row | null = null;
  const execCalls: Array<{ sql: string; params?: unknown[] }> = [];
  const queryImpl = vi.fn(async (_sql?: string): Promise<Row[]> => []);
  const queryOneImpl = vi.fn(async (_sql?: string): Promise<Row | null> => rowOne);
  const bridge = {
    db: {
      query: queryImpl,
      queryOne: queryOneImpl,
      exec: vi.fn(async (sql: string, params?: unknown[]): Promise<void> => {
        execCalls.push({ sql, params });
      })
    }
  } as unknown as NativeBridge;
  const wq = {
    enqueue: vi.fn(async <T,>(fn: () => Promise<T>): Promise<T> => fn())
  } as unknown as WriteQueue;
  const svc = new LongFormService(
    bridge,
    { wq },
    async () => ({}) as never,
    {} as never,
    {} as never,
    {} as never,
    {} as never
  );
  return { svc, bridge: bridge as unknown as { db: { query: typeof queryImpl } }, wq, execCalls, setRow: (r: Row | null) => { rowOne = r; } };
}

const ROW_BASE: Row = {
  id: 's1',
  book_id: 'b1',
  chapter_id: 'c1',
  status: 'done',
  beats: '[]',
  current_beat_index: 2,
  used_tokens: 100,
  estimated_tokens: 200,
  hints: '',
  character_ids: '[]',
  created_at: 1,
  updated_at: 2,
  seams: '[]'
};

describe('LongFormService 接缝持久化（批次4建议2）', () => {
  it('saveSeamIssues 写 seams 列并更新内存 Map，getSeamIssues 先命中内存', async () => {
    const { svc, execCalls } = makeFixture();
    const issues: SeamIssue[] = [{ beatIndex: 0, kind: 'tone', description: 'd', excerpt: 'e' }];
    await svc.saveSeamIssues('s1', issues);
    expect(execCalls[0].sql).toContain('UPDATE longform_sessions SET seams = ?');
    expect(execCalls[0].params?.[0]).toBe(JSON.stringify(issues));
    expect(execCalls[0].params?.[1]).toBe('s1');
    expect(await svc.getSeamIssues('s1')).toEqual(issues);
  });

  it('getSeamIssues 内存 Map 为空（重启后）时回退读落库 seams 列', async () => {
    const { svc, setRow } = makeFixture();
    const issues: SeamIssue[] = [{ beatIndex: 1, kind: 'timeline', description: 'x', excerpt: 'y' }];
    setRow({ ...ROW_BASE, seams: JSON.stringify(issues) });
    expect(await svc.getSeamIssues('s1')).toEqual(issues);
  });

  it('getSeamIssues 无落库 seams（旧库空列）时返回 []，不误报', async () => {
    const { svc, setRow } = makeFixture();
    setRow({ ...ROW_BASE, seams: null });
    expect(await svc.getSeamIssues('s1')).toEqual([]);
  });

  it('findDoneWithSeams 仅返回 status=done 且 seams 非空的遗留会话', async () => {
    const { svc, bridge } = makeFixture();
    const issues: SeamIssue[] = [{ beatIndex: 0, kind: 'other', description: 'd', excerpt: 'e' }];
    bridge.db.query.mockResolvedValue([{ ...ROW_BASE, seams: JSON.stringify(issues) }]);
    const s = await svc.findDoneWithSeams('b1');
    const sql = String(bridge.db.query.mock.calls[0][0]);
    expect(sql).toContain("status = 'done'");
    expect(sql).toContain('seams IS NOT NULL');
    expect(s?.seams).toEqual(issues);
  });
});