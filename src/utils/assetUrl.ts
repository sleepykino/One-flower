/**
 * assetProtocol 图片 URL 统一封装
 * 全项目禁止 file:// 直引；本地图片显示一律经 convertFileSrc 转为 asset 协议 URL。
 * scope 已在 tauri.conf.json 限定为 $APPDATA/**。
 */

import { convertFileSrc } from '@tauri-apps/api/core';

/** 绝对路径 -> WebView 可显示的 asset 协议 URL */
export function resolveAssetUrl(absolutePath: string | null | undefined): string | null {
  if (!absolutePath) return null;
  try {
    return convertFileSrc(absolutePath);
  } catch {
    console.warn('resolveAssetUrl 失败', absolutePath);
    return null;
  }
}

/** 归一化路径分隔符（Windows 反斜杠 -> /） */
export function normalizePath(p: string): string {
  return p.replace(/\\/g, '/');
}
