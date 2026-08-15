<template>
  <div ref="viewportRef" class="canvas-viewport">
    <div ref="wrapRef" class="canvas-wrap" :class="{ 'pan-mode': isPanMode, panning }">
      <canvas ref="mapCanvasRef" class="layer" />
      <canvas ref="gridCanvasRef" class="layer" />
      <canvas
        ref="overlayCanvasRef"
        class="layer overlay-interactive"
        @pointerdown="onPointerDown"
        @contextmenu="onContextMenu"
      />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch, onMounted, onUnmounted, nextTick } from 'vue'
import type { MapTool } from '@/types/map'
import { TILE_SETS } from '@/types/map'

const props = defineProps<{
  map: any | null
  tool: MapTool
  currentTile: number
  currentStamp: string
  brushSize: number
  brushShape: 'square' | 'circle'
  showGrid: boolean
  showContour: boolean
  layerVisible: { terrain: boolean; grid: boolean; label: boolean }
}>()

const emit = defineEmits<{
  (e: 'update:zoom', zoom: number): void
  (e: 'hover-coords', coords: { x: number; y: number } | null): void
  (e: 'commit-tile-history'): void
  (e: 'add-tile-label', x: number, y: number, text: string): void
  (e: 'tile-picked', tileId: number): void
}>()

/* ===== 常量 ===== */
const ZOOM_STEPS = [3, 4, 6, 8, 10, 12, 16, 20, 24, 32]
const BASE_TILE = 8

/* ===== DOM 引用 ===== */
const viewportRef = ref<HTMLDivElement | null>(null)
const wrapRef = ref<HTMLDivElement | null>(null)
const mapCanvasRef = ref<HTMLCanvasElement | null>(null)
const gridCanvasRef = ref<HTMLCanvasElement | null>(null)
const overlayCanvasRef = ref<HTMLCanvasElement | null>(null)

let mapCtx: CanvasRenderingContext2D | null = null
let gridCtx: CanvasRenderingContext2D | null = null
let overlayCtx: CanvasRenderingContext2D | null = null

/* 低分辨率离屏画布（每 tile 1 像素） */
const offCanvas = document.createElement('canvas')
const offCtx = offCanvas.getContext('2d')

/* ===== 状态 ===== */
const tileSize = ref(BASE_TILE)
const drawing = ref(false)
const lastTile = ref<[number, number] | null>(null)
const panning = ref(false)
const spaceDown = ref(false)
const pendingLabel = ref<string | null>(null)
const preview = ref<{ tool: string; x0: number; y0: number; x1: number; y1: number } | null>(null)
let panStart: { x: number; y: number; sx: number; sy: number } | null = null

const isPanMode = computed(() => props.tool === 'pan' || spaceDown.value)
const tileData = computed(() => props.map?.tileData ?? null)

/* 颜色查找缓存 */
const rgbCache: Record<string, { r: number; g: number; b: number }> = {}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const h = hex.replace('#', '')
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) }
}

function tileRGB(tileSetId: string, id: number) {
  const key = tileSetId + '_' + id
  if (rgbCache[key]) return rgbCache[key]
  const t = TILE_SETS[tileSetId]?.tiles.find(x => x.id === id)
  const c = t ? hexToRgb(t.color) : { r: 0, g: 0, b: 0 }
  rgbCache[key] = c
  return c
}

/* ===== 画布尺寸设置 ===== */
function setupCanvas() {
  const td = tileData.value
  if (!td) return
  const w = td.tileWidth * tileSize.value
  const h = td.tileHeight * tileSize.value
  for (const c of [mapCanvasRef.value, gridCanvasRef.value, overlayCanvasRef.value]) {
    if (!c) continue
    c.width = w
    c.height = h
    c.style.width = w + 'px'
    c.style.height = h + 'px'
  }
  if (wrapRef.value) {
    wrapRef.value.style.width = w + 'px'
    wrapRef.value.style.height = h + 'px'
  }
  offCanvas.width = td.tileWidth
  offCanvas.height = td.tileHeight
  if (mapCtx) mapCtx.imageSmoothingEnabled = false
}

/* ===== 渲染 ===== */
function renderAll() {
  renderMap()
  renderGrid()
  renderOverlay()
}

function renderMap() {
  const td = tileData.value
  if (!mapCtx || !td) return
  const w = td.tileWidth, h = td.tileHeight, ts = tileSize.value
  mapCtx.clearRect(0, 0, mapCanvasRef.value!.width, mapCanvasRef.value!.height)
  if (!props.layerVisible.terrain) return

  /* 低分辨率 ImageData + GPU 缩放 */
  const img = offCtx!.createImageData(w, h)
  const data = img.data
  for (let i = 0; i < w * h; i++) {
    const col = tileRGB(td.tileSetId, td.tiles[i])
    const o = i * 4
    data[o] = col.r; data[o + 1] = col.g; data[o + 2] = col.b; data[o + 3] = 255
  }
  offCtx!.putImageData(img, 0, 0)
  mapCtx.imageSmoothingEnabled = false
  mapCtx.drawImage(offCanvas, 0, 0, w, h, 0, 0, w * ts, h * ts)

  if (props.showContour) drawContours()
}

/* 边缘描边：相邻瓦片不同画暗线 */
function drawContours() {
  const td = tileData.value
  if (!mapCtx || !td) return
  const w = td.tileWidth, h = td.tileHeight, ts = tileSize.value
  mapCtx.save()
  mapCtx.strokeStyle = 'rgba(0,0,0,0.28)'
  mapCtx.lineWidth = 1
  mapCtx.beginPath()
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = td.tiles[y * w + x]
      if (x + 1 < w && td.tiles[y * w + x + 1] !== id) {
        mapCtx.moveTo((x + 1) * ts, y * ts)
        mapCtx.lineTo((x + 1) * ts, (y + 1) * ts)
      }
      if (y + 1 < h && td.tiles[(y + 1) * w + x] !== id) {
        mapCtx.moveTo(x * ts, (y + 1) * ts)
        mapCtx.lineTo((x + 1) * ts, (y + 1) * ts)
      }
    }
  }
  mapCtx.stroke()
  mapCtx.restore()
}

function renderGrid() {
  const td = tileData.value
  if (!gridCtx || !td) return
  const w = td.tileWidth, h = td.tileHeight, ts = tileSize.value
  gridCtx.clearRect(0, 0, gridCanvasRef.value!.width, gridCanvasRef.value!.height)
  if (!props.showGrid || !props.layerVisible.grid) return

  gridCtx.save()
  gridCtx.strokeStyle = TILE_SETS[td.tileSetId]?.gridColor || 'rgba(0,0,0,0.08)'
  gridCtx.lineWidth = 1
  gridCtx.beginPath()
  for (let x = 0; x <= w; x++) {
    gridCtx.moveTo(x * ts + 0.5, 0)
    gridCtx.lineTo(x * ts + 0.5, h * ts)
  }
  for (let y = 0; y <= h; y++) {
    gridCtx.moveTo(0, y * ts + 0.5)
    gridCtx.lineTo(w * ts, y * ts + 0.5)
  }
  gridCtx.stroke()
  gridCtx.restore()
}

function renderOverlay() {
  const td = tileData.value
  if (!overlayCtx || !td) return
  const ts = tileSize.value
  overlayCtx.clearRect(0, 0, overlayCanvasRef.value!.width, overlayCanvasRef.value!.height)
  if (!props.layerVisible.label) return

  /* 图章 */
  overlayCtx.save()
  overlayCtx.font = `${Math.floor(ts * 1.1)}px serif`
  overlayCtx.textAlign = 'center'
  overlayCtx.textBaseline = 'middle'
  for (const s of td.stamps) {
    overlayCtx.fillText(s.emoji, (s.x + 0.5) * ts, (s.y + 0.5) * ts)
  }
  overlayCtx.restore()

  /* 文字标注（白底黑字带边框） */
  overlayCtx.save()
  overlayCtx.font = `${Math.max(11, ts + 3)}px sans-serif`
  overlayCtx.textAlign = 'center'
  overlayCtx.textBaseline = 'middle'
  for (const l of td.labels) {
    const cx = (l.x + 0.5) * ts, cy = (l.y + 0.5) * ts
    const tw = overlayCtx.measureText(l.text).width
    overlayCtx.fillStyle = 'rgba(255,255,255,0.85)'
    overlayCtx.fillRect(cx - tw / 2 - 4, cy - 9, tw + 8, 18)
    overlayCtx.strokeStyle = 'rgba(0,0,0,0.3)'
    overlayCtx.lineWidth = 1
    overlayCtx.strokeRect(cx - tw / 2 - 4, cy - 9, tw + 8, 18)
    overlayCtx.fillStyle = '#1f2430'
    overlayCtx.fillText(l.text, cx, cy)
  }
  overlayCtx.restore()

  /* 直线/矩形预览 */
  if (preview.value) {
    const p = preview.value
    overlayCtx.save()
    overlayCtx.globalAlpha = 0.6
    const t = TILE_SETS[td.tileSetId]?.tiles.find(x => x.id === props.currentTile)
    overlayCtx.fillStyle = t?.color || '#e94560'
    const pts = shapePoints(p.tool, p.x0, p.y0, p.x1, p.y1)
    for (const [px, py] of pts) {
      overlayCtx.fillRect(px * ts, py * ts, ts, ts)
    }
    overlayCtx.restore()
  }
}

/* ===== 绘制操作（直接修改瓦片数据，提交时快照） ===== */
function getBgTileId(): number {
  const td = tileData.value
  if (!td) return 0
  return TILE_SETS[td.tileSetId]?.bgTile ?? 0
}

function paintAt(x: number, y: number, tileId?: number) {
  const td = tileData.value
  if (!td) return
  const size = props.brushSize
  const id = tileId ?? (props.tool === 'tile-eraser' ? getBgTileId() : props.currentTile)
  const half = Math.floor(size / 2)
  const r2 = (size / 2) ** 2
  const { tileWidth: w, tileHeight: h, tiles } = td
  for (let dy = -half; dy < -half + size; dy++) {
    for (let dx = -half; dx < -half + size; dx++) {
      if (props.brushShape === 'circle' && (dx + 0.5) ** 2 + (dy + 0.5) ** 2 > r2) continue
      const px = x + dx, py = y + dy
      if (px < 0 || py < 0 || px >= w || py >= h) continue
      tiles[py * w + px] = id
    }
  }
}

function floodFill(x: number, y: number) {
  const td = tileData.value
  if (!td) return
  const { tileWidth: w, tileHeight: h, tiles } = td
  if (x < 0 || y < 0 || x >= w || y >= h) return
  const target = tiles[y * w + x]
  const replace = props.currentTile
  if (target === replace) return
  const stack: [number, number][] = [[x, y]]
  while (stack.length) {
    const [cx, cy] = stack.pop()!
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue
    const i = cy * w + cx
    if (tiles[i] !== target) continue
    tiles[i] = replace
    stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
  }
}

function shapePoints(tool: string, x0: number, y0: number, x1: number, y1: number): [number, number][] {
  const pts: [number, number][] = []
  if (tool === 'tile-rect') {
    const xa = Math.min(x0, x1), xb = Math.max(x0, x1)
    const ya = Math.min(y0, y1), yb = Math.max(y0, y1)
    for (let x = xa; x <= xb; x++) { pts.push([x, ya]); pts.push([x, yb]) }
    for (let y = ya; y <= yb; y++) { pts.push([xa, y]); pts.push([xb, y]) }
    return pts
  }
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0)
  let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1
  let err = dx - dy, x = x0, y = y0
  while (true) {
    pts.push([x, y])
    if (x === x1 && y === y1) break
    const e2 = 2 * err
    if (e2 > -dy) { err -= dy; x += sx }
    if (e2 < dx) { err += dx; y += sy }
  }
  return pts
}

function applyShapePoints(pts: [number, number][], tileId: number) {
  const td = tileData.value
  if (!td) return
  const { tileWidth: w, tileHeight: h, tiles } = td
  for (const [px, py] of pts) {
    if (px < 0 || py < 0 || px >= w || py >= h) continue
    tiles[py * w + px] = tileId
  }
}

/* ===== 指针交互 ===== */
function getTile(e: PointerEvent | MouseEvent): [number, number] {
  const rect = overlayCanvasRef.value!.getBoundingClientRect()
  const x = Math.floor((e.clientX - rect.left) / tileSize.value)
  const y = Math.floor((e.clientY - rect.top) / tileSize.value)
  return [x, y]
}

function onPointerDown(e: PointerEvent) {
  const td = tileData.value
  if (!td) return

  /* 平移：pan 工具 / 中键 / 空格 */
  if (e.button === 1 || isPanMode.value) {
    panning.value = true
    panStart = { x: e.clientX, y: e.clientY, sx: viewportRef.value!.scrollLeft, sy: viewportRef.value!.scrollTop }
    e.preventDefault()
    return
  }
  if (e.button !== 0) return

  const [x, y] = getTile(e)
  if (x < 0 || y < 0 || x >= td.tileWidth || y >= td.tileHeight) return

  /* 待放置文字 */
  if (pendingLabel.value !== null) {
    emit('add-tile-label', x, y, pendingLabel.value)
    pendingLabel.value = null
    emit('commit-tile-history')
    renderOverlay()
    return
  }

  drawing.value = true
  lastTile.value = [x, y]

  switch (props.tool) {
    case 'tile-brush':
    case 'tile-eraser':
      paintAt(x, y)
      renderMap(); renderOverlay()
      break
    case 'tile-fill':
      floodFill(x, y)
      renderMap()
      emit('commit-tile-history')
      drawing.value = false
      break
    case 'tile-picker': {
      const id = td.tiles[y * td.tileWidth + x]
      emit('tile-picked', id)
      drawing.value = false
      break
    }
    case 'tile-stamp':
      if (!td.stamps.some(s => s.x === x && s.y === y)) {
        td.stamps.push({ x, y, emoji: props.currentStamp })
        renderOverlay()
        emit('commit-tile-history')
      }
      drawing.value = false
      break
    case 'tile-line':
    case 'tile-rect':
      preview.value = { tool: props.tool, x0: x, y0: y, x1: x, y1: y }
      renderOverlay()
      break
  }
}

function onWindowPointerMove(e: PointerEvent) {
  const td = tileData.value
  if (!td) return
  const [x, y] = getTile(e)
  if (x >= 0 && y >= 0 && x < td.tileWidth && y < td.tileHeight) {
    emit('hover-coords', { x, y })
  } else {
    emit('hover-coords', null)
  }

  /* 视口滚动平移 */
  if (panning.value && panStart) {
    viewportRef.value!.scrollLeft = panStart.sx - (e.clientX - panStart.x)
    viewportRef.value!.scrollTop = panStart.sy - (e.clientY - panStart.y)
    return
  }

  if (!drawing.value) return

  if (props.tool === 'tile-brush' || props.tool === 'tile-eraser') {
    /* Bresenham 插值连线，避免快速移动留空 */
    if (lastTile.value) {
      const pts = shapePoints('line', lastTile.value[0], lastTile.value[1], x, y)
      for (const [px, py] of pts) {
        if (px >= 0 && py >= 0 && px < td.tileWidth && py < td.tileHeight) paintAt(px, py)
      }
    } else {
      paintAt(x, y)
    }
    lastTile.value = [x, y]
    renderMap(); renderOverlay()
  } else if (preview.value) {
    preview.value.x1 = x
    preview.value.y1 = y
    renderOverlay()
  }
}

function onWindowPointerUp() {
  if (panning.value) {
    panning.value = false
    panStart = null
    return
  }
  if (!drawing.value) return
  drawing.value = false

  if (preview.value) {
    const p = preview.value
    applyShapePoints(shapePoints(p.tool, p.x0, p.y0, p.x1, p.y1), props.currentTile)
    preview.value = null
    renderMap(); renderOverlay()
    emit('commit-tile-history')
  } else if (props.tool === 'tile-brush' || props.tool === 'tile-eraser') {
    emit('commit-tile-history')
  }
  lastTile.value = null
}

/* 右键擦除 */
function onContextMenu(e: MouseEvent) {
  e.preventDefault()
  const td = tileData.value
  if (!td) return
  const [x, y] = getTile(e)
  if (x < 0 || y < 0 || x >= td.tileWidth || y >= td.tileHeight) return
  paintAt(x, y, getBgTileId())
  renderMap()
  emit('commit-tile-history')
}

/* ===== 键盘（空格平移） ===== */
function onKeyDown(e: KeyboardEvent) {
  if (e.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return
  if (e.code === 'Space') {
    spaceDown.value = true
    e.preventDefault()
  }
}
function onKeyUp(e: KeyboardEvent) {
  if (e.code === 'Space') spaceDown.value = false
}

/* ===== 缩放 ===== */
function setZoom(ts: number) {
  tileSize.value = ts
  setupCanvas()
  renderAll()
  emit('update:zoom', Math.round((ts / BASE_TILE) * 100))
}
function zoomIn() {
  const i = ZOOM_STEPS.indexOf(tileSize.value)
  const ni = Math.min(ZOOM_STEPS.length - 1, (i < 0 ? 4 : i) + 1)
  setZoom(ZOOM_STEPS[ni])
}
function zoomOut() {
  const i = ZOOM_STEPS.indexOf(tileSize.value)
  const ni = Math.max(0, (i < 0 ? 4 : i) - 1)
  setZoom(ZOOM_STEPS[ni])
}
function fitZoom() {
  const td = tileData.value
  if (!td || !viewportRef.value) return
  const vw = viewportRef.value.clientWidth - 40
  const vh = viewportRef.value.clientHeight - 40
  let best = ZOOM_STEPS[0]
  for (const ts of ZOOM_STEPS) {
    if (td.tileWidth * ts <= vw && td.tileHeight * ts <= vh) best = ts
  }
  setZoom(best)
}

/* ===== 监听 ===== */
watch(() => props.map?.id, () => {
  nextTick(() => { setupCanvas(); renderAll(); fitZoom() })
})
watch(() => [tileData.value?.tileWidth, tileData.value?.tileHeight, tileData.value?.tileSetId], () => {
  nextTick(() => { setupCanvas(); renderAll() })
})
watch(() => props.showGrid, () => renderGrid())
watch(() => props.showContour, () => renderMap())
watch(() => props.layerVisible, () => renderAll(), { deep: true })
watch(() => props.currentTile, () => { if (preview.value) renderOverlay() })

onMounted(() => {
  mapCtx = mapCanvasRef.value?.getContext('2d') ?? null
  gridCtx = gridCanvasRef.value?.getContext('2d') ?? null
  overlayCtx = overlayCanvasRef.value?.getContext('2d') ?? null

  window.addEventListener('pointermove', onWindowPointerMove)
  window.addEventListener('pointerup', onWindowPointerUp)
  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)

  nextTick(() => { setupCanvas(); renderAll(); fitZoom() })
})

onUnmounted(() => {
  window.removeEventListener('pointermove', onWindowPointerMove)
  window.removeEventListener('pointerup', onWindowPointerUp)
  window.removeEventListener('keydown', onKeyDown)
  window.removeEventListener('keyup', onKeyUp)
})

/* ===== 对外接口 ===== */
function setPendingTileLabel(text: string) {
  pendingLabel.value = text
}

/* 合成三层画布用于导出 */
function getCompositeCanvas(): HTMLCanvasElement | null {
  const mapC = mapCanvasRef.value
  const gridC = gridCanvasRef.value
  const overlayC = overlayCanvasRef.value
  if (!mapC) return null
  const out = document.createElement('canvas')
  out.width = mapC.width
  out.height = mapC.height
  const ctx = out.getContext('2d')!
  ctx.drawImage(mapC, 0, 0)
  if (props.showGrid && props.layerVisible.grid && gridC) ctx.drawImage(gridC, 0, 0)
  if (props.layerVisible.label && overlayC) ctx.drawImage(overlayC, 0, 0)
  return out
}

defineExpose({
  setZoom,
  zoomIn,
  zoomOut,
  fitZoom,
  renderAll,
  setPendingTileLabel,
  getCompositeCanvas
})
</script>

<style scoped>
.canvas-viewport {
  width: 100%;
  height: 100%;
  overflow: auto;
  position: relative;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 20px;
  background:
    linear-gradient(45deg, #e8ebf0 25%, transparent 25%),
    linear-gradient(-45deg, #e8ebf0 25%, transparent 25%),
    linear-gradient(45deg, transparent 75%, #e8ebf0 75%),
    linear-gradient(-45deg, transparent 75%, #e8ebf0 75%);
  background-size: 16px 16px;
  background-position: 0 0, 0 8px, 8px -8px, -8px 0;
  background-color: #dde1e8;
}
.canvas-viewport::-webkit-scrollbar { width: 10px; height: 10px; }
.canvas-viewport::-webkit-scrollbar-track { background: rgba(0,0,0,0.05); }
.canvas-viewport::-webkit-scrollbar-thumb { background: rgba(0,0,0,0.2); border-radius: 5px; }

.canvas-wrap {
  position: relative;
  flex-shrink: 0;
  box-shadow: 0 4px 24px rgba(0,0,0,0.18), 0 0 0 1px rgba(0,0,0,0.1);
  background: #fff;
}
.layer { position: absolute; top: 0; left: 0; image-rendering: pixelated; }
.layer:first-child { position: relative; }
.overlay-interactive { cursor: crosshair; }
.canvas-wrap.panning .overlay-interactive { cursor: grabbing; }
.canvas-wrap.pan-mode .overlay-interactive { cursor: grab; }
</style>
