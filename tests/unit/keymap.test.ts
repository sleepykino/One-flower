/**
 * keymap 单测：组合键匹配 / 显示 / 捕获 / 合法性 / 冲突 / localStorage 持久化
 */

import { describe, expect, it, beforeEach } from 'vitest';
import {
  SHORTCUT_DEFS,
  comboFromEvent,
  findConflict,
  formatCombo,
  getEffectiveShortcuts,
  isComboAllowed,
  matchesShortcut,
  resetShortcut,
  setCustomShortcut
} from '../../src/utils/keymap';
import type { KeyCombo, ShortcutId } from '../../src/utils/keymap';

/** node 环境无 KeyboardEvent 构造器，用字段级 stub（属性名与 KeyboardEvent 一致） */
function ev(patch: {
  ctrlKey?: boolean;
  metaKey?: boolean;
  shiftKey?: boolean;
  altKey?: boolean;
  key?: string;
}): KeyboardEvent {
  return patch as unknown as KeyboardEvent;
}

/** 内存版 localStorage（node 环境无全局 localStorage） */
function installLS(): void {
  class LS {
    private m = new Map<string, string>();
    getItem(k: string): string | null {
      return this.m.get(k) ?? null;
    }
    setItem(k: string, v: string): void {
      this.m.set(k, v);
    }
    removeItem(k: string): void {
      this.m.delete(k);
    }
  }
  (globalThis as Record<string, unknown>).localStorage = new LS() as unknown as Storage;
}

beforeEach(() => {
  installLS();
});

describe('formatCombo', () => {
  it('Ctrl+Shift+F 显示', () => {
    expect(formatCombo({ ctrl: true, shift: true, key: 'f' })).toBe('Ctrl+Shift+F');
  });
  it('单键大写显示', () => {
    expect(formatCombo({ key: 'a' })).toBe('A');
  });
  it('F2 原样显示', () => {
    expect(formatCombo({ key: 'F2' })).toBe('F2');
  });
});

describe('matchesShortcut', () => {
  it('Ctrl+S 命中，且 Ctrl 与 Cmd 等价', () => {
    const combo = { ctrl: true, key: 's' };
    expect(matchesShortcut(ev({ ctrlKey: true, key: 's' }), combo)).toBe(true);
    expect(matchesShortcut(ev({ metaKey: true, key: 's' }), combo)).toBe(true);
    expect(matchesShortcut(ev({ ctrlKey: true, key: 'f' }), combo)).toBe(false);
  });
  it('未绑定的修饰键不命中（Ctrl+Shift+S 不触发保存）', () => {
    expect(
      matchesShortcut(ev({ ctrlKey: true, shiftKey: true, key: 's' }), { ctrl: true, key: 's' })
    ).toBe(false);
  });
  it('大小写不敏感', () => {
    expect(matchesShortcut(ev({ ctrlKey: true, key: 'S' }), { ctrl: true, key: 's' })).toBe(true);
  });
});

describe('comboFromEvent', () => {
  it('纯修饰键返回 null', () => {
    expect(comboFromEvent(ev({ ctrlKey: true, key: 'Control' }))).toBeNull();
    expect(comboFromEvent(ev({ shiftKey: true, key: 'Shift' }))).toBeNull();
  });
  it('Ctrl+Alt+K 解析', () => {
    expect(comboFromEvent(ev({ ctrlKey: true, altKey: true, key: 'k' }))).toEqual({
      ctrl: true,
      alt: true,
      key: 'k'
    });
  });
  it('Cmd+S 归入 ctrl 位', () => {
    expect(comboFromEvent(ev({ metaKey: true, key: 's' }))).toEqual({ ctrl: true, key: 's' });
  });
});

describe('isComboAllowed', () => {
  it('含 Ctrl/Alt 允许', () => {
    expect(isComboAllowed({ ctrl: true, key: 'k' })).toBe(true);
    expect(isComboAllowed({ alt: true, key: 'x' })).toBe(true);
  });
  it('F 功能键允许', () => {
    expect(isComboAllowed({ key: 'F5' })).toBe(true);
  });
  it('纯字母/数字不允许（避免覆盖输入）', () => {
    expect(isComboAllowed({ key: 'a' })).toBe(false);
    expect(isComboAllowed({ shift: true, key: 'a' })).toBe(false);
  });
});

describe('findConflict', () => {
  it('相同组合检出冲突，不同不报', () => {
    const others: Array<[ShortcutId, KeyCombo]> = [
      ['globalSearch', { ctrl: true, shift: true, key: 'f' }]
    ];
    expect(findConflict('save', { ctrl: true, key: 's' }, others)).toBeNull();
    expect(
      findConflict('save', { ctrl: true, shift: true, key: 'f' }, others)
    ).toBe('globalSearch');
  });
});

describe('持久化（getEffectiveShortcuts / setCustomShortcut / resetShortcut）', () => {
  it('无自定义时全为默认', () => {
    const km = getEffectiveShortcuts();
    expect(km.save).toEqual(SHORTCUT_DEFS.save.default);
    expect(km.globalSearch).toEqual(SHORTCUT_DEFS.globalSearch.default);
  });
  it('自定义覆盖后合并返回，未配置的命令保持默认', () => {
    setCustomShortcut('save', { ctrl: true, alt: true, key: 'k' });
    const km = getEffectiveShortcuts();
    expect(km.save).toEqual({ ctrl: true, alt: true, key: 'k' });
    expect(km.globalSearch).toEqual(SHORTCUT_DEFS.globalSearch.default);
  });
  it('损坏的存储回落默认', () => {
    (globalThis as Record<string, unknown>).localStorage = {
      getItem: () => '{oops',
      setItem: () => undefined,
      removeItem: () => undefined
    } as unknown as Storage;
    expect(getEffectiveShortcuts().save).toEqual(SHORTCUT_DEFS.save.default);
  });
  it('resetShortcut 恢复默认且清空存储', () => {
    setCustomShortcut('save', { ctrl: true, alt: true, key: 'k' });
    resetShortcut('save');
    const km = getEffectiveShortcuts();
    expect(km.save).toEqual(SHORTCUT_DEFS.save.default);
    expect((globalThis as Record<string, unknown>).localStorage.getItem('oneflower.shortcuts')).toBeNull();
  });
});