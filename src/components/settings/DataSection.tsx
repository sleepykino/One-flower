/**
 * 数据与 Skill 子区块（从原设置页迁移）
 */

import { useEffect, useState } from 'react';
import { getAppContext } from '../../context/app-context';
import { invoke } from '@tauri-apps/api/core';

export function DataSection(): JSX.Element {
  const [dataDir, setDataDir] = useState('');
  const [skillsDir, setSkillsDir] = useState('');

  useEffect(() => {
    void (async () => {
      const { bridge } = getAppContext();
      const appData = await bridge.storage.appDataDir();
      const home = await invoke<string>('home_dir');
      setDataDir(appData);
      setSkillsDir(`${home}\\.novelagent\\skills`);
    })();
  }, []);

  const openDir = (path: string): void => {
    void invoke('open_url', { url: path }).catch((e) => console.warn('打开目录失败:', e));
  };

  return (
    <div>
      <h2 className="mb-2 font-medium">数据与 Skill</h2>
      <div className="space-y-2">
        <div className="rounded border border-ink-100 bg-white px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">应用数据目录</div>
            <button
              type="button"
              className="rounded border border-ink-200 px-2 py-0.5 text-xs hover:bg-ink-100"
              onClick={() => openDir(dataDir)}
            >
              打开目录
            </button>
          </div>
          <div className="mt-0.5 break-all text-xs text-ink-400">
            {dataDir || '…'}（SQLite WAL 模式 · 单写队列 · 全部本地存储）
          </div>
        </div>
        <div className="rounded border border-ink-100 bg-white px-3 py-2">
          <div className="flex items-center justify-between">
            <div className="text-sm font-medium">Skill 目录</div>
            <button
              type="button"
              className="rounded border border-ink-200 px-2 py-0.5 text-xs hover:bg-ink-100"
              onClick={() => openDir(skillsDir)}
            >
              打开目录
            </button>
          </div>
          <div className="mt-0.5 break-all text-xs text-ink-400">{skillsDir || '…'}</div>
          <div className="mt-1 text-[11px] text-ink-400">
            放入 SKILL.md 后在书籍 Skill 面板勾选启用文风；每本书可单独指定启用的 Skill。
          </div>
        </div>
      </div>
      <p className="mt-3 text-[11px] leading-5 text-ink-400">
        备份导出/导入已移至「备份与恢复」子页；正文格式导出（Markdown / TXT / EPUB / Word）在编辑器「导出」对话框中。
      </p>
    </div>
  );
}
