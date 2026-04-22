<template>
  <div class="shape-properties">
    <div class="property-group">
      <div class="group-title">形状属性</div>
      
      <div class="property-item">
        <label>形状类型</label>
        <el-select v-model="localData.shapeType" size="small" @change="emitUpdate">
          <el-option label="矩形" value="rectangle" />
          <el-option label="圆形" value="circle" />
          <el-option label="椭圆" value="ellipse" />
          <el-option label="多边形" value="polygon" />
        </el-select>
      </div>
      
      <div class="property-item">
        <label>填充颜色</label>
        <el-color-picker v-model="localData.fillColor" size="small" show-alpha @change="emitUpdate" />
      </div>
      
      <div class="property-item">
        <label>边框颜色</label>
        <el-color-picker v-model="localData.strokeColor" size="small" @change="emitUpdate" />
      </div>
      
      <div class="property-item">
        <label>边框宽度</label>
        <el-input-number v-model="localData.strokeWidth" size="small" :min="0" :max="20" @change="emitUpdate" />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { ShapeData } from '@/types/map'

const props = defineProps<{
  data: ShapeData
}>()

const emit = defineEmits<{
  (e: 'update', data: Partial<ShapeData>): void
}>()

const localData = ref<ShapeData>({ ...props.data })

watch(() => props.data, (newData) => {
  localData.value = { ...newData }
}, { deep: true })

function emitUpdate() {
  emit('update', { ...localData.value })
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
