import { describe, expect, it, vi } from 'vitest';
import { BookService, rowToBook } from '../../src/services/book/BookService';
import type { NativeBridge } from '../../src/native/NativeBridge';
import type { Database } from '../../src/db/Database';
import type { WriteQueue } from '../../src/db/WriteQueue';

// P6 M1/M3：BookService 软删除语义与书架管理（trash 只动一列 / purge 全量硬删 / reorder 单事务 / 启动清理）
// 全部经 mock db/wq/bridge 断言 SQL 行为，不起真库

type Row = Record<string, unknown>;

interface ExecCall {
  sql: string;
  params?: unknown[];
}

function createFixture() {
  const execCalls: ExecCall[] = [];
  const txCalls: ExecCall[] = [];
  const txCount = { n: 0 };
  const deletedPaths: string[] = [];
  const queryImpl = vi.fn(async (): Promise<Row[]> => []);
  const queryOneImpl = vi.fn(async (): Promise<Row | null> => null);

  const db = {
    query: queryImpl,
    queryOne: queryOneImpl,
    exec: vi.fn(async (sql: string, params?: unknown[]): Promise<void> => {
      execCalls.push({ sql, params });
    }),
    transaction: vi.fn(
      async (fn: (tx: { exec: (sql: string, params?: unknown[]) => Promise<void> }) => Promise<void>): Promise<void> => {
        txCount.n += 1;
        await fn({
          exec: async (sql: string, params?: unknown[]): Promise<void> => {
            txCalls.push({ sql, params });
          }
        });
      }
    )
  } as unknown as Database;

  const wq = {
    enqueue: vi.fn(async <T,>(fn: () => Promise<T>): Promise<T> => fn())
  } as unknown as WriteQueue;

  const bridge = {
    storage: { appDataDir: vi.fn(async () => '/appdata') },
    fs: {
      ensureDir: vi.fn(async () => undefined),
      deletePath: vi.fn(async (p: string) => {
        deletedPaths.push(p);
      })
    }
  } as unknown as NativeBridge;

  const svc = new BookService(bridge as never, db, wq);
  return { svc, queryImpl, queryOneImpl, execCalls, txCalls, txCount, deletedPaths };
}

const BOOK_ROW: Row = {
  id: 'b1',
  title: 'T',
  genre: 'g',
  author: 'a',
  cover_path: null,
  storage_dir: '/appdata/books/b1',
  enabled_skills: '[]',
  provider_config_id: null,
  pinned: 1,
  sort_order: 5,
  deleted_at: null,
  created_at: 1,
  updated_at: 2
};

describe('rowToBook（P6 新列映射）', () => {
  it('映射 pinned/sortOrder/deletedAt 与聚合统计，缺列容错', () => {
    const book = rowToBook({
      ...BOOK_ROW,
      chapter_count: 3,
      total_words: 4567
    });
    expect(book.pinned).toBe(true);
    expect(book.sortOrder).toBe(5);
    expect(book.deletedAt).toBeNull();
    expect(book.chapterCount).toBe(3);
    expect(book.totalWords).toBe(4567);

    // 旧数据（无新列）不炸，回默认值
    const legacy = rowToBook({ ...BOOK_ROW, pinned: undefined, sort_order: undefined, deleted_at: undefined });
    expect(legacy.pinned).toBe(false);
    expect(legacy.sortOrder).toBe(0);
    expect(legacy.deletedAt).toBeNull();
  });
});

describe('BookService.trash / restore（软删除零触碰）', () => {
  it('trash 仅 UPDATE deleted_at 一列，不产生 DELETE、不动目录', async () => {
    const { svc, execCalls, txCalls, deletedPaths } = createFixture();
    await svc.trash('b1');
    expect(execCalls).toHaveLength(1);
    expect(execCalls[0].sql).toContain('UPDATE books SET deleted_at = ?');
    expect(execCalls[0].sql).not.toContain('DELETE');
    expect(execCalls[0].params?.[1]).toBe('b1');
    expect(txCalls).toHaveLength(0);
    expect(deletedPaths).toHaveLength(0);
  });

  it('restore 置 NULL', async () => {
    const { svc, execCalls } = createFixture();
    await svc.restore('b1');
    expect(execCalls[0].sql).toContain('SET deleted_at = NULL');
  });
});

describe('BookService.purge（原硬删全量逻辑）', () => {
  it('单事务手动清 FTS/级联表 + 删 books 行 + 递归删 storageDir', async () => {
    const { svc, queryOneImpl, txCalls, deletedPaths } = createFixture();
    queryOneImpl.mockResolvedValue(BOOK_ROW);
    await svc.purge('b1');
    const sqls = txCalls.map((c) => c.sql);
    expect(sqls[0]).toContain('DELETE FROM chapters_fts');
    expect(sqls.some((s) => s.includes('DELETE FROM chapters WHERE book_id'))).toBe(true);
    expect(sqls.some((s) => s.includes('DELETE FROM books WHERE id'))).toBe(true);
    expect(deletedPaths).toEqual(['/appdata/books/b1']);
  });

  it('书不存在时为 no-op（不删目录）', async () => {
    const { svc, txCalls, deletedPaths } = createFixture();
    await svc.purge('missing');
    expect(txCalls).toHaveLength(0);
    expect(deletedPaths).toHaveLength(0);
  });
});

describe('BookService.list / listDeleted（过滤 + 聚合）', () => {
  it('list 过滤 deleted_at IS NULL 且 SQL 含章节数/字数聚合子查询', async () => {
    const { svc, queryImpl } = createFixture();
    queryImpl.mockResolvedValue([{ ...BOOK_ROW, chapter_count: 2, total_words: 100 }]);
    const books = await svc.list();
    const sql = String(queryImpl.mock.calls[0][0]);
    expect(sql).toContain('deleted_at IS NULL');
    expect(sql).toContain('chapter_count');
    expect(sql).toContain('total_words');
    expect(books[0].chapterCount).toBe(2);
    expect(books[0].totalWords).toBe(100);
  });

  it('listDeleted 过滤 deleted_at IS NOT NULL 且按删除时间倒序', async () => {
    const { svc, queryImpl } = createFixture();
    queryImpl.mockResolvedValue([]);
    await svc.listDeleted();
    const sql = String(queryImpl.mock.calls[0][0]);
    expect(sql).toContain('deleted_at IS NOT NULL');
    expect(sql).toContain('ORDER BY b.deleted_at DESC');
  });
});

describe('BookService.cleanupExpired（启动清理）', () => {
  it('retentionDays<=0（永久保留）直接返回 0 不查询', async () => {
    const { svc, queryImpl } = createFixture();
    expect(await svc.cleanupExpired(0)).toBe(0);
    expect(queryImpl).not.toHaveBeenCalled();
  });

  it('超期书逐本 purge（每本一个事务 + 删目录）', async () => {
    const { svc, queryImpl, queryOneImpl, txCount, deletedPaths } = createFixture();
    queryImpl.mockResolvedValue([{ id: 'x' }, { id: 'y' }]);
    queryOneImpl.mockResolvedValue({ ...BOOK_ROW, id: 'x', storage_dir: '/appdata/books/x' });
    const n = await svc.cleanupExpired(30);
    expect(n).toBe(2);
    expect(txCount.n).toBe(2);
    expect(deletedPaths).toEqual(['/appdata/books/x', '/appdata/books/x']);
  });
});

describe('BookService.setPinned / reorder（M3 书架管理）', () => {
  it('setPinned 不刷 updated_at', async () => {
    const { svc, execCalls } = createFixture();
    await svc.setPinned('b1', true);
    expect(execCalls[0].sql).toContain('UPDATE books SET pinned = ?');
    expect(execCalls[0].sql).not.toContain('updated_at');
    expect(execCalls[0].params).toEqual([1, 'b1']);
  });

  it('reorder 单事务批量回写 sort_order（index 序）', async () => {
    const { svc, txCalls, txCount } = createFixture();
    await svc.reorder(['a', 'b', 'c']);
    expect(txCount.n).toBe(1);
    expect(txCalls.map((c) => c.params)).toEqual([
      [0, 'a'],
      [1, 'b'],
      [2, 'c']
    ]);
  });
});
