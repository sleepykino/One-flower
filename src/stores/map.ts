import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { NovelMap, MapLayer, MapElement, MapStyle, GridType, TileMapData } from '@/types/map'
import { MAP_STYLES, TILE_SETS } from '@/types/map'
import { db } from '@/database'

export const useMapStore = defineStore('map', () => {
  const maps = ref<NovelMap[]>([])
  const currentMapId = ref<string | null>(null)
  const selectedElementIds = ref<string[]>([])
  const isInitialized = ref(false)
  const isLoading = ref(false)

  const history = ref<string[]>([])
  const historyIndex = ref(-1)
  const maxHistory = 50

  const currentMap = computed(() => 
    maps.value.find(m => m.id === currentMapId.value) || null
  )

  const selectedElements = computed(() => {
    if (!currentMap.value) return []
    const elements: MapElement[] = []
    currentMap.value.layers.forEach(layer => {
      layer.elements.forEach(el => {
        if (selectedElementIds.value.includes(el.id)) {
          elements.push(el)
        }
      })
    })
    return elements
  })

  const canUndo = computed(() => historyIndex.value > 0)
  const canRedo = computed(() => historyIndex.value < history.value.length - 1)

  async function loadMaps() {
    if (isInitialized.value) return
    isLoading.value = true
    try {
      const savedMaps = await db.maps.toArray()
      maps.value = savedMaps.map(m => {
        if (!m.style) m.style = 'custom'
        if (!m.gridType) m.gridType = 'square'
        if (!m.gridColor) {
          const preset = MAP_STYLES.find(s => s.id === m.style)
          m.gridColor = preset?.gridColor || 'rgba(128, 128, 128, 0.2)'
        }
        if (m.gridOpacity === undefined) {
          const preset = MAP_STYLES.find(s => s.id === m.style)
          m.gridOpacity = preset?.gridOpacity ?? 0.2
        }
        return m
      })
      isInitialized.value = true
    } catch (e) {
      console.error('加载地图失败:', e)
    } finally {
      isLoading.value = false
    }
  }

  async function saveMap(map: NovelMap) {
    map.updatedAt = Date.now()
    await db.maps.put(map)
  }

  function generateId(): string {
    return 'map_' + Date.now().toString(36) + Math.random().toString(36).substr(2)
  }

  function createMap(data: Partial<NovelMap> = {}): NovelMap {
    const now = Date.now()
    const style: MapStyle = data.style || 'fantasy'
    const stylePreset = MAP_STYLES.find(s => s.id === style) || MAP_STYLES[0]
    const newMap: NovelMap = {
      id: generateId(),
      name: data.name || '新地图',
      description: data.description || '',
      type: data.type || 'world',
      style,
      width: data.width || 2000,
      height: data.height || 2000,
      backgroundColor: data.backgroundColor || stylePreset.backgroundColor,
      gridVisible: data.gridVisible ?? true,
      gridType: data.gridType || 'square',
      gridSize: data.gridSize || 50,
      gridColor: data.gridColor || stylePreset.gridColor,
      gridOpacity: data.gridOpacity ?? stylePreset.gridOpacity,
      layers: data.layers || [{
        id: generateId(),
        name: '图层 1',
        visible: true,
        locked: false,
        opacity: 1,
        zIndex: 0,
        elements: []
      }],
      createdAt: now,
      updatedAt: now
    }
    maps.value.push(newMap)
    saveMap(newMap)
    return newMap
  }

  async function deleteMap(id: string) {
    const index = maps.value.findIndex(m => m.id === id)
    if (index !== -1) {
      maps.value.splice(index, 1)
      await db.maps.delete(id)
      if (currentMapId.value === id) {
        currentMapId.value = maps.value.length > 0 ? maps.value[0].id : null
      }
    }
  }

  function duplicateMap(id: string): NovelMap | null {
    const original = maps.value.find(m => m.id === id)
    if (!original) return null
    
    const now = Date.now()
    const duplicated: NovelMap = {
      ...JSON.parse(JSON.stringify(original)),
      id: generateId(),
      name: `${original.name} (副本)`,
      createdAt: now,
      updatedAt: now
    }
    maps.value.push(duplicated)
    saveMap(duplicated)
    return duplicated
  }

  function setCurrentMap(id: string | null) {
    currentMapId.value = id
    selectedElementIds.value = []
    history.value = []
    historyIndex.value = -1
    if (id) {
      pushHistory()
    }
  }

  function addLayer(mapId: string, layer?: Partial<MapLayer>): MapLayer | null {
    const map = maps.value.find(m => m.id === mapId)
    if (!map) return null
    
    const newLayer: MapLayer = {
      id: generateId(),
      name: layer?.name || `图层 ${map.layers.length + 1}`,
      visible: layer?.visible ?? true,
      locked: layer?.locked ?? false,
      opacity: layer?.opacity ?? 1,
      zIndex: map.layers.length,
      elements: layer?.elements || []
    }
    map.layers.push(newLayer)
    saveMap(map)
    pushHistory()
    return newLayer
  }

  function updateLayer(mapId: string, layerId: string, updates: Partial<MapLayer>) {
    const map = maps.value.find(m => m.id === mapId)
    if (!map) return
    
    const layer = map.layers.find(l => l.id === layerId)
    if (layer) {
      Object.assign(layer, updates)
      saveMap(map)
      pushHistory()
    }
  }

  function deleteLayer(mapId: string, layerId: string) {
    const map = maps.value.find(m => m.id === mapId)
    if (!map || map.layers.length <= 1) return
    
    const index = map.layers.findIndex(l => l.id === layerId)
    if (index !== -1) {
      map.layers.splice(index, 1)
      saveMap(map)
      pushHistory()
    }
  }

  function moveLayer(mapId: string, layerId: string, direction: 'up' | 'down') {
    const map = maps.value.find(m => m.id === mapId)
    if (!map) return
    
    const index = map.layers.findIndex(l => l.id === layerId)
    if (index === -1) return
    
    const newIndex = direction === 'up' ? index + 1 : index - 1
    if (newIndex < 0 || newIndex >= map.layers.length) return
    
    const [layer] = map.layers.splice(index, 1)
    map.layers.splice(newIndex, 0, layer)
    
    map.layers.forEach((l, i) => l.zIndex = i)
    saveMap(map)
    pushHistory()
  }

  function addElement(mapId: string, layerId: string, element: Omit<MapElement, 'id'>): MapElement | null {
    const map = maps.value.find(m => m.id === mapId)
    if (!map) return null
    
    const layer = map.layers.find(l => l.id === layerId)
    if (!layer || layer.locked) return null
    
    const newElement: MapElement = {
      ...element,
      id: generateId()
    }
    layer.elements.push(newElement)
    saveMap(map)
    pushHistory()
    return newElement
  }

  function updateElement(mapId: string, elementId: string, updates: Partial<MapElement>, skipHistory = false) {
    const map = maps.value.find(m => m.id === mapId)
    if (!map) return
    
    for (const layer of map.layers) {
      const element = layer.elements.find(e => e.id === elementId)
      if (element) {
        Object.assign(element, updates)
        if (skipHistory) {
          saveMap(map)
        } else {
          saveMap(map)
          pushHistory()
        }
        break
      }
    }
  }

  function updateElements(mapId: string, updates: Record<string, Partial<MapElement>>, skipHistory = false) {
    const map = maps.value.find(m => m.id === mapId)
    if (!map) return
    
    let changed = false
    for (const layer of map.layers) {
      for (const element of layer.elements) {
        if (updates[element.id]) {
          Object.assign(element, updates[element.id])
          changed = true
        }
      }
    }
    if (changed) {
      saveMap(map)
      if (!skipHistory) {
        pushHistory()
      }
    }
  }

  function commitDragEnd(mapId: string, updates: Record<string, Partial<MapElement>>) {
    const map = maps.value.find(m => m.id === mapId)
    if (!map) return
    
    let changed = false
    for (const layer of map.layers) {
      for (const element of layer.elements) {
        if (updates[element.id]) {
          Object.assign(element, updates[element.id])
          changed = true
        }
      }
    }
    if (changed) {
      saveMap(map)
      pushHistory()
    }
  }

  function addElements(mapId: string, layerId: string, elements: Omit<MapElement, 'id'>[]): MapElement[] {
    const map = maps.value.find(m => m.id === mapId)
    if (!map) return []
    
    const layer = map.layers.find(l => l.id === layerId)
    if (!layer || layer.locked) return []
    
    const newElements: MapElement[] = []
    for (const element of elements) {
      const newElement: MapElement = {
        ...element,
        id: generateId()
      }
      layer.elements.push(newElement)
      newElements.push(newElement)
    }
    saveMap(map)
    pushHistory()
    return newElements
  }

  function deleteElements(mapId: string, elementIds: string[]) {
    const map = maps.value.find(m => m.id === mapId)
    if (!map) return
    
    map.layers.forEach(layer => {
      layer.elements = layer.elements.filter(e => !elementIds.includes(e.id))
    })
    selectedElementIds.value = selectedElementIds.value.filter(id => !elementIds.includes(id))
    saveMap(map)
    pushHistory()
  }

  function selectElement(elementId: string, addToSelection = false) {
    if (addToSelection) {
      const index = selectedElementIds.value.indexOf(elementId)
      if (index === -1) {
        selectedElementIds.value.push(elementId)
      } else {
        selectedElementIds.value.splice(index, 1)
      }
    } else {
      selectedElementIds.value = [elementId]
    }
  }

  function clearSelection() {
    selectedElementIds.value = []
  }

  function selectAll() {
    if (!currentMap.value) return
    selectedElementIds.value = []
    currentMap.value.layers.forEach(layer => {
      if (!layer.locked) {
        layer.elements.forEach(el => {
          selectedElementIds.value.push(el.id)
        })
      }
    })
  }

  function pushHistory() {
    if (!currentMap.value) return
    
    const state = JSON.stringify(currentMap.value)
    history.value = history.value.slice(0, historyIndex.value + 1)
    history.value.push(state)
    
    if (history.value.length > maxHistory) {
      history.value.shift()
    }
    historyIndex.value = history.value.length - 1
  }

  function undo() {
    if (!canUndo.value) return
    
    historyIndex.value--
    const state = JSON.parse(history.value[historyIndex.value])
    const index = maps.value.findIndex(m => m.id === state.id)
    if (index !== -1) {
      maps.value[index] = state
    }
  }

  function redo() {
    if (!canRedo.value) return
    
    historyIndex.value++
    const state = JSON.parse(history.value[historyIndex.value])
    const index = maps.value.findIndex(m => m.id === state.id)
    if (index !== -1) {
      maps.value[index] = state
    }
  }

  function importMap(mapData: NovelMap): NovelMap {
    const now = Date.now()
    const style = mapData.style || 'custom'
    const stylePreset = MAP_STYLES.find(s => s.id === style)
    const newMap: NovelMap = {
      ...mapData,
      style,
      gridType: mapData.gridType || 'square',
      gridColor: mapData.gridColor || (stylePreset ? stylePreset.gridColor : 'rgba(128, 128, 128, 0.2)'),
      gridOpacity: mapData.gridOpacity ?? (stylePreset ? stylePreset.gridOpacity : 0.2),
      id: generateId(),
      createdAt: now,
      updatedAt: now
    }
    maps.value.push(newMap)
    saveMap(newMap)
    return newMap
  }

  function exportMap(id: string): string | null {
    const map = maps.value.find(m => m.id === id)
    if (!map) return null
    return JSON.stringify(map, null, 2)
  }

  /* ===== 瓦片地图操作 ===== */

  function initTileData(mapId: string, tileWidth: number, tileHeight: number, tileSetId: string) {
    const map = maps.value.find(m => m.id === mapId)
    if (!map) return
    const tileSet = TILE_SETS[tileSetId] || TILE_SETS['fantasy']
    map.tileData = {
      tiles: new Array(tileWidth * tileHeight).fill(tileSet.bgTile),
      tileWidth, tileHeight, tileSetId,
      stamps: [], labels: [], showContour: false
    }
    saveMap(map)
    pushHistory()
  }

  function updateTileData(mapId: string, updates: Partial<TileMapData>) {
    const map = maps.value.find(m => m.id === mapId)
    if (!map || !map.tileData) return
    Object.assign(map.tileData, updates)
    saveMap(map)
  }

  /* 调整瓦片地图尺寸，保留重叠区域数据 */
  function resizeTileData(mapId: string, newW: number, newH: number) {
    const map = maps.value.find(m => m.id === mapId)
    if (!map) return
    if (!map.tileData) {
      initTileData(mapId, newW, newH, 'fantasy')
      return
    }
    const td = map.tileData
    const tileSet = TILE_SETS[td.tileSetId]
    const tiles = new Array(newW * newH).fill(tileSet ? tileSet.bgTile : 0)
    const copyW = Math.min(newW, td.tileWidth)
    const copyH = Math.min(newH, td.tileHeight)
    for (let y = 0; y < copyH; y++) {
      for (let x = 0; x < copyW; x++) {
        tiles[y * newW + x] = td.tiles[y * td.tileWidth + x]
      }
    }
    td.tileWidth = newW
    td.tileHeight = newH
    td.tiles = tiles
    td.stamps = []
    td.labels = []
    saveMap(map)
    pushHistory()
  }

  function paintTiles(mapId: string, x: number, y: number, tileId: number, brushSize: number, brushShape: 'square' | 'circle') {
    const map = maps.value.find(m => m.id === mapId)
    if (!map || !map.tileData) return
    const { tiles, tileWidth, tileHeight } = map.tileData
    const half = Math.floor(brushSize / 2)
    const r2 = (brushSize / 2) ** 2
    for (let dy = -half; dy < -half + brushSize; dy++) {
      for (let dx = -half; dx < -half + brushSize; dx++) {
        if (brushShape === 'circle' && (dx + 0.5) ** 2 + (dy + 0.5) ** 2 > r2) continue
        const px = x + dx, py = y + dy
        if (px >= 0 && py >= 0 && px < tileWidth && py < tileHeight) tiles[py * tileWidth + px] = tileId
      }
    }
  }

  function paintLine(mapId: string, x0: number, y0: number, x1: number, y1: number, tileId: number) {
    const map = maps.value.find(m => m.id === mapId)
    if (!map || !map.tileData) return
    const { tiles, tileWidth, tileHeight } = map.tileData
    let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1, err = dx - dy, x = x0, y = y0
    while (true) {
      if (x >= 0 && y >= 0 && x < tileWidth && y < tileHeight) tiles[y * tileWidth + x] = tileId
      if (x === x1 && y === y1) break
      const e2 = 2 * err; if (e2 > -dy) { err -= dy; x += sx } if (e2 < dx) { err += dx; y += sy }
    }
  }

  function paintRect(mapId: string, x0: number, y0: number, x1: number, y1: number, tileId: number) {
    const map = maps.value.find(m => m.id === mapId)
    if (!map || !map.tileData) return
    const { tiles, tileWidth, tileHeight } = map.tileData
    const xa = Math.min(x0, x1), xb = Math.max(x0, x1), ya = Math.min(y0, y1), yb = Math.max(y0, y1)
    for (let y = ya; y <= yb; y++) for (let x = xa; x <= xb; x++) {
      if (x >= 0 && y >= 0 && x < tileWidth && y < tileHeight && (x === xa || x === xb || y === ya || y === yb)) tiles[y * tileWidth + x] = tileId
    }
  }

  function floodFillTiles(mapId: string, x: number, y: number, tileId: number) {
    const map = maps.value.find(m => m.id === mapId)
    if (!map || !map.tileData) return
    const { tiles, tileWidth, tileHeight } = map.tileData
    if (x < 0 || y < 0 || x >= tileWidth || y >= tileHeight) return
    const target = tiles[y * tileWidth + x]; if (target === tileId) return
    const stack = [[x, y]]
    while (stack.length) {
      const [cx, cy] = stack.pop()!
      if (cx < 0 || cy < 0 || cx >= tileWidth || cy >= tileHeight) continue
      const i = cy * tileWidth + cx; if (tiles[i] !== target) continue
      tiles[i] = tileId; stack.push([cx + 1, cy], [cx - 1, cy], [cx, cy + 1], [cx, cy - 1])
    }
    saveMap(map); pushHistory()
  }

  function addTileStamp(mapId: string, x: number, y: number, emoji: string) {
    const map = maps.value.find(m => m.id === mapId)
    if (!map || !map.tileData) return
    if (!map.tileData.stamps.some(s => s.x === x && s.y === y)) {
      map.tileData.stamps.push({ x, y, emoji }); saveMap(map); pushHistory()
    }
  }

  function addTileLabel(mapId: string, x: number, y: number, text: string) {
    const map = maps.value.find(m => m.id === mapId)
    if (!map || !map.tileData) return
    map.tileData.labels.push({ x, y, text }); saveMap(map); pushHistory()
  }

  function clearTileData(mapId: string) {
    const map = maps.value.find(m => m.id === mapId)
    if (!map || !map.tileData) return
    const tileSet = TILE_SETS[map.tileData.tileSetId]
    map.tileData.tiles.fill(tileSet ? tileSet.bgTile : 0)
    map.tileData.stamps = []; map.tileData.labels = []
    saveMap(map); pushHistory()
  }

  function commitTileHistory(mapId: string) {
    const map = maps.value.find(m => m.id === mapId)
    if (!map) return
    saveMap(map); pushHistory()
  }

  return {
    maps,
    currentMapId,
    currentMap,
    selectedElementIds,
    selectedElements,
    isInitialized,
    isLoading,
    canUndo,
    canRedo,
    loadMaps,
    saveMap,
    createMap,
    deleteMap,
    duplicateMap,
    setCurrentMap,
    addLayer,
    updateLayer,
    deleteLayer,
    moveLayer,
    addElement,
    addElements,
    updateElement,
    updateElements,
    commitDragEnd,
    deleteElements,
    selectElement,
    clearSelection,
    selectAll,
    undo,
    redo,
    importMap,
    exportMap,
    initTileData,
    resizeTileData,
    updateTileData,
    paintTiles,
    paintLine,
    paintRect,
    floodFillTiles,
    addTileStamp,
    addTileLabel,
    clearTileData,
    commitTileHistory
  }
})
