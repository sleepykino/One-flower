/**
 * 地图 data JSON 迁移（P4-M3 建立，P4.1 升 v2）
 * - v0（无 version）/ v1（tiles 单层）-> v2（tileLayers 多层，v1 tiles 迁移为第 0 层）
 * - 高于当前版本的数据原样透传（向前兼容：旧应用读新数据不崩溃）
 * 结构演化一律在此追加版本分支，不散落 ?? 默认值
 */

import type {
  MapBackgroundTransform,
  MapConnection,
  MapData,
  MapNode,
  MapTileLayer,
  MapTiles
} from './types';

/** 当前 data 结构版本 */
export const MAP_DATA_VERSION = 2;

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

/** 容错读取瓦片层（损坏层丢弃，不拖垮整张地图） */
function normalizeLayer(v: unknown, fallbackName: string): MapTileLayer | null {
  if (!v || typeof v !== 'object') return null;
  const l = v as Partial<MapTileLayer>;
  if (!validTiles(l.tiles)) return null;
  return {
    id: typeof l.id === 'string' && l.id !== '' ? l.id : crypto.randomUUID(),
    name: typeof l.name === 'string' && l.name !== '' ? l.name : fallbackName,
    visible: l.visible !== false,
    tiles: l.tiles
  };
}

/**
 * 旧 data JSON 容错升级到当前版本（可传字符串或已解析对象）
 * v0/v1（tiles 单层）-> v2（tileLayers 多层）
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
  const d = obj as Partial<MapData> & { tiles?: MapTiles };

  // v2：多层瓦片
  let tileLayers: MapTileLayer[];
  if (Array.isArray(d.tileLayers)) {
    tileLayers = d.tileLayers
      .map((l, i) => normalizeLayer(l, `图层 ${i + 1}`))
      .filter((l): l is MapTileLayer => l !== null);
  } else {
    // v0/v1：单层 tiles -> 第 0 层
    tileLayers = validTiles(d.tiles)
      ? [{ id: crypto.randomUUID(), name: '地形', visible: true, tiles: d.tiles }]
      : [];
  }

  return {
    version: MAP_DATA_VERSION,
    nodes: asArray<MapNode>(d.nodes),
    connections: asArray<MapConnection>(d.connections),
    desc: typeof d.desc === 'string' ? d.desc : undefined,
    bg:
      d.bg && typeof d.bg === 'object' && !Array.isArray(d.bg)
        ? (d.bg as MapBackgroundTransform)
        : undefined,
    tileLayers,
    activeTileLayer:
      typeof d.activeTileLayer === 'number' && d.activeTileLayer >= 0 && d.activeTileLayer < tileLayers.length
        ? d.activeTileLayer
        : 0
  };
}
