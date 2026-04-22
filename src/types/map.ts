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

export interface NovelMap {
  id: string
  name: string
  description: string
  type: 'world' | 'region' | 'city' | 'building' | 'custom'
  width: number
  height: number
  backgroundColor: string
  gridVisible: boolean
  gridSize: number
  layers: MapLayer[]
  createdAt: number
  updatedAt: number
}

export type MapTool = 'select' | 'pan' | 'marker' | 'path' | 'shape' | 'text' | 'eraser' | 'brush' | 'fill'

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
