<template>
  <div class="map-list">
    <div class="list-header">
      <el-input
        v-model="searchText"
        placeholder="搜索地图..."
        prefix-icon="Search"
        clearable
        size="small"
      />
      <el-button type="primary" size="small" @click="createNewMap">
        <el-icon><Plus /></el-icon>
        新建
      </el-button>
    </div>

    <div class="list-content">
      <el-empty v-if="filteredMaps.length === 0" description="暂无地图" />

      <div
        v-for="map in filteredMaps"
        :key="map.id"
        class="map-item"
        :class="{ active: map.id === currentMapId }"
        @click="selectMap(map.id)"
      >
        <div class="map-preview">
          <div class="preview-canvas" :style="{ backgroundColor: map.backgroundColor }">
            <span class="map-type-icon">{{ getTypeIcon(map.type) }}</span>
          </div>
        </div>
        <div class="map-info">
          <div class="map-name">{{ map.name }}</div>
          <div class="map-meta">
            <span class="map-type">{{ getTypeName(map.type) }}</span>
            <span class="map-style">{{ getStyleIcon(map.style) }} {{ getStyleName(map.style) }}</span>
            <span class="map-date">{{ formatDate(map.updatedAt) }}</span>
          </div>
        </div>
        <div class="map-actions">
          <el-dropdown trigger="click" @command="handleCommand($event, map.id)">
            <el-button link size="small">
              <el-icon><MoreFilled /></el-icon>
            </el-button>
            <template #dropdown>
              <el-dropdown-menu>
                <el-dropdown-item command="duplicate">
                  <el-icon><CopyDocument /></el-icon>
                  复制
                </el-dropdown-item>
                <el-dropdown-item command="export">
                  <el-icon><Download /></el-icon>
                  导出
                </el-dropdown-item>
                <el-dropdown-item command="delete" divided>
                  <el-icon><Delete /></el-icon>
                  删除
                </el-dropdown-item>
              </el-dropdown-menu>
            </template>
          </el-dropdown>
        </div>
      </div>
    </div>

    <el-dialog v-model="showCreateDialog" title="新建地图" width="500px">
      <el-form :model="newMapForm" label-width="80px">
        <el-form-item label="地图名称">
          <el-input v-model="newMapForm.name" placeholder="请输入地图名称" />
        </el-form-item>
        <el-form-item label="地图类型">
          <el-select v-model="newMapForm.type" style="width: 100%">
            <el-option label="世界地图" value="world">
              <span>🌍 世界地图</span>
            </el-option>
            <el-option label="区域地图" value="region">
              <span>🗺️ 区域地图</span>
            </el-option>
            <el-option label="城市地图" value="city">
              <span>🏙️ 城市地图</span>
            </el-option>
            <el-option label="建筑地图" value="building">
              <span>🏠 建筑地图</span>
            </el-option>
            <el-option label="自定义" value="custom">
              <span>📝 自定义</span>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="画布尺寸">
          <el-col :span="11">
            <el-input-number v-model="newMapForm.width" :min="500" :max="10000" :step="100" style="width: 100%" />
          </el-col>
          <el-col :span="2" style="text-align: center">×</el-col>
          <el-col :span="11">
            <el-input-number v-model="newMapForm.height" :min="500" :max="10000" :step="100" style="width: 100%" />
          </el-col>
        </el-form-item>
        <el-form-item label="背景颜色">
          <el-color-picker v-model="newMapForm.backgroundColor" />
        </el-form-item>
        <el-form-item label="地图风格">
          <div class="style-grid">
            <div
              v-for="style in MAP_STYLES"
              :key="style.id"
              class="style-card"
              :class="{ active: newMapForm.style === style.id }"
              @click="selectStyle(style.id)"
            >
              <span class="style-icon">{{ style.icon }}</span>
              <span class="style-name">{{ style.name }}</span>
            </div>
          </div>
        </el-form-item>
        <el-form-item label="显示网格">
          <el-switch v-model="newMapForm.gridVisible" />
        </el-form-item>
        <el-form-item label="网格类型" v-if="newMapForm.gridVisible">
          <el-select v-model="newMapForm.gridType" style="width: 100%">
            <el-option v-for="gt in GRID_TYPES" :key="gt.id" :label="gt.name" :value="gt.id">
              <span>{{ gt.icon }} {{ gt.name }}</span>
            </el-option>
          </el-select>
        </el-form-item>
        <el-form-item label="网格大小">
          <el-input-number v-model="newMapForm.gridSize" :min="10" :max="200" :step="10" />
        </el-form-item>
        <el-form-item label="网格颜色" v-if="newMapForm.gridVisible && newMapForm.gridType !== 'none'">
          <el-color-picker v-model="newMapForm.gridColor" />
        </el-form-item>
        <el-form-item label="网格透明度" v-if="newMapForm.gridVisible && newMapForm.gridType !== 'none'">
          <el-slider v-model="newMapForm.gridOpacity" :min="0" :max="1" :step="0.05" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="showCreateDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmCreate">创建</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, MoreFilled, CopyDocument, Download, Delete } from '@element-plus/icons-vue'
import { useMapStore } from '@/stores/map'
import type { NovelMap, MapStyle, GridType } from '@/types/map'
import { MAP_STYLES, GRID_TYPES } from '@/types/map'

const mapStore = useMapStore()

const searchText = ref('')
const showCreateDialog = ref(false)
const newMapForm = ref({
  name: '',
  type: 'world' as NovelMap['type'],
  style: 'fantasy' as MapStyle,
  width: 2000,
  height: 2000,
  backgroundColor: '#f5f5dc',
  gridVisible: true,
  gridType: 'square' as GridType,
  gridSize: 50,
  gridColor: '#a08050',
  gridOpacity: 0.3
})

const currentMapId = computed(() => mapStore.currentMapId)

const filteredMaps = computed(() => {
  if (!searchText.value) return mapStore.maps
  const search = searchText.value.toLowerCase()
  return mapStore.maps.filter(m => 
    m.name.toLowerCase().includes(search) ||
    m.description.toLowerCase().includes(search)
  )
})

function getTypeIcon(type: NovelMap['type']): string {
  const icons: Record<string, string> = {
    world: '🌍',
    region: '🗺️',
    city: '🏙️',
    building: '🏠',
    custom: '📝'
  }
  return icons[type] || '🗺️'
}

function getTypeName(type: NovelMap['type']): string {
  const names: Record<string, string> = {
    world: '世界地图',
    region: '区域地图',
    city: '城市地图',
    building: '建筑地图',
    custom: '自定义'
  }
  return names[type] || '未知'
}

function selectStyle(styleId: MapStyle) {
  newMapForm.value.style = styleId
  const preset = MAP_STYLES.find(s => s.id === styleId)
  if (preset) {
    newMapForm.value.backgroundColor = preset.backgroundColor
    newMapForm.value.gridColor = preset.gridColor
    newMapForm.value.gridOpacity = preset.gridOpacity
  }
}

function getStyleIcon(style: MapStyle): string {
  const preset = MAP_STYLES.find(s => s.id === style)
  return preset?.icon || '🗺️'
}

function getStyleName(style: MapStyle): string {
  const preset = MAP_STYLES.find(s => s.id === style)
  return preset?.name || '未知'
}

function formatDate(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })
}

function selectMap(id: string) {
  mapStore.setCurrentMap(id)
}

function createNewMap() {
  newMapForm.value = {
    name: '',
    type: 'world',
    style: 'fantasy',
    width: 2000,
    height: 2000,
    backgroundColor: '#f5f5dc',
    gridVisible: true,
    gridType: 'square',
    gridSize: 50,
    gridColor: '#a08050',
    gridOpacity: 0.3
  }
  showCreateDialog.value = true
}

function confirmCreate() {
  if (!newMapForm.value.name.trim()) {
    ElMessage.warning('请输入地图名称')
    return
  }

  const map = mapStore.createMap(newMapForm.value)
  mapStore.setCurrentMap(map.id)
  showCreateDialog.value = false
  ElMessage.success('地图创建成功')
}

async function handleCommand(command: string, mapId: string) {
  switch (command) {
    case 'duplicate':
      const duplicated = mapStore.duplicateMap(mapId)
      if (duplicated) {
        ElMessage.success('地图已复制')
      }
      break
    case 'export':
      const json = mapStore.exportMap(mapId)
      if (json) {
        const blob = new Blob([json], { type: 'application/json' })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        a.href = url
        const map = mapStore.maps.find(m => m.id === mapId)
        a.download = `${map?.name || 'map'}.json`
        a.click()
        URL.revokeObjectURL(url)
        ElMessage.success('地图已导出')
      }
      break
    case 'delete':
      try {
        await ElMessageBox.confirm('确定要删除这个地图吗？此操作不可撤销。', '删除确认', {
          type: 'warning'
        })
        mapStore.deleteMap(mapId)
        ElMessage.success('地图已删除')
      } catch {
        // 用户取消
      }
      break
  }
}
</script>

<style scoped>
.map-list {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: #1a1a2e;
}

.list-header {
  padding: 15px;
  display: flex;
  gap: 10px;
  border-bottom: 1px solid #0f3460;
}

.list-content {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
}

.map-item {
  display: flex;
  align-items: center;
  padding: 10px;
  margin-bottom: 8px;
  background: #16213e;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s;
  border: 2px solid transparent;
}

.map-item:hover {
  background: #1f2b47;
}

.map-item.active {
  border-color: #e94560;
  background: #1f2b47;
}

.map-preview {
  width: 60px;
  height: 60px;
  margin-right: 12px;
  flex-shrink: 0;
}

.preview-canvas {
  width: 100%;
  height: 100%;
  border-radius: 6px;
  display: flex;
  align-items: center;
  justify-content: center;
  border: 1px solid #0f3460;
}

.map-type-icon {
  font-size: 24px;
}

.map-info {
  flex: 1;
  min-width: 0;
}

.map-name {
  font-size: 14px;
  font-weight: 500;
  color: #e0e0e0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.map-meta {
  display: flex;
  gap: 10px;
  margin-top: 4px;
  font-size: 12px;
  color: #808080;
}

.map-actions {
  opacity: 0;
  transition: opacity 0.2s;
}

.map-item:hover .map-actions {
  opacity: 1;
}

:deep(.el-input__wrapper) {
  background: #0f3460;
  border-color: #0f3460;
}

:deep(.el-input__inner) {
  color: #e0e0e0;
}

:deep(.el-input__inner::placeholder) {
  color: #606060;
}

.style-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
  width: 100%;
}

.style-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 10px 5px;
  background: #16213e;
  border: 2px solid transparent;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.style-card:hover {
  background: #1f2b47;
}

.style-card.active {
  border-color: #e94560;
  background: #1f2b47;
}

.style-icon {
  font-size: 20px;
  margin-bottom: 4px;
}

.style-name {
  font-size: 11px;
  color: #a0a0a0;
  text-align: center;
}

.style-card.active .style-name {
  color: #e0e0e0;
}

.map-style {
  color: #a0a0a0;
}
</style>
