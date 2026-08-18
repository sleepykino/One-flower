/**
 * UpdateDialog（客户端更新）：发现新版本弹窗
 * 显示版本号 / 发布时间 / Release Notes，[去下载]（系统浏览器）或 [暂不更新]（可勾选忽略此版本）
 */

import { useState } from 'react';
import type { UpdateInfo } from '../../services/update/UpdateService';
import { getAppContext } from '../../context/app-context';

export function UpdateDialog({
  info,
  currentVersion,
  onClose
}: {
  info: UpdateInfo;
  currentVersion: string;
  onClose: () => void;
}): JSX.Element {
  const [ignore, setIgnore] = useState(false);

  const download = (): void => {
    void getAppContext()
      .updateService.openDownloadPage(info.url)
      .catch((e) => console.warn('打开下载页失败:', e));
    onClose();
  };

  const later = (): void => {
    if (ignore) {
      void getAppContext().updateService.setIgnoredVersion(info.version);
    }
    onClose();
  };

  const published = info.publishedAt ? new Date(info.publishedAt).toLocaleDateString() : '';

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/40 p-4">
      <div className="flex max-h-[70vh] w-[420px] flex-col rounded-lg border border-ink-200 bg-white shadow-xl">
        <div className="border-b border-ink-100 px-4 py-3">
          <div className="text-base font-medium">发现新版本 v{info.version}</div>
          <div className="mt-0.5 text-xs text-ink-400">
            当前 v{currentVersion}
            {published ? ` · 发布于 ${published}` : ''}
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3 text-xs leading-6 text-ink-600">
          {info.notes ? (
            <pre className="whitespace-pre-wrap break-words font-sans">{info.notes}</pre>
          ) : (
            <span className="text-ink-400">（该版本未填写更新说明）</span>
          )}
        </div>
        <div className="border-t border-ink-100 px-4 py-3">
          <label className="mb-2 flex cursor-pointer items-center gap-1.5 text-xs text-ink-500">
            <input type="checkbox" checked={ignore} onChange={(e) => setIgnore(e.target.checked)} />
            忽略此版本（不再提醒 v{info.version}）
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className="flex-1 rounded bg-violet-600 py-1.5 text-sm text-white hover:bg-violet-700"
              onClick={download}
            >
              去下载
            </button>
            <button
              type="button"
              className="flex-1 rounded border border-ink-200 py-1.5 text-sm hover:bg-ink-100"
              onClick={later}
            >
              暂不更新
            </button>
          </div>
          <div className="mt-1.5 text-center text-[10px] text-ink-400">
            将用系统浏览器打开 GitHub Releases 页，若无法访问请自行配置网络后重试
          </div>
        </div>
      </div>
    </div>
  );
}
