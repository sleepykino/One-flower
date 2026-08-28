/**
 * 首页导入入口：合并「导入文档（TXT / Markdown）」与「导入备份（.zip）」为单一按钮下拉
 * 点击展开、点击菜单外自动收起、选择后收起（交互模式与 BookCardMenu 一致）
 */

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, FileText, FolderUp } from 'lucide-react';

export function ImportMenu({
  onImportDoc,
  onImportBackup
}: {
  onImportDoc: () => void;
  onImportBackup: () => void;
}): JSX.Element {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent): void => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  const item = (icon: JSX.Element, title: string, hint: string, onClick: () => void): JSX.Element => (
    <button
      type="button"
      className="flex w-full items-start gap-2.5 px-3 py-2 text-left hover:bg-ink-100"
      onClick={() => {
        setOpen(false);
        onClick();
      }}
    >
      <span className="mt-0.5 text-violet-600">{icon}</span>
      <span>
        <span className="block text-sm text-ink-800">{title}</span>
        <span className="block text-xs text-ink-400">{hint}</span>
      </span>
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        className="flex items-center gap-1 rounded border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
        onClick={() => setOpen((o) => !o)}
      >
        导入
        <ChevronDown size={14} className={`text-ink-400 transition-transform ${open ? 'rotate-180' : ''}`} />
      </button>
      {open && (
        <div className="absolute right-0 top-9 z-30 w-60 overflow-hidden rounded-lg border border-ink-200 bg-white py-1 shadow-lg">
          {item(<FileText size={16} />, '导入文档', 'TXT / Markdown · 自动按章节标题切分', onImportDoc)}
          <div className="border-t border-ink-100" />
          {item(<FolderUp size={16} />, '导入备份', '从备份包（.zip）恢复整本书', onImportBackup)}
        </div>
      )}
    </div>
  );
}
