/**
 * P6 M1 回收站列表：已删书籍行列表（恢复 / 彻底删除）+ 保留剩余天数
 * 数据由 BookService.listDeleted 提供（books 行原地保留，恢复零损耗）
 * 彻底删除走 PurgeConfirmDialog：可选勾选联动清理自动备份文件（P6 补充）
 */

import { useMemo, useState } from 'react';
import { RotateCcw, Trash2 } from 'lucide-react';
import { resolveAssetUrl } from '../../utils/assetUrl';
import { getAppContext } from '../../context/app-context';
import { toast } from '../common/toast';
import { PurgeConfirmDialog } from './PurgeConfirmDialog';
import type { Book } from '../../types';

/** 字数格式化：>=1 万显示 X.X 万，否则原值 */
export function formatWordCount(n: number | undefined): string {
  if (n == null) return '0 字';
  if (n < 10000) return `${n} 字`;
  return `${(n / 10000).toFixed(1)} 万字`;
}

/** 剩余保留天数：永久（<=0）显示 null */
function remainingDays(deletedAt: number, retentionDays: number): number | null {
  if (retentionDays <= 0) return null;
  const elapsed = Date.now() - deletedAt;
  return Math.max(0, Math.ceil((retentionDays * 24 * 60 * 60 * 1000 - elapsed) / (24 * 60 * 60 * 1000)));
}

export function TrashList({
  books,
  retentionDays,
  onChanged
}: {
  books: Book[];
  retentionDays: number;
  onChanged: () => Promise<void>;
}): JSX.Element {
  const { bookService } = getAppContext();
  // P6 补充：彻底删除确认对话框状态（backupCount null = 查询中）
  const [purgeTarget, setPurgeTarget] = useState<Book | null>(null);
  const [purgeBackupCount, setPurgeBackupCount] = useState<number | null>(null);
  const [purging, setPurging] = useState(false);

  const restore = async (book: Book): Promise<void> => {
    try {
      await bookService.restore(book.id);
      toast.success(`《${book.title}》已恢复到书架`);
      await onChanged();
    } catch (e) {
      toast.error(`恢复失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** 打开彻底删除确认框，并异步查询该书自动备份数量 */
  const startPurge = (book: Book): void => {
    setPurgeTarget(book);
    setPurgeBackupCount(null);
    void getAppContext()
      .autoBackupService.listBookBackups(book)
      .then((names) => setPurgeBackupCount(names.length))
      .catch(() => setPurgeBackupCount(0));
  };

  const confirmPurge = async (deleteBackups: boolean): Promise<void> => {
    if (!purgeTarget) return;
    setPurging(true);
    try {
      await bookService.purge(purgeTarget.id);
      let backupNote = '';
      if (deleteBackups && (purgeBackupCount ?? 0) > 0) {
        const n = await getAppContext().autoBackupService.purgeBookBackups(purgeTarget);
        if (n > 0) backupNote = `，并删除 ${n} 个自动备份文件`;
      }
      toast.info(`《${purgeTarget.title}》已彻底删除${backupNote}`);
      setPurgeTarget(null);
      await onChanged();
    } catch (e) {
      toast.error(`删除失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setPurging(false);
    }
  };

  const rows = useMemo(
    () =>
      books.map((b) => ({
        book: b,
        remaining: remainingDays(b.deletedAt ?? Date.now(), retentionDays)
      })),
    [books, retentionDays]
  );

  if (books.length === 0) {
    return (
      <div className="rounded-lg border-2 border-dashed border-ink-200 p-16 text-center text-ink-400">
        回收站是空的
      </div>
    );
  }

  return (
    <>
      <div className="overflow-hidden rounded-lg border border-ink-200 bg-white">
        {rows.map(({ book, remaining }, i) => {
        const coverUrl = book.coverPath
          ? resolveAssetUrl(`${book.storageDir.replace(/\\/g, '/')}/${book.coverPath.replace(/\\/g, '/')}`)
          : null;
        return (
          <div
            key={book.id}
            className={`flex items-center gap-3 px-4 py-3 ${i > 0 ? 'border-t border-ink-100' : ''}`}
          >
            <div className="h-14 w-10 shrink-0 overflow-hidden rounded">
              {coverUrl ? (
                <img src={coverUrl} alt={book.title} className="h-full w-full object-cover" />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-gradient-to-br from-violet-200 to-sky-200 text-xs font-bold text-white">
                  {book.title.slice(0, 2)}
                </div>
              )}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{book.title}</div>
              <div className="text-xs text-ink-400">
                {[book.genre, book.author].filter(Boolean).join(' · ') || '未设置类型'}
                {book.chapterCount != null && (
                  <>
                    {' · '}
                    {book.chapterCount} 章 · {formatWordCount(book.totalWords)}
                  </>
                )}
              </div>
              <div className="mt-0.5 text-[11px] text-ink-300">
                删除于 {new Date(book.deletedAt ?? Date.now()).toLocaleString()}
                {remaining != null && (
                  <span className={remaining <= 3 ? 'ml-1 text-red-500' : 'ml-1'}>
                    （剩余 {remaining} 天自动清理）
                  </span>
                )}
              </div>
            </div>
            <div className="flex shrink-0 gap-2">
              <button
                type="button"
                className="flex items-center gap-1 rounded border border-ink-200 px-2.5 py-1 text-xs hover:bg-ink-100"
                onClick={() => void restore(book)}
              >
                <RotateCcw size={13} />
                恢复
              </button>
              <button
                type="button"
                className="flex items-center gap-1 rounded border border-ink-200 px-2.5 py-1 text-xs text-red-600 hover:border-red-300 hover:bg-red-50"
                onClick={() => startPurge(book)}
              >
                <Trash2 size={13} />
                彻底删除
              </button>
            </div>
          </div>
        );
      })}
    </div>

      {/* P6 补充：彻底删除确认（可选联动清理自动备份） */}
      {purgeTarget && (
        <PurgeConfirmDialog
          title="彻底删除"
          message={`确认彻底删除《${purgeTarget.title}》？\n\n该操作不可恢复，书籍数据与本地文件将被永久删除。`}
          backupCount={purgeBackupCount}
          busy={purging}
          onConfirm={(deleteBackups) => void confirmPurge(deleteBackups)}
          onCancel={() => setPurgeTarget(null)}
        />
      )}
    </>
  );
}
