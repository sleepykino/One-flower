/**
 * 地图模块类型定义（参考「易制地图」升级版）
 * data 列以 JSON 存储 { nodes, connections, desc, bg }
 */

// ============ 图标元件库 ============

/** 单个图标定义 */
export interface MapIconDef {
  id: string;
  label: string;
  emoji: string;
}

/** 图标分类 */
export interface MapIconCategory {
  key: string;
  label: string;
  icons: MapIconDef[];
}

/** 内置图标元件库（emoji 字形，WebView2 彩色渲染） */
export const ICON_LIBRARY: MapIconCategory[] = [
  {
    key: 'terrain',
    label: '地形',
    icons: [
      { id: 'mountain', label: '山脉', emoji: '⛰️' },
      { id: 'snowpeak', label: '雪山', emoji: '🏔️' },
      { id: 'volcano', label: '火山', emoji: '🌋' },
      { id: 'desert', label: '沙漠', emoji: '🏜️' },
      { id: 'island', label: '岛屿', emoji: '🏝️' },
      { id: 'hills', label: '丘陵', emoji: '🌄' },
      { id: 'valley', label: '溪谷', emoji: '🏞️' },
      { id: 'icefield', label: '冰原', emoji: '❄️' }
    ]
  },
  {
    key: 'water',
    label: '水文',
    icons: [
      { id: 'ocean', label: '海洋', emoji: '🌊' },
      { id: 'lake', label: '湖泊', emoji: '💠' },
      { id: 'river', label: '河流', emoji: '💧' },
      { id: 'spring', label: '泉水', emoji: '⛲' },
      { id: 'hotspring', label: '温泉', emoji: '♨️' },
      { id: 'waterfall', label: '瀑布', emoji: '💦' },
      { id: 'wetland', label: '湿地', emoji: '🦆' }
    ]
  },
  {
    key: 'vegetation',
    label: '植被',
    icons: [
      { id: 'forest', label: '森林', emoji: '🌲' },
      { id: 'jungle', label: '丛林', emoji: '🌴' },
      { id: 'grassland', label: '草原', emoji: '🌾' },
      { id: 'autumn', label: '秋林', emoji: '🍁' },
      { id: 'gobi', label: '戈壁', emoji: '🌵' }
    ]
  },
  {
    key: 'settlement',
    label: '聚居',
    icons: [
      { id: 'city', label: '城市', emoji: '🏙️' },
      { id: 'town', label: '城镇', emoji: '🏘️' },
      { id: 'village', label: '村庄', emoji: '🏡' },
      { id: 'tribe', label: '部落', emoji: '🛖' },
      { id: 'camp', label: '营地', emoji: '⛺' },
      { id: 'ruins', label: '废墟', emoji: '🏚️' },
      { id: 'farm', label: '农场', emoji: '🚜' },
      { id: 'fishing', label: '渔村', emoji: '🐟' }
    ]
  },
  {
    key: 'building',
    label: '建筑',
    icons: [
      { id: 'castle', label: '城堡', emoji: '🏰' },
      { id: 'palace', label: '宫殿', emoji: '🏛️' },
      { id: 'temple', label: '神殿', emoji: '🕌' },
      { id: 'shrine', label: '神社', emoji: '⛩️' },
      { id: 'tower', label: '高塔', emoji: '🗼' },
      { id: 'bridge', label: '桥梁', emoji: '🌉' },
      { id: 'tavern', label: '酒馆', emoji: '🍺' },
      { id: 'market', label: '集市', emoji: '🛒' },
      { id: 'academy', label: '学院', emoji: '🎓' },
      { id: 'cemetery', label: '墓地', emoji: '🪦' }
    ]
  },
  {
    key: 'military',
    label: '军事',
    icons: [
      { id: 'fortress', label: '要塞', emoji: '🛡️' },
      { id: 'battle', label: '战场', emoji: '⚔️' },
      { id: 'barracks', label: '军营', emoji: '🏕️' },
      { id: 'beacon', label: '烽火台', emoji: '🔥' },
      { id: 'pass', label: '关隘', emoji: '🚩' }
    ]
  },
  {
    key: 'fantasy',
    label: '奇幻',
    icons: [
      { id: 'cave', label: '洞穴', emoji: '🕳️' },
      { id: 'dragon', label: '龙巢', emoji: '🐉' },
      { id: 'secret', label: '秘境', emoji: '🌀' },
      { id: 'astro', label: '占星台', emoji: '🔮' },
      { id: 'relic', label: '遗迹', emoji: '🗿' },
      { id: 'crystal', label: '水晶矿', emoji: '💎' },
      { id: 'mine', label: '矿坑', emoji: '⛏️' },
      { id: 'holy', label: '圣地', emoji: '✨' },
      { id: 'demon', label: '魔窟', emoji: '🌙' },
      { id: 'teleport', label: '传送门', emoji: '🚪' },
      { id: 'harbor', label: '港口', emoji: '⚓' },
      { id: 'stable', label: '驿站', emoji: '🐎' }
    ]
  }
];

/** id -> 图标定义（含旧版 15 个 id，全部已收录在新库中） */
export const ICON_MAP: Map<string, MapIconDef> = new Map(
  ICON_LIBRARY.flatMap((c) => c.icons).map((i): [string, MapIconDef] => [i.id, i])
);

/** 取图标 emoji，未知 id（含旧值）回退 ⭐ */
export function iconEmoji(id?: string): string {
  if (!id) return '📍';
  return ICON_MAP.get(id)?.emoji ?? '📍';
}

/** id -> 图标中文标签 */
export function iconLabel(id?: string): string {
  if (!id) return '无';
  return ICON_MAP.get(id)?.label ?? id;
}

// ============ 瓦片地形库 ============

/** 单个地形瓦片定义 */
export interface MapTerrainDef {
  id: string;
  label: string;
  emoji: string;
  /** 底色（瓦片矩形填充） */
  color: string;
}

/** 地形分类 */
export interface MapTerrainCategory {
  key: string;
  label: string;
  terrains: MapTerrainDef[];
}

/** 内置地形瓦片库（色块 + emoji 纹理） */
export const TERRAIN_LIBRARY: MapTerrainCategory[] = [
  {
    key: 'water',
    label: '水域',
    terrains: [
      { id: 'deepwater', label: '深海', emoji: '🌊', color: '#2a6a97' },
      { id: 'water', label: '浅海', emoji: '💧', color: '#5aa3c9' },
      { id: 'river', label: '河流', emoji: '🏞️', color: '#8cc3e0' },
      { id: 'swamp', label: '沼泽', emoji: '🦆', color: '#6f8f6e' }
    ]
  },
  {
    key: 'plain',
    label: '平原',
    terrains: [
      { id: 'grass', label: '草原', emoji: '🌿', color: '#a9c98c' },
      { id: 'plain', label: '旷野', emoji: '🌾', color: '#d3e0a9' },
      { id: 'farm', label: '农田', emoji: '🚜', color: '#e6cf94' },
      { id: 'sand', label: '沙滩', emoji: '🏖️', color: '#eedfb4' },
      { id: 'desert', label: '沙漠', emoji: '🏜️', color: '#e7c98d' }
    ]
  },
  {
    key: 'forest',
    label: '植被',
    terrains: [
      { id: 'forest', label: '森林', emoji: '🌳', color: '#639e67' },
      { id: 'pine', label: '松林', emoji: '🌲', color: '#4c8a5c' },
      { id: 'jungle', label: '丛林', emoji: '🌴', color: '#3f8f4f' },
      { id: 'autumn', label: '秋林', emoji: '🍁', color: '#c98f52' }
    ]
  },
  {
    key: 'mountain',
    label: '山地',
    terrains: [
      { id: 'hill', label: '丘陵', emoji: '🌄', color: '#b7a87f' },
      { id: 'mountain', label: '山脉', emoji: '⛰️', color: '#928a7c' },
      { id: 'snow', label: '雪原', emoji: '🏔️', color: '#e6ecf2' },
      { id: 'volcano', label: '火山', emoji: '🌋', color: '#a35c4c' },
      { id: 'ice', label: '冰川', emoji: '❄️', color: '#d8e9f2' }
    ]
  },
  {
    key: 'manmade',
    label: '人造',
    terrains: [
      { id: 'road', label: '道路', emoji: '🛣️', color: '#d8c8a6' },
      { id: 'bridge', label: '桥', emoji: '🌉', color: '#c9b896' },
      { id: 'town', label: '街区', emoji: '🏘️', color: '#c2a688' },
      { id: 'ruins', label: '废墟', emoji: '🏚️', color: '#b2a496' }
    ]
  }
];

/** id -> 地形定义 */
export const TERRAIN_MAP: Map<string, MapTerrainDef> = new Map(
  TERRAIN_LIBRARY.flatMap((c) => c.terrains).map((t): [string, MapTerrainDef] => [t.id, t])
);

/** 取地形定义，空/未知返回 undefined */
export function terrainDef(id?: string): MapTerrainDef | undefined {
  if (!id) return undefined;
  return TERRAIN_MAP.get(id);
}

/** 默认瓦片边长（px） */
export const TILE_SIZE = 32;

/** 瓦片地形层（存 data JSON，data 数组元素为地形 id 或 '' 空） */
export interface MapTiles {
  cols: number;
  rows: number;
  /** 单格像素边长 */
  size: number;
  /** 长度恒为 cols * rows */
  data: string[];
}

/** 创建全空瓦片层 */
export function createEmptyTiles(cols: number, rows: number, size = TILE_SIZE): MapTiles {
  return { cols, rows, size, data: new Array<string>(cols * rows).fill('') };
}

// ============ 数据模型 ============

/** 地图节点（location=地点 / marker=文字标注 / region=区域多边形） */
export interface MapNode {
  id: string;
  type: 'location' | 'marker' | 'region';
  label: string;
  x: number;
  y: number;
  /** icon=图标元件（推荐），circle/rect/polygon=几何形状 */
  shape: 'icon' | 'circle' | 'rect' | 'polygon';
  /** circle / icon 底圆半径 */
  radius?: number;
  /** rect 用 */
  width?: number;
  height?: number;
  /** polygon / region：相对节点 x/y 的顶点 [x1,y1,x2,y2,...] */
  points?: number[];
  color: string;
  /** 关联的世界书条目 id */
  worldbookEntryId?: string;
  /** 图标元件 id（ICON_LIBRARY） */
  icon?: string;
  /** 整体缩放 0.2~4，默认 1 */
  scale?: number;
  /** 旋转角 0~359，默认 0 */
  rotation?: number;
  /** 不透明度 0~1，默认 1 */
  opacity?: number;
  /** 层级，越大越靠上，默认 0 */
  zIndex?: number;
  /** 描述（导出/展示时可检索） */
  desc?: string;
}

/** 节点连线（道路 / 航线 / 河流走向等） */
export interface MapConnection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  label: string;
  style: 'solid' | 'dashed';
  /** 直线 / 弧线（弧线更接近手绘地图的道路） */
  lineType?: 'straight' | 'curve';
  /** 线宽 1~8，默认 2 */
  width?: number;
  /** 线色，默认 #8a8070 */
  color?: string;
  /** 终点方向箭头，默认 false */
  arrow?: boolean;
}

/** 底图变换（存 data JSON；图片文件存 appData，background 存相对路径） */
export interface MapBackgroundTransform {
  x: number;
  y: number;
  scale: number;
  /** 锁定后不可拖动/缩放 */
  locked?: boolean;
}

/** 一张地图（对应 maps 表一行） */
export interface NovelMap {
  id: string;
  bookId: string;
  name: string;
  width: number;
  height: number;
  /** 底图相对路径（相对 appData 目录），如 maps/<id>.png */
  background?: string;
  /** 底图变换与锁定 */
  bg?: MapBackgroundTransform;
  /** 地图描述 */
  desc?: string;
  /** 瓦片地形层（可无） */
  tiles?: MapTiles;
  nodes: MapNode[];
  connections: MapConnection[];
  createdAt: number;
  updatedAt: number;
}

// ============ 常量 ============

/** 预设色板（10 色） */
export const PALETTE = [
  '#7c3aed',
  '#2563eb',
  '#0891b2',
  '#16a34a',
  '#ca8a04',
  '#ea580c',
  '#dc2626',
  '#db2777',
  '#524c44',
  '#1f2937'
];

/** 图层 key 与中文名（图层显隐面板用） */
export interface LayerVisibility {
  bg: boolean;
  tile: boolean;
  region: boolean;
  conn: boolean;
  node: boolean;
  marker: boolean;
}

export const LAYER_LABELS: Array<{ key: keyof LayerVisibility; label: string }> = [
  { key: 'bg', label: '底图' },
  { key: 'tile', label: '地形' },
  { key: 'region', label: '区域' },
  { key: 'conn', label: '连线' },
  { key: 'node', label: '地点' },
  { key: 'marker', label: '标注' }
];
