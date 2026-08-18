/**
 * GlobalPromptService（P2.1-M1）：自定义全局提示词
 * 存储复用 app_settings 表（JSON 序列化），所有 AI 模式统一注入 system 段
 * 语义层级：全局提示词 > Skill（PromptAssembler 内显式标注）
 */

import type { AppSettingsService } from '../settings/AppSettingsService';

export interface GlobalPromptItem {
  id: string; // crypto.randomUUID
  text: string; // "避免使用'仿佛'"
  enabled: boolean; // 单条启停
}

const KEY_ITEMS = 'ai.globalPrompts';
const KEY_ENABLED = 'ai.globalPrompts.enabled';

export class GlobalPromptService {
  private settings: AppSettingsService;

  constructor(settings: AppSettingsService) {
    this.settings = settings;
  }

  /** app_settings key = 'ai.globalPrompts'，value 为 JSON 数组；空/损坏返回 [] */
  async list(): Promise<GlobalPromptItem[]> {
    const raw = await this.settings.get(KEY_ITEMS);
    if (!raw) return [];
    try {
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (it): it is GlobalPromptItem =>
            typeof it === 'object' &&
            it !== null &&
            typeof (it as GlobalPromptItem).id === 'string' &&
            typeof (it as GlobalPromptItem).text === 'string' &&
            typeof (it as GlobalPromptItem).enabled === 'boolean'
        )
        .map((it) => ({ ...it, text: it.text.trimStart() }));
    } catch {
      return [];
    }
  }

  /** 整体覆盖保存（内部经 AppSettingsService.set 走 wq） */
  async save(items: GlobalPromptItem[]): Promise<void> {
    await this.settings.set(KEY_ITEMS, JSON.stringify(items));
  }

  /** 总开关：app_settings key = 'ai.globalPrompts.enabled'，默认 true */
  async isEnabled(): Promise<boolean> {
    const raw = await this.settings.get(KEY_ENABLED);
    return raw !== 'false';
  }

  async setEnabled(v: boolean): Promise<void> {
    await this.settings.set(KEY_ENABLED, v ? 'true' : 'false');
  }

  /** 便捷方法：总开关开启且单条 enabled 的非空文本数组 */
  async enabledTexts(): Promise<string[]> {
    const on = await this.isEnabled();
    if (!on) return [];
    const items = await this.list();
    return items.filter((i) => i.enabled && i.text.trim() !== '').map((i) => i.text.trim());
  }
}
