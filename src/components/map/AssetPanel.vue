<template>
  <div class="asset-panel">
    <div class="panel-header">
      <span>素材库</span>
    </div>

    <el-input
      v-model="searchText"
      placeholder="搜索素材..."
      prefix-icon="Search"
      clearable
      size="small"
      class="search-input"
    />

    <el-collapse v-model="activeCategories" class="asset-collapse">
      <el-collapse-item
        v-for="(assets, category) in filteredAssets"
        :key="category"
        :name="category"
      >
        <template #title>
          <span class="category-title">{{ getCategoryName(category) }}</span>
          <el-badge :value="assets.length" class="category-badge" />
        </template>

        <div class="asset-grid">
          <div
            v-for="asset in assets"
            :key="asset.id"
            class="asset-item"
            :title="asset.name"
            @click="$emit('select-asset', asset)"
          >
            <span class="asset-icon">{{ asset.icon }}</span>
            <span class="asset-name">{{ asset.name }}</span>
          </div>
        </div>
      </el-collapse-item>
    </el-collapse>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { MAP_ICONS, type MapAsset } from '@/types/map'

const emit = defineEmits<{
  (e: 'select-asset', asset: MapAsset): void
}>()

const searchText = ref('')
const activeCategories = ref(['location', 'terrain', 'special'])

const filteredAssets = computed(() => {
  const result: Record<string, MapAsset[]> = {}
  
  for (const [category, assets] of Object.entries(MAP_ICONS)) {
    const filtered = assets.filter(asset => 
      asset.name.toLowerCase().includes(searchText.value.toLowerCase()) ||
      asset.icon.includes(searchText.value)
    )
    
    if (filtered.length > 0) {
      result[category] = filtered
    }
  }
  
  return result
})

function getCategoryName(category: string): string {
  const names: Record<string, string> = {
    location: '地点',
    terrain: '地形',
    special: '特殊'
  }
  return names[category] || category
}
</script>

<style scoped>
.asset-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.panel-header {
  font-weight: 500;
  color: #e0e0e0;
  margin-bottom: 10px;
}

.search-input {
  margin-bottom: 10px;
}

.asset-collapse {
  flex: 1;
  overflow-y: auto;
  border: none;
}

.asset-collapse :deep(.el-collapse-item__header) {
  background: #0f3460;
  border: none;
  color: #e0e0e0;
  padding: 0 10px;
  height: 36px;
}

.asset-collapse :deep(.el-collapse-item__wrap) {
  background: transparent;
  border: none;
}

.asset-collapse :deep(.el-collapse-item__content) {
  padding: 10px 0;
}

.category-title {
  font-size: 13px;
}

.category-badge {
  margin-left: 10px;
}

.asset-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 8px;
}

.asset-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  padding: 8px;
  background: #0f3460;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.2s;
}

.asset-item:hover {
  background: #1a3a5c;
  transform: scale(1.05);
}

.asset-icon {
  font-size: 24px;
  margin-bottom: 4px;
}

.asset-name {
  font-size: 10px;
  color: #a0a0a0;
  text-align: center;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
  width: 100%;
}
</style>
