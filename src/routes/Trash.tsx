/**
 * P6 M1 回收站页：已删书籍的恢复 / 彻底删除 / 清空 / 保留期设置
 * 保留期持久化 app_settings 键 trash.retentionDays（7/30/90 天，0 = 永久）
 * 清空回收站走 PurgeConfirmDialog：可选勾选联动清理这些书的自动备份文件（P6 补充）
 */

import { useCallback, useEffect, useState } from 'react';
import { Trash2 } from 'lucide-react';
import { getAppContext } from '../context/app-context';
import { toast } from '../components/common/toast';
import { HomeSidebar } from '../components/home/HomeSidebar';
import { TrashList } from '../components/home/TrashList';
import { PurgeConfirmDialog } from '../components/home/PurgeConfirmDialog';
import type { Book } from '../types';

const RETENTION_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 7, label: '7 天' },
  { value: 30, label: '30 天' },
  { value: 90, label: '90 天' },
  { value: 0, label: '永久保留' }
];

const RETENTION_KEY = 'trash.retentionDays';
const DEFAULT_RETENTION = 30;

export function Trash(): JSX.Element {
  const { bookService, appSettings } = getAppContext();
  const [books, setBooks] = useState<Book[]>([]);
  const [retention, setRetention] = useState<number>(DEFAULT_RETENTION);
  const [loading, setLoading] = useState(true);
  // P6 补充：清空回收站确认对话框状态（backupTotal null = 查询中）
  const [emptying, setEmptying] = useState(false);
  const [emptyBackupTotal, setEmptyBackupTotal] = useState<number | null>(null);
  const [emptyingBusy, setEmptyingBusy] = useState(false);

  const reload = useCallback(async (): Promise<void> => {
    try {
      setBooks(await bookService.listDeleted());
    } finally {
      setLoading(false);
    }
  }, [bookService]);

  useEffect(() => {
    void reload();
    void appSettings
      .get(RETENTION_KEY)
      .then((v) => {
        if (v != null) setRetention(Number(v));
      })
      .catch(() => undefined);
  }, [reload, appSettings]);

  const changeRetention = async (days: number): Promise<void> => {
    setRetention(days);
    try {
      await appSettings.set(RETENTION_KEY, String(days));
    } catch {
      // 设置写入失败不阻断（下次启动取回旧值）
    }
  };

  /** 打开清空确认框，并异步汇总这些书的自动备份总数 */
  const startEmpty = (): void => {
    if (books.length === 0) return;
    setEmptying(true);
    setEmptyBackupTotal(null);
    void (async () => {
      const { autoBackupService } = getAppContext();
      const lists = await Promise.all(books.map((b) => autoBackupService.listBookBackups(b)));
      setEmptyBackupTotal(lists.reduce((n, l) => n + l.length, 0));
    })().catch(() => setEmptyBackupTotal(0));
  };

  const confirmEmpty = async (deleteBackups: boolean): Promise<void> => {
    setEmptyingBusy(true);
    try {
      const n = await bookService.emptyTrash();
      let backupNote = '';
      if (deleteBackups && (emptyBackupTotal ?? 0) > 0) {
        const { autoBackupService } = getAppContext();
        let deleted = 0;
        for (const b of books) {
          deleted += await autoBackupService.purgeBookBackups(b);
        }
        if (deleted > 0) backupNote = `，并删除 ${deleted} 个自动备份文件`;
      }
      toast.info(`已清空回收站（${n} 本）${backupNote}`);
      setEmptying(false);
      await reload();
    } catch (e) {
      toast.error(`清空失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setEmptyingBusy(false);
    }
  };

  return (
    <div className="flex h-full">
      <HomeSidebar />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <header className="mx-auto flex max-w-4xl flex-wrap items-center justify-between gap-3 px-6 py-6">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-bold">
              <Trash2 size={22} className="text-ink-400" />
              回收站
            </h1>
            <p className="text-sm text-ink-500">
              已删书籍原地保留，可随时恢复；超过保留期将在启动时自动清理。
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-ink-500">
              保留期
              <select
                value={retention}
                onChange={(e) => void changeRetention(Number(e.target.value))}
                className="ml-1.5 rounded border border-ink-200 px-2 py-1 text-xs"
              >
                {RETENTION_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              type="button"
              disabled={books.length === 0}
              className="rounded border border-red-200 px-3 py-1.5 text-sm text-red-600 hover:bg-red-50 disabled:opacity-40"
              onClick={startEmpty}
            >
              清空回收站
            </button>
          </div>
        </header>

        <main className="mx-auto max-w-4xl px-6 pb-10">
          {loading ? (
            <div className="p-16 text-center text-ink-400">加载中…</div>
          ) : (
            <TrashList books={books} retentionDays={retention} onChanged={reload} />
          )}
        </main>
      </div>

      {/* P6 补充：清空回收站确认（可选联动清理自动备份） */}
      {emptying && (
        <PurgeConfirmDialog
          title="清空回收站"
          message={`确认清空回收站（共 ${books.length} 本）？\n\n该操作不可恢复，全部书籍数据与本地文件将被永久删除。`}
          backupCount={emptyBackupTotal}
          busy={emptyingBusy}
          onConfirm={(deleteBackups) => void confirmEmpty(deleteBackups)}
          onCancel={() => setEmptying(false)}
        />
      )}
    </div>
  );
}
