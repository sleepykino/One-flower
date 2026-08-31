/**
 * 全局主题工具（P7.5）：浅色 / 深色 / 护眼 三主题
 * - 单一事实源：<html data-theme> 属性（色板变量定义见 index.css）
 * - 持久化：app_settings 键 ui.theme（切换处写入；启动注入在 main.tsx）
 * - 事件：'app-theme-change'，供订阅方同步（设置页高亮 / 顶栏按钮 / canvas 组件）
 */

import { useEffect, useState } from 'react';

export type AppTheme = 'light' | 'dark' | 'sepia';

/** app_settings 持久化键 */
export const THEME_KEY = 'ui.theme';

export interface ThemeOption {
  value: AppTheme;
  label: string;
}

export const THEME_OPTIONS: ThemeOption[] = [
  { value: 'light', label: '浅色' },
  { value: 'dark', label: '深色' },
  { value: 'sepia', label: '护眼' }
];

export const THEME_LABELS: Record<AppTheme, string> = {
  light: '浅色',
  dark: '深色',
  sepia: '护眼'
};

/** 应用主题：写 <html data-theme> 并广播事件 */
export function applyTheme(t: AppTheme): void {
  document.documentElement.dataset.theme = t;
  window.dispatchEvent(new Event('app-theme-change'));
}

/** 当前主题（缺省浅色，兼容未初始化） */
export function currentTheme(): AppTheme {
  return (document.documentElement.dataset.theme as AppTheme) ?? 'light';
}

/** 下一主题（顶栏循环按钮：浅色 → 深色 → 护眼 → 浅色） */
export function cycleTheme(t: AppTheme): AppTheme {
  const idx = THEME_OPTIONS.findIndex((o) => o.value === t);
  return THEME_OPTIONS[(idx + 1) % THEME_OPTIONS.length].value;
}

/** 校验持久化值（非法值回落浅色，兼容存量未设置） */
export function parseTheme(v: string | null): AppTheme {
  return v === 'dark' || v === 'sepia' ? v : 'light';
}

/** 订阅全局主题（canvas 等非 DOM 渲染组件用；DOM 组件直接走 CSS 变量无需订阅） */
export function useAppTheme(): AppTheme {
  const [theme, setTheme] = useState<AppTheme>(currentTheme);
  useEffect(() => {
    const sync = (): void => setTheme(currentTheme());
    window.addEventListener('app-theme-change', sync);
    return () => window.removeEventListener('app-theme-change', sync);
  }, []);
  return theme;
}

/** 画布（Konva / 导出位图等）三主题配色：hex 常量，CSS 变量对 canvas 无效 */
export interface CanvasColors {
  bg: string; // 画布底
  bgBorder: string; // 画布边界虚线框
  grid: string; // 网格线
  label: string; // 节点主标签 / 面板文字
  sub: string; // 次标签 / 默认连线色
  panel: string; // 标签面板 / 手柄底
  panelBorder: string; // 面板边框
  nodeRing: string; // 节点描边圈
}

export const CANVAS_COLORS: Record<AppTheme, CanvasColors> = {
  light: {
    bg: '#fdfcf8',
    bgBorder: '#c9c2b4',
    grid: '#ece7dc',
    label: '#23211e',
    sub: '#8a8070',
    panel: '#ffffff',
    panelBorder: '#d9d4ca',
    nodeRing: '#ffffff'
  },
  dark: {
    bg: '#1c1c1e',
    bgBorder: '#3d3d44',
    grid: '#26262a',
    label: '#d6d3cd',
    sub: '#8b8b96',
    panel: '#232327',
    panelBorder: '#3d3d44',
    nodeRing: '#48484f'
  },
  sepia: {
    bg: '#f8f3e6',
    bgBorder: '#c4b69a',
    grid: '#ece4cd',
    label: '#5b4a32',
    sub: '#9c8a6e',
    panel: '#fdfaf2',
    panelBorder: '#ddd2b8',
    nodeRing: '#fdfaf2'
  }
};