/**
 * 地图模块类型定义（P2）：节点 / 连线 / 地图
 * data 列以 JSON 存储 { nodes, connections }
 */

/** 常用图标（优化项：地点节点的矢量符号） */
export type MapIcon =
  | 'city'
  | 'castle'
  | 'mountain'
  | 'forest'
  | 'river'
  | 'lake'
  | 'port'
  | 'ruins'
  | 'cave'
  | 'tower'
  | 'bridge'
  | 'camp'
  | 'shrine'
  | 'village'
  | 'battle';

/** 地图节点（location=地点 / marker=文字标注小圆点 / region=区域） */
export interface MapNode {
  id: string;
  type: 'location' | 'marker' | 'region';
  label: string;
  x: number;
  y: number;
  shape: 'circle' | 'rect' | 'polygon';
  /** circle 用 */
  radius?: number;
  /** rect 用 */
  width?: number;
  height?: number;
  /** polygon 用：相对节点 x/y 的顶点坐标 [x1, y1, x2, y2, ...] */
  points?: number[];
  color: string;
  /** 关联的世界书条目 id */
  worldbookEntryId?: string;
  /** 常用图标（优化项） */
  icon?: MapIcon;
}

/** 节点连线（道路 / 航线等） */
export interface MapConnection {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  label: string;
  style: 'solid' | 'dashed';
}

/** 一张地图（对应 maps 表一行，data 列拆为 nodes/connections） */
export interface NovelMap {
  id: string;
  bookId: string;
  name: string;
  width: number;
  height: number;
  background?: string;
  nodes: MapNode[];
  connections: MapConnection[];
  createdAt: number;
  updatedAt: number;
}

/** 图标下拉选项（中文标签） */
export const ICON_OPTIONS: Array<{ value: MapIcon; label: string }> = [
  { value: 'city', label: '城市' },
  { value: 'castle', label: '城堡' },
  { value: 'mountain', label: '山脉' },
  { value: 'forest', label: '森林' },
  { value: 'river', label: '河流' },
  { value: 'lake', label: '湖泊' },
  { value: 'port', label: '港口' },
  { value: 'ruins', label: '遗迹' },
  { value: 'cave', label: '洞穴' },
  { value: 'tower', label: '高塔' },
  { value: 'bridge', label: '桥梁' },
  { value: 'camp', label: '营地' },
  { value: 'shrine', label: '神殿' },
  { value: 'village', label: '村庄' },
  { value: 'battle', label: '战场' }
];
