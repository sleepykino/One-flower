/**
 * 通用子区块：软件更新 + 关于
 */

import { useEffect, useState } from 'react';
import { getAppContext } from '../../context/app-context';
import { invoke } from '@tauri-apps/api/core';
import type { UpdateInfo } from '../../services/update/UpdateService';
import { UpdateDialog } from '../update/UpdateDialog';

export function GeneralSection(): JSX.Element {
  const [appVersion, setAppVersion] = useState('');
  const [autoCheck, setAutoCheck] = useState(true);
  const [checking, setChecking] = useState(false);
  const [updateMsg, setUpdateMsg] = useState('');
  const [updateInfo, setUpdateInfo] = useState<UpdateInfo | null>(null);

  useEffect(() => {
    void (async () => {
      const { updateService } = getAppContext();
      setAppVersion(await updateService.getCurrentVersion());
      setAutoCheck(await updateService.isAutoCheckEnabled());
    })();
  }, []);

  const checkUpdate = async (): Promise<void> => {
    const { updateService } = getAppContext();
    setChecking(true);
    setUpdateMsg('检查中…');
    try {
      const info = await updateService.findNewer();
      await updateService.markChecked();
      if (info) {
        setUpdateInfo(info);
        setUpdateMsg(`发现新版本 v${info.version}`);
      } else {
        setUpdateMsg(`已是最新版本（v${appVersion || await updateService.getCurrentVersion()}）`);
      }
    } catch (e) {
      setUpdateMsg(`检查失败：${e instanceof Error ? e.message : String(e)}（GitHub 访问受限时可配置网络后重试）`);
    } finally {
      setChecking(false);
    }
  };

  const openRepo = (): void => {
    void invoke('open_url', { url: 'https://github.com/sleepykino/One-flower' }).catch((e) =>
      console.warn('打开仓库失败:', e)
    );
  };

  return (
    <div>
      {/* 软件更新 */}
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-medium">软件更新</h2>
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-ink-600">
          <input
            type="checkbox"
            checked={autoCheck}
            onChange={(e) => {
              const v = e.target.checked;
              setAutoCheck(v);
              void getAppContext().updateService.setAutoCheckEnabled(v);
            }}
          />
          自动检查更新
        </label>
      </div>
      <p className="mb-3 text-xs text-ink-400">
        新版本发布于 GitHub Releases，检查到新版本时会弹出下载提示。
      </p>
      <div className="flex items-center gap-2">
        <button
          type="button"
          disabled={checking}
          className="rounded bg-violet-600 px-3 py-1 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
          onClick={() => void checkUpdate()}
        >
          {checking ? '检查中…' : '立即检查更新'}
        </button>
        {updateMsg && <span className="min-w-0 truncate text-xs text-ink-500">{updateMsg}</span>}
      </div>

      {/* 关于 */}
      <h2 className="mb-2 mt-6 font-medium">关于</h2>
      <div className="rounded border border-ink-100 bg-white px-3 py-2 text-sm">
        <div className="flex items-center gap-2">
          <span className="font-medium">One Flower 一花一世界</span>
          <span className="rounded bg-ink-100 px-1.5 text-[10px] text-ink-500">v{appVersion || '…'}</span>
        </div>
        <div className="mt-1 text-xs text-ink-400">本地优先 · 多模式 AI · Skill 文风 · 一致性检查</div>
        <button
          type="button"
          className="mt-2 text-xs text-violet-600 hover:underline"
          onClick={openRepo}
        >
          GitHub 仓库 ↗
        </button>
      </div>

      {/* 发现新版本：下载弹窗 */}
      {updateInfo && (
        <UpdateDialog
          info={updateInfo}
          currentVersion={appVersion}
          onClose={() => setUpdateInfo(null)}
        />
      )}
    </div>
  );
}
