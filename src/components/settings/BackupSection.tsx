/**
 * 备份与恢复子页（P2 三期）：全书备份导出 + 备份导入集中入口
 * 导出复用 ExportService.exportBook('backup')；导入复用 ImportService（原书架入口保留）
 */

import { useEffect, useState } from 'react';
import { open, save } from '@tauri-apps/plugin-dialog';
import { useBookStore } from '../../store/bookStore';
import { getAppContext } from '../../context/app-context';

export function BackupSection(): JSX.Element {
  const books = useBookStore((s) => s.books);
  const loadBooks = useBookStore((s) => s.loadBooks);
  const [bookId, setBookId] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportMsg, setExportMsg] = useState('');
  const [importMsg, setImportMsg] = useState('');
  const [importing, setImporting] = useState(false);

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

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

      <p className="mt-3 text-[11px] leading-5 text-ink-400">
        正文格式导出（Markdown / TXT / EPUB / Word）在编辑器「导出」对话框中；书架页也保留了备份导入入口。
      </p>
    </div>
  );
}
