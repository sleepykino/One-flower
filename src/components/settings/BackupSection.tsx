/**
 * 备份与恢复子页（P2 三期）：全书备份导出 + 备份导入集中入口
 * 导出复用 ExportService.exportBook('backup')；导入复用 ImportService（原书架入口保留）
 * P6 M2：新增「自动备份」小节（开关/间隔/目录/保留份数/立即备份，全部实时保存到 app_settings）
 */

import { useEffect, useState } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { invoke } from '@tauri-apps/api/core';
import { useBookStore } from '../../store/bookStore';
import { getAppContext } from '../../context/app-context';
import { toast } from '../common/toast';
import type { AutoBackupSettings } from '../../services/backup/AutoBackupService';

/** 备份间隔选项（小时） */
const INTERVAL_OPTIONS: Array<{ value: number; label: string }> = [
  { value: 6, label: '每 6 小时' },
  { value: 12, label: '每 12 小时' },
  { value: 24, label: '每 24 小时' },
  { value: 72, label: '每 3 天' },
  { value: 168, label: '每 7 天' }
];

export function BackupSection(): JSX.Element {
  const books = useBookStore((s) => s.books);
  const loadBooks = useBookStore((s) => s.loadBooks);
  const [bookId, setBookId] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [importing, setImporting] = useState(false);
  const [autoSettings, setAutoSettings] = useState<AutoBackupSettings | null>(null);
  const [lastRunAt, setLastRunAt] = useState<number | null>(null);

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  // P6：加载自动备份设置与最近备份时间
  useEffect(() => {
    void (async () => {
      const { autoBackupService } = getAppContext();
      setAutoSettings(await autoBackupService.getSettings());
      setLastRunAt(await autoBackupService.getLastRunAt());
    })().catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!bookId && books.length > 0) setBookId(books[0].id);
  }, [books, bookId]);

  const exportBackup = async (): Promise<void> => {
    if (!bookId) {
      setExportMsg('暂无可备份的书籍');
      return;
    }
    const book = books.find((b) => b.id === bookId);
    const path = await save({
      defaultPath: `${book?.title ?? 'book'}.zip`,
      filters: [{ name: '备份包', extensions: ['zip'] }]
    });
    if (!path) return;
    setExporting(true);
    setExportMsg('备份中…');
    try {
      await getAppContext().exportService.exportBook(bookId, 'backup', path, (i, total) => {
        setExportMsg(`备份中… ${i}/${total} 章`);
      });
      setExportMsg(`备份完成：${path}`);
    } catch (e) {
      setExportMsg(`备份失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setExporting(false);
    }
  };

  const importBackup = async (): Promise<void> => {
    const path = await open({
      multiple: false,
      filters: [{ name: '备份包', extensions: ['zip'] }]
    });
    if (typeof path !== 'string') return;
    setImporting(true);
    setImportMsg('导入中…');
    try {
      const check = await getAppContext().importService.validateBackup(path);
      if (!check.valid) {
        setImportMsg(`备份包校验失败：${check.errors.join('；')}`);
        return;
      }
      const r = await getAppContext().importService.importBackup(path);
      setImportMsg(`导入成功：${r.chapterCount} 章`);
      await loadBooks();
    } catch (e) {
      setImportMsg(`导入失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImporting(false);
    }
  };

  /** P6：保存自动备份设置（实时保存，diff 写回） */
  const saveAuto = async (patch: Partial<AutoBackupSettings>): Promise<void> => {
    const { autoBackupService } = getAppContext();
    await autoBackupService.saveSettings(patch);
    setAutoSettings(await autoBackupService.getSettings());
  };

  /** P6：更换备份目录（系统目录选择对话框） */
  const changeBackupDir = async (): Promise<void> => {
    const dir = await open({ directory: true, multiple: false });
    if (typeof dir !== 'string' || !dir.trim()) return;
    await saveAuto({ dir: dir.replace(/\\/g, '/') });
    toast.success('备份目录已更新');
  };

  /** P6：立即备份（任务中心托管，进度见底部任务面板） */
  const runBackupNow = async (): Promise<void> => {
    const { autoBackupService } = getAppContext();
    try {
      await autoBackupService.run();
      setLastRunAt(await autoBackupService.getLastRunAt());
      toast.info('正在备份');
    } catch (e) {
      toast.error(`启动备份失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div>
      <h2 className="mb-1 font-medium">备份与恢复</h2>
      <p className="mb-3 text-xs leading-5 text-ink-400">
        备份包含章节正文、章节树、角色卡、世界书与伏笔，用于设备迁移或误删恢复。
        迁移设备时：旧设备导出 → 新设备导入。
      </p>

      {/* 导出 */}
      <div className="rounded border border-ink-100 bg-white px-3 py-3">
        <div className="mb-1 text-xs font-medium text-ink-600">导出备份</div>
        <div className="flex gap-2">
          <select
            value={bookId}
            onChange={(e) => setBookId(e.target.value)}
            className="min-w-0 flex-1 rounded border border-ink-200 px-2 py-1.5 text-sm"
          >
            {books.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title}
              </option>
            ))}
            {books.length === 0 && <option value="">暂无书籍</option>}
          </select>
          <button
            type="button"
            disabled={exporting || books.length === 0}
            className="shrink-0 rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
            onClick={() => void exportBackup()}
          >
            {exporting ? '备份中…' : '导出备份'}
          </button>
        </div>
        {exportMsg && <div className="mt-1.5 break-all text-xs text-ink-500">{exportMsg}</div>}
      </div>

      {/* 导入 */}
      <div className="mt-3 rounded border border-ink-100 bg-white px-3 py-3">
        <div className="mb-1 text-xs font-medium text-ink-600">导入备份</div>
        <p className="mb-2 text-[11px] leading-5 text-ink-400">
          导入会创建一本新书（不覆盖现有书籍）；同名书籍可重复导入为多本。
        </p>
        <div className="flex items-center gap-2">
          <button
            type="button"
            disabled={importing}
            className="rounded border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100 disabled:opacity-40"
            onClick={() => void importBackup()}
          >
            {importing ? '导入中…' : '选择备份包导入'}
          </button>
          {importMsg && <span className="min-w-0 flex-1 truncate text-xs text-ink-500">{importMsg}</span>}
        </div>
      </div>

      {/* P6：自动备份 */}
      <div className="mt-3 rounded border border-ink-100 bg-white px-3 py-3">
        <div className="mb-1 text-xs font-medium text-ink-600">自动备份</div>
        <p className="mb-2 text-[11px] leading-5 text-ink-400">
          定期把全部书籍备份为与手动备份格式一致的 zip（可随时在书架导入恢复）；已删除书籍不参与备份。
        </p>
        {autoSettings ? (
          <div className="space-y-2">
            <div className="flex items-center gap-2">
              <label className="flex items-center gap-1.5 text-sm">
                <input
                  type="checkbox"
                  checked={autoSettings.enabled}
                  onChange={(e) => void saveAuto({ enabled: e.target.checked })}
                />
                启用自动备份
              </label>
              <select
                value={autoSettings.intervalHours}
                disabled={!autoSettings.enabled}
                onChange={(e) => void saveAuto({ intervalHours: Number(e.target.value) })}
                className="rounded border border-ink-200 px-2 py-1 text-xs disabled:opacity-40"
              >
                {INTERVAL_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <label className="ml-auto flex items-center gap-1 text-xs text-ink-500">
                每书保留
                <input
                  type="number"
                  min={1}
                  max={99}
                  value={autoSettings.keepPerBook}
                  disabled={!autoSettings.enabled}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (v >= 1) void saveAuto({ keepPerBook: Math.floor(v) });
                  }}
                  className="w-14 rounded border border-ink-200 px-1.5 py-0.5 text-xs disabled:opacity-40"
                />
                份
              </label>
            </div>
            <div className="flex items-center gap-2 text-xs">
              <span className="shrink-0 text-ink-500">备份目录</span>
              <span className="min-w-0 flex-1 truncate rounded bg-ink-50 px-2 py-1 text-ink-600" title={autoSettings.dir}>
                {autoSettings.dir}
              </span>
              <button
                type="button"
                className="shrink-0 rounded border border-ink-200 px-2 py-1 hover:bg-ink-100"
                onClick={() => void changeBackupDir()}
              >
                更改
              </button>
              <button
                type="button"
                className="shrink-0 rounded border border-ink-200 px-2 py-1 hover:bg-ink-100"
                onClick={() => void invoke('open_url', { url: autoSettings.dir }).catch(() => toast.error('打开目录失败'))}
              >
                打开目录
              </button>
            </div>
            <div className="flex items-center gap-2">
              <button
                type="button"
                disabled={books.length === 0}
                className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
                onClick={() => void runBackupNow()}
              >
                立即备份
              </button>
              <span className="min-w-0 flex-1 truncate text-xs text-ink-400">
                {lastRunAt != null ? `最近一次：${new Date(lastRunAt).toLocaleString()}` : '尚未执行过'}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-xs text-ink-400">加载中…</div>
        )}
      </div>

      <p className="mt-3 text-[11px] leading-5 text-ink-400">
        正文格式导出（Markdown / TXT / EPUB / Word）在编辑器「导出」对话框中；书架页也保留了备份导入入口。
      </p>
    </div>
  );
}
