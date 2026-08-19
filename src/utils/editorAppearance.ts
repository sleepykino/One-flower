/**
 * 编辑器外观共享配置（P2 三期）：设置页「外观」与编辑器工具栏共用
 * localStorage 持久化，双入口同步
 */

export const FONT_SIZE_KEY = 'novel-editor-font-size';
export const FONT_FAMILY_KEY = 'novel-editor-font-family';

export const FONT_SIZES = [14, 15, 16, 17, 18, 20, 22, 24];

/** 字体选项（Windows 常见中文字体 + 西文衬线） */
export const FONT_FAMILIES: Array<{ value: string; label: string; css: string }> = [
  { value: 'default', label: '默认', css: "'Segoe UI', 'Microsoft YaHei', system-ui, sans-serif" },
  { value: 'simsun', label: '宋体', css: 'SimSun, serif' },
  { value: 'kaiti', label: '楷体', css: 'KaiTi, serif' },
  { value: 'fangsong', label: '仿宋', css: 'FangSong, serif' },
  { value: 'simhei', label: '黑体', css: 'SimHei, sans-serif' },
  { value: 'yahei', label: '微软雅黑', css: "'Microsoft YaHei', sans-serif" },
  { value: 'dengxian', label: '等线', css: 'DengXian, sans-serif' },
  { value: 'georgia', label: 'Georgia', css: 'Georgia, serif' },
  { value: 'times', label: 'Times New Roman', css: "'Times New Roman', serif" }
];

export function loadFontSize(): number {
  const v = Number(localStorage.getItem(FONT_SIZE_KEY));
  return FONT_SIZES.includes(v) ? v : 16;
}

export function loadFontFamily(): string {
  return localStorage.getItem(FONT_FAMILY_KEY) || 'default';
}

export function saveFontSize(v: number): void {
  localStorage.setItem(FONT_SIZE_KEY, String(v));
}

export function saveFontFamily(v: string): void {
  localStorage.setItem(FONT_FAMILY_KEY, v);
}
