<template>
  <div class="map-editor">
    <MapToolbar
      :tool="currentTool"
      :tile-set-id="currentTileSetId"
      :map-size="currentMapSize"
      :can-undo="canUndo"
      :can-redo="canRedo"
      @update:tile-set-id="changeTileSet"
      @update:map-size="changeMapSize"
      @update:tool="currentTool = $event"
      @undo="undo"
      @redo="redo"
      @save="saveCurrentMap"
      @export="showExportDialog = true"
      @generate="showGenerateDialog = true"
      @clear="clearMap"
    />

    <div class="main">
      <!-- 左侧：工具 / 笔刷 / 视图 -->
      <aside class="sidebar left">
        <div class="tool-group">
          <button
            v-for="t in tools"
            :key="t.id"
            class="tool"
            :class="{ active: currentTool === t.id }"
            :title="t.tip"
            @click="currentTool = t.id"
          >
            <span class="ti">{{ t.icon }}</span>
            <span class="tn">{{ t.name }}</span>
          </button>
        </div>

        <div class="divider"></div>

        <div class="panel-section">
          <div class="section-title">笔刷</div>
          <div class="brush-size">
            <input v-model.number="brushSize" type="range" min="1" max="12" />
            <span class="size-val">{{ brushSize }}</span>
          </div>
          <div class="brush-shape">
            <label><input v-model="brushShape" type="radio" value="square" /> 方形</label>
            <label><input v-model="brushShape" type="radio" value="circle" /> 圆形</label>
          </div>
        </div>

        <div class="divider"></div>

        <div class="panel-section">
          <div class="section-title">视图</div>
          <label class="check"><input v-model="showGrid" type="checkbox" /> 显示网格</label>
          <label class="check"><input v-model="showContour" type="checkbox" /> 等高线</label>
          <div class="layer-list">
            <label class="check"><input v-model="layerVisible.terrain" type="checkbox" /> 地形层</label>
            <label class="check"><input v-model="layerVisible.grid" type="checkbox" /> 网格层</label>
            <label class="check"><input v-model="layerVisible.label" type="checkbox" /> 标注层</label>
          </div>
          <div class="zoom-row">
            <button class="btn sm ghost" @click="canvasRef?.zoomOut()">－</button>
            <span class="zoom-val">{{ zoom }}%</span>
            <button class="btn sm ghost" @click="canvasRef?.zoomIn()">＋</button>
            <button class="btn sm ghost" title="适应窗口" @click="canvasRef?.fitZoom()">⤢</button>
          </div>
        </div>
      </aside>

      <!-- 中央画布 -->
      <section class="canvas-area">
        <MapCanvas
          ref="canvasRef"
          :map="currentMap"
          :tool="currentTool"
          :current-tile="currentTile"
          :current-stamp="currentStamp"
          :brush-size="brushSize"
          :brush-shape="brushShape"
          :show-grid="showGrid"
          :show-contour="showContour"
          :layer-visible="layerVisible"
          @update:zoom="zoom = $event"
          @hover-coords="hoverCoords = $event"
          @commit-tile-history="handleCommitTileHistory"
          @add-tile-label="handleAddTileLabel"
          @tile-picked="handleTilePicked"
        />
      </section>

      <!-- 右侧：调色板 / 图章 / 文字 -->
      <aside class="sidebar right">
        <TerrainPanel
          :tile-set-id="currentTileSetId"
          :current-tile="currentTile"
          :current-stamp="currentStamp"
          @update:tile-set-id="changeTileSet"
          @select-tile="handleSelectTile"
          @select-stamp="selectStamp"
          @add-label="handlePendingLabel"
        />
      </aside>
    </div>

    <!-- 底部状态栏 -->
    <footer class="statusbar">
      <span>坐标：{{ hoverCoords ? `${hoverCoords.x}, ${hoverCoords.y}` : '-' }}</span>
      <span>{{ mapSizeText }}</span>
      <span>{{ toolName }}</span>
      <span class="status-right">{{ statusMsg }}</span>
    </footer>

    <ExportDialog v-model="showExportDialog" :map="currentMap" :canvas-ref="canvasRef" />
    <GenerateDialog v-model="showGenerateDialog" @generate="handleGenerate" />
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useMapStore } from '@/stores/map'
import type { MapTool } from '@/types/map'
import { TILE_SETS } from '@/types/map'
import { generateTerrainMap, generateDungeon, hashSeed } from '@/utils/mapGenerator'
import MapToolbar from './MapToolbar.vue'
import MapCanvas from './MapCanvas.vue'
import TerrainPanel from './TerrainPanel.vue'
import ExportDialog from './ExportDialog.vue'
import GenerateDialog from './GenerateDialog.vue'

const mapStore = useMapStore()

/* ===== 状态 ===== */
const currentTool = ref<MapTool>('tile-brush')
const zoom = ref(100)
const showExportDialog = ref(false)
const showGenerateDialog = ref(false)
const canvasRef = ref<InstanceType<typeof MapCanvas> | null>(null)

const brushSize = ref(2)
const brushShape = ref<'square' | 'circle'>('square')
const showGrid = ref(true)
const showContour = ref(false)
const layerVisible = reactive({ terrain: true, grid: true, label: true })

const currentTile = ref(3)
const currentStamp = ref('💎')
const currentTileSetId = ref('fantasy')

const hoverCoords = ref<{ x: number; y: number } | null>(null)
const statusMsg = ref('就绪 - 试试随机生成')

const currentMap = computed(() => mapStore.currentMap)
const canUndo = computed(() => mapStore.canUndo)
const canRedo = computed(() => mapStore.canRedo)
const currentMapSize = computed(() => currentMap.value?.tileData?.tileWidth ?? 80)
const mapSizeText = computed(() => {
  const td = currentMap.value?.tileData
  return td ? `${td.tileWidth} × ${td.tileHeight}` : '-'
})

const tools = [
  { id: 'tile-brush' as MapTool, icon: '🖌', name: '画笔', tip: '画笔 (B)' },
  { id: 'tile-eraser' as MapTool, icon: '🩹', name: '橡皮', tip: '橡皮擦 (E)' },
  { id: 'tile-fill' as MapTool, icon: '🪣', name: '填充', tip: '油漆桶 (F)' },
  { id: 'tile-line' as MapTool, icon: '／', name: '直线', tip: '直线 (L)' },
  { id: 'tile-rect' as MapTool, icon: '▭', name: '矩形', tip: '矩形 (R)' },
  { id: 'tile-picker' as MapTool, icon: '💧', name: '取色', tip: '取色器 (I)' },
  { id: 'tile-stamp' as MapTool, icon: '⭐', name: '图章', tip: '图章 (S)' },
  { id: 'pan' as MapTool, icon: '✋', name: '平移', tip: '平移 (H / 空格)' },
]

const toolName = computed(() => tools.find(t => t.id === currentTool.value)?.name ?? currentTool.value)

/* 自动初始化瓦片数据 */
watch(currentMap, (map) => {
  if (map && !map.tileData) {
    mapStore.initTileData(map.id, 80, 80, currentTileSetId.value)
  }
}, { immediate: true })

/* ===== 操作 ===== */
function undo() { mapStore.undo() }
function redo() { mapStore.redo() }

function saveCurrentMap() {
  if (currentMap.value) {
    mapStore.saveMap(currentMap.value)
    statusMsg.value = '已保存'
  }
}

function clearMap() {
  if (!currentMap.value) return
  ElMessageBox.confirm('确定清空当前地图？', '提示', { type: 'warning' })
    .then(() => {
      mapStore.clearTileData(currentMap.value!.id)
      canvasRef.value?.renderAll()
      statusMsg.value = '已清空'
    })
    .catch(() => {})
}

function changeTileSet(tileSetId: string) {
  currentTileSetId.value = tileSetId
  currentTile.value = 0
  if (currentMap.value?.tileData) {
    mapStore.updateTileData(currentMap.value.id, { tileSetId })
  }
  statusMsg.value = `已切换到 ${TILE_SETS[tileSetId]?.name ?? tileSetId}`
}

function changeMapSize(size: number) {
  if (!currentMap.value) return
  mapStore.resizeTileData(currentMap.value.id, size, size)
  statusMsg.value = `尺寸已调整为 ${size} × ${size}`
}

function handleSelectTile(tileId: number) {
  currentTile.value = tileId
  /* 选了调色板自动切到画笔（除取色/平移外） */
  if (!['tile-picker', 'pan'].includes(currentTool.value)) {
    currentTool.value = 'tile-brush'
  }
}

function selectStamp(emoji: string) {
  currentStamp.value = emoji
  currentTool.value = 'tile-stamp'
}

function handleTilePicked(tileId: number) {
  currentTile.value = tileId
  currentTool.value = 'tile-brush'
  const t = TILE_SETS[currentTileSetId.value]?.tiles.find(x => x.id === tileId)
  statusMsg.value = `取色：${t?.name ?? tileId}`
}

function handlePendingLabel(text: string) {
  if (!currentMap.value?.tileData) {
    ElMessage.warning('请先启用瓦片地图')
    return
  }
  canvasRef.value?.setPendingTileLabel(text)
  statusMsg.value = `点击地图放置「${text}」`
}

function handleAddTileLabel(x: number, y: number, text: string) {
  if (!currentMap.value) return
  mapStore.addTileLabel(currentMap.value.id, x, y, text)
  statusMsg.value = '文字已放置'
}

function handleCommitTileHistory() {
  if (!currentMap.value) return
  mapStore.commitTileHistory(currentMap.value.id)
}

/* ===== 随机生成 ===== */
function handleGenerate(params: {
  seed: string; seaLevel: number; roughness: number; octaves: number; roomCount: number;
  tileSetId: string; tileWidth: number; tileHeight: number
}) {
  if (!currentMap.value) return

  /* 尺寸/风格与当前不同则调整 */
  if (!currentMap.value.tileData) {
    mapStore.initTileData(currentMap.value.id, params.tileWidth, params.tileHeight, params.tileSetId)
  } else {
    const td = currentMap.value.tileData
    if (td.tileWidth !== params.tileWidth || td.tileHeight !== params.tileHeight) {
      mapStore.resizeTileData(currentMap.value.id, params.tileWidth, params.tileHeight)
    }
    if (td.tileSetId !== params.tileSetId) {
      mapStore.updateTileData(currentMap.value.id, { tileSetId: params.tileSetId })
    }
    td.stamps = []
    td.labels = []
  }

  currentTileSetId.value = params.tileSetId
  currentTile.value = 0

  const seedNum = params.seed ? hashSeed(params.seed) : Math.floor(Math.random() * 1e9)
  const tiles = params.tileSetId === 'trpg'
    ? generateDungeon(seedNum, params.tileWidth, params.tileHeight, params.roomCount)
    : generateTerrainMap(seedNum, params.tileWidth, params.tileHeight, params.seaLevel, params.roughness, params.octaves, params.tileSetId)

  mapStore.updateTileData(currentMap.value.id, { tiles })
  if (currentMap.value.tileData) currentMap.value.tileData.tiles = tiles
  mapStore.commitTileHistory(currentMap.value.id)
  nextTickRender()

  statusMsg.value = `已生成 ${TILE_SETS[params.tileSetId]?.name}（种子 ${seedNum}）`
  ElMessage.success('地图已生成')
}

function nextTickRender() {
  requestAnimationFrame(() => canvasRef.value?.renderAll())
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
  background: #eef1f5;
  font-size: 13px;
  color: #1f2430;
}

.main { flex: 1; display: flex; min-height: 0; }

/* ===== 侧栏 ===== */
.sidebar {
  width: 196px;
  background: #fff;
  border-right: 1px solid #e2e6ec;
  display: flex;
  flex-direction: column;
  padding: 10px;
  gap: 8px;
  overflow-y: auto;
  flex-shrink: 0;
}
.sidebar.right { border-right: none; border-left: 1px solid #e2e6ec; }
.sidebar::-webkit-scrollbar { width: 8px; }
.sidebar::-webkit-scrollbar-thumb { background: #cdd3dc; border-radius: 4px; }
.sidebar::-webkit-scrollbar-track { background: transparent; }

.divider { height: 1px; background: #e2e6ec; margin: 2px 0; }
.panel-section { display: flex; flex-direction: column; gap: 7px; }
.section-title {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #8a93a3;
  font-weight: 600;
  margin-bottom: 2px;
}

/* 工具组 */
.tool-group { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; }
.tool {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 2px;
  padding: 7px 2px;
  background: #f7f8fa;
  border: 1px solid #e2e6ec;
  border-radius: 5px;
  cursor: pointer;
  transition: all 0.12s;
  font-family: inherit;
}
.tool:hover { background: #fff; border-color: #cdd3dc; }
.tool.active { background: #e8f0fe; border-color: #3b82f6; color: #2563eb; }
.tool .ti { font-size: 16px; line-height: 1; }
.tool .tn { font-size: 10px; }

/* 笔刷 */
.brush-size { display: flex; align-items: center; gap: 8px; }
.brush-size input[type='range'] { flex: 1; }
.size-val {
  font-size: 11px; color: #5b6472;
  min-width: 18px; text-align: center;
  background: #f7f8fa; border-radius: 4px; padding: 1px 4px;
}
.brush-shape { display: flex; gap: 10px; font-size: 11px; color: #5b6472; }
.brush-shape label { display: flex; align-items: center; gap: 3px; cursor: pointer; }

/* 复选框 */
.check { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #5b6472; cursor: pointer; }
.check input { accent-color: #3b82f6; cursor: pointer; }

.layer-list { display: flex; flex-direction: column; gap: 5px; padding-left: 2px; }

/* 缩放 */
.zoom-row { display: flex; align-items: center; gap: 4px; }
.zoom-val { flex: 1; text-align: center; font-size: 11px; color: #5b6472; }

.btn {
  font-size: 12px;
  color: #1f2430;
  background: #f7f8fa;
  border: 1px solid #e2e6ec;
  border-radius: 5px;
  padding: 4px 9px;
  cursor: pointer;
  font-family: inherit;
}
.btn:hover { background: #fff; border-color: #cdd3dc; }
.btn.sm { padding: 3px 8px; font-size: 11px; min-width: 30px; justify-content: center; }
.btn.ghost { background: transparent; }

/* range 通用 */
input[type='range'] {
  -webkit-appearance: none; appearance: none;
  height: 4px; background: #e2e6ec; border-radius: 2px; outline: none;
}
input[type='range']::-webkit-slider-thumb {
  -webkit-appearance: none; appearance: none;
  width: 14px; height: 14px; border-radius: 50%;
  background: #3b82f6; cursor: pointer; border: 2px solid #fff;
  box-shadow: 0 1px 3px rgba(0,0,0,0.25);
}

/* ===== 画布区 ===== */
.canvas-area { flex: 1; position: relative; overflow: hidden; min-width: 0; }

/* ===== 状态栏 ===== */
.statusbar {
  height: 26px;
  background: #fff;
  border-top: 1px solid #e2e6ec;
  display: flex;
  align-items: center;
  gap: 18px;
  padding: 0 14px;
  font-size: 11px;
  color: #5b6472;
  flex-shrink: 0;
}
.status-right { margin-left: auto; color: #8a93a3; }
</style>
