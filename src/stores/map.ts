import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { NovelMap, MapLayer, MapElement } from '@/types/map'
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
      maps.value = savedMaps
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
    const newMap: NovelMap = {
      id: generateId(),
      name: data.name || '新地图',
      description: data.description || '',
      type: data.type || 'world',
      width: data.width || 2000,
      height: data.height || 2000,
      backgroundColor: data.backgroundColor || '#f5f5dc',
      gridVisible: data.gridVisible ?? true,
      gridSize: data.gridSize || 50,
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
    const newMap: NovelMap = {
      ...mapData,
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
    exportMap
  }
})
