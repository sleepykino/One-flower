/**
 * 外观子页（P2 三期）：编辑器字体 / 字号
 * 与编辑器工具栏共用 localStorage（utils/editorAppearance），双入口实时同步
 */

import { useEffect, useState } from 'react';
import {
  FONT_FAMILIES,
  FONT_SIZES,
  loadFontSize,
  loadFontFamily,
  saveFontSize,
  saveFontFamily
} from '../../utils/editorAppearance';

export function AppearanceSection(): JSX.Element {
  const [fontSize, setFontSize] = useState<number>(loadFontSize);
  const [fontFamily, setFontFamily] = useState<string>(loadFontFamily);

  useEffect(() => {
    const sync = (): void => {
      setFontSize(loadFontSize());
      setFontFamily(loadFontFamily());
    };
    window.addEventListener('editor-appearance-change', sync);
    return () => window.removeEventListener('editor-appearance-change', sync);
  }, []);

  const changeFontSize = (v: number): void => {
    setFontSize(v);
    saveFontSize(v);
    window.dispatchEvent(new Event('editor-appearance-change'));
  };

  const changeFontFamily = (v: string): void => {
    setFontFamily(v);
    saveFontFamily(v);
    window.dispatchEvent(new Event('editor-appearance-change'));
  };

  return (
    <div>
      <h2 className="mb-1 font-medium">编辑器</h2>
      <p className="mb-3 text-xs text-ink-400">
        正文显示字体与字号，编辑器工具栏也可快捷调整（两处同步）。
      </p>

      <div className="rounded border border-ink-100 bg-white px-3 py-3">
        <div className="mb-2 text-xs font-medium text-ink-600">字体</div>
        <div className="grid grid-cols-3 gap-1.5">
          {FONT_FAMILIES.map((f) => (
            <button
              key={f.value}
              type="button"
              onClick={() => changeFontFamily(f.value)}
              style={{ fontFamily: f.css }}
              className={`rounded border px-2 py-1.5 text-sm ${
                fontFamily === f.value
                  ? 'border-violet-400 bg-violet-50 text-violet-700'
                  : 'border-ink-200 hover:bg-ink-50'
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="mb-2 mt-4 text-xs font-medium text-ink-600">字号</div>
        <div className="flex flex-wrap gap-1.5">
          {FONT_SIZES.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => changeFontSize(s)}
              className={`h-9 w-12 rounded border text-sm ${
                fontSize === s
                  ? 'border-violet-400 bg-violet-50 font-medium text-violet-700'
                  : 'border-ink-200 hover:bg-ink-50'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* 预览 */}
        <div className="mt-4 rounded bg-ink-50 px-3 py-3">
          <div className="mb-1 text-[10px] text-ink-400">预览</div>
          <div
            style={{
              fontFamily: FONT_FAMILIES.find((f) => f.value === fontFamily)?.css,
              fontSize: `${fontSize}px`,
              lineHeight: 1.8
            }}
          >
            灯下提笔，一花一世界。The quick brown fox jumps over the lazy dog.
          </div>
        </div>
      </div>
    </div>
  );
}
