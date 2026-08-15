<template>
  <div class="terrain-panel">
    <!-- 地形调色板 -->
    <div class="panel-section">
      <div class="section-title">{{ currentTileSet?.name ?? '地形' }} · 调色板</div>
      <div class="tile-grid">
        <el-tooltip
          v-for="tile in currentTileSet?.tiles ?? []"
          :key="tile.id"
          :content="tile.name"
          placement="top"
        >
          <div
            class="tile-swatch"
            :class="{ active: tile.id === currentTile }"
            :style="{ background: tile.color }"
            @click="emit('select-tile', tile.id)"
          />
        </el-tooltip>
      </div>
    </div>

    <!-- 当前选中瓦片 -->
    <div class="current-tile">
      <div class="ct-swatch" :style="{ background: currentTileData?.color ?? '#ccc' }" />
      <span class="ct-name">{{ currentTileData?.name ?? '未选择' }}</span>
    </div>

    <div class="divider"></div>

    <!-- 图章面板 -->
    <div class="panel-section">
      <div class="section-title">图章</div>
      <div class="stamp-grid">
        <div
          v-for="stamp in currentTileSet?.stamps ?? []"
          :key="stamp"
          class="stamp-item"
          :class="{ active: stamp === currentStamp }"
          @click="emit('select-stamp', stamp)"
        >
          {{ stamp }}
        </div>
      </div>
    </div>

    <div class="divider"></div>

    <!-- 添加文字标注 -->
    <div class="panel-section">
      <div class="section-title">添加文字标注</div>
      <div class="label-input-row">
        <input
          v-model="labelText"
          type="text"
          placeholder="城市名..."
          @keyup.enter="submitLabel"
        />
        <button class="add-btn" @click="submitLabel">＋</button>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed } from 'vue'
import { TILE_SETS } from '@/types/map'

const props = defineProps<{
  tileSetId: string
  currentTile: number
  currentStamp: string
}>()

const emit = defineEmits<{
  (e: 'select-tile', tileId: number): void
  (e: 'select-stamp', emoji: string): void
  (e: 'add-label', text: string): void
  (e: 'update:tileSetId', value: string): void
}>()

const currentTileSet = computed(() =>
  TILE_SETS[props.tileSetId] || TILE_SETS['fantasy']
)

const currentTileData = computed(() =>
  currentTileSet.value?.tiles.find(t => t.id === props.currentTile)
)

const labelText = ref('')

function submitLabel() {
  const text = labelText.value.trim()
  if (!text) return
  emit('add-label', text)
  labelText.value = ''
}
</script>

<style scoped>
.terrain-panel {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.panel-section { display: flex; flex-direction: column; gap: 6px; }

.section-title {
  font-size: 10px;
  text-transform: uppercase;
  letter-spacing: 1px;
  color: #8a93a3;
  font-weight: 600;
}

.divider { height: 1px; background: #e2e6ec; margin: 2px 0; }

/* 调色板 */
.tile-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 5px;
}

.tile-swatch {
  aspect-ratio: 1;
  border-radius: 5px;
  border: 2px solid transparent;
  cursor: pointer;
  position: relative;
  transition: transform 0.1s;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12);
}
.tile-swatch:hover { transform: scale(1.08); }
.tile-swatch.active {
  border-color: #3b82f6;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.12), 0 0 0 1px #3b82f6;
}

/* 当前选中 */
.current-tile {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 9px;
  background: #f7f8fa;
  border-radius: 5px;
  border: 1px solid #e2e6ec;
}
.ct-swatch {
  width: 18px;
  height: 18px;
  border-radius: 4px;
  box-shadow: inset 0 0 0 1px rgba(0, 0, 0, 0.15);
}
.ct-name { font-size: 12px; color: #1f2430; font-weight: 500; }

/* 图章 */
.stamp-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 5px;
}

.stamp-item {
  aspect-ratio: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f7f8fa;
  border: 1px solid #e2e6ec;
  border-radius: 5px;
  cursor: pointer;
  font-size: 17px;
  transition: all 0.12s;
}
.stamp-item:hover { background: #fff; border-color: #cdd3dc; }
.stamp-item.active { background: #e8f0fe; border-color: #3b82f6; }

/* 文字标注 */
.label-input-row { display: flex; gap: 4px; }

.label-input-row input {
  flex: 1;
  font-size: 12px;
  color: #1f2430;
  background: #f7f8fa;
  border: 1px solid #e2e6ec;
  border-radius: 5px;
  padding: 5px 8px;
  outline: none;
  transition: border-color 0.15s;
  font-family: inherit;
  min-width: 0;
}
.label-input-row input:focus { border-color: #3b82f6; background: #fff; }

.add-btn {
  font-size: 13px;
  color: #1f2430;
  background: #f7f8fa;
  border: 1px solid #e2e6ec;
  border-radius: 5px;
  padding: 4px 9px;
  cursor: pointer;
  font-family: inherit;
  transition: all 0.12s;
}
.add-btn:hover { background: #fff; border-color: #cdd3dc; }
</style>
