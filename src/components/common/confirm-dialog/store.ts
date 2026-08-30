/**
 * 软件内确认弹窗状态（P7.2）：替代原生 ask 的系统消息框。
 * 背景：Tauri WebView2 中同步 JS 对话框被拦截；原生 ask 与应用设计语言割裂、
 * 无法展示结构化内容，e2e 只能靠 PowerShell SendKeys 自动化。
 * 现在确认操作全部经 confirmDialog -> 本 store -> ConfirmDialogHost 软件内渲染。
 * 并发语义：同一时刻仅一个弹窗；后续请求进 pending 串行队列，前一个解决后自动展示下一个。
 */

import { create } from 'zustand';

interface PendingItem {
  text: string;
  title: string;
  resolve: (v: boolean) => void;
}

interface ConfirmStore {
  open: boolean;
  text: string;
  title: string;
  /** 当前展示项的 resolver（settle 时调用） */
  resolveCurrent: ((v: boolean) => void) | null;
  pending: PendingItem[];
  /** 对外唯一入口：返回 Promise<boolean>，语义对齐原生 ask */
  confirm: (text: string, title?: string) => Promise<boolean>;
  /** Host 内部调用：用户点击确认/取消/Esc 后 resolve 并清场（或取队列下一条） */
  settle: (result: boolean) => void;
}

export const useConfirmStore = create<ConfirmStore>((set, get) => ({
  open: false,
  text: '',
  title: '确认操作',
  resolveCurrent: null,
  pending: [],
  confirm: (text, title = '确认操作') =>
    new Promise<boolean>((resolve) => {
      const s = get();
      if (s.open) {
        // 已有弹窗展示中：进串行队列，前一个解决后自动展示
        set({ pending: [...s.pending, { text, title, resolve }] });
      } else {
        set({ open: true, text, title, resolveCurrent: resolve });
      }
    }),
  settle: (result) => {
    const s = get();
    s.resolveCurrent?.(result);
    const next = s.pending[0];
    if (next) {
      set({ resolveCurrent: next.resolve, text: next.text, title: next.title, pending: s.pending.slice(1) });
    } else {
      set({ open: false, text: '', resolveCurrent: null });
    }
  }
}));
