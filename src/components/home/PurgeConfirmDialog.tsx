/**
 * P6 补充：彻底删除确认对话框（回收站专用）
 * 原生 ask 对话框不支持复选框，改用自定义模态：
 * 警告文案 + 可选勾选「同时删除其自动备份文件」（默认不勾，显式交给用户决定）+ 取消/彻底删除
 * backupCount 由调用方经 AutoBackupService.listBookBackups 查询；null = 查询中（确认按钮禁用）
 */

import { useState } from 'react';

export function PurgeConfirmDialog({
  title,
  message,
  backupCount,
  busy = false,
  onConfirm,
  onCancel
}: {
  title: string;
  message: string;
  /** 该书（或这批书）自动备份文件数；null = 查询中 */
  backupCount: number | null;
  busy?: boolean;
  onConfirm: (deleteBackups: boolean) => void;
  onCancel: () => void;
}): JSX.Element {
  const [deleteBackups, setDeleteBackups] = useState(false);
  const checking = backupCount == null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget && !busy) onCancel();
      }}
    >
      <div className="w-96 rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-2 text-sm font-medium text-red-600">{title}</div>
        <p className="mb-3 whitespace-pre-line text-xs leading-5 text-ink-600">{message}</p>

        {checking ? (
          <div className="mb-3 rounded border border-ink-100 bg-ink-50 px-2.5 py-2 text-xs text-ink-400">
            正在检查自动备份文件…
          </div>
        ) : backupCount > 0 ? (
          <label className="mb-3 flex cursor-pointer items-start gap-2 rounded border border-ink-100 bg-ink-50 px-2.5 py-2 text-xs leading-5 text-ink-600">
            <input
              type="checkbox"
              checked={deleteBackups}
              onChange={(e) => setDeleteBackups(e.target.checked)}
              disabled={busy}
              className="mt-0.5"
            />
            <span>
              同时删除其自动备份文件（{backupCount} 个 zip）
              <span className="mt-0.5 block text-[11px] text-ink-400">
                仅清理自动备份目录中的文件；手动导出到其他位置的备份不受影响
              </span>
            </span>
          </label>
        ) : null}

        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={busy}
            className="rounded border border-ink-200 px-3 py-1 text-xs hover:bg-ink-100 disabled:opacity-40"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            disabled={busy || checking}
            className="rounded bg-red-600 px-3 py-1 text-xs text-white hover:bg-red-700 disabled:opacity-40"
            onClick={() => onConfirm(deleteBackups)}
          >
            {busy ? '删除中…' : '彻底删除'}
          </button>
        </div>
      </div>
    </div>
  );
}
