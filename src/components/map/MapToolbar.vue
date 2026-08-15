<template>
  <div class="topbar">
    <div class="brand">
      <span class="logo">◈</span>
      <span class="title">地图工坊</span>
      <span class="subtitle">Map Editor</span>
    </div>

    <div class="top-group">
      <label class="field">
        <span class="field-label">风格</span>
        <select :value="tileSetId" @change="$emit('update:tile-set-id', ($event.target as HTMLSelectElement).value)">
          <option v-for="ts in tileSetList" :key="ts.id" :value="ts.id">{{ ts.name }}</option>
        </select>
      </label>
      <label class="field">
        <span class="field-label">尺寸</span>
        <select :value="mapSize" @change="$emit('update:map-size', +($event.target as HTMLSelectElement).value)">
          <option v-for="s in TILE_SIZES" :key="s.value" :value="s.value">{{ s.label }}</option>
        </select>
      </label>
    </div>

    <div class="top-group">
      <button class="btn" title="随机生成地图 (G)" @click="$emit('generate')">
        <span class="ic">✨</span> 随机生成
      </button>
      <button class="btn ghost" title="清空画布" @click="$emit('clear')">
        <span class="ic">🗑</span> 清空
      </button>
    </div>

    <div class="top-group">
      <button class="btn ghost" :disabled="!canUndo" title="撤销 (Ctrl+Z)" @click="$emit('undo')">↶</button>
      <button class="btn ghost" :disabled="!canRedo" title="重做 (Ctrl+Y)" @click="$emit('redo')">↷</button>
    </div>

    <div class="top-group right">
      <button class="btn ghost" title="保存 (Ctrl+S)" @click="$emit('save')">💾 保存</button>
      <button class="btn primary" title="导出 PNG / JSON" @click="$emit('export')">⬇ 导出</button>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, computed } from 'vue'
import type { MapTool } from '@/types/map'
import { TILE_SETS, TILE_SIZES } from '@/types/map'

const props = defineProps<{
  tool: MapTool
  tileSetId: string
  mapSize: number
  canUndo: boolean
  canRedo: boolean
}>()

const emit = defineEmits<{
  (e: 'update:tile-set-id', id: string): void
  (e: 'update:map-size', size: number): void
  (e: 'update:tool', tool: MapTool): void
  (e: 'undo'): void
  (e: 'redo'): void
  (e: 'save'): void
  (e: 'export'): void
  (e: 'generate'): void
  (e: 'clear'): void
}>()

const tileSetList = computed(() => Object.values(TILE_SETS))

function handleKeydown(e: KeyboardEvent) {
  if (e.target instanceof HTMLElement && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return
  if (e.ctrlKey || e.metaKey) {
    switch (e.key.toLowerCase()) {
      case 'z': e.preventDefault(); emit(e.shiftKey ? 'redo' : 'undo'); break
      case 'y': e.preventDefault(); emit('redo'); break
      case 's': e.preventDefault(); emit('save'); break
    }
  } else {
    switch (e.key.toLowerCase()) {
      case 'h': emit('update:tool', 'pan'); break
      case 'b': emit('update:tool', 'tile-brush'); break
      case 'e': emit('update:tool', 'tile-eraser'); break
      case 'f': emit('update:tool', 'tile-fill'); break
      case 'l': emit('update:tool', 'tile-line'); break
      case 'r': emit('update:tool', 'tile-rect'); break
      case 'i': emit('update:tool', 'tile-picker'); break
      case 's': emit('update:tool', 'tile-stamp'); break
      case 'g': emit('generate'); break
    }
  }
}

onMounted(() => window.addEventListener('keydown', handleKeydown))
onUnmounted(() => window.removeEventListener('keydown', handleKeydown))
</script>

<style scoped>
.topbar {
  height: 50px;
  background: #fff;
  border-bottom: 1px solid #e2e6ec;
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 0 14px;
  flex-shrink: 0;
}

.brand {
  display: flex;
  align-items: center;
  gap: 6px;
  padding-right: 12px;
  border-right: 1px solid #e2e6ec;
  height: 100%;
}
.brand .logo { color: #3b82f6; font-size: 20px; line-height: 1; }
.brand .title { font-weight: 700; font-size: 15px; letter-spacing: 0.5px; color: #1f2430; }
.brand .subtitle { font-size: 11px; color: #8a93a3; text-transform: uppercase; letter-spacing: 1px; }

.top-group { display: flex; align-items: center; gap: 8px; }
.top-group.right { margin-left: auto; }

.field { display: flex; align-items: center; gap: 6px; }
.field-label { font-size: 11px; color: #5b6472; white-space: nowrap; }

select {
  font-size: 12px;
  color: #1f2430;
  background: #f7f8fa;
  border: 1px solid #e2e6ec;
  border-radius: 5px;
  padding: 4px 8px;
  outline: none;
  transition: border-color 0.15s;
  font-family: inherit;
}
select:focus { border-color: #3b82f6; background: #fff; }

.btn {
  font-size: 12px;
  color: #1f2430;
  background: #f7f8fa;
  border: 1px solid #e2e6ec;
  border-radius: 5px;
  padding: 5px 11px;
  cursor: pointer;
  display: inline-flex;
  align-items: center;
  gap: 5px;
  transition: all 0.12s;
  white-space: nowrap;
  font-family: inherit;
}
.btn:hover { background: #fff; border-color: #cdd3dc; }
.btn:active { transform: translateY(1px); }
.btn:disabled { opacity: 0.45; cursor: default; }
.btn.primary { background: #3b82f6; border-color: #3b82f6; color: #fff; }
.btn.primary:hover { background: #2563eb; border-color: #2563eb; }
.btn.ghost { background: transparent; }
.btn.ghost:hover { background: #f7f8fa; }
.btn .ic { font-size: 13px; }
</style>
