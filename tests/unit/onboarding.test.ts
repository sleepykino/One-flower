/**
 * P7.1 单测：TOURS 数据完整性 + 引导状态编解码纯逻辑
 * OnboardingService 只依赖 appSettings 的 get/set，用内存桩即可测（不依赖 Tauri 运行时）
 */

import { describe, expect, it } from 'vitest';
import { OnboardingService } from '../../src/services/onboarding/OnboardingService';
import { TOURS } from '../../src/services/onboarding/tours';
import type { AppSettingsService } from '../../src/services/settings/AppSettingsService';

/** app_settings 内存桩（语义同 AppSettingsService：null 删除、字符串覆盖） */
function fakeSettings(): AppSettingsService {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string | null) => {
      if (value === null) store.delete(key);
      else store.set(key, value);
    }
  } as unknown as AppSettingsService;
}

describe('TOURS 数据完整性', () => {
  it('id 全局唯一且非空', () => {
    const ids = TOURS.map((t) => t.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids.every((id) => id.length > 0)).toBe(true);
  });

  it('trigger 取值合法，auto 引导只有 welcome 与 editor-basics', () => {
    for (const t of TOURS) {
      expect(['auto', 'manual']).toContain(t.trigger);
    }
    expect(TOURS.filter((t) => t.trigger === 'auto').map((t) => t.id)).toEqual([
      'welcome',
      'editor-basics'
    ]);
  });

  it('auto 引导步数与方案文档一致（welcome=7，editor-basics=5）', () => {
    const byId = new Map(TOURS.map((t) => [t.id, t]));
    expect(byId.get('welcome')?.steps.length).toBe(7);
    expect(byId.get('editor-basics')?.steps.length).toBe(5);
  });

  it('manual 引导步数 ≤ 6', () => {
    for (const t of TOURS.filter((x) => x.trigger === 'manual')) {
      expect(t.steps.length).toBeLessThanOrEqual(6);
    }
  });

  it('每步 title / description 非空', () => {
    for (const t of TOURS) {
      for (const s of t.steps) {
        expect(s.title.trim().length).toBeGreaterThan(0);
        expect(s.description.trim().length).toBeGreaterThan(0);
      }
    }
  });

  it('锚点只用 data-tour / data-rail-tab / data-ai-mode 语义选择器', () => {
    for (const t of TOURS) {
      for (const s of t.steps) {
        if (!s.target) continue;
        expect(s.target).toMatch(/^\[data-(tour|rail-tab|ai-mode)/);
      }
    }
  });

  it('welcome 第 5 步导航设置页、第 7 步回书架；editor-basics 末步切世界书 tab', () => {
    const byId = new Map(TOURS.map((t) => [t.id, t]));
    expect(byId.get('welcome')?.steps[4]?.before?.navigate).toBe('/settings');
    expect(byId.get('welcome')?.steps[6]?.before?.navigate).toBe('/');
    const basics = byId.get('editor-basics')?.steps ?? [];
    expect(basics[basics.length - 1]?.before?.openEditorTab).toBe('worldbook');
  });
});

describe('引导状态编解码（app_settings 键值）', () => {
  it('空状态读出空集合', async () => {
    const svc = new OnboardingService(fakeSettings());
    expect(await svc.getCompleted()).toEqual({});
  });

  it('markDone 落盘 JSON 且多条不互相覆盖', async () => {
    const settings = fakeSettings();
    const svc = new OnboardingService(settings);
    await svc.markDone('welcome');
    await svc.markDone('editor-basics');
    const raw = await settings.get('onboarding.completed');
    expect(JSON.parse(raw ?? '{}')).toEqual({ welcome: true, 'editor-basics': true });
    expect(await svc.getCompleted()).toEqual({ welcome: true, 'editor-basics': true });
  });

  it('重复 markDone 幂等', async () => {
    const svc = new OnboardingService(fakeSettings());
    await svc.markDone('welcome');
    await svc.markDone('welcome');
    expect(await svc.getCompleted()).toEqual({ welcome: true });
  });

  it('JSON 损坏时按空集合兜底', async () => {
    const settings = fakeSettings();
    await settings.set('onboarding.completed', '{oops');
    const svc = new OnboardingService(settings);
    expect(await svc.getCompleted()).toEqual({});
  });

  it('shouldAutoShow 缺省 true，set false 后读出 false', async () => {
    const settings = fakeSettings();
    const svc = new OnboardingService(settings);
    expect(await svc.shouldAutoShow()).toBe(true);
    await svc.setAutoShow(false);
    expect(await settings.get('onboarding.autoShow')).toBe('false');
    expect(await svc.shouldAutoShow()).toBe(false);
  });

  it('clearAll 清空全部引导状态（dev reset 路径）', async () => {
    const settings = fakeSettings();
    const svc = new OnboardingService(settings);
    await svc.markDone('welcome');
    await svc.setAutoShow(false);
    await svc.clearAll();
    expect(await settings.get('onboarding.completed')).toBeNull();
    expect(await settings.get('onboarding.autoShow')).toBeNull();
    expect(await svc.getCompleted()).toEqual({});
    expect(await svc.shouldAutoShow()).toBe(true);
  });

  it('初始未运行 / 运行标记切换（isRunning 基础语义）', () => {
    const svc = new OnboardingService(fakeSettings());
    expect(svc.isRunning()).toBe(false);
  });
});
