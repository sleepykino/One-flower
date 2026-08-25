/**
 * P6 M3 书卡 ⋮ 菜单：编辑信息 / 置顶切换 / 导出备份 / 删除（移入回收站）
 * hover 卡片时按钮可见，点击展开，点击菜单外自动收起
 */

import { useEffect, useRef, useState } from 'react';
import { Download, MoreVertical, Pencil, Pin, PinOff, Trash2 } from 'lucide-react';
import type { Book } from '../../types';

export function BookCardMenu({
  book,
  onEdit,
  onTogglePin,
  onExportBackup,
  onDelete
}: {
  book: Book;
  onEdit: () => void;
  onTogglePin: () => void;
  onExportBackup: () => void;
  onDelete: () => void;
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

  const item = (icon: JSX.Element, label: string, onClick: () => void, danger = false): JSX.Element => (
    <button
      type="button"
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-ink-100 ${
        danger ? 'text-red-600' : 'text-ink-700'
      }`}
      onClick={(e) => {
        e.stopPropagation();
        setOpen(false);
        onClick();
      }}
    >
      {icon}
      {label}
    </button>
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        title="更多操作"
        className="hidden rounded p-0.5 text-ink-400 hover:text-ink-700 group-hover:block"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
      >
        <MoreVertical size={15} />
      </button>
      {open && (
        <div className="absolute right-0 top-6 z-20 w-32 rounded border border-ink-200 bg-white py-1 shadow-lg">
          {item(<Pencil size={13} />, '编辑信息', onEdit)}
          {item(
            book.pinned ? <PinOff size={13} /> : <Pin size={13} />,
            book.pinned ? '取消置顶' : '置顶',
            onTogglePin
          )}
          {item(<Download size={13} />, '导出备份', onExportBackup)}
          <div className="my-1 border-t border-ink-100" />
          {item(<Trash2 size={13} />, '删除', onDelete, true)}
        </div>
      )}
    </div>
  );
}
