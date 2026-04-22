<template>
  <div class="text-properties">
    <div class="property-group">
      <div class="group-title">文字属性</div>
      
      <div class="property-item full-width">
        <label>内容</label>
        <el-input 
          v-model="localData.content" 
          type="textarea" 
          :rows="3" 
          size="small" 
          @change="emitUpdate" 
        />
      </div>
      
      <div class="property-item">
        <label>字体大小</label>
        <el-input-number v-model="localData.fontSize" size="small" :min="8" :max="72" @change="emitUpdate" />
      </div>
      
      <div class="property-item">
        <label>字体</label>
        <el-select v-model="localData.fontFamily" size="small" @change="emitUpdate">
          <el-option label="Arial" value="Arial" />
          <el-option label="微软雅黑" value="Microsoft YaHei" />
          <el-option label="宋体" value="SimSun" />
          <el-option label="黑体" value="SimHei" />
          <el-option label="楷体" value="KaiTi" />
        </el-select>
      </div>
      
      <div class="property-item">
        <label>颜色</label>
        <el-color-picker v-model="localData.color" size="small" @change="emitUpdate" />
      </div>
      
      <div class="property-item">
        <label>粗体</label>
        <el-switch v-model="localData.bold" @change="emitUpdate" />
      </div>
      
      <div class="property-item">
        <label>斜体</label>
        <el-switch v-model="localData.italic" @change="emitUpdate" />
      </div>
      
      <div class="property-item">
        <label>对齐</label>
        <el-select v-model="localData.align" size="small" @change="emitUpdate">
          <el-option label="左对齐" value="left" />
          <el-option label="居中" value="center" />
          <el-option label="右对齐" value="right" />
        </el-select>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch } from 'vue'
import type { TextData } from '@/types/map'

const props = defineProps<{
  data: TextData
}>()

const emit = defineEmits<{
  (e: 'update', data: Partial<TextData>): void
}>()

const localData = ref<TextData>({ ...props.data })

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

.property-item :deep(.el-input-number),
.property-item :deep(.el-select) {
  flex: 1;
}

.property-item.full-width :deep(.el-textarea) {
  width: 100%;
}
</style>
