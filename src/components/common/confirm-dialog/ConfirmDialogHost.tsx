/**
 * 软件内确认弹窗宿主（P7.2）：全局唯一，挂载于 App.tsx 根（Router 同级）。
 * 替代原生 ask 系统消息框；非阻断通知仍走 toast。
 * 交互：Enter=确认(true) / Esc=取消(false)，对齐原生 ask 的回车=是 / ESC=否；
 * 遮罩点击=取消；焦点默认落在「确认」按钮。
 */

import { useEffect, useRef } from 'react';
import { useConfirmStore } from './store';

export function ConfirmDialogHost(): JSX.Element | null {
  const open = useConfirmStore((s) => s.open);
  const text = useConfirmStore((s) => s.text);
  const title = useConfirmStore((s) => s.title);
  const settle = useConfirmStore((s) => s.settle);
  const confirmRef = useRef<HTMLButtonElement>(null);

  // 焦点：打开时落「确认」按钮
  useEffect(() => {
    if (open) confirmRef.current?.focus();
  }, [open]);

  // 键盘：Enter=确认 / Esc=取消（capture + preventDefault，避免聚焦按钮时默认激活二次触发）
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') {
        e.preventDefault();
        settle(true);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        settle(false);
      }
    };
    document.addEventListener('keydown', onKey, true);
    return () => document.removeEventListener('keydown', onKey, true);
  }, [open, settle]);

  if (!open) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-[300] flex items-center justify-center bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget) settle(false);
      }}
    >
      <div className="w-96 rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 text-sm font-medium text-ink-800">{title}</div>
        <p className="mb-3 whitespace-pre-line text-xs leading-5 text-ink-600">{text}</p>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            className="rounded border border-ink-200 px-3 py-1 text-xs hover:bg-ink-100"
            onClick={() => settle(false)}
          >
            取消
          </button>
          <button
            ref={confirmRef}
            type="button"
            className="rounded bg-violet-600 px-3 py-1 text-xs text-white hover:bg-violet-700"
            onClick={() => settle(true)}
          >
            确认
          </button>
        </div>
      </div>
    </div>
  );
}
