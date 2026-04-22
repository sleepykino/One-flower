<template>
  <div class="map-canvas-wrapper" ref="wrapperRef">
    <canvas ref="canvasRef" @mousedown="onMouseDown" @mousemove="onMouseMove" @mouseup="onMouseUp" @wheel="onWheel" @contextmenu.prevent="onContextMenu" />
    
    <div v-if="!map" class="empty-state">
      <el-empty description="请选择或创建一个地图" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue'
import type { NovelMap, MapElement, MapTool, MapAsset, Point, MarkerData, PathData, ShapeData, BrushConfig, FillConfig, SelectionRect } from '@/types/map'

const props = defineProps<{
  map: NovelMap | null
  tool: MapTool
  selectedElementIds: string[]
  selectedLayerId: string | null
  selectedAsset: MapAsset | null
  brushConfig: BrushConfig
  fillConfig: FillConfig
}>()

const emit = defineEmits<{
  (e: 'select-element', id: string, addToSelection: boolean): void
  (e: 'update-element', id: string, updates: Partial<MapElement>, skipHistory?: boolean): void
  (e: 'add-element', element: Omit<MapElement, 'id'>): void
  (e: 'add-elements', elements: Omit<MapElement, 'id'>[]): void
  (e: 'delete-elements', ids: string[]): void
  (e: 'update:zoom', zoom: number): void
  (e: 'commit-drag', updates: Record<string, Partial<MapElement>>): void
  (e: 'select-elements-in-rect', rect: SelectionRect): void
}>()

const wrapperRef = ref<HTMLDivElement | null>(null)
const canvasRef = ref<HTMLCanvasElement | null>(null)
let ctx: CanvasRenderingContext2D | null = null

const zoom = ref(1)
const panX = ref(0)
const panY = ref(0)
const isPanning = ref(false)
const isDrawing = ref(false)
const lastPanPoint = ref<Point | null>(null)
const currentPath = ref<Point[]>([])
const dragStartPoint = ref<Point | null>(null)
const dragElements = ref<Record<string, { startX: number; startY: number }>>({})
const isDragging = ref(false)

const isSelecting = ref(false)
const selectionStart = ref<Point | null>(null)
const selectionEnd = ref<Point | null>(null)

const isBrushDrawing = ref(false)
const brushLastPoint = ref<Point | null>(null)
const brushPendingElements = ref<Omit<MapElement, 'id'>[]>([])

const isFillDrawing = ref(false)
const fillStartPoint = ref<Point | null>(null)
const fillCurrentPoint = ref<Point | null>(null)

function initCanvas() {
  if (!canvasRef.value || !wrapperRef.value) return
  
  const rect = wrapperRef.value.getBoundingClientRect()
  canvasRef.value.width = rect.width
  canvasRef.value.height = rect.height
  
  ctx = canvasRef.value.getContext('2d')
  render()
}

function render() {
  if (!ctx || !canvasRef.value || !props.map) {
    if (ctx && canvasRef.value) {
      ctx.fillStyle = '#1a1a2e'
      ctx.fillRect(0, 0, canvasRef.value.width, canvasRef.value.height)
    }
    return
  }

  const canvas = canvasRef.value
  ctx.save()
  
  ctx.fillStyle = '#1a1a2e'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  
  ctx.translate(panX.value, panY.value)
  ctx.scale(zoom.value, zoom.value)
  
  ctx.fillStyle = props.map.backgroundColor
  ctx.fillRect(0, 0, props.map.width, props.map.height)
  
  if (props.map.gridVisible) {
    drawGrid()
  }
  
  const sortedLayers = [...props.map.layers].sort((a, b) => a.zIndex - b.zIndex)
  for (const layer of sortedLayers) {
    if (!layer.visible) continue
    
    ctx.globalAlpha = layer.opacity
    for (const element of layer.elements) {
      drawElement(element)
    }
  }
  
  ctx.globalAlpha = 1

  for (const el of brushPendingElements.value) {
    drawElement({ ...el, id: '__pending__' } as MapElement)
  }
  
  if (isDrawing.value && currentPath.value.length > 0 && props.tool === 'path') {
    drawCurrentPath()
  }

  if (isSelecting.value && selectionStart.value && selectionEnd.value) {
    drawSelectionRect()
  }

  if (isFillDrawing.value && fillStartPoint.value && fillCurrentPoint.value) {
    drawFillPreview()
  }
  
  ctx.restore()
  
  emit('update:zoom', zoom.value)
}

function drawGrid() {
  if (!ctx || !props.map) return
  
  ctx.strokeStyle = 'rgba(128, 128, 128, 0.2)'
  ctx.lineWidth = 1 / zoom.value
  
  const gridSize = props.map.gridSize
  
  for (let x = 0; x <= props.map.width; x += gridSize) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, props.map.height)
    ctx.stroke()
  }
  
  for (let y = 0; y <= props.map.height; y += gridSize) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(props.map.width, y)
    ctx.stroke()
  }
}

function drawElement(element: MapElement) {
  if (!ctx) return
  
  const isSelected = props.selectedElementIds.includes(element.id)
  
  if (element.type === 'path') {
    ctx.save()
    ctx.globalAlpha *= element.opacity
    drawPath(element.data as PathData, isSelected)
    ctx.restore()
    return
  }
  
  ctx.save()
  ctx.translate(element.x, element.y)
  ctx.rotate((element.rotation * Math.PI) / 180)
  ctx.globalAlpha *= element.opacity
  
  switch (element.type) {
    case 'marker':
      drawMarker(element.data as MarkerData, isSelected)
      break
    case 'shape':
      drawShape(element.data as ShapeData, element.width, element.height, isSelected)
      break
    case 'text':
      drawText(element.data as any)
      break
    case 'image':
      drawImage(element.data as any)
      break
  }
  
  ctx.restore()
}

function drawMarker(data: MarkerData, isSelected: boolean) {
  if (!ctx) return
  
  const size = data.size
  
  ctx.font = `${size}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(data.icon, 0, 0)
  
  if (data.labelVisible && data.label) {
    ctx.font = '14px Arial'
    ctx.fillStyle = '#333'
    ctx.fillText(data.label, 0, size / 2 + 15)
  }
  
  if (isSelected) {
    ctx.strokeStyle = '#e94560'
    ctx.lineWidth = 2 / zoom.value
    ctx.setLineDash([5 / zoom.value, 5 / zoom.value])
    ctx.strokeRect(-size / 2 - 5, -size / 2 - 5, size + 10, size + 10)
    ctx.setLineDash([])
  }
}

function drawPath(data: PathData, isSelected: boolean) {
  if (!ctx || data.points.length < 2) return
  
  ctx.beginPath()
  ctx.strokeStyle = data.strokeColor
  ctx.lineWidth = data.strokeWidth
  ctx.setLineDash(data.strokeDash)
  
  if (data.smooth && data.points.length > 2) {
    ctx.moveTo(data.points[0].x, data.points[0].y)
    for (let i = 1; i < data.points.length - 1; i++) {
      const xc = (data.points[i].x + data.points[i + 1].x) / 2
      const yc = (data.points[i].y + data.points[i + 1].y) / 2
      ctx.quadraticCurveTo(data.points[i].x, data.points[i].y, xc, yc)
    }
    const lastPoint = data.points[data.points.length - 1]
    ctx.lineTo(lastPoint.x, lastPoint.y)
  } else {
    ctx.moveTo(data.points[0].x, data.points[0].y)
    for (let i = 1; i < data.points.length; i++) {
      ctx.lineTo(data.points[i].x, data.points[i].y)
    }
  }
  
  if (data.fillColor && data.fillColor !== 'transparent') {
    ctx.fillStyle = data.fillColor
    ctx.fill()
  }
  
  ctx.stroke()
  ctx.setLineDash([])
  
  if (data.arrow === 'start' || data.arrow === 'both') {
    drawArrow(data.points[0], data.points[1], data.strokeColor)
  }
  if (data.arrow === 'end' || data.arrow === 'both') {
    const len = data.points.length
    drawArrow(data.points[len - 1], data.points[len - 2], data.strokeColor)
  }
  
  if (isSelected) {
    ctx.fillStyle = '#e94560'
    for (const point of data.points) {
      ctx.beginPath()
      ctx.arc(point.x, point.y, 6 / zoom.value, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function drawArrow(point: Point, prevPoint: Point, color: string) {
  if (!ctx) return
  
  const angle = Math.atan2(point.y - prevPoint.y, point.x - prevPoint.x)
  const arrowSize = 10 / zoom.value
  
  ctx.save()
  ctx.fillStyle = color
  ctx.translate(point.x, point.y)
  ctx.rotate(angle)
  
  ctx.beginPath()
  ctx.moveTo(0, 0)
  ctx.lineTo(-arrowSize, -arrowSize / 2)
  ctx.lineTo(-arrowSize, arrowSize / 2)
  ctx.closePath()
  ctx.fill()
  
  ctx.restore()
}

function drawShape(data: ShapeData, width?: number, height?: number, isSelected?: boolean) {
  if (!ctx) return
  
  ctx.fillStyle = data.fillColor
  ctx.strokeStyle = data.strokeColor
  ctx.lineWidth = data.strokeWidth
  
  const w = width || 100
  const h = height || 100
  
  switch (data.shapeType) {
    case 'rectangle':
      ctx.fillRect(-w / 2, -h / 2, w, h)
      ctx.strokeRect(-w / 2, -h / 2, w, h)
      break
    case 'circle':
      ctx.beginPath()
      ctx.arc(0, 0, Math.min(w, h) / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      break
    case 'ellipse':
      ctx.beginPath()
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      break
    case 'polygon':
      if (data.points && data.points.length >= 3) {
        ctx.beginPath()
        ctx.moveTo(data.points[0].x, data.points[0].y)
        for (let i = 1; i < data.points.length; i++) {
          ctx.lineTo(data.points[i].x, data.points[i].y)
        }
        ctx.closePath()
        ctx.fill()
        ctx.stroke()
      }
      break
  }
  
  if (isSelected) {
    ctx.strokeStyle = '#e94560'
    ctx.lineWidth = 2 / zoom.value
    ctx.setLineDash([5 / zoom.value, 5 / zoom.value])
    ctx.strokeRect(-w / 2 - 5, -h / 2 - 5, w + 10, h + 10)
    ctx.setLineDash([])
  }
}

function drawText(data: any) {
  if (!ctx) return
  
  ctx.font = `${data.italic ? 'italic ' : ''}${data.bold ? 'bold ' : ''}${data.fontSize}px ${data.fontFamily}`
  ctx.fillStyle = data.color
  ctx.textAlign = data.align
  ctx.textBaseline = 'top'
  ctx.fillText(data.content, 0, 0)
}

function drawImage(data: any) {
}

function drawCurrentPath() {
  if (!ctx || currentPath.value.length < 2) return
  
  ctx.save()
  ctx.strokeStyle = '#e94560'
  ctx.lineWidth = 3
  ctx.setLineDash([5, 5])
  
  ctx.beginPath()
  ctx.moveTo(currentPath.value[0].x, currentPath.value[0].y)
  for (let i = 1; i < currentPath.value.length; i++) {
    ctx.lineTo(currentPath.value[i].x, currentPath.value[i].y)
  }
  ctx.stroke()
  
  ctx.restore()
}

function drawSelectionRect() {
  if (!ctx || !selectionStart.value || !selectionEnd.value) return
  
  const x = Math.min(selectionStart.value.x, selectionEnd.value.x)
  const y = Math.min(selectionStart.value.y, selectionEnd.value.y)
  const w = Math.abs(selectionEnd.value.x - selectionStart.value.x)
  const h = Math.abs(selectionEnd.value.y - selectionStart.value.y)
  
  ctx.save()
  ctx.fillStyle = 'rgba(233, 69, 96, 0.1)'
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = '#e94560'
  ctx.lineWidth = 2 / zoom.value
  ctx.setLineDash([6 / zoom.value, 4 / zoom.value])
  ctx.strokeRect(x, y, w, h)
  ctx.setLineDash([])
  ctx.restore()
}

function drawFillPreview() {
  if (!ctx || !fillStartPoint.value || !fillCurrentPoint.value) return
  
  const x = Math.min(fillStartPoint.value.x, fillCurrentPoint.value.x)
  const y = Math.min(fillStartPoint.value.y, fillCurrentPoint.value.y)
  const w = Math.abs(fillCurrentPoint.value.x - fillStartPoint.value.x)
  const h = Math.abs(fillCurrentPoint.value.y - fillStartPoint.value.y)
  
  ctx.save()
  ctx.fillStyle = 'rgba(99, 102, 241, 0.15)'
  ctx.fillRect(x, y, w, h)
  ctx.strokeStyle = '#6366f1'
  ctx.lineWidth = 2 / zoom.value
  ctx.setLineDash([8 / zoom.value, 4 / zoom.value])
  ctx.strokeRect(x, y, w, h)
  ctx.setLineDash([])
  ctx.restore()
}

function screenToCanvas(screenX: number, screenY: number): Point {
  if (!canvasRef.value) return { x: 0, y: 0 }
  
  const rect = canvasRef.value.getBoundingClientRect()
  return {
    x: (screenX - rect.left - panX.value) / zoom.value,
    y: (screenY - rect.top - panY.value) / zoom.value
  }
}

function findElementAt(point: Point): MapElement | null {
  if (!props.map) return null
  
  for (let i = props.map.layers.length - 1; i >= 0; i--) {
    const layer = props.map.layers[i]
    if (!layer.visible || layer.locked) continue
    
    for (let j = layer.elements.length - 1; j >= 0; j--) {
      const element = layer.elements[j]
      if (isPointInElement(point, element)) {
        return element
      }
    }
  }
  
  return null
}

function isPointInElement(point: Point, element: MapElement): boolean {
  if (element.type === 'path') {
    const pathData = element.data as PathData
    for (const p of pathData.points) {
      const dist = Math.sqrt((point.x - p.x) ** 2 + (point.y - p.y) ** 2)
      if (dist <= pathData.strokeWidth / 2 + 8) return true
    }
    return false
  }

  const dx = point.x - element.x
  const dy = point.y - element.y
  
  if (element.type === 'shape') {
    const w = (element.width || 100) / 2 + 5
    const h = (element.height || 100) / 2 + 5
    return Math.abs(dx) <= w && Math.abs(dy) <= h
  }

  const size = element.type === 'marker' ? (element.data as MarkerData).size : 50
  
  return Math.abs(dx) <= size / 2 + 10 && Math.abs(dy) <= size / 2 + 10
}

function findElementsInRect(rect: SelectionRect): string[] {
  if (!props.map) return []
  
  const ids: string[] = []
  const minX = rect.x
  const minY = rect.y
  const maxX = rect.x + rect.width
  const maxY = rect.y + rect.height
  
  for (const layer of props.map.layers) {
    if (!layer.visible || layer.locked) continue
    
    for (const element of layer.elements) {
      if (isElementInRect(element, minX, minY, maxX, maxY)) {
        ids.push(element.id)
      }
    }
  }
  
  return ids
}

function isElementInRect(element: MapElement, minX: number, minY: number, maxX: number, maxY: number): boolean {
  if (element.type === 'path') {
    const pathData = element.data as PathData
    return pathData.points.some(p => p.x >= minX && p.x <= maxX && p.y >= minY && p.y <= maxY)
  }

  const elX = element.x
  const elY = element.y
  const halfW = (element.width || (element.type === 'marker' ? (element.data as MarkerData).size : 50)) / 2
  const halfH = (element.height || (element.type === 'marker' ? (element.data as MarkerData).size : 50)) / 2

  return (elX - halfW) >= minX && (elX + halfW) <= maxX &&
         (elY - halfH) >= minY && (elY + halfH) <= maxY
}

function createBrushMarker(point: Point): Omit<MapElement, 'id'> | null {
  if (!props.selectedAsset) return null

  const config = props.brushConfig
  const offsetX = config.randomness > 0 ? (Math.random() - 0.5) * config.randomness * 2 : 0
  const offsetY = config.randomness > 0 ? (Math.random() - 0.5) * config.randomness * 2 : 0
  const size = Math.round(32 * config.sizeScale)

  return {
    type: 'marker',
    x: point.x + offsetX,
    y: point.y + offsetY,
    rotation: 0,
    opacity: 1,
    data: {
      name: props.selectedAsset.name,
      description: '',
      icon: props.selectedAsset.icon,
      color: props.selectedAsset.color,
      size,
      label: '',
      labelVisible: false
    }
  }
}

function generateFillElements(startPoint: Point, endPoint: Point): Omit<MapElement, 'id'>[] {
  if (!props.selectedAsset) return []

  const config = props.fillConfig
  const x = Math.min(startPoint.x, endPoint.x)
  const y = Math.min(startPoint.y, endPoint.y)
  const w = Math.abs(endPoint.x - startPoint.x)
  const h = Math.abs(endPoint.y - startPoint.y)

  if (w < 20 || h < 20) return []

  const elements: Omit<MapElement, 'id'>[] = []
  const markerSize = Math.round(24 * config.sizeScale)
  const spacing = Math.max(markerSize * 1.5, 30) / config.density

  for (let px = x + spacing / 2; px < x + w; px += spacing) {
    for (let py = y + spacing / 2; py < y + h; py += spacing) {
      const offsetX = config.randomness > 0 ? (Math.random() - 0.5) * config.randomness * spacing * 0.5 : 0
      const offsetY = config.randomness > 0 ? (Math.random() - 0.5) * config.randomness * spacing * 0.5 : 0

      elements.push({
        type: 'marker',
        x: px + offsetX,
        y: py + offsetY,
        rotation: 0,
        opacity: 0.7 + Math.random() * 0.3,
        data: {
          name: props.selectedAsset.name,
          description: '',
          icon: props.selectedAsset.icon,
          color: props.selectedAsset.color,
          size: markerSize,
          label: '',
          labelVisible: false
        }
      })
    }
  }

  return elements
}

function onMouseDown(e: MouseEvent) {
  const point = screenToCanvas(e.clientX, e.clientY)
  
  if (props.tool === 'pan' || e.button === 1) {
    isPanning.value = true
    lastPanPoint.value = { x: e.clientX, y: e.clientY }
    return
  }
  
  if (props.tool === 'select') {
    const element = findElementAt(point)
    if (element) {
      if (!props.selectedElementIds.includes(element.id)) {
        emit('select-element', element.id, e.shiftKey)
      }

      dragStartPoint.value = point
      isDragging.value = false
      dragElements.value = {}
      for (const id of props.selectedElementIds) {
        const el = findElementById(id)
        if (el) {
          dragElements.value[id] = { startX: el.x, startY: el.y }
        }
      }
    } else {
      emit('select-element', '', false)
      isSelecting.value = true
      selectionStart.value = point
      selectionEnd.value = point
    }
    return
  }
  
  if (props.tool === 'marker' && props.selectedAsset) {
    emit('add-element', {
      type: 'marker',
      x: point.x,
      y: point.y,
      rotation: 0,
      opacity: 1,
      data: {
        name: props.selectedAsset.name,
        description: '',
        icon: props.selectedAsset.icon,
        color: props.selectedAsset.color,
        size: 32,
        label: props.selectedAsset.name,
        labelVisible: true
      }
    })
    return
  }

  if (props.tool === 'brush' && props.selectedAsset) {
    isBrushDrawing.value = true
    brushLastPoint.value = point
    brushPendingElements.value = []
    const marker = createBrushMarker(point)
    if (marker) {
      brushPendingElements.value.push(marker)
    }
    render()
    return
  }

  if (props.tool === 'fill' && props.selectedAsset) {
    isFillDrawing.value = true
    fillStartPoint.value = point
    fillCurrentPoint.value = point
    render()
    return
  }
  
  if (props.tool === 'path') {
    isDrawing.value = true
    currentPath.value = [point]
    return
  }
  
  if (props.tool === 'shape') {
    isFillDrawing.value = true
    fillStartPoint.value = point
    fillCurrentPoint.value = point
    render()
    return
  }
  
  if (props.tool === 'text') {
    emit('add-element', {
      type: 'text',
      x: point.x,
      y: point.y,
      rotation: 0,
      opacity: 1,
      data: {
        content: '双击编辑文字',
        fontSize: 16,
        fontFamily: 'Arial',
        color: '#333333',
        bold: false,
        italic: false,
        align: 'left'
      }
    })
    return
  }
  
  if (props.tool === 'eraser') {
    const element = findElementAt(point)
    if (element) {
      emit('delete-elements', [element.id])
    }
    return
  }
}

function onMouseMove(e: MouseEvent) {
  if (isPanning.value && lastPanPoint.value) {
    panX.value += e.clientX - lastPanPoint.value.x
    panY.value += e.clientY - lastPanPoint.value.y
    lastPanPoint.value = { x: e.clientX, y: e.clientY }
    render()
    return
  }
  
  if (isDrawing.value && props.tool === 'path') {
    const point = screenToCanvas(e.clientX, e.clientY)
    currentPath.value.push(point)
    render()
    return
  }

  if (isBrushDrawing.value && props.tool === 'brush' && brushLastPoint.value) {
    const point = screenToCanvas(e.clientX, e.clientY)
    const config = props.brushConfig
    const spacing = Math.max(config.spacing, 10)

    const dx = point.x - brushLastPoint.value.x
    const dy = point.y - brushLastPoint.value.y
    const dist = Math.sqrt(dx * dx + dy * dy)

    if (dist >= spacing) {
      const steps = Math.floor(dist / spacing)
      for (let i = 1; i <= steps; i++) {
        const t = i / steps
        const ix = brushLastPoint.value.x + dx * t
        const iy = brushLastPoint.value.y + dy * t
        const marker = createBrushMarker({ x: ix, y: iy })
        if (marker) {
          brushPendingElements.value.push(marker)
        }
      }
      brushLastPoint.value = point
      render()
    }
    return
  }

  if (isFillDrawing.value && (props.tool === 'fill' || props.tool === 'shape') && fillStartPoint.value) {
    fillCurrentPoint.value = screenToCanvas(e.clientX, e.clientY)
    render()
    return
  }

  if (isSelecting.value && selectionStart.value) {
    selectionEnd.value = screenToCanvas(e.clientX, e.clientY)
    render()
    return
  }
  
  if (dragStartPoint.value && props.selectedElementIds.length > 0) {
    const point = screenToCanvas(e.clientX, e.clientY)
    const dx = point.x - dragStartPoint.value.x
    const dy = point.y - dragStartPoint.value.y

    if (!isDragging.value && (Math.abs(dx) > 2 || Math.abs(dy) > 2)) {
      isDragging.value = true
    }

    if (isDragging.value && props.map) {
      const updates: Record<string, Partial<MapElement>> = {}
      for (const layer of props.map.layers) {
        for (const element of layer.elements) {
          if (props.selectedElementIds.includes(element.id)) {
            const start = dragElements.value[element.id]
            if (start) {
              updates[element.id] = {
                x: start.startX + dx,
                y: start.startY + dy
              }
            }
          }
        }
      }
      
      for (const [id, update] of Object.entries(updates)) {
        emit('update-element', id, update, true)
      }
    }
    render()
  }
}

function onMouseUp(e: MouseEvent) {
  if (isPanning.value) {
    isPanning.value = false
    lastPanPoint.value = null
    return
  }
  
  if (isDrawing.value && props.tool === 'path' && currentPath.value.length > 1) {
    emit('add-element', {
      type: 'path',
      x: 0,
      y: 0,
      rotation: 0,
      opacity: 1,
      data: {
        points: currentPath.value,
        strokeColor: '#333333',
        strokeWidth: 3,
        strokeDash: [],
        fillColor: 'transparent',
        arrow: 'none',
        smooth: false
      }
    })
    currentPath.value = []
    isDrawing.value = false
    return
  }

  if (isBrushDrawing.value && props.tool === 'brush') {
    if (brushPendingElements.value.length > 0) {
      emit('add-elements', brushPendingElements.value)
    }
    isBrushDrawing.value = false
    brushLastPoint.value = null
    brushPendingElements.value = []
    render()
    return
  }

  if (isFillDrawing.value && props.tool === 'fill' && fillStartPoint.value && fillCurrentPoint.value) {
    const elements = generateFillElements(fillStartPoint.value, fillCurrentPoint.value)
    if (elements.length > 0) {
      emit('add-elements', elements)
    }
    isFillDrawing.value = false
    fillStartPoint.value = null
    fillCurrentPoint.value = null
    render()
    return
  }

  if (isFillDrawing.value && props.tool === 'shape' && fillStartPoint.value && fillCurrentPoint.value) {
    const x = (fillStartPoint.value.x + fillCurrentPoint.value.x) / 2
    const y = (fillStartPoint.value.y + fillCurrentPoint.value.y) / 2
    const w = Math.abs(fillCurrentPoint.value.x - fillStartPoint.value.x)
    const h = Math.abs(fillCurrentPoint.value.y - fillStartPoint.value.y)

    if (w > 5 && h > 5) {
      emit('add-element', {
        type: 'shape',
        x,
        y,
        width: w,
        height: h,
        rotation: 0,
        opacity: 1,
        data: {
          shapeType: 'rectangle',
          strokeColor: '#333333',
          strokeWidth: 2,
          fillColor: '#cccccc'
        }
      })
    }
    isFillDrawing.value = false
    fillStartPoint.value = null
    fillCurrentPoint.value = null
    render()
    return
  }

  if (isSelecting.value && selectionStart.value && selectionEnd.value) {
    const x = Math.min(selectionStart.value.x, selectionEnd.value.x)
    const y = Math.min(selectionStart.value.y, selectionEnd.value.y)
    const w = Math.abs(selectionEnd.value.x - selectionStart.value.x)
    const h = Math.abs(selectionEnd.value.y - selectionStart.value.y)

    if (w > 5 && h > 5) {
      const ids = findElementsInRect({ x, y, width: w, height: h })
      for (const id of ids) {
        if (!props.selectedElementIds.includes(id)) {
          emit('select-element', id, true)
        }
      }
    }

    isSelecting.value = false
    selectionStart.value = null
    selectionEnd.value = null
    render()
    return
  }

  if (isDragging.value && dragStartPoint.value && props.map) {
    const point = screenToCanvas(e.clientX, e.clientY)
    const dx = point.x - dragStartPoint.value.x
    const dy = point.y - dragStartPoint.value.y

    const updates: Record<string, Partial<MapElement>> = {}
    for (const id of props.selectedElementIds) {
      const start = dragElements.value[id]
      if (start) {
        updates[id] = {
          x: start.startX + dx,
          y: start.startY + dy
        }
      }
    }
    emit('commit-drag', updates)
  }

  dragStartPoint.value = null
  dragElements.value = {}
  isDragging.value = false
}

function onWheel(e: WheelEvent) {
  e.preventDefault()
  
  const delta = e.deltaY > 0 ? 0.9 : 1.1
  const newZoom = Math.max(0.1, Math.min(5, zoom.value * delta))
  
  if (canvasRef.value) {
    const rect = canvasRef.value.getBoundingClientRect()
    const mouseX = e.clientX - rect.left
    const mouseY = e.clientY - rect.top
    
    panX.value = mouseX - (mouseX - panX.value) * (newZoom / zoom.value)
    panY.value = mouseY - (mouseY - panY.value) * (newZoom / zoom.value)
  }
  
  zoom.value = newZoom
  render()
}

function onContextMenu(e: MouseEvent) {
}

function findElementById(id: string): MapElement | null {
  if (!props.map) return null
  for (const layer of props.map.layers) {
    const el = layer.elements.find(e => e.id === id)
    if (el) return el
  }
  return null
}

function resetView() {
  if (!props.map || !canvasRef.value) return
  
  zoom.value = 1
  panX.value = (canvasRef.value.width - props.map.width) / 2
  panY.value = (canvasRef.value.height - props.map.height) / 2
  render()
}

watch(() => props.map, () => {
  nextTick(() => {
    render()
  })
}, { deep: true })

watch(() => props.selectedElementIds, () => {
  render()
}, { deep: true })

onMounted(() => {
  initCanvas()
  window.addEventListener('resize', initCanvas)
})

onUnmounted(() => {
  window.removeEventListener('resize', initCanvas)
})

defineExpose({
  resetView,
  render
})
</script>

<style scoped>
.map-canvas-wrapper {
  width: 100%;
  height: 100%;
  position: relative;
  overflow: hidden;
}

canvas {
  display: block;
  cursor: crosshair;
}

.empty-state {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
}
</style>
