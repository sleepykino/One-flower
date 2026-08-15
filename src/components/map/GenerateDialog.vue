<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    title="生成地图"
    width="480px"
    class="generate-dialog"
  >
    <el-form :model="form" label-width="90px">
      <el-form-item label="瓦片集">
        <el-select v-model="form.tileSetId" style="width: 100%">
          <el-option
            v-for="tileSet in Object.values(TILE_SETS)"
            :key="tileSet.id"
            :label="tileSet.name"
            :value="tileSet.id"
          />
        </el-select>
      </el-form-item>

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
        <el-input v-model="form.seed" placeholder="随机留空" />
      </el-form-item>

      <el-form-item label="海平面">
        <div class="slider-row">
          <el-slider v-model="form.seaLevel" :min="0" :max="100" :show-tooltip="false" />
          <span class="slider-value">{{ (form.seaLevel / 100).toFixed(2) }}</span>
        </div>
      </el-form-item>

      <el-form-item label="粗糙度">
        <div class="slider-row">
          <el-slider v-model="form.roughness" :min="0" :max="100" :show-tooltip="false" />
          <span class="slider-value">{{ (form.roughness / 100).toFixed(2) }}</span>
        </div>
      </el-form-item>

      <el-form-item label="细节层数" v-if="!isTrpg">
        <div class="slider-row">
          <el-slider v-model="form.octaves" :min="1" :max="8" :show-tooltip="false" />
          <span class="slider-value">{{ form.octaves }}</span>
        </div>
      </el-form-item>

      <el-form-item label="地牢房数" v-if="isTrpg">
        <div class="slider-row">
          <el-slider v-model="form.roomCount" :min="3" :max="20" :show-tooltip="false" />
          <span class="slider-value">{{ form.roomCount }}</span>
        </div>
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" @click="handleGenerate">生成</el-button>
      <el-button @click="changeSeed">换个种子</el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { reactive, computed } from 'vue'
import { TILE_SETS, TILE_SIZES } from '@/types/map'

interface GenerateParams {
  seed: string
  seaLevel: number  // 0-1
  roughness: number  // 0-1
  octaves: number  // 1-8
  roomCount: number  // 3-20
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
  seed: '',
  seaLevel: 50,
  roughness: 50,
  octaves: 4,
  roomCount: 8,
  tileSetId: Object.values(TILE_SETS)[0].id,
  tileWidth: TILE_SIZES[0].value,
  tileHeight: TILE_SIZES[0].value
})

const isTrpg = computed(() => form.tileSetId === 'trpg')

const selectedSizeIndex = computed({
  get() {
    const index = TILE_SIZES.findIndex(s => s.value === form.tileWidth)
    return index >= 0 ? index : 0
  },
  set(index: number) {
    const size = TILE_SIZES[index]
    if (size) {
      form.tileWidth = size.value
      form.tileHeight = size.value
    }
  }
})

function handleGenerate() {
  const params: GenerateParams = {
    seed: form.seed,
    seaLevel: form.seaLevel / 100,
    roughness: form.roughness / 100,
    octaves: form.octaves,
    roomCount: form.roomCount,
    tileSetId: form.tileSetId,
    tileWidth: form.tileWidth,
    tileHeight: form.tileHeight
  }
  emit('generate', params)
  emit('update:modelValue', false)
}

function changeSeed() {
  form.seed = ''
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

.generate-dialog :deep(.el-form-item__label) {
  color: #5b6472;
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
</style>
