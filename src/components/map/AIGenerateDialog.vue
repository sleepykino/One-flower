<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    title="AI 地图生成"
    width="650px"
    class="ai-dialog"
    :close-on-click-modal="!generating"
    :close-on-press-escape="!generating"
  >
    <el-form :model="form" label-width="100px" :disabled="generating">
      <el-form-item label="地图类型">
        <el-select v-model="form.type" style="width: 100%">
          <el-option label="🌍 世界地图" value="world" />
          <el-option label="🗺️ 区域地图" value="region" />
          <el-option label="🏙️ 城市地图" value="city" />
          <el-option label="🏠 建筑地图" value="building" />
        </el-select>
      </el-form-item>
      
      <el-form-item label="地图名称">
        <el-input v-model="form.name" placeholder="请输入地图名称" />
      </el-form-item>
      
      <el-form-item label="画布尺寸">
        <el-col :span="11">
          <el-input-number v-model="form.width" :min="500" :max="10000" :step="100" style="width: 100%" />
        </el-col>
        <el-col :span="2" style="text-align: center; color: #a0a0a0;">×</el-col>
        <el-col :span="11">
          <el-input-number v-model="form.height" :min="500" :max="10000" :step="100" style="width: 100%" />
        </el-col>
      </el-form-item>
      
      <el-form-item label="生成要求">
        <el-input
          v-model="form.requirements"
          type="textarea"
          :rows="4"
          placeholder="描述你想要的地图特征，例如：&#10;- 包含三座主要城市&#10;- 一条横贯大陆的河流&#10;- 北部的雪山区域"
        />
      </el-form-item>
      
      <el-form-item label="风格设定">
        <el-select v-model="form.style" style="width: 100%">
          <el-option label="奇幻风格" value="fantasy" />
          <el-option label="写实风格" value="realistic" />
          <el-option label="卡通风格" value="cartoon" />
          <el-option label="古代风格" value="ancient" />
          <el-option label="科幻风格" value="scifi" />
        </el-select>
      </el-form-item>
      
      <el-form-item label="元素密度">
        <el-slider v-model="form.density" :min="1" :max="10" :marks="densityMarks" />
      </el-form-item>
    </el-form>

    <div v-if="error" class="error-section">
      <el-alert :title="error" type="error" show-icon closable @close="error = ''" />
    </div>

    <div v-if="generating" class="loading-section">
      <el-progress :percentage="progress" :format="() => progressText" />
      <p class="loading-tip">AI 正在生成地图，请稍候...</p>
    </div>

    <template #footer>
      <el-button @click="$emit('update:modelValue', false)" :disabled="generating">取消</el-button>
      <el-button type="primary" @click="generateMap" :loading="generating">
        <el-icon v-if="!generating"><MagicStick /></el-icon>
        {{ generating ? '生成中...' : '生成地图' }}
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive } from 'vue'
import { ElMessage } from 'element-plus'
import { MagicStick } from '@element-plus/icons-vue'
import { useAIProviderStore } from '@/stores/aiProvider'
import type { NovelMap, MapLayer, MapElement } from '@/types/map'

const props = defineProps<{
  modelValue: boolean
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
  (e: 'generate', data: Partial<NovelMap>): void
}>()

const aiProviderStore = useAIProviderStore()

const form = reactive({
  type: 'world' as 'world' | 'region' | 'city' | 'building',
  name: '',
  width: 2000,
  height: 2000,
  requirements: '',
  style: 'fantasy',
  density: 5
})

const densityMarks = {
  1: '稀疏',
  5: '适中',
  10: '密集'
}

const generating = ref(false)
const error = ref('')
const progress = ref(0)
const progressText = ref('')

function generateId(): string {
  return 'id_' + Date.now().toString(36) + Math.random().toString(36).substr(2, 9)
}

function getPrompt(): string {
  const typeNames: Record<string, string> = {
    world: '世界地图',
    region: '区域地图',
    city: '城市地图',
    building: '建筑地图'
  }

  const styleNames: Record<string, string> = {
    fantasy: '奇幻',
    realistic: '写实',
    cartoon: '卡通',
    ancient: '古代',
    scifi: '科幻'
  }

  return `你是一位专业的${styleNames[form.style]}风格地图设计师。请根据以下要求生成一个${typeNames[form.type]}的数据。

要求：
- 地图名称：${form.name || '未命名地图'}
- 地图类型：${typeNames[form.type]}
- 画布尺寸：${form.width} × ${form.height} 像素
- 风格：${styleNames[form.style]}
- 元素密度：${form.density}/10（1最稀疏，10最密集）
- 特殊要求：${form.requirements || '无特殊要求'}

请以严格的JSON格式输出地图数据。注意：
1. 所有坐标(x, y)必须在画布范围内（0-${form.width}, 0-${form.height}）
2. 元素数量根据密度调整，密度${form.density}建议生成${Math.floor(form.density * 3 + 5)}-${Math.floor(form.density * 5 + 10)}个元素
3. 图标使用emoji，如：🏰城市 🏘️村庄 ⛰️山脉 🌲森林 🌊河流 🏔️雪山 🏜️沙漠 🌾平原

输出格式（必须是有效的JSON）：
{
  "name": "地图名称",
  "description": "地图描述",
  "backgroundColor": "#f5f5dc",
  "layers": [
    {
      "name": "地形层",
      "elements": [
        {
          "type": "shape",
          "x": 100,
          "y": 100,
          "width": 300,
          "height": 200,
          "rotation": 0,
          "opacity": 0.8,
          "data": {
            "shapeType": "polygon",
            "fillColor": "#228B22",
            "strokeColor": "#006400",
            "strokeWidth": 2
          }
        }
      ]
    },
    {
      "name": "标记层",
      "elements": [
        {
          "type": "marker",
          "x": 500,
          "y": 400,
          "rotation": 0,
          "opacity": 1,
          "data": {
            "name": "地点名称",
            "description": "地点描述",
            "icon": "🏰",
            "color": "#FFD700",
            "size": 32,
            "label": "显示标签",
            "labelVisible": true
          }
        }
      ]
    },
    {
      "name": "路径层",
      "elements": [
        {
          "type": "path",
          "x": 0,
          "y": 0,
          "rotation": 0,
          "opacity": 1,
          "data": {
            "points": [[100, 200], [300, 400], [500, 300]],
            "strokeColor": "#4169E1",
            "strokeWidth": 3,
            "strokeDash": [],
            "fillColor": "transparent",
            "arrow": "none",
            "smooth": true
          }
        }
      ]
    }
  ]
}

只输出JSON，不要有任何其他文字或说明。确保JSON格式正确，可以被解析。`
}

function validateMapData(data: any): boolean {
  if (!data || typeof data !== 'object') return false
  if (!Array.isArray(data.layers)) return false
  
  for (const layer of data.layers) {
    if (!layer.name || typeof layer.name !== 'string') return false
    if (!Array.isArray(layer.elements)) return false
    
    for (const el of layer.elements) {
      if (!el.type || !['marker', 'path', 'shape', 'text', 'image'].includes(el.type)) return false
      if (typeof el.x !== 'number' || typeof el.y !== 'number') return false
      if (!el.data || typeof el.data !== 'object') return false
    }
  }
  
  return true
}

function normalizeMapData(data: any): Partial<NovelMap> {
  const now = Date.now()
  
  const layers: MapLayer[] = (data.layers || []).map((layer: any, index: number): MapLayer => {
    const elements: MapElement[] = (layer.elements || []).map((el: any): MapElement => {
      const element: MapElement = {
        id: el.id || generateId(),
        type: el.type || 'marker',
        x: Math.max(0, Math.min(form.width, Number(el.x) || 0)),
        y: Math.max(0, Math.min(form.height, Number(el.y) || 0)),
        rotation: Number(el.rotation) || 0,
        opacity: Math.max(0, Math.min(1, Number(el.opacity) || 1)),
        data: el.data || {}
      }
      
      if (el.width !== undefined) element.width = Number(el.width) || 100
      if (el.height !== undefined) element.height = Number(el.height) || 100
      
      if (el.type === 'marker') {
        element.data = {
          name: el.data?.name || '未命名',
          description: el.data?.description || '',
          icon: el.data?.icon || '📍',
          color: el.data?.color || '#FFD700',
          size: Math.max(16, Math.min(128, Number(el.data?.size) || 32)),
          label: el.data?.label || el.data?.name || '',
          labelVisible: el.data?.labelVisible !== false
        }
      } else if (el.type === 'path') {
        element.data = {
          points: Array.isArray(el.data?.points) ? el.data.points.map((p: any) => ({
            x: Number(p[0]) || Number(p.x) || 0,
            y: Number(p[1]) || Number(p.y) || 0
          })) : [],
          strokeColor: el.data?.strokeColor || '#333333',
          strokeWidth: Math.max(1, Number(el.data?.strokeWidth) || 3),
          strokeDash: Array.isArray(el.data?.strokeDash) ? el.data.strokeDash : [],
          fillColor: el.data?.fillColor || 'transparent',
          arrow: el.data?.arrow || 'none',
          smooth: Boolean(el.data?.smooth)
        }
      } else if (el.type === 'shape') {
        element.data = {
          shapeType: el.data?.shapeType || 'rectangle',
          strokeColor: el.data?.strokeColor || '#333333',
          strokeWidth: Math.max(0, Number(el.data?.strokeWidth) || 2),
          fillColor: el.data?.fillColor || '#cccccc'
        }
      } else if (el.type === 'text') {
        element.data = {
          content: el.data?.content || '文字',
          fontSize: Math.max(8, Math.min(72, Number(el.data?.fontSize) || 16)),
          fontFamily: el.data?.fontFamily || 'Arial',
          color: el.data?.color || '#333333',
          bold: Boolean(el.data?.bold),
          italic: Boolean(el.data?.italic),
          align: el.data?.align || 'left'
        }
      }
      
      return element
    })
    
    return {
      id: layer.id || generateId(),
      name: String(layer.name) || `图层 ${index + 1}`,
      visible: layer.visible !== false,
      locked: Boolean(layer.locked),
      opacity: Math.max(0, Math.min(1, Number(layer.opacity) || 1)),
      zIndex: index,
      elements
    }
  })
  
  if (layers.length === 0) {
    layers.push({
      id: generateId(),
      name: '图层 1',
      visible: true,
      locked: false,
      opacity: 1,
      zIndex: 0,
      elements: []
    })
  }
  
  return {
    name: String(data.name || form.name || '新地图'),
    description: String(data.description || ''),
    type: form.type,
    width: form.width,
    height: form.height,
    backgroundColor: data.backgroundColor || '#f5f5dc',
    gridVisible: true,
    gridSize: 50,
    layers
  }
}

async function generateMap() {
  if (!form.requirements.trim()) {
    ElMessage.warning('请输入生成要求')
    return
  }

  generating.value = true
  error.value = ''
  progress.value = 10
  progressText.value = '准备中...'
  
  try {
    const enabledProviders = aiProviderStore.enabledProviders
    if (enabledProviders.length === 0) {
      throw new Error('请先在设置中启用至少一个AI模型并配置 API Key')
    }

    let provider = enabledProviders[0]
    let modelId = aiProviderStore.selectedModelId
    
    if (modelId) {
      const providerWithModel = enabledProviders.find(p => 
        p.models.some(m => m.id === modelId)
      )
      if (providerWithModel) {
        provider = providerWithModel
      }
    } else {
      modelId = provider.models[0]?.id
    }
    
    const apiKey = provider.apiKey
    
    if (!apiKey) {
      throw new Error(`请先在设置中配置 ${provider.name} 的 API Key`)
    }

    if (!modelId) {
      throw new Error(`请先选择一个模型`)
    }

    progress.value = 20
    progressText.value = '连接AI服务...'

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 120000)

    const response = await fetch(provider.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: modelId,
        messages: [
          {
            role: 'system',
            content: '你是一个专业的地图数据生成器。你必须只输出有效的JSON格式数据，不要有任何其他文字、解释或markdown标记。'
          },
          {
            role: 'user',
            content: getPrompt()
          }
        ],
        temperature: 0.8,
        max_tokens: 8000
      }),
      signal: controller.signal
    })

    clearTimeout(timeoutId)

    progress.value = 50
    progressText.value = '接收响应...'

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`API请求失败 (${response.status}): ${errorText.slice(0, 200)}`)
    }

    const data = await response.json()
    const content = data.choices?.[0]?.message?.content
    
    if (!content) {
      throw new Error('AI未返回有效内容，请重试')
    }

    progress.value = 70
    progressText.value = '解析数据...'

    let jsonStr = content.trim()
    if (jsonStr.startsWith('```json')) {
      jsonStr = jsonStr.slice(7)
    }
    if (jsonStr.startsWith('```')) {
      jsonStr = jsonStr.slice(3)
    }
    if (jsonStr.endsWith('```')) {
      jsonStr = jsonStr.slice(0, -3)
    }
    jsonStr = jsonStr.trim()

    const jsonMatch = jsonStr.match(/\{[\s\S]*\}/)
    if (!jsonMatch) {
      throw new Error('AI返回的内容不是有效的JSON格式，请重试或调整要求')
    }

    let parsedData: any
    try {
      parsedData = JSON.parse(jsonMatch[0])
    } catch (e) {
      throw new Error('JSON解析失败，AI返回的数据格式有误，请重试')
    }

    progress.value = 80
    progressText.value = '验证数据...'

    if (!validateMapData(parsedData)) {
      console.warn('数据验证失败，尝试修复:', parsedData)
    }

    progress.value = 90
    progressText.value = '处理数据...'

    const mapData = normalizeMapData(parsedData)

    progress.value = 100
    progressText.value = '完成！'

    emit('generate', mapData)
    emit('update:modelValue', false)
    ElMessage.success('地图生成成功！')
    
  } catch (err: any) {
    console.error('生成地图失败:', err)
    
    if (err.name === 'AbortError') {
      error.value = '请求超时，请检查网络连接后重试'
    } else if (err.message.includes('Failed to fetch')) {
      error.value = '网络连接失败，请检查网络或API地址是否正确'
    } else {
      error.value = err.message || '生成失败，请重试'
    }
    
    ElMessage.error(error.value)
  } finally {
    generating.value = false
    progress.value = 0
    progressText.value = ''
  }
}
</script>

<style scoped>
.ai-dialog :deep(.el-dialog__body) {
  max-height: 65vh;
  overflow-y: auto;
}

.error-section {
  margin-top: 15px;
}

.loading-section {
  margin-top: 20px;
  padding: 15px;
  background: #0f3460;
  border-radius: 8px;
}

.loading-tip {
  margin-top: 10px;
  font-size: 13px;
  color: #a0a0a0;
  text-align: center;
}

:deep(.el-slider__marks-text) {
  font-size: 11px;
  color: #808080;
}

:deep(.el-form-item) {
  margin-bottom: 18px;
}

:deep(.el-textarea__inner) {
  font-family: inherit;
}
</style>
