<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    title="AI 生成地图"
    width="560px"
    class="ai-dialog"
    :close-on-click-modal="!generating"
    :close-on-press-escape="!generating"
  >
    <el-form :model="form" label-width="76px" :disabled="generating">
      <el-form-item label="瓦片集">
        <el-select v-model="form.tileSetId" style="width: 100%">
          <el-option
            v-for="ts in tileSetList"
            :key="ts.id"
            :label="ts.name"
            :value="ts.id"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="地图尺寸">
        <el-radio-group v-model="form.size">
          <el-radio-button v-for="s in AI_SIZES" :key="s" :value="s">{{ s }} × {{ s }}</el-radio-button>
        </el-radio-group>
      </el-form-item>

      <el-form-item label="模型">
        <el-select v-model="form.modelKey" style="width: 100%" placeholder="选择 AI 模型">
          <el-option
            v-for="m in modelOptions"
            :key="m.key"
            :label="m.label"
            :value="m.key"
          />
        </el-select>
      </el-form-item>

      <el-form-item label="地图描述">
        <el-input
          v-model="form.requirements"
          type="textarea"
          :rows="4"
          placeholder="描述你想要的地图，例如：&#10;- 一座中央火山岛，四周环绕沙滩&#10;- 北部森林，南部草原&#10;- 两个港口城镇与一座内陆要塞"
        />
      </el-form-item>

      <div class="legend-preview">
        <span class="legend-title">图例：</span>
        <span v-for="(name, ch) in legendEntries" :key="ch" class="legend-item">
          <code>{{ ch }}</code>{{ name }}
        </span>
      </div>
    </el-form>

    <div v-if="error" class="error-section">
      <el-alert :title="error" type="error" show-icon closable @close="error = ''" />
    </div>

    <div v-if="generating" class="loading-section">
      <el-icon class="is-loading"><Loading /></el-icon>
      <span>{{ progressText }}</span>
    </div>

    <template #footer>
      <el-button :disabled="generating" @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" :loading="generating" @click="generateMap">
        {{ generating ? '生成中...' : '✨ AI 生成' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Loading } from '@element-plus/icons-vue'
import { useAIProviderStore } from '@/stores/aiProvider'
import { TILE_SETS } from '@/types/map'
import type { TileStamp, TileLabel } from '@/types/map'

export interface AIGenerateResult {
  tileSetId: string
  tileWidth: number
  tileHeight: number
  tiles: number[]
  stamps: TileStamp[]
  labels: TileLabel[]
}

defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'generate', result: AIGenerateResult): void
}>()

const aiProviderStore = useAIProviderStore()

const AI_SIZES = [32, 48, 64]

/* 每个瓦片集的字符图例：字符 -> 瓦片 id（顺序与 TILE_SETS.tiles 对应） */
const TILE_CHARS: Record<string, Record<string, number>> = {
  fantasy: { '~': 0, o: 1, s: 2, '.': 3, g: 4, f: 5, h: 6, m: 7, '^': 8, d: 9, w: 10 },
  terrain: { '~': 0, o: 1, s: 2, '.': 3, g: 4, f: 5, p: 6, t: 7, r: 8, '^': 9, d: 10, v: 11 },
  island: { '~': 0, o: 1, s: 2, r: 3, '.': 4, g: 5, f: 6, h: 7, v: 8, '^': 9 },
  trpg: { '.': 0, '#': 1, D: 2, w: 3, g: 4, L: 5, x: 6, r: 7 }
}

const form = reactive({
  tileSetId: 'fantasy',
  size: 48,
  requirements: '',
  modelKey: ''
})

const generating = ref(false)
const error = ref('')
const progressText = ref('')

const tileSetList = computed(() => Object.values(TILE_SETS))

/* 可用模型列表：所有已启用提供商的模型 */
const modelOptions = computed(() => {
  const list: { key: string; label: string; providerIndex: number; modelId: string }[] = []
  aiProviderStore.enabledProviders.forEach((p, pi) => {
    p.models.forEach(m => {
      if (m.id) {
        list.push({
          key: `${pi}:${m.id}`,
          label: `${p.name} / ${m.id}`,
          providerIndex: pi,
          modelId: m.id
        })
      }
    })
  })
  return list
})

/* 默认选中当前设置中选中的模型 */
watch(
  () => modelOptions.value,
  (opts) => {
    if (form.modelKey && opts.some(o => o.key === form.modelKey)) return
    const selectedId = aiProviderStore.selectedModelId
    const hit = selectedId ? opts.find(o => o.modelId === selectedId) : null
    form.modelKey = (hit ?? opts[0])?.key ?? ''
  },
  { immediate: true }
)

const legendEntries = computed<Record<string, string>>(() => {
  const chars = TILE_CHARS[form.tileSetId] ?? {}
  const tiles = TILE_SETS[form.tileSetId]?.tiles ?? []
  const out: Record<string, string> = {}
  for (const [ch, id] of Object.entries(chars)) {
    out[ch] = tiles[id]?.name ?? String(id)
  }
  return out
})

function buildPrompt(): string {
  const ts = TILE_SETS[form.tileSetId]
  const isDungeon = form.tileSetId === 'trpg'
  const legend = Object.entries(legendEntries.value)
    .map(([ch, name]) => `"${ch}"=${name}`)
    .join('，')

  const terrainRules = isDungeon
    ? [
        '这是一张俯视视角的地下城地图（类似经典 roguelike）',
        '整体被墙壁 "#" 包裹，房间为矩形地板 "."，房间之间用 1 格宽走廊连通',
        '门 "D" 放在房间出入口，可点缀水域、岩浆、深坑等元素但不要喧宾夺主'
      ]
    : [
        '地形必须成块连贯（大块海洋/森林/山脉），严禁棋盘式噪点或每格随机',
        '水深由深到浅向陆地过渡：深海 -> 海洋 -> 浅海 -> 沙滩 -> 内陆',
        '山脉/雪峰在内陆成链状分布，不要孤立单格'
      ]

  return `你是一位像素瓦片地图设计师。请绘制一张 ${form.size} × ${form.size} 的「${ts?.name}」地图。

图例（每个字符代表一种瓦片）：
${legend}

设计规则：
${terrainRules.join('\n')}

${form.requirements ? `用户要求：${form.requirements}\n` : ''}
输出要求：
1. 只输出一个 JSON 对象，不要任何解释文字、markdown 标记
2. 格式：{"rows":["长度为${form.size}的字符串", ...共${form.size}行], "markers":[{"x":列号,"y":行号,"icon":"🏰"}, ...], "labels":[{"x":列号,"y":行号,"text":"地点名"}, ...]}
3. rows 必须恰好 ${form.size} 行，每行恰好 ${form.size} 个字符，只能使用图例中的字符
4. markers 最多 8 个（icon 用单个 emoji），labels 最多 6 个，坐标必须在 0-${form.size - 1} 范围内，且放在合适的地形上（城镇放陆地、港口放海岸）
5. markers 和 labels 可以为空数组`
}

interface RawAIResponse {
  rows?: string[] | string
  markers?: { x?: number; y?: number; icon?: string }[]
  labels?: { x?: number; y?: number; text?: string }[]
}

function extractJson(content: string): RawAIResponse | null {
  let str = content.trim()
  if (str.startsWith('```')) {
    str = str.replace(/^```(json)?\s*/i, '').replace(/```\s*$/, '')
  }
  const match = str.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    return JSON.parse(match[0]) as RawAIResponse
  } catch {
    return null
  }
}

function parseTiles(data: RawAIResponse): number[] | null {
  const size = form.size
  const charMap = TILE_CHARS[form.tileSetId] ?? {}
  const bgTile = TILE_SETS[form.tileSetId]?.bgTile ?? 0

  let rows = data.rows
  if (typeof rows === 'string') rows = rows.split('\n')
  if (!Array.isArray(rows) || rows.length === 0) return null

  const cleaned = rows.map(r => String(r).replace(/\s+/g, '')).filter(r => r.length > 0)
  if (cleaned.length < Math.floor(size * 0.8)) return null

  const tiles: number[] = new Array(size * size).fill(bgTile)
  const h = Math.min(cleaned.length, size)
  for (let y = 0; y < h; y++) {
    const row = cleaned[y]
    const w = Math.min(row.length, size)
    for (let x = 0; x < w; x++) {
      const id = charMap[row[x]]
      tiles[y * size + x] = id ?? bgTile
    }
  }
  return tiles
}

function parseStamps(data: RawAIResponse): TileStamp[] {
  const size = form.size
  if (!Array.isArray(data.markers)) return []
  return data.markers
    .filter(m => {
      const x = Number(m?.x)
      const y = Number(m?.y)
      return Number.isInteger(x) && Number.isInteger(y) &&
        x >= 0 && x < size && y >= 0 && y < size && typeof m?.icon === 'string' && m.icon
    })
    .slice(0, 12)
    .map(m => ({ x: Number(m.x), y: Number(m.y), emoji: [...m.icon!][0] }))
}

function parseLabels(data: RawAIResponse): TileLabel[] {
  const size = form.size
  if (!Array.isArray(data.labels)) return []
  return data.labels
    .filter(l => {
      const x = Number(l?.x)
      const y = Number(l?.y)
      return Number.isInteger(x) && Number.isInteger(y) &&
        x >= 0 && x < size && y >= 0 && y < size && typeof l?.text === 'string' && l.text.trim()
    })
    .slice(0, 8)
    .map(l => ({ x: Number(l.x), y: Number(l.y), text: l.text.trim().slice(0, 12) }))
}

async function callAI(): Promise<string> {
  const opt = modelOptions.value.find(o => o.key === form.modelKey)
  if (!opt) throw new Error('请先选择一个 AI 模型')

  const provider = aiProviderStore.enabledProviders[opt.providerIndex]
  const apiKey = provider.apiKey
  if (!apiKey) throw new Error(`请先在设置中配置 ${provider.name} 的 API Key`)

  const prompt = buildPrompt()
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 120000)

  try {
    let response: Response

    if (provider.type === 'anthropic') {
      response = await fetch(provider.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'anthropic-dangerous-direct-browser-access': 'true'
        },
        body: JSON.stringify({
          model: opt.modelId,
          max_tokens: 8000,
          system: '你是像素地图生成器。只输出严格的 JSON，不要任何其他文字或 markdown 标记。',
          messages: [{ role: 'user', content: prompt }]
        }),
        signal: controller.signal
      })
    } else {
      response = await fetch(provider.baseUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${apiKey}`
        },
        body: JSON.stringify({
          model: opt.modelId,
          messages: [
            {
              role: 'system',
              content: '你是像素地图生成器。只输出严格的 JSON，不要任何其他文字或 markdown 标记。'
            },
            { role: 'user', content: prompt }
          ],
          temperature: 0.7,
          max_tokens: 8000
        }),
        signal: controller.signal
      })
    }

    if (!response.ok) {
      const errText = await response.text()
      throw new Error(`API 请求失败 (${response.status}): ${errText.slice(0, 200)}`)
    }

    const data = await response.json()
    const content =
      provider.type === 'anthropic'
        ? data.content?.map?.((c: { text?: string }) => c.text ?? '').join('')
        : data.choices?.[0]?.message?.content

    if (!content) throw new Error('AI 未返回有效内容，请重试')
    return content
  } finally {
    clearTimeout(timeoutId)
  }
}

async function generateMap() {
  if (modelOptions.value.length === 0) {
    error.value = '请先在设置中启用至少一个 AI 提供商并配置 API Key'
    ElMessage.warning(error.value)
    return
  }

  generating.value = true
  error.value = ''
  progressText.value = '正在请求 AI 模型，可能需要 30-60 秒...'

  try {
    const content = await callAI()

    progressText.value = '正在解析地图数据...'
    const data = extractJson(content)
    if (!data) throw new Error('AI 返回的内容不是有效的 JSON，请重试或换一个模型')

    const tiles = parseTiles(data)
    if (!tiles) throw new Error('AI 返回的地图网格不完整（行数不足），建议减小尺寸后重试')

    emit('generate', {
      tileSetId: form.tileSetId,
      tileWidth: form.size,
      tileHeight: form.size,
      tiles,
      stamps: parseStamps(data),
      labels: parseLabels(data)
    })
    emit('update:modelValue', false)
    ElMessage.success('AI 地图生成成功')
  } catch (err: any) {
    console.error('AI 生成地图失败:', err)
    if (err.name === 'AbortError') {
      error.value = '请求超时，请重试或换用更快的模型'
    } else if (String(err?.message).includes('Failed to fetch')) {
      error.value = '网络连接失败，请检查网络或 API 地址'
    } else {
      error.value = err?.message || '生成失败，请重试'
    }
    ElMessage.error(error.value)
  } finally {
    generating.value = false
    progressText.value = ''
  }
}
</script>

<style scoped>
.ai-dialog :deep(.el-dialog) {
  border-radius: 10px;
  border: 1px solid #e2e6ec;
}

.ai-dialog :deep(.el-dialog__title) {
  color: #1f2430;
  font-weight: 600;
}

.ai-dialog :deep(.el-form-item__label) {
  color: #5b6472;
}

/* 图例预览 */
.legend-preview {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 10px;
  padding: 10px 12px;
  background: #f7f8fa;
  border: 1px solid #e2e6ec;
  border-radius: 6px;
  font-size: 12px;
  color: #5b6472;
}

.legend-title {
  font-weight: 600;
  color: #8a93a3;
}

.legend-item {
  display: inline-flex;
  align-items: center;
  gap: 3px;
}

.legend-item code {
  display: inline-block;
  min-width: 18px;
  text-align: center;
  background: #fff;
  border: 1px solid #e2e6ec;
  border-radius: 3px;
  padding: 0 3px;
  font-size: 11px;
  color: #1f2430;
}

.error-section {
  margin-top: 12px;
}

.loading-section {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  margin-top: 14px;
  padding: 14px;
  background: #f7f8fa;
  border-radius: 8px;
  font-size: 13px;
  color: #3b82f6;
}
</style>
