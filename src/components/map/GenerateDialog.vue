<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    title="随机生成地图"
    width="560px"
    class="generate-dialog"
  >
    <!-- 地形预设 -->
    <div class="preset-grid">
      <button
        v-for="p in TERRAIN_PRESETS"
        :key="p.id"
        class="preset-card"
        :class="{ active: form.presetId === p.id }"
        @click="selectPreset(p)"
      >
        <span class="p-icon">{{ p.icon }}</span>
        <span class="p-name">{{ p.name }}</span>
        <span class="p-desc">{{ p.description }}</span>
      </button>
    </div>

    <el-form :model="form" label-width="76px" class="gen-form">
      <el-form-item label="地图尺寸">
        <el-select v-model="selectedSizeIndex" style="width: 100%">
          <el-option
            v-for="(size, index) in TILE_SIZES"
            :key="index"
            :label="size.label"
            :value="index"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="种子">
        <div class="seed-row">
          <el-input v-model="form.seed" placeholder="留空则随机" clearable />
          <el-button @click="rollSeed">🎲 换一个</el-button>
        </div>
      </el-form-item>

      <el-form-item v-if="!isDungeon" label="海平面">
        <div class="slider-row">
          <el-slider v-model="seaLevelPercent" :min="10" :max="70" :show-tooltip="false" />
          <span class="slider-value">{{ (seaLevelPercent / 100).toFixed(2) }}</span>
        </div>
      </el-form-item>

      <el-form-item v-if="isDungeon" label="房间数">
        <div class="slider-row">
          <el-slider v-model="form.roomCount" :min="3" :max="24" :show-tooltip="false" />
          <span class="slider-value">{{ form.roomCount }}</span>
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="rollSeed">🎲 换个种子</el-button>
      <el-button type="primary" @click="handleGenerate">生成</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { reactive, computed, watch } from 'vue'
import { TILE_SIZES } from '@/types/map'
import { TERRAIN_PRESETS, getPreset, type TerrainPreset } from '@/utils/mapGenerator'

export interface GenerateParams {
  seed: string
  presetId: string
  seaLevel: number
  roomCount: number
  /** 由预设推导出的瓦片集 */
  tileSetId: string
  tileWidth: number
  tileHeight: number
}

defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'generate', params: GenerateParams): void
}>()

const form = reactive({
  presetId: 'continent',
  seed: '',
  seaLevel: TERRAIN_PRESETS[0].seaLevel,
  roomCount: 10,
  tileWidth: TILE_SIZES[1].value,
  tileHeight: TILE_SIZES[1].value
})

/* 海平面以百分比存储，切换预设时重置为该预设的推荐值 */
const seaLevelPercent = computed({
  get: () => Math.round(form.seaLevel * 100),
  set(v: number) {
    form.seaLevel = v / 100
  }
})

const isDungeon = computed(() => form.presetId === 'dungeon')

function selectPreset(p: TerrainPreset) {
  form.presetId = p.id
  form.seaLevel = p.seaLevel
}

watch(
  () => form.presetId,
  (id) => {
    form.seaLevel = getPreset(id).seaLevel
  }
)

const selectedSizeIndex = computed({
  get() {
    const index = TILE_SIZES.findIndex(s => s.value === form.tileWidth)
    return index >= 0 ? index : 1
  },
  set(index: number) {
    const size = TILE_SIZES[index]
    if (size) {
      form.tileWidth = size.value
      form.tileHeight = size.value
    }
  }
})

function rollSeed() {
  form.seed = Math.random().toString(36).slice(2, 10)
}

function handleGenerate() {
  const preset = getPreset(form.presetId)
  const params: GenerateParams = {
    seed: form.seed,
    presetId: form.presetId,
    seaLevel: form.seaLevel || preset.seaLevel,
    roomCount: form.roomCount,
    tileSetId: isDungeon.value ? 'trpg' : preset.style,
    tileWidth: form.tileWidth,
    tileHeight: form.tileHeight
  }
  emit('generate', params)
  emit('update:modelValue', false)
}
</script>

<style scoped>
.generate-dialog :deep(.el-dialog) {
  border-radius: 10px;
  border: 1px solid #e2e6ec;
}

.generate-dialog :deep(.el-dialog__title) {
  color: #1f2430;
  font-weight: 600;
}

/* 预设卡片 */
.preset-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 8px;
  margin-bottom: 16px;
}

.preset-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 10px 6px 8px;
  background: #f7f8fa;
  border: 1px solid #e2e6ec;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.12s;
  font-family: inherit;
}

.preset-card:hover {
  background: #fff;
  border-color: #cdd3dc;
  transform: translateY(-1px);
}

.preset-card.active {
  background: #e8f0fe;
  border-color: #3b82f6;
}

.preset-card.active .p-name {
  color: #2563eb;
}

.p-icon {
  font-size: 20px;
  line-height: 1;
}

.p-name {
  font-size: 12px;
  font-weight: 600;
  color: #1f2430;
}

.p-desc {
  font-size: 10px;
  color: #8a93a3;
  text-align: center;
  line-height: 1.3;
}

.gen-form :deep(.el-form-item__label) {
  color: #5b6472;
}

.seed-row {
  display: flex;
  gap: 8px;
  width: 100%;
}

.seed-row .el-input {
  flex: 1;
}

.slider-row {
  display: flex;
  align-items: center;
  width: 100%;
  gap: 12px;
}

.slider-row :deep(.el-slider) {
  flex: 1;
}

.slider-value {
  min-width: 40px;
  text-align: right;
  color: #5b6472;
  font-size: 13px;
  font-variant-numeric: tabular-nums;
}

.generate-dialog :deep(.el-slider__runway) {
  background-color: #e2e6ec;
}

.generate-dialog :deep(.el-slider__bar) {
  background-color: #3b82f6;
}

.generate-dialog :deep(.el-slider__button) {
  border-color: #3b82f6;
}
</style>
