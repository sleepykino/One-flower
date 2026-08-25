/**
 * 快捷键设置：列出所有可自定义的命令，支持改绑（按键捕获）与恢复默认
 * 持久化在 localStorage（oneflower.shortcuts），修改后即时生效
 */

import { useEffect, useState } from 'react';
import {
  SHORTCUT_DEFS,
  comboFromEvent,
  findConflict,
  formatCombo,
  getEffectiveShortcuts,
  isComboAllowed,
  resetShortcut,
  setCustomShortcut,
  type KeyCombo,
  type ShortcutId
} from '../../utils/keymap';

export function ShortcutsSection(): JSX.Element {
  const [keymap, setKeymap] = useState<Record<ShortcutId, KeyCombo>>(() =>
    getEffectiveShortcuts()
  );
  const [capturing, setCapturing] = useState<ShortcutId | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const refresh = (): void => setKeymap(getEffectiveShortcuts());

  // 捕获按键组合：按下有效组合即保存
  useEffect(() => {
    if (!capturing) return;
    const onKey = (e: KeyboardEvent): void => {
      e.preventDefault();
      e.stopPropagation();
      const combo = comboFromEvent(e);
      if (!combo) return; // 纯修饰键，继续等待
      if (!isComboAllowed(combo)) {
        setError('请至少包含 Ctrl/Alt，或使用 F 功能键（避免覆盖文本输入）');
        return;
      }
      const others = Object.entries(keymap) as Array<[ShortcutId, KeyCombo]>;
      const conflict = findConflict(capturing, combo, others);
      if (conflict) {
        setError(`与「${SHORTCUT_DEFS[conflict].label}」冲突，请换一个组合键`);
        return;
      }
      setCustomShortcut(capturing, combo);
      setKeymap((k) => ({ ...k, [capturing]: combo }));
      setCapturing(null);
      setError(null);
      setNotice(`已更新「${SHORTCUT_DEFS[capturing].label}」为 ${formatCombo(combo)}`);
    };
    window.addEventListener('keydown', onKey, { capture: true });
    return () => window.removeEventListener('keydown', onKey, { capture: true });
  }, [capturing, keymap]);

  const applyReset = (id: ShortcutId): void => {
    resetShortcut(id);
    refresh();
    setError(null);
    setNotice(`已恢复「${SHORTCUT_DEFS[id].label}」为默认 ${formatCombo(SHORTCUT_DEFS[id].default)}`);
  };

  const ids = Object.keys(SHORTCUT_DEFS) as ShortcutId[];

  return (
    <div className="space-y-3">
      <p className="text-xs text-ink-500">
        自定义全局快捷键（Ctrl 与 Cmd 等价）。修改即时生效；设置的组合不会覆盖正文输入、引用触发（@ / [[ / ##）等编辑器内语义。
      </p>
      {notice && (
        <div className="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-700">{notice}</div>
      )}
      {error && (
        <div className="rounded bg-red-50 px-3 py-2 text-xs text-red-600">{error}</div>
      )}
      {ids.map((id) => {
        const def = SHORTCUT_DEFS[id];
        const combo = keymap[id];
        const isDefault =
          combo.ctrl === def.default.ctrl &&
          combo.shift === def.default.shift &&
          combo.alt === def.default.alt &&
          combo.key.toLowerCase() === def.default.key.toLowerCase();
        return (
          <div
            key={id}
            className="flex items-center gap-3 rounded-lg border border-ink-200 bg-white p-3"
          >
            <div className="min-w-0 flex-1">
              <div className="text-sm font-medium">{def.label}</div>
              <div className="text-xs text-ink-400">{def.description}</div>
            </div>
            {capturing === id ? (
              <span className="animate-pulse rounded bg-violet-50 px-3 py-1.5 text-xs text-violet-700">
                按下新组合键…
              </span>
            ) : (
              <kbd className="rounded border border-ink-200 bg-ink-50 px-2.5 py-1 font-mono text-xs">
                {formatCombo(combo)}
              </kbd>
            )}
            <button
              type="button"
              className="rounded border border-ink-200 px-2.5 py-1 text-xs hover:bg-ink-100"
              onClick={() => {
                if (capturing === id) {
                  setCapturing(null);
                  setError(null);
                  return;
                }
                setCapturing(id);
                setError(null);
                setNotice(null);
              }}
            >
              {capturing === id ? '取消' : '修改'}
            </button>
            <button
              type="button"
              disabled={isDefault}
              className="rounded border border-ink-200 px-2.5 py-1 text-xs text-ink-500 hover:bg-ink-100 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={() => applyReset(id)}
            >
              恢复默认
            </button>
          </div>
        );
      })}
    </div>
  );
}