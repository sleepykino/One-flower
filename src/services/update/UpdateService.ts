/**
 * UpdateService（客户端更新 · 方案 A）：检查 GitHub Release + 系统浏览器打开下载页
 * 设置项存 app_settings：update.autoCheck / update.lastCheckAt / update.ignoreVersion
 * 不做应用内下载/安装（无签名，无 updater 插件）
 */

import { fetch } from '@tauri-apps/plugin-http';
import { getVersion } from '@tauri-apps/api/app';
import { invoke } from '@tauri-apps/api/core';
import type { AppSettingsService } from '../settings/AppSettingsService';

const REPO_LATEST_URL = 'https://api.github.com/repos/sleepykino/One-flower/releases/latest';
const RELEASES_PAGE = 'https://github.com/sleepykino/One-flower/releases/latest';

/** 自动检查最小间隔（24h），避免频繁请求 GitHub API */
const AUTO_CHECK_INTERVAL_MS = 24 * 60 * 60 * 1000;

export interface UpdateInfo {
  version: string; // "0.2.0"（去 v 前缀）
  notes: string; // release body
  url: string; // 下载页地址
  publishedAt: string;
}

/** 语义化版本比较：a > b 返回 1 */
export function compareVersions(a: string, b: string): number {
  const pa = a.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  const pb = b.replace(/^v/, '').split('.').map((n) => parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length, 3); i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x > y) return 1;
    if (x < y) return -1;
  }
  return 0;
}

export class UpdateService {
  private settings: AppSettingsService;

  constructor(settings: AppSettingsService) {
    this.settings = settings;
  }

  async getCurrentVersion(): Promise<string> {
    return getVersion();
  }

  /** 请求 GitHub latest release（网络错误时抛出） */
  async checkLatest(signal?: AbortSignal): Promise<UpdateInfo> {
    const res = await fetch(REPO_LATEST_URL, {
      method: 'GET',
      headers: { Accept: 'application/vnd.github+json' },
      signal: signal ?? AbortSignal.timeout(10000)
    });
    if (!res.ok) throw new Error(`GitHub API 返回 ${res.status}`);
    const data = (await res.json()) as {
      tag_name?: string;
      body?: string;
      html_url?: string;
      published_at?: string;
    };
    if (!data.tag_name) throw new Error('Release 数据缺少 tag_name');
    return {
      version: data.tag_name.replace(/^v/, ''),
      notes: (data.body ?? '').trim(),
      url: data.html_url || RELEASES_PAGE,
      publishedAt: data.published_at ?? ''
    };
  }

  /** 有更新且未被忽略时返回 UpdateInfo，否则 null（网络错误抛出） */
  async findNewer(signal?: AbortSignal): Promise<UpdateInfo | null> {
    const [latest, current, ignored] = await Promise.all([
      this.checkLatest(signal),
      this.getCurrentVersion(),
      this.settings.get('update.ignoreVersion')
    ]);
    if (compareVersions(latest.version, current) <= 0) return null;
    if (ignored === latest.version) return null;
    return latest;
  }

  /** 自动检查开关（默认开） */
  async isAutoCheckEnabled(): Promise<boolean> {
    return (await this.settings.get('update.autoCheck')) !== 'false';
  }

  async setAutoCheckEnabled(v: boolean): Promise<void> {
    await this.settings.set('update.autoCheck', v ? 'true' : 'false');
  }

  /** 是否到达自动检查时机（开关开 && 距上次检查超 24h） */
  async shouldAutoCheck(): Promise<boolean> {
    if (!(await this.isAutoCheckEnabled())) return false;
    const last = await this.settings.get('update.lastCheckAt');
    if (last && Date.now() - Number(last) < AUTO_CHECK_INTERVAL_MS) return false;
    return true;
  }

  async markChecked(): Promise<void> {
    await this.settings.set('update.lastCheckAt', String(Date.now()));
  }

  async getIgnoredVersion(): Promise<string | null> {
    return this.settings.get('update.ignoreVersion');
  }

  async setIgnoredVersion(v: string | null): Promise<void> {
    await this.settings.set('update.ignoreVersion', v);
  }

  /** 用系统默认浏览器打开下载页 */
  async openDownloadPage(url?: string): Promise<void> {
    await invoke('open_url', { url: url ?? RELEASES_PAGE });
  }
}
