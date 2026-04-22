<template>
  <div class="property-panel">
    <div v-if="elements.length === 0" class="empty-state">
      <el-empty description="未选中任何元素" :image-size="60" />
    </div>

    <div v-else class="property-content">
      <div v-if="elements.length === 1" class="single-element">
        <div class="property-group">
          <div class="group-title">基本信息</div>
          
          <div class="property-item">
            <label>类型</label>
            <span>{{ getTypeName(element?.type) }}</span>
          </div>
          
          <div class="property-item">
            <label>位置 X</label>
            <el-input-number v-model="localElement.x" size="small" @change="updatePosition" />
          </div>
          
          <div class="property-item">
            <label>位置 Y</label>
            <el-input-number v-model="localElement.y" size="small" @change="updatePosition" />
          </div>
          
          <div class="property-item" v-if="element?.width !== undefined">
            <label>宽度</label>
            <el-input-number v-model="localElement.width" size="small" :min="10" @change="updateSize" />
          </div>
          
          <div class="property-item" v-if="element?.height !== undefined">
            <label>高度</label>
            <el-input-number v-model="localElement.height" size="small" :min="10" @change="updateSize" />
          </div>
          
          <div class="property-item">
            <label>旋转</label>
            <el-slider v-model="localElement.rotation" :min="0" :max="360" @change="updateRotation" />
          </div>
          
          <div class="property-item">
            <label>透明度</label>
            <el-slider v-model="localElement.opacity" :min="0" :max="1" :step="0.1" @change="updateOpacity" />
          </div>
        </div>

        <MarkerProperties
          v-if="element?.type === 'marker'"
          :data="element.data"
          @update="updateData"
        />
        
        <PathProperties
          v-if="element?.type === 'path'"
          :data="element.data"
          @update="updateData"
        />
        
        <ShapeProperties
          v-if="element?.type === 'shape'"
          :data="element.data"
          @update="updateData"
        />
        
        <TextProperties
          v-if="element?.type === 'text'"
          :data="element.data"
          @update="updateData"
        />
      </div>

      <div v-else class="multi-elements">
        <div class="property-group">
          <div class="group-title">批量编辑</div>
          <p class="hint">已选中 {{ elements.length }} 个元素</p>
          
          <div class="property-item">
            <label>统一透明度</label>
            <el-slider v-model="batchOpacity" :min="0" :max="1" :step="0.1" @change="batchUpdateOpacity" />
          </div>

          <div class="property-item">
            <label>统一旋转</label>
            <el-slider v-model="batchRotation" :min="0" :max="360" @change="batchUpdateRotation" />
          </div>

          <div class="property-item">
            <label>偏移 X</label>
            <el-input-number v-model="batchOffsetX" size="small" @change="batchUpdatePosition" />
          </div>

          <div class="property-item">
            <label>偏移 Y</label>
            <el-input-number v-model="batchOffsetY" size="small" @change="batchUpdatePosition" />
          </div>

          <div class="property-item">
            <label>统一大小</label>
            <el-slider v-model="batchSizeScale" :min="0.2" :max="3" :step="0.1" @change="batchUpdateSize" />
          </div>
        </div>

        <div class="batch-actions">
          <el-button type="danger" size="small" @click="deleteSelected">
            <el-icon><Delete /></el-icon>
            删除选中
          </el-button>
          <el-button size="small" @click="alignElements('left')">
            左对齐
          </el-button>
          <el-button size="small" @click="alignElements('center')">
            水平居中
          </el-button>
          <el-button size="small" @click="alignElements('right')">
            右对齐
          </el-button>
          <el-button size="small" @click="alignElements('top')">
            顶部对齐
          </el-button>
          <el-button size="small" @click="alignElements('middle')">
            垂直居中
          </el-button>
          <el-button size="small" @click="alignElements('bottom')">
            底部对齐
          </el-button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { Delete } from '@element-plus/icons-vue'
import type { MapElement, MarkerData, PathData, ShapeData, TextData } from '@/types/map'
import MarkerProperties from './properties/MarkerProperties.vue'
import PathProperties from './properties/PathProperties.vue'
import ShapeProperties from './properties/ShapeProperties.vue'
import TextProperties from './properties/TextProperties.vue'

const props = defineProps<{
  elements: MapElement[]
  map: any
}>()

const emit = defineEmits<{
  (e: 'update-element', id: string, updates: Partial<MapElement>): void
  (e: 'update-map', updates: any): void
}>()

const element = computed(() => props.elements[0] || null)

const localElement = ref({
  x: 0,
  y: 0,
  width: 100,
  height: 100,
  rotation: 0,
  opacity: 1
})

const batchOpacity = ref(1)
const batchRotation = ref(0)
const batchOffsetX = ref(0)
const batchOffsetY = ref(0)
const batchSizeScale = ref(1)

watch(element, (el) => {
  if (el) {
    localElement.value = {
      x: el.x,
      y: el.y,
      width: el.width || 100,
      height: el.height || 100,
      rotation: el.rotation,
      opacity: el.opacity
    }
  }
}, { immediate: true })

function getTypeName(type: string): string {
  const names: Record<string, string> = {
    marker: '标记',
    path: '路径',
    shape: '形状',
    text: '文字',
    image: '图片'
  }
  return names[type] || type
}

function updatePosition() {
  if (element.value) {
    emit('update-element', element.value.id, {
      x: localElement.value.x,
      y: localElement.value.y
    })
  }
}

function updateSize() {
  if (element.value) {
    emit('update-element', element.value.id, {
      width: localElement.value.width,
      height: localElement.value.height
    })
  }
}

function updateRotation() {
  if (element.value) {
    emit('update-element', element.value.id, {
      rotation: localElement.value.rotation
    })
  }
}

function updateOpacity() {
  if (element.value) {
    emit('update-element', element.value.id, {
      opacity: localElement.value.opacity
    })
  }
}

function updateData(data: any) {
  if (element.value) {
    emit('update-element', element.value.id, {
      data: { ...element.value.data, ...data }
    })
  }
}

function batchUpdateOpacity() {
  props.elements.forEach(el => {
    emit('update-element', el.id, { opacity: batchOpacity.value })
  })
}

function batchUpdateRotation() {
  props.elements.forEach(el => {
    emit('update-element', el.id, { rotation: batchRotation.value })
  })
}

function batchUpdatePosition() {
  props.elements.forEach(el => {
    emit('update-element', el.id, {
      x: el.x + batchOffsetX.value,
      y: el.y + batchOffsetY.value
    })
  })
  batchOffsetX.value = 0
  batchOffsetY.value = 0
}

function batchUpdateSize() {
  props.elements.forEach(el => {
    const updates: Partial<MapElement> = {}
    if (el.width !== undefined) {
      updates.width = Math.round(el.width * batchSizeScale.value)
    }
    if (el.height !== undefined) {
      updates.height = Math.round(el.height * batchSizeScale.value)
    }
    if (el.type === 'marker') {
      const data = el.data as MarkerData
      updates.data = { ...data, size: Math.round(data.size * batchSizeScale.value) }
    }
    emit('update-element', el.id, updates)
  })
  batchSizeScale.value = 1
}

function alignElements(direction: string) {
  if (props.elements.length < 2) return

  const positions = props.elements.map(el => ({
    id: el.id,
    x: el.x,
    y: el.y,
    w: el.width || (el.type === 'marker' ? (el.data as MarkerData).size : 50),
    h: el.height || (el.type === 'marker' ? (el.data as MarkerData).size : 50)
  }))

  switch (direction) {
    case 'left': {
      const minX = Math.min(...positions.map(p => p.x - p.w / 2))
      positions.forEach(p => {
        emit('update-element', p.id, { x: minX + p.w / 2 })
      })
      break
    }
    case 'right': {
      const maxX = Math.max(...positions.map(p => p.x + p.w / 2))
      positions.forEach(p => {
        emit('update-element', p.id, { x: maxX - p.w / 2 })
      })
      break
    }
    case 'center': {
      const avgX = positions.reduce((s, p) => s + p.x, 0) / positions.length
      positions.forEach(p => {
        emit('update-element', p.id, { x: avgX })
      })
      break
    }
    case 'top': {
      const minY = Math.min(...positions.map(p => p.y - p.h / 2))
      positions.forEach(p => {
        emit('update-element', p.id, { y: minY + p.h / 2 })
      })
      break
    }
    case 'bottom': {
      const maxY = Math.max(...positions.map(p => p.y + p.h / 2))
      positions.forEach(p => {
        emit('update-element', p.id, { y: maxY - p.h / 2 })
      })
      break
    }
    case 'middle': {
      const avgY = positions.reduce((s, p) => s + p.y, 0) / positions.length
      positions.forEach(p => {
        emit('update-element', p.id, { y: avgY })
      })
      break
    }
  }
}

function deleteSelected() {
  // 由父组件处理
}
</script>

<style scoped>
.property-panel {
  height: 100%;
  overflow-y: auto;
}

.empty-state {
  padding: 20px;
}

.property-content {
  padding: 10px;
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

.property-item:last-child {
  margin-bottom: 0;
}

.property-item label {
  width: 70px;
  font-size: 12px;
  color: #a0a0a0;
  flex-shrink: 0;
}

.property-item span {
  font-size: 12px;
  color: #e0e0e0;
}

.property-item :deep(.el-input-number) {
  flex: 1;
}

.property-item :deep(.el-slider) {
  flex: 1;
  margin-left: 10px;
}

.hint {
  font-size: 12px;
  color: #808080;
  margin-bottom: 10px;
}

.multi-elements .el-button {
  width: 100%;
}

.batch-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 10px;
}

.batch-actions .el-button {
  width: auto;
  flex: 1;
  min-width: calc(50% - 5px);
  font-size: 11px;
}
</style>
