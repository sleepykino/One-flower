<template>
  <div class="layer-panel">
    <div class="panel-header">
      <span>图层</span>
      <el-button type="primary" size="small" @click="$emit('add-layer')">
        <el-icon><Plus /></el-icon>
      </el-button>
    </div>

    <div class="layer-list">
      <div
        v-for="(layer, index) in [...layers].reverse()"
        :key="layer.id"
        class="layer-item"
        :class="{ active: layer.id === selectedLayerId, locked: layer.locked }"
        @click="$emit('select-layer', layer.id)"
      >
        <div class="layer-visibility">
          <el-icon 
            :class="{ visible: layer.visible }" 
            @click.stop="$emit('update-layer', layer.id, { visible: !layer.visible })"
          >
            <View v-if="layer.visible" />
            <Hide v-else />
          </el-icon>
        </div>
        
        <div class="layer-name">
          {{ layer.name }}
          <span class="element-count">({{ layer.elements.length }})</span>
        </div>
        
        <div class="layer-actions">
          <el-icon 
            :class="{ locked: layer.locked }"
            @click.stop="$emit('update-layer', layer.id, { locked: !layer.locked })"
          >
            <Lock v-if="layer.locked" />
            <Unlock v-else />
          </el-icon>
        </div>

        <el-dropdown trigger="click" @command="handleCommand($event, layer.id)">
          <el-icon class="layer-more"><MoreFilled /></el-icon>
          <template #dropdown>
            <el-dropdown-menu>
              <el-dropdown-item command="rename">
                <el-icon><Edit /></el-icon>
                重命名
              </el-dropdown-item>
              <el-dropdown-item command="moveUp" :disabled="index === 0">
                <el-icon><Top /></el-icon>
                上移
              </el-dropdown-item>
              <el-dropdown-item command="moveDown" :disabled="index === layers.length - 1">
                <el-icon><Bottom /></el-icon>
                下移
              </el-dropdown-item>
              <el-dropdown-item command="duplicate">
                <el-icon><CopyDocument /></el-icon>
                复制
              </el-dropdown-item>
              <el-dropdown-item command="delete" divided :disabled="layers.length <= 1">
                <el-icon><Delete /></el-icon>
                删除
              </el-dropdown-item>
            </el-dropdown-menu>
          </template>
        </el-dropdown>
      </div>
    </div>

    <el-dialog v-model="showRenameDialog" title="重命名图层" width="300px">
      <el-input v-model="newLayerName" placeholder="请输入图层名称" />
      <template #footer>
        <el-button @click="showRenameDialog = false">取消</el-button>
        <el-button type="primary" @click="confirmRename">确定</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref } from 'vue'
import { Plus, View, Hide, Lock, Unlock, MoreFilled, Edit, Top, Bottom, CopyDocument, Delete } from '@element-plus/icons-vue'
import type { MapLayer } from '@/types/map'

defineProps<{
  layers: MapLayer[]
  selectedLayerId: string | null
}>()

const emit = defineEmits<{
  (e: 'select-layer', id: string): void
  (e: 'add-layer'): void
  (e: 'delete-layer', id: string): void
  (e: 'update-layer', id: string, updates: Partial<MapLayer>): void
  (e: 'move-layer', id: string, direction: 'up' | 'down'): void
}>()

const showRenameDialog = ref(false)
const newLayerName = ref('')
const renameLayerId = ref<string | null>(null)

function handleCommand(command: string, layerId: string) {
  switch (command) {
    case 'rename':
      renameLayerId.value = layerId
      newLayerName.value = ''
      showRenameDialog.value = true
      break
    case 'moveUp':
      emit('move-layer', layerId, 'up')
      break
    case 'moveDown':
      emit('move-layer', layerId, 'down')
      break
    case 'delete':
      emit('delete-layer', layerId)
      break
  }
}

function confirmRename() {
  if (renameLayerId.value && newLayerName.value.trim()) {
    emit('update-layer', renameLayerId.value, { name: newLayerName.value.trim() })
    showRenameDialog.value = false
  }
}
</script>

<style scoped>
.layer-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.panel-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 10px;
  font-weight: 500;
  color: #e0e0e0;
}

.layer-list {
  flex: 1;
  overflow-y: auto;
}

.layer-item {
  display: flex;
  align-items: center;
  padding: 8px 10px;
  margin-bottom: 5px;
  background: #0f3460;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
  gap: 8px;
}

.layer-item:hover {
  background: #1a3a5c;
}

.layer-item.active {
  background: #e94560;
}

.layer-item.locked {
  opacity: 0.6;
}

.layer-visibility,
.layer-actions,
.layer-more {
  cursor: pointer;
  color: #808080;
  transition: color 0.2s;
}

.layer-visibility:hover,
.layer-actions:hover,
.layer-more:hover {
  color: #e0e0e0;
}

.layer-visibility .visible {
  color: #00b894;
}

.layer-actions .locked {
  color: #e94560;
}

.layer-name {
  flex: 1;
  font-size: 13px;
  color: #e0e0e0;
}

.element-count {
  color: #808080;
  font-size: 11px;
  margin-left: 5px;
}

:deep(.el-dropdown-menu__item) {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
