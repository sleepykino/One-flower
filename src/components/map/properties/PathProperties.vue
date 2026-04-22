<template>
  <div class="path-properties">
    <div class="property-group">
      <div class="group-title">路径属性</div>
      
      <div class="property-item">
        <label>线条颜色</label>
        <el-color-picker v-model="localData.strokeColor" size="small" @change="emitUpdate" />
      </div>
      
      <div class="property-item">
        <label>线条宽度</label>
        <el-input-number v-model="localData.strokeWidth" size="small" :min="1" :max="20" @change="emitUpdate" />
      </div>
      
      <div class="property-item">
        <label>填充颜色</label>
        <el-color-picker v-model="localData.fillColor" size="small" show-alpha @change="emitUpdate" />
      </div>
      
      <div class="property-item">
        <label>平滑曲线</label>
        <el-switch v-model="localData.smooth" @change="emitUpdate" />
      </div>
      
      <div class="property-item">
        <label>箭头</label>
        <el-select v-model="localData.arrow" size="small" @change="emitUpdate">
          <el-option label="无" value="none" />
          <el-option label="起点" value="start" />
          <el-option label="终点" value="end" />
          <el-option label="双向" value="both" />
        </el-select>
      </div>
      
      <div class="property-item">
        <label>虚线样式</label>
        <el-select v-model="dashStyle" size="small" @change="updateDash">
          <el-option label="实线" value="solid" />
          <el-option label="虚线" value="dashed" />
          <el-option label="点线" value="dotted" />
        </el-select>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, computed } from 'vue'
import type { PathData } from '@/types/map'

const props = defineProps<{
  data: PathData
}>()

const emit = defineEmits<{
  (e: 'update', data: Partial<PathData>): void
}>()

const localData = ref<PathData>({ ...props.data })

const dashStyle = computed({
  get: () => {
    if (localData.value.strokeDash.length === 0) return 'solid'
    if (localData.value.strokeDash[0] === 5) return 'dashed'
    return 'dotted'
  },
  set: () => {}
})

watch(() => props.data, (newData) => {
  localData.value = { ...newData }
}, { deep: true })

function emitUpdate() {
  emit('update', { ...localData.value })
}

function updateDash(style: string) {
  switch (style) {
    case 'solid':
      localData.value.strokeDash = []
      break
    case 'dashed':
      localData.value.strokeDash = [5, 5]
      break
    case 'dotted':
      localData.value.strokeDash = [2, 2]
      break
  }
  emitUpdate()
}
</script>

<style scoped>
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

.property-item label {
  width: 70px;
  font-size: 12px;
  color: #a0a0a0;
  flex-shrink: 0;
}

.property-item :deep(.el-input-number),
.property-item :deep(.el-select) {
  flex: 1;
}
</style>
