<template>
  <div class="map-editor">
    <MapToolbar
      :tool="currentTool"
      :can-undo="canUndo"
      :can-redo="canRedo"
      @update:tool="currentTool = $event"
      @undo="undo"
      @redo="redo"
      @generate="showAIDialog = true"
      @export="showExportDialog = true"
      @save="saveCurrentMap"
    />

    <div class="editor-main">
      <div class="left-panel">
        <el-tabs v-model="leftTab" type="border-card">
          <el-tab-pane label="图层" name="layers">
            <LayerPanel
              :layers="currentMap?.layers || []"
              :selected-layer-id="selectedLayerId"
              @select-layer="selectedLayerId = $event"
              @add-layer="addLayer"
              @delete-layer="deleteLayer"
              @update-layer="updateLayer"
              @move-layer="moveLayer"
            />
          </el-tab-pane>
          <el-tab-pane label="素材" name="assets">
            <AssetPanel @select-asset="selectAsset" />
          </el-tab-pane>
        </el-tabs>
      </div>

      <div class="canvas-container">
        <MapCanvas
          ref="canvasRef"
          :map="currentMap"
          :tool="currentTool"
          :selected-element-ids="selectedElementIds"
          :selected-layer-id="selectedLayerId"
          :selected-asset="selectedAsset"
          :brush-config="brushConfig"
          :fill-config="fillConfig"
          @select-element="selectElement"
          @update-element="handleUpdateElement"
          @add-element="addElement"
          @add-elements="addElements"
          @delete-elements="deleteElements"
          @update:zoom="zoom = $event"
          @commit-drag="commitDrag"
        />

        <div class="zoom-controls">
          <el-button-group>
            <el-button size="small" @click="zoomIn">
              <el-icon><ZoomIn /></el-icon>
            </el-button>
            <el-button size="small" disabled>{{ Math.round(zoom * 100) }}%</el-button>
            <el-button size="small" @click="zoomOut">
              <el-icon><ZoomOut /></el-icon>
            </el-button>
            <el-button size="small" @click="resetView">重置</el-button>
          </el-button-group>
        </div>
      </div>

      <div class="right-panel">
        <el-tabs v-model="rightTab" type="border-card">
          <el-tab-pane label="属性" name="properties">
            <PropertyPanel
              :elements="selectedElements"
              :map="currentMap"
              @update-element="updateElement"
              @update-map="updateMap"
            />
            <div v-if="currentTool === 'brush'" class="tool-config-panel">
              <h4>笔刷设置</h4>
              <el-form label-width="60px" size="small">
                <el-form-item label="间距">
                  <el-slider v-model="brushConfig.spacing" :min="10" :max="80" :step="5" />
                </el-form-item>
                <el-form-item label="随机">
                  <el-slider v-model="brushConfig.randomness" :min="0" :max="30" :step="1" />
                </el-form-item>
                <el-form-item label="大小">
                  <el-slider v-model="brushConfig.sizeScale" :min="0.3" :max="3" :step="0.1" />
                </el-form-item>
              </el-form>
            </div>
            <div v-if="currentTool === 'fill'" class="tool-config-panel">
              <h4>填充设置</h4>
              <el-form label-width="60px" size="small">
                <el-form-item label="密度">
                  <el-slider v-model="fillConfig.density" :min="0.2" :max="2" :step="0.1" />
                </el-form-item>
                <el-form-item label="随机">
                  <el-slider v-model="fillConfig.randomness" :min="0" :max="30" :step="1" />
                </el-form-item>
                <el-form-item label="大小">
                  <el-slider v-model="fillConfig.sizeScale" :min="0.3" :max="3" :step="0.1" />
                </el-form-item>
              </el-form>
            </div>
          </el-tab-pane>
          <el-tab-pane label="地图" name="map-info">
            <MapInfoPanel
              :map="currentMap"
              @update-map="updateMap"
            />
          </el-tab-pane>
        </el-tabs>
      </div>
    </div>

    <AIGenerateDialog
      v-model="showAIDialog"
      @generate="handleAIGenerate"
    />

    <ExportDialog
      v-model="showExportDialog"
      :map="currentMap"
      :canvas-ref="canvasRef"
    />
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { ZoomIn, ZoomOut } from '@element-plus/icons-vue'
import { useMapStore } from '@/stores/map'
import type { MapTool, MapAsset, MapElement, BrushConfig, FillConfig } from '@/types/map'
import MapToolbar from './MapToolbar.vue'
import MapCanvas from './MapCanvas.vue'
import LayerPanel from './LayerPanel.vue'
import AssetPanel from './AssetPanel.vue'
import PropertyPanel from './PropertyPanel.vue'
import MapInfoPanel from './MapInfoPanel.vue'
import AIGenerateDialog from './AIGenerateDialog.vue'
import ExportDialog from './ExportDialog.vue'

const mapStore = useMapStore()

const currentTool = ref<MapTool>('select')
const selectedLayerId = ref<string | null>(null)
const selectedAsset = ref<MapAsset | null>(null)
const zoom = ref(1)
const leftTab = ref('layers')
const rightTab = ref('properties')
const showAIDialog = ref(false)
const showExportDialog = ref(false)
const canvasRef = ref<InstanceType<typeof MapCanvas> | null>(null)

const brushConfig = ref<BrushConfig>({
  spacing: 25,
  randomness: 5,
  sizeScale: 1
})

const fillConfig = ref<FillConfig>({
  density: 0.7,
  sizeScale: 0.8,
  randomness: 10
})

const currentMap = computed(() => mapStore.currentMap)
const selectedElementIds = computed(() => mapStore.selectedElementIds)
const selectedElements = computed(() => mapStore.selectedElements)
const canUndo = computed(() => mapStore.canUndo)
const canRedo = computed(() => mapStore.canRedo)

watch(currentMap, (map) => {
  if (map && map.layers.length > 0 && !selectedLayerId.value) {
    selectedLayerId.value = map.layers[0].id
  }
}, { immediate: true })

function selectElement(elementId: string, addToSelection = false) {
  mapStore.selectElement(elementId, addToSelection)
}

function updateElement(elementId: string, updates: Partial<MapElement>, skipHistory = false) {
  if (currentMap.value) {
    mapStore.updateElement(currentMap.value.id, elementId, updates, skipHistory)
  }
}

function handleUpdateElement(elementId: string, updates: Partial<MapElement>, skipHistory = false) {
  updateElement(elementId, updates, skipHistory)
}

function addElement(element: Omit<MapElement, 'id'>) {
  if (currentMap.value && selectedLayerId.value) {
    mapStore.addElement(currentMap.value.id, selectedLayerId.value, element)
  }
}

function addElements(elements: Omit<MapElement, 'id'>[]) {
  if (currentMap.value && selectedLayerId.value) {
    mapStore.addElements(currentMap.value.id, selectedLayerId.value, elements)
  }
}

function commitDrag(updates: Record<string, Partial<MapElement>>) {
  if (currentMap.value) {
    mapStore.commitDragEnd(currentMap.value.id, updates)
  }
}

function deleteElements(elementIds: string[]) {
  if (currentMap.value) {
    mapStore.deleteElements(currentMap.value.id, elementIds)
  }
}

function addLayer() {
  if (currentMap.value) {
    const layer = mapStore.addLayer(currentMap.value.id)
    if (layer) {
      selectedLayerId.value = layer.id
    }
  }
}

function deleteLayer(layerId: string) {
  if (currentMap.value) {
    mapStore.deleteLayer(currentMap.value.id, layerId)
    if (selectedLayerId.value === layerId && currentMap.value.layers.length > 0) {
      selectedLayerId.value = currentMap.value.layers[0].id
    }
  }
}

function updateLayer(layerId: string, updates: any) {
  if (currentMap.value) {
    mapStore.updateLayer(currentMap.value.id, layerId, updates)
  }
}

function moveLayer(layerId: string, direction: 'up' | 'down') {
  if (currentMap.value) {
    mapStore.moveLayer(currentMap.value.id, layerId, direction)
  }
}

function selectAsset(asset: MapAsset) {
  selectedAsset.value = asset
  if (currentTool.value !== 'brush' && currentTool.value !== 'fill') {
    currentTool.value = 'marker'
  }
}

function updateMap(updates: Partial<any>) {
  if (currentMap.value) {
    Object.assign(currentMap.value, updates)
    mapStore.saveMap(currentMap.value)
  }
}

function undo() {
  mapStore.undo()
}

function redo() {
  mapStore.redo()
}

function zoomIn() {
  zoom.value = Math.min(zoom.value * 1.2, 5)
}

function zoomOut() {
  zoom.value = Math.max(zoom.value / 1.2, 0.1)
}

function resetView() {
  zoom.value = 1
  if (canvasRef.value) {
    canvasRef.value.resetView()
  }
}

function saveCurrentMap() {
  if (currentMap.value) {
    mapStore.saveMap(currentMap.value)
    ElMessage.success('地图已保存')
  }
}

async function handleAIGenerate(mapData: Partial<NovelMap>) {
  if (!currentMap.value) {
    ElMessage.warning('请先创建或选择一个地图')
    return
  }
  
  try {
    if (mapData.layers && mapData.layers.length > 0) {
      currentMap.value.layers = mapData.layers
    }
    if (mapData.name) {
      currentMap.value.name = mapData.name
    }
    if (mapData.description) {
      currentMap.value.description = mapData.description
    }
    if (mapData.backgroundColor) {
      currentMap.value.backgroundColor = mapData.backgroundColor
    }
    
    currentMap.value.updatedAt = Date.now()
    
    mapStore.saveMap(currentMap.value)
    
    if (currentMap.value.layers.length > 0) {
      selectedLayerId.value = currentMap.value.layers[0].id
    }
    
    ElMessage.success(`地图已生成，包含 ${currentMap.value.layers.reduce((sum, l) => sum + l.elements.length, 0)} 个元素`)
  } catch (error: any) {
    console.error('应用地图数据失败:', error)
    ElMessage.error('应用地图数据失败: ' + error.message)
  }
}

onMounted(() => {
  mapStore.loadMaps()
})
</script>

<style scoped>
.map-editor {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1a1a2e;
}

.editor-main {
  display: flex;
  flex: 1;
  overflow: hidden;
}

.left-panel,
.right-panel {
  width: 280px;
  background: #16213e;
  border-color: #0f3460;
}

.left-panel :deep(.el-tabs--border-card),
.right-panel :deep(.el-tabs--border-card) {
  background: transparent;
  border: none;
}

.left-panel :deep(.el-tabs__header),
.right-panel :deep(.el-tabs__header) {
  background: #0f3460;
  border-bottom: 1px solid #0f3460;
}

.left-panel :deep(.el-tabs__item),
.right-panel :deep(.el-tabs__item) {
  color: #a0a0a0;
}

.left-panel :deep(.el-tabs__item.is-active),
.right-panel :deep(.el-tabs__item.is-active) {
  color: #e94560;
  background: #16213e;
}

.left-panel :deep(.el-tabs__content),
.right-panel :deep(.el-tabs__content) {
  padding: 10px;
  color: #e0e0e0;
}

.canvas-container {
  flex: 1;
  position: relative;
  overflow: hidden;
}

.zoom-controls {
  position: absolute;
  bottom: 20px;
  left: 50%;
  transform: translateX(-50%);
  z-index: 10;
}

.tool-config-panel {
  margin-top: 15px;
  padding: 10px;
  border-top: 1px solid #0f3460;
}

.tool-config-panel h4 {
  color: #e94560;
  margin: 0 0 10px 0;
  font-size: 13px;
}

.tool-config-panel :deep(.el-form-item__label) {
  color: #a0a0a0;
  font-size: 12px;
}
</style>
