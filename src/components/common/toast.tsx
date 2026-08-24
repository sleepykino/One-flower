/**
 * 全局轻量通知（右下角堆叠，自动消失）：承接原先阻塞式原生弹窗的非阻断场景。
 * 用法：import { toast } from '.../toast'; toast.info(...) / toast.success(...) / toast.error(...)
 * 需在应用根挂载一次 <ToastHost />。
 * error 停留更久且需手动关闭，保证重要失败不被错过。
 */

import { useEffect, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react';

export type ToastKind = 'info' | 'success' | 'error';

interface ToastItem {
  id: number;
  kind: ToastKind;
  text: string;
}

/** 各类型停留时长（ms）；error 更久 */
const DURATION: Record<ToastKind, number> = { info: 3500, success: 3000, error: 8000 };
const MAX_VISIBLE = 5;

let items: ToastItem[] = [];
let seq = 0;
const listeners = new Set<() => void>();

function emit(): void {
  for (const l of listeners) l();
}

function dismiss(id: number): void {
  if (!items.some((i) => i.id === id)) return;
  items = items.filter((i) => i.id !== id);
  emit();
}

function push(kind: ToastKind, text: string): void {
  const item: ToastItem = { id: ++seq, kind, text: text.trim() || '（空消息）' };
  items = [...items.slice(-(MAX_VISIBLE - 1)), item];
  emit();
  window.setTimeout(() => dismiss(item.id), DURATION[kind]);
}

export const toast = {
  info: (text: string): void => push('info', text),
  success: (text: string): void => push('success', text),
  error: (text: string): void => push('error', text)
};

const KIND_STYLE: Record<ToastKind, { icon: JSX.Element; border: string }> = {
  info: {
    icon: <Info size={15} className="shrink-0 text-sky-500" />,
    border: 'border-l-sky-400'
  },
  success: {
    icon: <CheckCircle2 size={15} className="shrink-0 text-emerald-500" />,
    border: 'border-l-emerald-500'
  },
  error: {
    icon: <AlertTriangle size={15} className="shrink-0 text-red-500" />,
    border: 'border-l-red-500'
  }
};

export function ToastHost(): JSX.Element {
  const [, force] = useState(0);
  useEffect(() => {
    const listener = (): void => force((t) => t + 1);
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
    };
  }, []);

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex w-80 flex-col gap-2">
      {items.map((t) => (
        <div
          key={t.id}
          className={`pointer-events-auto flex items-start gap-2 rounded border border-ink-200 border-l-4 bg-white px-3 py-2 text-xs leading-5 text-ink-700 shadow-lg ${KIND_STYLE[t.kind].border}`}
        >
          <span className="mt-px">{KIND_STYLE[t.kind].icon}</span>
          <span className="min-w-0 flex-1 break-words">{t.text}</span>
          <button
            type="button"
            title="关闭"
            className="shrink-0 pt-0.5 text-ink-300 hover:text-ink-600"
            onClick={() => dismiss(t.id)}
          >
            <X size={13} />
          </button>
        </div>
      ))}
    </div>
  );
}
