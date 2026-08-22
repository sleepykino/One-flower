/**
 * 地图 data JSON 迁移（P4-M3 预留）
 * 读取时缺失 version 视为 v0，统一升级到 MAP_DATA_VERSION；
 * 后续结构演化（多图层 tileLayers / 素材引用等）在此追加版本分支，不散落 ?? 默认值
 */

import type { MapBackgroundTransform, MapConnection, MapData, MapNode, MapTiles } from './types';

/** 当前 data 结构版本 */
export const MAP_DATA_VERSION = 1;

function asArray<T>(v: unknown): T[] {
  return Array.isArray(v) ? (v as T[]) : [];
}

/** 瓦片层数据校验：cols/rows 为正且 data 长度匹配 */
function validTiles(t: unknown): t is MapTiles {
  if (!t || typeof t !== 'object') return false;
  const tiles = t as MapTiles;
  return (
    Number.isInteger(tiles.cols) &&
    tiles.cols > 0 &&
    Number.isInteger(tiles.rows) &&
    tiles.rows > 0 &&
    Array.isArray(tiles.data) &&
    tiles.data.length === tiles.cols * tiles.rows
  );
}

/**
 * 旧 data JSON 容错升级到当前版本（可传字符串或已解析对象）
 * - v0（无 version）：补默认结构 -> v1（version=1）
 * - 高于当前版本的数据原样透传（向前兼容：旧应用读新数据不崩溃）
 */
export function migrateMapData(raw: unknown): MapData {
  let obj: unknown = raw;
  if (typeof obj === 'string') {
    try {
      obj = JSON.parse(obj);
    } catch {
      obj = {};
    }
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) obj = {};
  const d = obj as Partial<MapData>;
  // v0 -> v1：仅补 version 与字段容错（结构未变）
  return {
    version: MAP_DATA_VERSION,
    nodes: asArray<MapNode>(d.nodes),
    connections: asArray<MapConnection>(d.connections),
    desc: typeof d.desc === 'string' ? d.desc : undefined,
    bg:
      d.bg && typeof d.bg === 'object' && !Array.isArray(d.bg)
        ? (d.bg as MapBackgroundTransform)
        : undefined,
    tiles: validTiles(d.tiles) ? d.tiles : undefined
  };
}
