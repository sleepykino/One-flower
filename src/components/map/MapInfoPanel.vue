<template>
  <div class="map-info-panel">
    <div class="property-group">
      <div class="group-title">地图信息</div>

      <div class="property-item">
        <label>名称</label>
        <el-input v-model="localMap.name" size="small" @change="emitUpdate" />
      </div>

      <div class="property-item">
        <label>类型</label>
        <el-select v-model="localMap.type" size="small" @change="emitUpdate">
          <el-option label="世界地图" value="world" />
          <el-option label="区域地图" value="region" />
          <el-option label="城市地图" value="city" />
          <el-option label="建筑地图" value="building" />
          <el-option label="自定义" value="custom" />
        </el-select>
      </div>

      <div class="property-item">
        <label>宽度</label>
        <el-input-number v-model="localMap.width" size="small" :min="500" :max="10000" :step="100" @change="emitUpdate" />
      </div>

      <div class="property-item">
        <label>高度</label>
        <el-input-number v-model="localMap.height" size="small" :min="500" :max="10000" :step="100" @change="emitUpdate" />
      </div>

      <div class="property-item">
        <label>背景色</label>
        <el-color-picker v-model="localMap.backgroundColor" size="small" @change="emitUpdate" />
      </div>

      <div class="property-item full-width">
        <label>描述</label>
        <el-input
          v-model="localMap.description"
          type="textarea"
          :rows="3"
          size="small"
          @change="emitUpdate"
        />
      </div>
    </div>

    <div class="property-group">
      <div class="group-title">地图风格</div>

      <div class="style-grid">
        <div
          v-for="style in MAP_STYLES"
          :key="style.id"
          class="style-card"
          :class="{ active: localMap.style === style.id }"
          @click="applyStyle(style.id)"
        >
          <span class="style-icon">{{ style.icon }}</span>
          <span class="style-name">{{ style.name }}</span>
        </div>
      </div>
    </div>

    <div class="property-group">
      <div class="group-title">网格设置</div>

      <div class="property-item">
        <label>显示网格</label>
        <el-switch v-model="localMap.gridVisible" @change="emitUpdate" />
      </div>

      <template v-if="localMap.gridVisible">
        <div class="property-item">
          <label>网格类型</label>
          <el-select v-model="localMap.gridType" size="small" @change="emitUpdate">
            <el-option v-for="gt in GRID_TYPES" :key="gt.id" :label="gt.name" :value="gt.id">
              <span>{{ gt.icon }} {{ gt.name }}</span>
            </el-option>
          </el-select>
        </div>

        <div class="property-item">
          <label>网格大小</label>
          <el-input-number v-model="localMap.gridSize" size="small" :min="10" :max="200" :step="10" @change="emitUpdate" />
        </div>

        <template v-if="localMap.gridType !== 'none'">
          <div class="property-item">
            <label>网格颜色</label>
            <el-color-picker v-model="localMap.gridColor" size="small" @change="emitUpdate" />
          </div>

          <div class="property-item">
            <label>网格透明度</label>
            <el-slider v-model="localMap.gridOpacity" :min="0" :max="1" :step="0.05" @change="emitUpdate" />
          </div>
        </template>
      </template>
    </div>

    <div class="property-group">
      <div class="group-title">统计信息</div>

      <div class="stat-item">
        <span class="stat-label">图层数</span>
        <span class="stat-value">{{ map?.layers?.length || 0 }}</span>
      </div>

      <div class="stat-item">
        <span class="stat-label">元素数</span>
        <span class="stat-value">{{ totalElements }}</span>
      </div>

      <div class="stat-item">
        <span class="stat-label">创建时间</span>
        <span class="stat-value">{{ formatDate(map?.createdAt) }}</span>
      </div>

      <div class="stat-item">
        <span class="stat-label">更新时间</span>
        <span class="stat-value">{{ formatDate(map?.updatedAt) }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { NovelMap, MapStyle, MapStylePreset } from '@/types/map'
import { MAP_STYLES, GRID_TYPES } from '@/types/map'

const props = defineProps<{
  map: NovelMap | null
}>()

const emit = defineEmits<{
  (e: 'update-map', updates: Partial<NovelMap>): void
}>()

const localMap = ref({
  name: '',
  type: 'world' as NovelMap['type'],
  style: 'fantasy' as MapStyle,
  width: 2000,
  height: 2000,
  backgroundColor: '#f5f5dc',
  gridVisible: true,
  gridType: 'square' as NovelMap['gridType'],
  gridSize: 50,
  gridColor: '#a08050',
  gridOpacity: 0.3,
  description: ''
})

const totalElements = computed(() => {
  if (!props.map) return 0
  return props.map.layers.reduce((sum, layer) => sum + layer.elements.length, 0)
})

watch(() => props.map, (newMap) => {
  if (newMap) {
    localMap.value = {
      name: newMap.name,
      type: newMap.type,
      style: newMap.style,
      width: newMap.width,
      height: newMap.height,
      backgroundColor: newMap.backgroundColor,
      gridVisible: newMap.gridVisible,
      gridType: newMap.gridType,
      gridSize: newMap.gridSize,
      gridColor: newMap.gridColor,
      gridOpacity: newMap.gridOpacity,
      description: newMap.description
    }
  }
}, { immediate: true })

function applyStyle(styleId: MapStyle) {
  localMap.value.style = styleId
  const preset: MapStylePreset | undefined = MAP_STYLES.find(s => s.id === styleId)
  if (preset) {
    localMap.value.backgroundColor = preset.backgroundColor
    localMap.value.gridColor = preset.gridColor
    localMap.value.gridOpacity = preset.gridOpacity
  }
  emitUpdate()
}

function emitUpdate() {
  emit('update-map', { ...localMap.value })
}

function formatDate(timestamp?: number): string {
  if (!timestamp) return '-'
  return new Date(timestamp).toLocaleString('zh-CN', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  })
}
</script>

<style scoped>
.map-info-panel {
  padding: 4px 0;
  height: 100%;
  overflow-y: auto;
}

.property-group {
  margin-bottom: 15px;
  padding: 10px;
  background: #0f3460;
  border-radius: 6px;
}

.group-title {
  font-size: 13px;
  font-weight: 500;
  color: #e94560;
  margin-bottom: 10px;
  padding-bottom: 5px;
  border-bottom: 1px solid #1a3a5c;
}

.property-item {
  display: flex;
  align-items: center;
  margin-bottom: 10px;
}

.property-item.full-width {
  flex-direction: column;
  align-items: flex-start;
}

.property-item.full-width label {
  margin-bottom: 5px;
}

.property-item label {
  width: 70px;
  font-size: 12px;
  color: #a0a0a0;
  flex-shrink: 0;
}

.property-item :deep(.el-input),
.property-item :deep(.el-input-number),
.property-item :deep(.el-select) {
  flex: 1;
}

.property-item.full-width :deep(.el-textarea) {
  width: 100%;
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

.stat-item {
  display: flex;
  justify-content: space-between;
  padding: 5px 0;
  border-bottom: 1px solid #1a3a5c;
}

.stat-item:last-child {
  border-bottom: none;
}

.stat-label {
  font-size: 12px;
  color: #a0a0a0;
}

.stat-value {
  font-size: 12px;
  color: #e0e0e0;
}
</style>
