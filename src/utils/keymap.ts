/**
 * 快捷键集中管理：命令定义 + 自定义覆盖（localStorage 持久化）+ 匹配
 * 语义约定：ctrl 位按 (Ctrl || Cmd) 跨平台匹配（与编辑器既有实现一致）
 */

export interface KeyCombo {
  ctrl?: boolean;
  shift?: boolean;
  alt?: boolean;
  key: string;
}

export type ShortcutId = 'save' | 'globalSearch';

export interface ShortcutDef {
  label: string;
  description: string;
  default: KeyCombo;
}

export const SHORTCUT_DEFS: Record<ShortcutId, ShortcutDef> = {
  save: {
    label: '保存当前章节',
    description: '立即保存未落盘的修改（取消防抖立即保存）',
    default: { ctrl: true, key: 's' }
  },
  globalSearch: {
    label: '全局查找',
    description: '跨章节全文查找与替换',
    default: { ctrl: true, shift: true, key: 'f' }
  }
};

const STORAGE_KEY = 'oneflower.shortcuts';

/** 读取存储中的自定义覆盖（过滤非法命令/组合） */
function readCustom(): Partial<Record<ShortcutId, KeyCombo>> {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Partial<Record<ShortcutId, KeyCombo>>;
    const out: Partial<Record<ShortcutId, KeyCombo>> = {};
    for (const [sid, combo] of Object.entries(parsed)) {
      if (sid in SHORTCUT_DEFS && isKeyCombo(combo)) {
        out[sid as ShortcutId] = combo;
      }
    }
    return out;
  } catch {
    return {};
  }
}

/** 写入自定义表（空表时清空存储） */
function writeCustom(stored: Partial<Record<ShortcutId, KeyCombo>>): void {
  try {
    if (Object.keys(stored).length === 0) {
      localStorage.removeItem(STORAGE_KEY);
    } else {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(stored));
    }
  } catch {
    // localStorage 不可用（极少见）时静默
  }
}

/** 读取当前生效的快捷键（自定义覆盖 + 默认回落） */
export function getEffectiveShortcuts(): Record<ShortcutId, KeyCombo> {
  const defaults = Object.fromEntries(
    Object.entries(SHORTCUT_DEFS).map(([id, def]) => [id, { ...def.default }])
  ) as Record<ShortcutId, KeyCombo>;
  return { ...defaults, ...readCustom() };
}

/** 保存单条自定义覆盖（只存自定义项，默认值不落库） */
export function setCustomShortcut(id: ShortcutId, combo: KeyCombo): void {
  const stored = readCustom();
  stored[id] = combo;
  writeCustom(stored);
}

/** 重置单条为默认值 */
export function resetShortcut(id: ShortcutId): void {
  const stored = readCustom();
  delete stored[id];
  writeCustom(stored);
}

/** 判断 KeyboardEvent 是否命中组合（ctrl 位按 Ctrl|Cmd 匹配） */
export function matchesShortcut(e: KeyboardEvent, combo: KeyCombo): boolean {
  const ctrlHit = combo.ctrl ? e.ctrlKey || e.metaKey : !e.ctrlKey && !e.metaKey;
  const shiftHit = combo.shift ? e.shiftKey : !e.shiftKey;
  const altHit = combo.alt ? e.altKey : !e.altKey;
  if (!ctrlHit || !shiftHit || !altHit) return false;
  return normalizeKey(e) === combo.key.toLowerCase();
}

/** 组合键显示的规范化 key（字母转小写）；功能键取标准名 */
function normalizeKey(e: KeyboardEvent): string | null {
  if (e.key.length === 1) return e.key.toLowerCase();
  return e.key;
}

/** 从捕获的 KeyboardEvent 构造 KeyCombo（排除纯修饰键） */
export function comboFromEvent(e: KeyboardEvent): KeyCombo | null {
  if (
    e.key === 'Control' ||
    e.key === 'Shift' ||
    e.key === 'Alt' ||
    e.key === 'Meta' ||
    e.key === 'CapsLock'
  ) {
    return null; // 纯修饰键
  }
  const key = normalizeKey(e);
  if (!key) return null;
  return {
    ctrl: e.ctrlKey || e.metaKey,
    shift: e.shiftKey,
    alt: e.altKey,
    key
  };
}

/** 自定义合法性：避免覆盖输入语义——必须有修饰键，或为 F 功能键 */
export function isComboAllowed(combo: KeyCombo): boolean {
  if (!isKeyCombo(combo)) return false;
  if (combo.ctrl || combo.alt) return true;
  if (/^f\d{1,2}$/i.test(combo.key)) return true;
  return false;
}

/** 冲突检测：同一组合已被其他命令占用 */
export function findConflict(
  id: ShortcutId,
  combo: KeyCombo,
  others: Iterable<[ShortcutId, KeyCombo]>
): ShortcutId | null {
  for (const [sid, c] of others) {
    if (sid === id) continue;
    if (sameCombo(c, combo)) return sid;
  }
  return null;
}

/** 显示用：Ctrl+Shift+F */
export function formatCombo(combo: KeyCombo): string {
  const parts: string[] = [];
  if (combo.ctrl) parts.push('Ctrl');
  if (combo.alt) parts.push('Alt');
  if (combo.shift) parts.push('Shift');
  const key = combo.key.length === 1 ? combo.key.toUpperCase() : combo.key;
  parts.push(key);
  return parts.join('+');
}

function isKeyCombo(v: unknown): v is KeyCombo {
  return (
    !!v &&
    typeof v === 'object' &&
    'key' in (v as Record<string, unknown>) &&
    typeof (v as KeyCombo).key === 'string' &&
    (v as KeyCombo).key.length > 0
  );
}

function sameCombo(a: KeyCombo, b: KeyCombo): boolean {
  return (
    !!a.ctrl === !!b.ctrl &&
    !!a.shift === !!b.shift &&
    !!a.alt === !!b.alt &&
    a.key.toLowerCase() === b.key.toLowerCase()
  );
}