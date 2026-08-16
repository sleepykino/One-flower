/**
 * 导出对话框：单章/全书 + 格式选择 + 路径选择（Tauri 文件对话框）+ 进度显示
 */

import { useEffect, useState } from 'react';
import { save } from '@tauri-apps/plugin-dialog';
import { getAppContext } from '../../context/app-context';
import type { ExportFormat } from '../../services/export/ExportService';
import type { Chapter } from '../../types';

const FORMAT_LABEL: Record<ExportFormat, string> = {
  markdown: 'Markdown (.md)',
  txt: '纯文本 (.txt)',
  epub: 'EPUB 电子书 (.epub)',
  docx: 'Word 文档 (.docx)',
  backup: '备份包 (.zip)'
};

export function ExportDialog({ bookId, onClose }: { bookId: string; onClose: () => void }): JSX.Element | null {
  const chapters = useChapterList(bookId);
  const [scope, setScope] = useState<'book' | 'chapter'>('book');
  const [chapterId, setChapterId] = useState('');
  const [format, setFormat] = useState<ExportFormat>('markdown');
  const [progress, setProgress] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const run = async (): Promise<void> => {
    setError(null);
    setDone(null);
    try {
      const ext =
        format === 'markdown'
          ? 'md'
          : format === 'txt'
            ? 'txt'
            : format === 'epub'
              ? 'epub'
              : format === 'docx'
                ? 'docx'
                : 'zip';
      const defaultName =
        scope === 'book' ? `book.${ext}` : `${chapters.find((c) => c.id === chapterId)?.title ?? 'chapter'}.${ext}`;
      const path = await save({
        defaultPath: defaultName,
        filters: [{ name: FORMAT_LABEL[format], extensions: [ext] }]
      });
      if (!path) return;

      setProgress('准备导出…');
      const { exportService } = getAppContext();
      if (scope === 'book') {
        await exportService.exportBook(bookId, format, path, (i, total) => {
          setProgress(`导出中… ${i}/${total} 章`);
        });
      } else {
        if (!chapterId) {
          setError('请选择章节');
          return;
        }
        await exportService.exportChapter(chapterId, format, path);
      }
      setProgress(null);
      setDone(path);
    } catch (e) {
      setProgress(null);
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  return (
    <div className="fixed inset-0 z-40 flex items-center justify-center bg-black/30" onClick={progress ? undefined : onClose}>
      <div className="w-[420px] rounded-lg bg-white p-4 shadow-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-base font-medium">导出</div>

        <div className="mb-3">
          <div className="mb-1 text-xs font-medium text-ink-600">范围</div>
          <div className="flex gap-2">
            <label className="flex cursor-pointer items-center gap-1 text-sm">
              <input type="radio" checked={scope === 'book'} onChange={() => setScope('book')} />
              全书
            </label>
            <label className="flex cursor-pointer items-center gap-1 text-sm">
              <input type="radio" checked={scope === 'chapter'} onChange={() => setScope('chapter')} />
              单章
            </label>
          </div>
          {scope === 'chapter' && (
            <select
              value={chapterId}
              onChange={(e) => setChapterId(e.target.value)}
              className="mt-1 w-full rounded border border-ink-200 px-2 py-1 text-sm"
            >
              <option value="">选择章节…</option>
              {chapters.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.title}
                </option>
              ))}
            </select>
          )}
        </div>

        <div className="mb-3">
          <div className="mb-1 text-xs font-medium text-ink-600">格式</div>
          <select
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
            className="w-full rounded border border-ink-200 px-2 py-1 text-sm"
          >
            {(Object.keys(FORMAT_LABEL) as ExportFormat[]).map((f) => (
              <option key={f} value={f} disabled={f === 'backup' && scope === 'chapter'}>
                {FORMAT_LABEL[f]}
              </option>
            ))}
          </select>
          <div className="mt-1 text-[11px] text-ink-400">
            {format === 'backup'
              ? '.zip 备份包（meta.json + chapters/），可用于迁移恢复'
              : format === 'docx'
                ? 'Word 文档；全书导出含目录页、页眉书名与页脚页码（打开时按提示更新目录域）'
                : '阅读格式导出，含章节标题与目录'}
          </div>
        </div>

        {progress && (
          <div className="mb-2 rounded bg-violet-50 px-2 py-1.5 text-xs text-violet-700">{progress}</div>
        )}
        {done && (
          <div className="mb-2 rounded bg-emerald-50 px-2 py-1.5 text-xs text-emerald-700">
            已导出：{done}
          </div>
        )}
        {error && (
          <div className="mb-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-600">{error}</div>
        )}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
            onClick={onClose}
          >
            关闭
          </button>
          <button
            type="button"
            disabled={!!progress}
            className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
            onClick={() => void run()}
          >
            选择路径并导出
          </button>
        </div>
      </div>
    </div>
  );
}

function useChapterList(bookId: string): Chapter[] {
  const [chapters, setChapters] = useState<Chapter[]>([]);
  useEffect(() => {
    void getAppContext()
      .chapterService.listTreeOrder(bookId)
      .then(setChapters);
  }, [bookId]);
  return chapters;
}
