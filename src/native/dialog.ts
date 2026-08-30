/**
 * 软件内对话框封装：确认弹窗 + 文件对话框统一出口
 * - confirmDialog：软件内确认弹窗（P7.2 起替代原生 ask）。背景：Tauri WebView2 中
 *   同步 JS 对话框被拦截；原生 ask 与应用设计语言割裂、无法展示结构化内容、e2e 只能
 *   靠 PowerShell SendKeys 自动化。确认操作统一经 useConfirmStore 由 ConfirmDialogHost
 *   软件内渲染（Enter=确认 / Esc=取消 / 遮罩=取消）。
 * - 文件选择 / 保存仍走 plugin-dialog 原生对话框（自研文件浏览器成本高、丢 OS 集成
 *   能力、需放宽 fs 权限），见 pickSavePath（含上次目录记忆）。
 * - 非阻断通知请用 components/common/toast（toast.info/success/error）。
 */

import { save } from '@tauri-apps/plugin-dialog';
import { useConfirmStore } from '../components/common/confirm-dialog/store';

/** localStorage 键：导出场景记忆的上次目录（UI 便利，非应用数据） */
const LAST_SAVE_DIR_KEY = 'dialog.lastSaveDir';

export async function confirmDialog(text: string, title = '确认操作'): Promise<boolean> {
  return useConfirmStore.getState().confirm(text, title);
}

/**
 * 导出场景的文件保存对话框：带上次目录记忆。
 * 传入默认文件名（如 `${title}.zip`），若之前导出过则默认落在上次目录；
 * 成功选择后记住所在目录，下次默认定位，减少翻目录次数。
 * 返回用户选择的完整路径；用户取消返回 null。
 */
export async function pickSavePath(options: {
  /** 默认文件名（如 `book.zip`），是保存对话框的默认文件名 */
  fileName: string;
  /** 对话框窗口标题（透传 plugin-dialog） */
  title?: string;
  filters?: Array<{ name: string; extensions: string[] }>;
}): Promise<string | null> {
  const lastDir = localStorage.getItem(LAST_SAVE_DIR_KEY);
  const defaultPath = lastDir ? `${lastDir}/${options.fileName}` : options.fileName;
  const path = await save({ defaultPath, title: options.title, filters: options.filters });
  if (path) {
    const idx = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    if (idx > 0) localStorage.setItem(LAST_SAVE_DIR_KEY, path.slice(0, idx));
  }
  return path;
}
