/**
 * 原生对话框封装：替代 window.confirm / window.alert
 * Tauri WebView2 中同步 JS 对话框被拦截，必须用 dialog 插件的异步原生对话框。
 * 非阻断通知请用 components/common/toast（toast.info/success/error）。
 */

import { ask } from '@tauri-apps/plugin-dialog';

export async function confirmDialog(text: string, title = '确认操作'): Promise<boolean> {
  return ask(text, { title });
}
