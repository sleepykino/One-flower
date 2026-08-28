import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  UsageService,
  createRecordingProvider,
  setSharedUsageService,
  getSharedUsageService
} from '../../src/services/usage/UsageService';
import type { UsageEntry } from '../../src/services/usage/UsageService';
import type { LLMProvider, ChatResponse } from '../../src/services/ai/providers/LLMProvider';
import type { Database } from '../../src/db/Database';
import type { WriteQueue } from '../../src/db/WriteQueue';
import type { AppSettingsService } from '../../src/services/settings/AppSettingsService';
import type { NativeBridge } from '../../src/native/NativeBridge';

// G4 AI 用量统计：流水写入走 WriteQueue + 装饰器三种记账口径（API usage / 缺失估算 / 流式估算）

function createUsageFixture() {
  const inserts: Array<{ sql: string; params?: unknown[] }> = [];
  const settingsStore = new Map<string, string>();
  const settings = {
    get: vi.fn(async (key: string) => settingsStore.get(key) ?? null),
    set: vi.fn(async (key: string, value: string | null) => {
      if (value === null) settingsStore.delete(key);
      else settingsStore.set(key, value);
    })
  };
  const db = {
    exec: vi.fn(async (sql: string, params?: unknown[]) => {
      inserts.push({ sql, params });
    }),
    query: vi.fn(async (): Promise<Record<string, unknown>[]> => []),
    queryOne: vi.fn(async (): Promise<Record<string, unknown> | null> => null)
  } as unknown as Database;
  const wq = {
    enqueue: vi.fn(async <T,>(fn: () => Promise<T>): Promise<T> => fn())
  } as unknown as WriteQueue;
  const bridge = {} as NativeBridge;
  const svc = new UsageService(bridge, db, wq, settings as unknown as AppSettingsService);
  return { svc, inserts, db, wq, settings, settingsStore };
}

describe('UsageService 记账', () => {
  it('record 经 WriteQueue 写入完整字段', async () => {
    const { svc, inserts, wq } = createUsageFixture();
    const entry: UsageEntry = {
      bookId: 'b1',
      feature: 'continue',
      configId: 'cfg1',
      model: 'test-model',
      promptTokens: 1200,
      completionTokens: 300,
      estimated: false
    };
    await svc.record(entry);
    expect(wq.enqueue).toHaveBeenCalledTimes(1);
    expect(inserts).toHaveLength(1);
    expect(inserts[0].sql).toContain('INSERT INTO ai_usage');
    expect(inserts[0].params).toHaveLength(8);
    expect(inserts[0].params![5]).toBe(1200);
    expect(inserts[0].params![6]).toBe(300);
    expect(inserts[0].params![7]).toBe(0);
  });

  it('写入失败只告警不抛错（不影响生成主路径）', async () => {
    const { svc, db } = createUsageFixture();
    (db.exec as ReturnType<typeof vi.fn>).mockRejectedValue(new Error('db locked'));
    await expect(
      svc.record({ feature: 'continue', promptTokens: 1, completionTokens: 1, estimated: true })
    ).resolves.toBeUndefined();
  });
});

describe('createRecordingProvider 记账口径', () => {
  const entries: UsageEntry[] = [];
  let svc: UsageService;

  beforeEach(() => {
    entries.length = 0;
    const db = {
      exec: vi.fn(async (_sql: string, params?: unknown[]) => {
        entries.push({
          bookId: params![1] == null ? null : String(params![1]),
          feature: String(params![2]),
          configId: String(params![3]),
          model: params![4] == null ? null : String(params![4]),
          promptTokens: Number(params![5]),
          completionTokens: Number(params![6]),
          estimated: params![7] === 1
        });
      }),
      query: vi.fn(async () => []),
      queryOne: vi.fn(async () => null)
    } as unknown as Database;
    const wq = { enqueue: vi.fn(async <T,>(fn: () => Promise<T>): Promise<T> => fn()) } as unknown as WriteQueue;
    svc = new UsageService({} as NativeBridge, db, wq, {
      get: vi.fn(async () => null),
      set: vi.fn(async () => undefined)
    } as unknown as AppSettingsService);
    setSharedUsageService(svc);
  });

  const rawProvider = (chatRes?: ChatResponse): LLMProvider => ({
    name: 'test',
    countTokens: (t) => Math.ceil(t.length / 3),
    chat: vi.fn(async () => chatRes ?? { content: '输出文本内容', usage: { promptTokens: 0, completionTokens: 0 } }),
    stream: async function* () {
      yield { delta: '你好', done: false };
      yield { delta: '世界', done: true };
    }
  });

  it('chat 带 API usage：精确入账（estimated=0）', async () => {
    const p = createRecordingProvider(
      rawProvider({ content: 'ok', usage: { promptTokens: 500, completionTokens: 120 } }),
      { bookId: 'b1', feature: 'continue', configId: 'c1' },
      svc
    );
    const res = await p.chat([{ role: 'user', content: '写一段' }], { model: 'm1' });
    expect(res.content).toBe('ok');
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({
      feature: 'continue',
      model: 'm1',
      promptTokens: 500,
      completionTokens: 120,
      estimated: false
    });
  });

  it('chat 缺失 usage：按字符估算（estimated=1）', async () => {
    const p = createRecordingProvider(rawProvider(), { bookId: null, feature: 'summary', configId: 'c2' }, svc);
    await p.chat([{ role: 'user', content: '123456789' }], { model: 'm2' });
    expect(entries).toHaveLength(1);
    expect(entries[0].estimated).toBe(true);
    expect(entries[0].promptTokens).toBeGreaterThan(0);
    expect(entries[0].completionTokens).toBeGreaterThan(0);
    expect(entries[0].bookId).toBeNull();
  });

  it('stream 无 usage：累计输出估算入账，chunk 透传不变', async () => {
    const p = createRecordingProvider(rawProvider(), { bookId: 'b2', feature: 'rewrite', configId: 'c3' }, svc);
    const chunks: string[] = [];
    for await (const chunk of p.stream([{ role: 'user', content: '改写这段' }], { model: 'm3' })) {
      chunks.push(chunk.delta);
    }
    expect(chunks).toEqual(['你好', '世界']);
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ feature: 'rewrite', model: 'm3', estimated: true });
    expect(entries[0].completionTokens).toBeGreaterThan(0);
  });

  it('共享单例：set / get', () => {
    expect(getSharedUsageService()).toBe(svc);
    setSharedUsageService(null);
    expect(getSharedUsageService()).toBeNull();
  });
});

describe('UsageService 保留期与清理', () => {
  function createPruneFixture(queryOneImpl: () => Record<string, unknown> | null) {
    const settingsStore = new Map<string, string>();
    const settings = {
      get: vi.fn(async (key: string) => settingsStore.get(key) ?? null),
      set: vi.fn(async (key: string, value: string | null) => {
        if (value === null) settingsStore.delete(key);
        else settingsStore.set(key, value);
      })
    };
    const execs: Array<{ sql: string; params?: unknown[] }> = [];
    const db = {
      exec: vi.fn(async (sql: string, params?: unknown[]) => {
        execs.push({ sql, params });
      }),
      query: vi.fn(async () => []),
      queryOne: vi.fn(async () => queryOneImpl())
    } as unknown as Database;
    const wq = { enqueue: vi.fn(async <T,>(fn: () => Promise<T>): Promise<T> => fn()) } as unknown as WriteQueue;
    const svc = new UsageService({} as NativeBridge, db, wq, settings as unknown as AppSettingsService);
    return { svc, settings, settingsStore, execs };
  }

  it('保留期默认 90 天，非法值回退；0 = 永久可存取', async () => {
    const { svc, settingsStore } = createPruneFixture(() => null);
    expect(await svc.getRetentionDays()).toBe(90);
    settingsStore.set('usage.retentionDays', '180');
    expect(await svc.getRetentionDays()).toBe(180);
    settingsStore.set('usage.retentionDays', 'abc');
    expect(await svc.getRetentionDays()).toBe(90);
    await svc.setRetentionDays(0);
    expect(await svc.getRetentionDays()).toBe(0);
  });

  it('prune 删除过期行并把 token 合计并入累计锚点', async () => {
    const { svc, settings, settingsStore, execs } = createPruneFixture(() => ({ c: 5, t: 970 }));
    const r = await svc.prune(30);
    expect(r).toEqual({ deleted: 5, tokens: 970 });
    expect(execs.some((e) => e.sql.startsWith('DELETE FROM ai_usage'))).toBe(true);
    expect(settings.set).toHaveBeenCalledWith('usage.prunedTokens', '970');
    expect(settingsStore.get('usage.prunedTokens')).toBe('970');
  });

  it('锚点累加：多次清理累计不缩水', async () => {
    const { svc, settingsStore } = createPruneFixture(() => ({ c: 2, t: 300 }));
    settingsStore.set('usage.prunedTokens', '970');
    await svc.prune(30);
    expect(settingsStore.get('usage.prunedTokens')).toBe('1270');
  });

  it('无过期行时不写锚点；保留期 0 为永久（no-op）', async () => {
    const none = createPruneFixture(() => ({ c: 0, t: 0 }));
    expect(await none.svc.prune(30)).toEqual({ deleted: 0, tokens: 0 });
    expect(none.settings.set).not.toHaveBeenCalled();
    const forever = createPruneFixture(() => ({ c: 9, t: 999 }));
    expect(await forever.svc.prune(0)).toEqual({ deleted: 0, tokens: 0 });
    expect(forever.execs).toHaveLength(0);
  });

  it('clearAll 使用未来 cutoff 清空全部并并入锚点', async () => {
    const { svc, settingsStore, execs } = createPruneFixture(() => ({ c: 1, t: 973 }));
    const r = await svc.clearAll();
    expect(r).toEqual({ deleted: 1, tokens: 973 });
    expect(execs[0].params![0]).toBeGreaterThan(Date.now());
    expect(settingsStore.get('usage.prunedTokens')).toBe('973');
  });

  it('totals 计入清理锚点（累计不缩水）', async () => {
    const { svc, settingsStore } = createPruneFixture(() => ({ t: 500, c: 1 }));
    settingsStore.set('usage.prunedTokens', '473');
    const t = await svc.totals();
    expect(t.total).toBe(973);
    expect(t.today).toBe(500);
  });
});
