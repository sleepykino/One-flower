<template>
  <div class="map-toolbar">
    <div class="tool-group">
      <el-tooltip content="选择 (V)" placement="bottom">
        <el-button :type="tool === 'select' ? 'primary' : 'default'" @click="$emit('update:tool', 'select')">
          <el-icon><Pointer /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="平移 (H)" placement="bottom">
        <el-button :type="tool === 'pan' ? 'primary' : 'default'" @click="$emit('update:tool', 'pan')">
          <el-icon><Rank /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="标记 (M)" placement="bottom">
        <el-button :type="tool === 'marker' ? 'primary' : 'default'" @click="$emit('update:tool', 'marker')">
          <el-icon><Location /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="路径 (P)" placement="bottom">
        <el-button :type="tool === 'path' ? 'primary' : 'default'" @click="$emit('update:tool', 'path')">
          <el-icon><Connection /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="形状 (S)" placement="bottom">
        <el-button :type="tool === 'shape' ? 'primary' : 'default'" @click="$emit('update:tool', 'shape')">
          <el-icon><Grid /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="文字 (T)" placement="bottom">
        <el-button :type="tool === 'text' ? 'primary' : 'default'" @click="$emit('update:tool', 'text')">
          <el-icon><EditPen /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="橡皮擦 (E)" placement="bottom">
        <el-button :type="tool === 'eraser' ? 'primary' : 'default'" @click="$emit('update:tool', 'eraser')">
          <el-icon><Delete /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="笔刷 (B)" placement="bottom">
        <el-button :type="tool === 'brush' ? 'primary' : 'default'" @click="$emit('update:tool', 'brush')">
          <el-icon><Brush /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="填充 (F)" placement="bottom">
        <el-button :type="tool === 'fill' ? 'primary' : 'default'" @click="$emit('update:tool', 'fill')">
          <el-icon><Pouring /></el-icon>
        </el-button>
      </el-tooltip>
    </div>

    <el-divider direction="vertical" />

    <div class="tool-group">
      <el-tooltip content="撤销 (Ctrl+Z)" placement="bottom">
        <el-button :disabled="!canUndo" @click="$emit('undo')">
          <el-icon><RefreshLeft /></el-icon>
        </el-button>
      </el-tooltip>
      <el-tooltip content="重做 (Ctrl+Y)" placement="bottom">
        <el-button :disabled="!canRedo" @click="$emit('redo')">
          <el-icon><RefreshRight /></el-icon>
        </el-button>
      </el-tooltip>
    </div>

    <el-divider direction="vertical" />

    <div class="tool-group">
      <el-tooltip content="AI 生成" placement="bottom">
        <el-button type="success" @click="$emit('generate')">
          <el-icon><MagicStick /></el-icon>
          AI 生成
        </el-button>
      </el-tooltip>
    </div>

    <div class="toolbar-spacer"></div>

    <div class="tool-group">
      <el-tooltip content="保存 (Ctrl+S)" placement="bottom">
        <el-button @click="$emit('save')">
          <el-icon><DocumentChecked /></el-icon>
          保存
        </el-button>
      </el-tooltip>
      <el-tooltip content="导出" placement="bottom">
        <el-button @click="$emit('export')">
          <el-icon><Download /></el-icon>
          导出
        </el-button>
      </el-tooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted } from 'vue'
import { 
  Pointer, Rank, Location, Connection, Grid, EditPen, Delete,
  RefreshLeft, RefreshRight, MagicStick, DocumentChecked, Download,
  Brush, Pouring
} from '@element-plus/icons-vue'
import type { MapTool } from '@/types/map'

defineProps<{
  tool: MapTool
  canUndo: boolean
  canRedo: boolean
}>()

const emit = defineEmits<{
  (e: 'update:tool', tool: MapTool): void
  (e: 'undo'): void
  (e: 'redo'): void
  (e: 'generate'): void
  (e: 'save'): void
  (e: 'export'): void
}>()

function handleKeydown(e: KeyboardEvent) {
  if (e.ctrlKey || e.metaKey) {
    switch (e.key.toLowerCase()) {
      case 'z':
        e.preventDefault()
        if (e.shiftKey) {
          emit('redo')
        } else {
          emit('undo')
        }
        break
      case 'y':
        e.preventDefault()
        emit('redo')
        break
      case 's':
        e.preventDefault()
        emit('save')
        break
    }
  } else {
    switch (e.key.toLowerCase()) {
      case 'v':
        emit('update:tool', 'select')
        break
      case 'h':
        emit('update:tool', 'pan')
        break
      case 'm':
        emit('update:tool', 'marker')
        break
      case 'p':
        emit('update:tool', 'path')
        break
      case 's':
        emit('update:tool', 'shape')
        break
      case 't':
        emit('update:tool', 'text')
        break
      case 'e':
        emit('update:tool', 'eraser')
        break
      case 'b':
        emit('update:tool', 'brush')
        break
      case 'f':
        emit('update:tool', 'fill')
        break
    }
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeydown)
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeydown)
})
</script>

<style scoped>
.map-toolbar {
  display: flex;
  align-items: center;
  padding: 10px 15px;
  background: #16213e;
  border-bottom: 1px solid #0f3460;
  gap: 10px;
}

.tool-group {
  display: flex;
  gap: 5px;
}

.toolbar-spacer {
  flex: 1;
}

.el-divider {
  margin: 0 10px;
  border-color: #0f3460;
}

:deep(.el-button) {
  background: #0f3460;
  border-color: #0f3460;
  color: #e0e0e0;
}

:deep(.el-button:hover) {
  background: #1a3a5c;
  border-color: #1a3a5c;
  color: #ffffff;
}

:deep(.el-button.is-disabled) {
  background: #0a0a15;
  border-color: #0a0a15;
  color: #606060;
}

:deep(.el-button--primary) {
  background: #e94560;
  border-color: #e94560;
  color: #ffffff;
}

:deep(.el-button--primary:hover) {
  background: #ff5a77;
  border-color: #ff5a77;
}

:deep(.el-button--success) {
  background: #00b894;
  border-color: #00b894;
  color: #ffffff;
}

:deep(.el-button--success:hover) {
  background: #00d9a5;
  border-color: #00d9a5;
}
</style>
