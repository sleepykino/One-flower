<template>
  <el-dialog
    :model-value="modelValue"
    @update:model-value="$emit('update:modelValue', $event)"
    title="导出地图"
    width="500px"
    class="export-dialog"
  >
    <el-form :model="form" label-width="100px">
      <el-form-item label="导出格式">
        <el-select v-model="form.format" style="width: 100%">
          <el-option label="PNG 图片" value="png" />
          <el-option label="JPG 图片" value="jpg" />
          <el-option label="JSON 数据" value="json" />
        </el-select>
      </el-form-item>
      
      <el-form-item label="图片质量" v-if="form.format !== 'json'">
        <el-select v-model="form.quality" style="width: 100%">
          <el-option label="标准 (1x)" value="standard" />
          <el-option label="高清 (2x)" value="high" />
          <el-option label="超高清 (4x)" value="ultra" />
        </el-select>
      </el-form-item>
      
      <el-form-item label="背景颜色" v-if="form.format !== 'json'">
        <el-color-picker v-model="form.backgroundColor" show-alpha />
        <el-checkbox v-model="form.transparent" style="margin-left: 10px">透明背景</el-checkbox>
      </el-form-item>
      
      <el-form-item label="包含网格" v-if="form.format !== 'json'">
        <el-switch v-model="form.includeGrid" />
      </el-form-item>
      
      <el-form-item label="文件名">
        <el-input v-model="form.filename" placeholder="请输入文件名" />
      </el-form-item>
    </el-form>

    <template #footer>
      <el-button @click="$emit('update:modelValue', false)">取消</el-button>
      <el-button type="primary" @click="exportMap">
        <el-icon><Download /></el-icon>
        导出
      </el-button>
    </template>
  </el-dialog>
</template>

<script setup lang="ts">
import { ref, reactive, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Download } from '@element-plus/icons-vue'
import type { NovelMap } from '@/types/map'

const props = defineProps<{
  modelValue: boolean
  map: NovelMap | null
  canvasRef: any
}>()

const emit = defineEmits<{
  (e: 'update:modelValue', value: boolean): void
}>()

const form = reactive({
  format: 'png' as 'png' | 'jpg' | 'json',
  quality: 'high' as 'standard' | 'high' | 'ultra',
  backgroundColor: '#ffffff',
  transparent: false,
  includeGrid: true,
  filename: ''
})

watch(() => props.map, (map) => {
  if (map) {
    form.filename = map.name
    form.backgroundColor = map.backgroundColor
  }
}, { immediate: true })

function getScale(): number {
  switch (form.quality) {
    case 'standard': return 1
    case 'high': return 2
    case 'ultra': return 4
    default: return 1
  }
}

async function exportMap() {
  if (!props.map) {
    ElMessage.warning('没有可导出的地图')
    return
  }

  try {
    if (form.format === 'json') {
      exportAsJson()
    } else {
      await exportAsImage()
    }
    
    emit('update:modelValue', false)
    ElMessage.success('导出成功')
  } catch (error) {
    console.error('导出失败:', error)
    ElMessage.error('导出失败')
  }
}

function exportAsJson() {
  if (!props.map) return
  
  const json = JSON.stringify(props.map, null, 2)
  const blob = new Blob([json], { type: 'application/json' })
  downloadBlob(blob, `${form.filename}.json`)
}

async function exportAsImage() {
  if (!props.map) return
  
  const scale = getScale()
  const canvas = document.createElement('canvas')
  canvas.width = props.map.width * scale
  canvas.height = props.map.height * scale
  
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  
  ctx.scale(scale, scale)
  
  if (form.transparent) {
    ctx.clearRect(0, 0, props.map.width, props.map.height)
  } else {
    ctx.fillStyle = form.backgroundColor
    ctx.fillRect(0, 0, props.map.width, props.map.height)
  }
  
  if (form.includeGrid && props.map.gridVisible) {
    drawGrid(ctx, props.map)
  }
  
  const sortedLayers = [...props.map.layers].sort((a, b) => a.zIndex - b.zIndex)
  for (const layer of sortedLayers) {
    if (!layer.visible) continue
    
    ctx.globalAlpha = layer.opacity
    for (const element of layer.elements) {
      drawElement(ctx, element)
    }
  }
  
  const mimeType = form.format === 'jpg' ? 'image/jpeg' : 'image/png'
  const quality = form.format === 'jpg' ? 0.9 : undefined
  
  canvas.toBlob((blob) => {
    if (blob) {
      downloadBlob(blob, `${form.filename}.${form.format}`)
    }
  }, mimeType, quality)
}

function drawGrid(ctx: CanvasRenderingContext2D, map: NovelMap) {
  ctx.strokeStyle = 'rgba(128, 128, 128, 0.3)'
  ctx.lineWidth = 1
  
  for (let x = 0; x <= map.width; x += map.gridSize) {
    ctx.beginPath()
    ctx.moveTo(x, 0)
    ctx.lineTo(x, map.height)
    ctx.stroke()
  }
  
  for (let y = 0; y <= map.height; y += map.gridSize) {
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(map.width, y)
    ctx.stroke()
  }
}

function drawElement(ctx: CanvasRenderingContext2D, element: any) {
  ctx.save()
  ctx.translate(element.x, element.y)
  ctx.rotate((element.rotation * Math.PI) / 180)
  ctx.globalAlpha *= element.opacity
  
  switch (element.type) {
    case 'marker':
      drawMarker(ctx, element.data)
      break
    case 'path':
      drawPath(ctx, element.data)
      break
    case 'shape':
      drawShape(ctx, element.data, element.width, element.height)
      break
    case 'text':
      drawText(ctx, element.data)
      break
  }
  
  ctx.restore()
}

function drawMarker(ctx: CanvasRenderingContext2D, data: any) {
  const size = data.size
  ctx.font = `${size}px Arial`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(data.icon, 0, 0)
  
  if (data.labelVisible && data.label) {
    ctx.font = '14px Arial'
    ctx.fillStyle = '#333'
    ctx.fillText(data.label, 0, size / 2 + 15)
  }
}

function drawPath(ctx: CanvasRenderingContext2D, data: any) {
  if (data.points.length < 2) return
  
  ctx.beginPath()
  ctx.strokeStyle = data.strokeColor
  ctx.lineWidth = data.strokeWidth
  ctx.setLineDash(data.strokeDash)
  
  ctx.moveTo(data.points[0].x, data.points[0].y)
  for (let i = 1; i < data.points.length; i++) {
    ctx.lineTo(data.points[i].x, data.points[i].y)
  }
  
  ctx.stroke()
  ctx.setLineDash([])
}

function drawShape(ctx: CanvasRenderingContext2D, data: any, width?: number, height?: number) {
  ctx.fillStyle = data.fillColor
  ctx.strokeStyle = data.strokeColor
  ctx.lineWidth = data.strokeWidth
  
  const w = width || 100
  const h = height || 100
  
  switch (data.shapeType) {
    case 'rectangle':
      ctx.fillRect(-w / 2, -h / 2, w, h)
      ctx.strokeRect(-w / 2, -h / 2, w, h)
      break
    case 'circle':
      ctx.beginPath()
      ctx.arc(0, 0, Math.min(w, h) / 2, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      break
    case 'ellipse':
      ctx.beginPath()
      ctx.ellipse(0, 0, w / 2, h / 2, 0, 0, Math.PI * 2)
      ctx.fill()
      ctx.stroke()
      break
  }
}

function drawText(ctx: CanvasRenderingContext2D, data: any) {
  ctx.font = `${data.italic ? 'italic ' : ''}${data.bold ? 'bold ' : ''}${data.fontSize}px ${data.fontFamily}`
  ctx.fillStyle = data.color
  ctx.textAlign = data.align
  ctx.textBaseline = 'top'
  ctx.fillText(data.content, 0, 0)
}

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}
</script>

<style scoped>
.export-dialog :deep(.el-form-item) {
  margin-bottom: 15px;
}
</style>
