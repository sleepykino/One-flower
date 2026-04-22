<template>
  <div class="marker-properties">
    <div class="property-group">
      <div class="group-title">标记属性</div>
      
      <div class="property-item">
        <label>名称</label>
        <el-input v-model="localData.name" size="small" @change="emitUpdate" />
      </div>
      
      <div class="property-item">
        <label>图标</label>
        <el-input v-model="localData.icon" size="small" @change="emitUpdate" />
      </div>
      
      <div class="property-item">
        <label>颜色</label>
        <el-color-picker v-model="localData.color" size="small" @change="emitUpdate" />
      </div>
      
      <div class="property-item">
        <label>大小</label>
        <el-input-number v-model="localData.size" size="small" :min="16" :max="128" @change="emitUpdate" />
      </div>
      
      <div class="property-item">
        <label>标签</label>
        <el-input v-model="localData.label" size="small" @change="emitUpdate" />
      </div>
      
      <div class="property-item">
        <label>显示标签</label>
        <el-switch v-model="localData.labelVisible" @change="emitUpdate" />
      </div>
      
      <div class="property-item full-width">
        <label>描述</label>
        <el-input 
          v-model="localData.description" 
          type="textarea" 
          :rows="3" 
          size="small" 
          @change="emitUpdate" 
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { MarkerData } from '@/types/map'

const props = defineProps<{
  data: MarkerData
}>()

const emit = defineEmits<{
  (e: 'update', data: Partial<MarkerData>): void
}>()

const localData = ref<MarkerData>({ ...props.data })

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
.property-item :deep(.el-input-number) {
  flex: 1;
}

.property-item.full-width :deep(.el-textarea) {
  width: 100%;
}
</style>
