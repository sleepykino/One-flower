export interface Point {
  x: number
  y: number
}

export interface MarkerData {
  name: string
  description: string
  icon: string
  color: string
  size: number
  label: string
  labelVisible: boolean
}

export interface PathData {
  points: Point[]
  strokeColor: string
  strokeWidth: number
  strokeDash: number[]
  fillColor: string
  arrow: 'none' | 'start' | 'end' | 'both'
  smooth: boolean
}

export interface ShapeData {
  shapeType: 'rectangle' | 'circle' | 'polygon' | 'ellipse'
  strokeColor: string
  strokeWidth: number
  fillColor: string
  points?: Point[]
}

export interface TextData {
  content: string
  fontSize: number
  fontFamily: string
  color: string
  bold: boolean
  italic: boolean
  align: 'left' | 'center' | 'right'
}

export interface ImageData {
  src: string
  fit: 'fill' | 'contain' | 'cover'
}

export interface MapElement {
  id: string
  type: 'marker' | 'path' | 'shape' | 'text' | 'image'
  x: number
  y: number
  width?: number
  height?: number
  rotation: number
  opacity: number
  data: MarkerData | PathData | ShapeData | TextData | ImageData
}

export interface MapLayer {
  id: string
  name: string
  visible: boolean
  locked: boolean
  opacity: number
  zIndex: number
  elements: MapElement[]
}

export type MapStyle = 'fantasy' | 'realistic' | 'cartoon' | 'ancient' | 'sci-fi' | 'watercolor' | 'ink' | 'custom'

export type GridType = 'square' | 'hex' | 'dot' | 'none'

export interface MapStylePreset {
  id: MapStyle
  name: string
  icon: string
  backgroundColor: string
  gridColor: string
  gridOpacity: number
  pathStyles: { color: string; width: number; dash: number[] }[]
  markerColors: string[]
  description: string
}

export interface NovelMap {
  id: string
  name: string
  description: string
  type: 'world' | 'region' | 'city' | 'building' | 'custom'
  style: MapStyle
  width: number
  height: number
  backgroundColor: string
  gridVisible: boolean
  gridType: GridType
  gridSize: number
  gridColor: string
  gridOpacity: number
  layers: MapLayer[]
  tileData?: TileMapData
  createdAt: number
  updatedAt: number
}

export type MapTool = 'select' | 'pan' | 'marker' | 'path' | 'shape' | 'text' | 'eraser' | 'brush' | 'fill' | 'tile-brush' | 'tile-eraser' | 'tile-fill' | 'tile-line' | 'tile-rect' | 'tile-picker' | 'tile-stamp'

export interface BrushConfig {
  spacing: number
  randomness: number
  sizeScale: number
}

export interface FillConfig {
  density: number
  sizeScale: number
  randomness: number
}

export type ResizeHandleType = 'nw' | 'n' | 'ne' | 'w' | 'e' | 'sw' | 's' | 'se'

export interface SelectionRect {
  x: number
  y: number
  width: number
  height: number
}

export interface MapAsset {
  id: string
  name: string
  category: string
  icon: string
  color: string
}

export const MAP_ICONS: Record<string, MapAsset[]> = {
  location: [
    { id: 'city', name: '城市', category: 'location', icon: '🏙️', color: '#4A90D9' },
    { id: 'village', name: '村庄', category: 'location', icon: '🏘️', color: '#8B7355' },
    { id: 'castle', name: '城堡', category: 'location', icon: '🏰', color: '#6B4423' },
    { id: 'tower', name: '塔楼', category: 'location', icon: '🗼', color: '#708090' },
    { id: 'temple', name: '神庙', category: 'location', icon: '⛩️', color: '#DAA520' },
    { id: 'ruins', name: '遗迹', category: 'location', icon: '🏚️', color: '#8B8682' },
    { id: 'cave', name: '洞穴', category: 'location', icon: '🕳️', color: '#2F4F4F' },
    { id: 'camp', name: '营地', category: 'location', icon: '⛺', color: '#D2691E' },
    { id: 'port', name: '港口', category: 'location', icon: '⚓', color: '#1E90FF' },
    { id: 'bridge', name: '桥梁', category: 'location', icon: '🌉', color: '#A0522D' }
  ],
  terrain: [
    { id: 'mountain', name: '山脉', category: 'terrain', icon: '🏔️', color: '#696969' },
    { id: 'forest', name: '森林', category: 'terrain', icon: '🌲', color: '#228B22' },
    { id: 'river', name: '河流', category: 'terrain', icon: '🌊', color: '#4169E1' },
    { id: 'lake', name: '湖泊', category: 'terrain', icon: '💧', color: '#00CED1' },
    { id: 'desert', name: '沙漠', category: 'terrain', icon: '🏜️', color: '#F4A460' },
    { id: 'plain', name: '平原', category: 'terrain', icon: '🌾', color: '#9ACD32' },
    { id: 'swamp', name: '沼泽', category: 'terrain', icon: '🌿', color: '#556B2F' },
    { id: 'snow', name: '雪地', category: 'terrain', icon: '❄️', color: '#E0FFFF' },
    { id: 'volcano', name: '火山', category: 'terrain', icon: '🌋', color: '#FF4500' },
    { id: 'island', name: '岛屿', category: 'terrain', icon: '🏝️', color: '#32CD32' }
  ],
  special: [
    { id: 'battle', name: '战场', category: 'special', icon: '⚔️', color: '#DC143C' },
    { id: 'treasure', name: '宝藏', category: 'special', icon: '💎', color: '#FFD700' },
    { id: 'magic', name: '魔法', category: 'special', icon: '✨', color: '#9370DB' },
    { id: 'danger', name: '危险', category: 'special', icon: '⚠️', color: '#FF6347' },
    { id: 'quest', name: '任务', category: 'special', icon: '📜', color: '#DAA520' },
    { id: 'portal', name: '传送门', category: 'special', icon: '🌀', color: '#8A2BE2' },
    { id: 'dragon', name: '龙巢', category: 'special', icon: '🐉', color: '#FF4500' },
    { id: 'dungeon', name: '地牢', category: 'special', icon: '🗝️', color: '#2F4F4F' }
  ]
}

export const SHAPE_TYPES = [
  { id: 'rectangle', name: '矩形', icon: '▢' },
  { id: 'circle', name: '圆形', icon: '○' },
  { id: 'ellipse', name: '椭圆', icon: '⬭' },
  { id: 'polygon', name: '多边形', icon: '⬡' }
]

export const PATH_STYLES = [
  { id: 'road', name: '道路', color: '#8B4513', width: 3, dash: [] },
  { id: 'river', name: '河流', color: '#4169E1', width: 4, dash: [] },
  { id: 'border', name: '边界', color: '#FF0000', width: 2, dash: [5, 5] },
  { id: 'trail', name: '小径', color: '#D2691E', width: 2, dash: [3, 3] },
  { id: 'wall', name: '城墙', color: '#2F4F4F', width: 4, dash: [] }
]

export const MAP_STYLES: MapStylePreset[] = [
  { id: 'fantasy', name: '奇幻风格', icon: '🐉', backgroundColor: '#f5e6c8', gridColor: '#a08050', gridOpacity: 0.3, pathStyles: [{ color: '#8B4513', width: 3, dash: [] }, { color: '#4169E1', width: 4, dash: [] }, { color: '#DAA520', width: 2, dash: [5, 5] }], markerColors: ['#4A90D9', '#8B7355', '#6B4423', '#DAA520', '#228B22', '#DC143C'], description: '古典羊皮纸风格，适合架空世界地图' },
  { id: 'realistic', name: '写实风格', icon: '🗺️', backgroundColor: '#e8e8e8', gridColor: '#999999', gridOpacity: 0.15, pathStyles: [{ color: '#696969', width: 3, dash: [] }, { color: '#4169E1', width: 4, dash: [] }, { color: '#FF0000', width: 2, dash: [5, 5] }], markerColors: ['#333333', '#4A90D9', '#228B22', '#FF4500', '#DAA520'], description: '现代写实风格，适合现实场景地图' },
  { id: 'cartoon', name: '卡通风格', icon: '🎨', backgroundColor: '#fffde7', gridColor: '#FFB74D', gridOpacity: 0.4, pathStyles: [{ color: '#FF6F00', width: 4, dash: [] }, { color: '#42A5F5', width: 4, dash: [] }, { color: '#66BB6A', width: 3, dash: [6, 4] }], markerColors: ['#FF6F00', '#42A5F5', '#66BB6A', '#EF5350', '#AB47BC', '#FFCA28'], description: '明亮活泼的卡通风格，适合轻松场景' },
  { id: 'ancient', name: '古风水墨', icon: '🏯', backgroundColor: '#f0ead6', gridColor: '#5c5c5c', gridOpacity: 0.2, pathStyles: [{ color: '#3c3c3c', width: 2, dash: [] }, { color: '#6b8e6b', width: 3, dash: [] }, { color: '#8b0000', width: 2, dash: [4, 4] }], markerColors: ['#3c3c3c', '#8b0000', '#6b8e6b', '#DAA520', '#4a4a4a'], description: '传统水墨风格，适合中国古代地图' },
  { id: 'sci-fi', name: '科幻风格', icon: '🚀', backgroundColor: '#0a0e27', gridColor: '#00ffff', gridOpacity: 0.2, pathStyles: [{ color: '#00ffff', width: 2, dash: [] }, { color: '#ff00ff', width: 3, dash: [] }, { color: '#00ff00', width: 2, dash: [4, 4] }], markerColors: ['#00ffff', '#ff00ff', '#00ff00', '#ff6600', '#ff0066'], description: '暗色科幻风格，适合未来世界地图' },
  { id: 'watercolor', name: '水彩风格', icon: '🖌️', backgroundColor: '#faf0e6', gridColor: '#c4a882', gridOpacity: 0.15, pathStyles: [{ color: '#a0522d', width: 3, dash: [] }, { color: '#5f9ea0', width: 4, dash: [] }, { color: '#bc8f8f', width: 2, dash: [3, 3] }], markerColors: ['#a0522d', '#5f9ea0', '#bc8f8f', '#ddb892', '#8fbc8f'], description: '柔和水彩风格，适合艺术地图' },
  { id: 'ink', name: '黑白水墨', icon: '✒️', backgroundColor: '#ffffff', gridColor: '#000000', gridOpacity: 0.1, pathStyles: [{ color: '#000000', width: 2, dash: [] }, { color: '#333333', width: 3, dash: [] }, { color: '#666666', width: 2, dash: [4, 4] }], markerColors: ['#000000', '#333333', '#666666', '#999999'], description: '极简黑白风格，适合手绘地图' },
  { id: 'custom', name: '自定义', icon: '⚙️', backgroundColor: '#f5f5dc', gridColor: 'rgba(128, 128, 128, 0.2)', gridOpacity: 0.2, pathStyles: [{ color: '#8B4513', width: 3, dash: [] }, { color: '#4169E1', width: 4, dash: [] }, { color: '#FF0000', width: 2, dash: [5, 5] }], markerColors: ['#4A90D9', '#8B7355', '#6B4423', '#DAA520', '#228B22', '#DC143C'], description: '完全自由自定义风格' }
]

export const GRID_TYPES = [
  { id: 'square' as GridType, name: '方格', icon: '⊞' },
  { id: 'hex' as GridType, name: '六边形', icon: '⬡' },
  { id: 'dot' as GridType, name: '点阵', icon: '⋯' },
  { id: 'none' as GridType, name: '无网格', icon: '∅' }
]

/* ===== 瓦片地图系统 ===== */

export interface TileDef {
  id: number
  name: string
  color: string
}

export interface TileSet {
  id: string
  name: string
  tiles: TileDef[]
  stamps: string[]
  bgTile: number
  gridColor: string
}

export interface TileStamp {
  x: number
  y: number
  emoji: string
}

export interface TileLabel {
  x: number
  y: number
  text: string
}

export interface TileMapData {
  tiles: number[]
  tileWidth: number
  tileHeight: number
  tileSetId: string
  stamps: TileStamp[]
  labels: TileLabel[]
  showContour: boolean
}

export const TILE_SETS: Record<string, TileSet> = {
  fantasy: {
    id: 'fantasy', name: '奇幻世界',
    tiles: [
      { id: 0, name: '深海', color: '#1a4a7a' }, { id: 1, name: '海洋', color: '#2d6db3' },
      { id: 2, name: '浅海', color: '#4a9fd4' }, { id: 3, name: '沙滩', color: '#e8d9a0' },
      { id: 4, name: '草原', color: '#7cb342' }, { id: 5, name: '森林', color: '#3f7d2e' },
      { id: 6, name: '丘陵', color: '#a8a04a' }, { id: 7, name: '山脉', color: '#8a7a5c' },
      { id: 8, name: '雪峰', color: '#f0f0f0' }, { id: 9, name: '沙漠', color: '#e0c080' },
      { id: 10, name: '沼泽', color: '#5a6a3a' },
    ],
    stamps: ['🏰','🏘️','⛰️','🌲','💧','🚢','🐉','⛺','🌋','⚓','💠','🌟'],
    bgTile: 0, gridColor: 'rgba(0,0,0,0.08)',
  },
  terrain: {
    id: 'terrain', name: '像素地形',
    tiles: [
      { id: 0, name: '深海', color: '#0d3b66' }, { id: 1, name: '海洋', color: '#1d6fa5' },
      { id: 2, name: '浅海', color: '#5fb3d4' }, { id: 3, name: '海滩', color: '#f4e4a1' },
      { id: 4, name: '草地', color: '#8bc34a' }, { id: 5, name: '森林', color: '#2e7d32' },
      { id: 6, name: '针叶', color: '#4a6a4a' }, { id: 7, name: '苔原', color: '#b0b8a8' },
      { id: 8, name: '岩石', color: '#6b6b6b' }, { id: 9, name: '雪山', color: '#ffffff' },
      { id: 10, name: '沙漠', color: '#e8c87a' }, { id: 11, name: '草原', color: '#c4b06a' },
    ],
    stamps: ['🌲','🌴','🏔️','⛺','🌾','🪨','🌸','☀️','🦌','🌋','❄️','🔆'],
    bgTile: 0, gridColor: 'rgba(0,0,0,0.06)',
  },
  island: {
    id: 'island', name: '孤岛海域',
    tiles: [
      { id: 0, name: '深海', color: '#0a2a4a' }, { id: 1, name: '海洋', color: '#15406e' },
      { id: 2, name: '浅海', color: '#2a6a9a' }, { id: 3, name: '礁石', color: '#4a9ec4' },
      { id: 4, name: '海滩', color: '#f0d894' }, { id: 5, name: '平原', color: '#6fa83f' },
      { id: 6, name: '森林', color: '#357a2e' }, { id: 7, name: '丘陵', color: '#9a8a4a' },
      { id: 8, name: '火山岩', color: '#6b2a2a' }, { id: 9, name: '山顶', color: '#d0d0d0' },
    ],
    stamps: ['🌴','🌲','⛰️','🏝️','🦜','🐚','⚓','🚤','⛺','🌋','💎','🔱'],
    bgTile: 0, gridColor: 'rgba(255,255,255,0.12)',
  },
  trpg: {
    id: 'trpg', name: '跑团地牢',
    tiles: [
      { id: 0, name: '地板', color: '#d8d4cc' }, { id: 1, name: '墙壁', color: '#4a4a4a' },
      { id: 2, name: '门', color: '#8a5a2a' }, { id: 3, name: '水域', color: '#2a5a8a' },
      { id: 4, name: '草地', color: '#5a8a3a' }, { id: 5, name: '岩浆', color: '#d4401a' },
      { id: 6, name: '深坑', color: '#1a1a1a' }, { id: 7, name: '地毯', color: '#8a2a5a' },
    ],
    stamps: ['💎','⚔️','🚪','🗡️','💰','🔥','💀','🌀','📜','⭐','👑','🛡️'],
    bgTile: 1, gridColor: 'rgba(0,0,0,0.25)',
  },
}

export const TILE_SIZES = [
  { value: 48, label: '48 × 48' },
  { value: 80, label: '80 × 80' },
  { value: 128, label: '128 × 128' },
  { value: 192, label: '192 × 192' },
]

export interface TileBrushConfig {
  size: number
  shape: 'square' | 'circle'
}
