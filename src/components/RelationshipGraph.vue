<template>
  <div class="relationship-graph">
    <div class="graph-header">
      <h3>
        <el-icon><Share /></el-icon>
        角色关系图谱
      </h3>
      <div class="graph-actions">
        <el-button size="small" @click="resetView">
          <el-icon><RefreshRight /></el-icon>
          重置视图
        </el-button>
        <el-button size="small" type="primary" @click="showAddRelationDialog">
          <el-icon><Plus /></el-icon>
          添加关系
        </el-button>
      </div>
    </div>

    <div class="graph-container" ref="graphContainer">
      <canvas ref="canvas" @mousedown="handleMouseDown" @mousemove="handleMouseMove" @mouseup="handleMouseUp" @wheel="handleWheel"></canvas>
      
      <div v-if="characters.length === 0" class="empty-state">
        <el-icon class="empty-icon"><User /></el-icon>
        <p>暂无角色数据</p>
        <p class="empty-hint">请先创建角色卡</p>
      </div>
    </div>

    <div class="graph-legend">
      <div class="legend-title">关系类型</div>
      <div class="legend-items">
        <div class="legend-item" v-for="(label, type) in relationTypes" :key="type">
          <span class="legend-color" :style="{ background: getRelationColor(type) }"></span>
          <span class="legend-label">{{ label }}</span>
        </div>
      </div>
    </div>

    <el-dialog v-model="relationDialogVisible" title="添加角色关系" width="500px">
      <el-form :model="relationForm" label-width="100px">
        <el-form-item label="角色A">
          <el-select v-model="relationForm.fromCharacterId" placeholder="选择角色">
            <el-option
              v-for="char in characters"
              :key="char.id"
              :label="char.name"
              :value="char.id"
            />
          </el-select>
        </el-form-item>
        
        <el-form-item label="关系类型">
          <el-select v-model="relationForm.relationType" placeholder="选择关系类型">
            <el-option
              v-for="(label, value) in relationTypes"
              :key="value"
              :label="label"
              :value="value"
            />
          </el-select>
        </el-form-item>
        
        <el-form-item label="角色B">
          <el-select v-model="relationForm.toCharacterId" placeholder="选择角色">
            <el-option
              v-for="char in characters"
              :key="char.id"
              :label="char.name"
              :value="char.id"
            />
          </el-select>
        </el-form-item>
        
        <el-form-item label="关系描述">
          <el-input
            v-model="relationForm.description"
            type="textarea"
            :rows="3"
            placeholder="描述两个角色之间的关系..."
          />
        </el-form-item>
      </el-form>
      
      <template #footer>
        <el-button @click="relationDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="addRelation">确定</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="nodeDetailVisible" :title="selectedNode?.name" width="400px">
      <div v-if="selectedNode" class="node-detail">
        <div class="detail-item">
          <span class="detail-label">描述：</span>
          <span>{{ selectedNode.description || '暂无描述' }}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">性格：</span>
          <span>{{ selectedNode.personality || '暂无' }}</span>
        </div>
        <div class="detail-item">
          <span class="detail-label">关系数量：</span>
          <span>{{ getNodeRelationCount(selectedNode.id) }}</span>
        </div>
      </div>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { Share, Plus, RefreshRight, User } from '@element-plus/icons-vue'
import { useCharacterStore } from '@/stores/character'
import type { Character, CharacterRelation } from '@/types'

const characterStore = useCharacterStore()
const characters = computed(() => characterStore.characters)

const canvas = ref<HTMLCanvasElement | null>(null)
const graphContainer = ref<HTMLDivElement | null>(null)

const relationDialogVisible = ref(false)
const nodeDetailVisible = ref(false)
const selectedNode = ref<Character | null>(null)

const relationForm = ref({
  fromCharacterId: '',
  toCharacterId: '',
  relationType: 'friend' as CharacterRelation['relationType'],
  description: ''
})

const relationTypes = {
  friend: '朋友',
  enemy: '敌人',
  family: '家人',
  lover: '恋人',
  colleague: '同事',
  rival: '对手',
  master: '师徒',
  student: '学生',
  other: '其他'
}

interface Node {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  character: Character
}

interface Edge {
  from: string
  to: string
  relation: CharacterRelation
}

let nodes: Node[] = []
let edges: Edge[] = []
let ctx: CanvasRenderingContext2D | null = null
let animationId: number | null = null

let scale = 1
let offsetX = 0
let offsetY = 0
let isDragging = false
let dragNode: Node | null = null
let lastMouseX = 0
let lastMouseY = 0

onMounted(() => {
  if (canvas.value && graphContainer.value) {
    const rect = graphContainer.value.getBoundingClientRect()
    canvas.value.width = rect.width
    canvas.value.height = rect.height
    
    ctx = canvas.value.getContext('2d')
    
    initGraph()
    animate()
    
    window.addEventListener('resize', handleResize)
  }
})

onUnmounted(() => {
  if (animationId) {
    cancelAnimationFrame(animationId)
  }
  window.removeEventListener('resize', handleResize)
})

watch(() => characters.value, () => {
  initGraph()
}, { deep: true })

function handleResize() {
  if (canvas.value && graphContainer.value) {
    const rect = graphContainer.value.getBoundingClientRect()
    canvas.value.width = rect.width
    canvas.value.height = rect.height
  }
}

function initGraph() {
  nodes = characters.value.map((char, index) => {
    const angle = (index / characters.value.length) * 2 * Math.PI
    const radius = 150
    
    return {
      id: char.id,
      x: (canvas.value?.width || 600) / 2 + radius * Math.cos(angle),
      y: (canvas.value?.height || 400) / 2 + radius * Math.sin(angle),
      vx: 0,
      vy: 0,
      character: char
    }
  })

  edges = []
  characters.value.forEach(char => {
    if (char.relations) {
      char.relations.forEach(relation => {
        if (!edges.find(e => e.from === relation.fromCharacterId && e.to === relation.toCharacterId)) {
          edges.push({
            from: relation.fromCharacterId,
            to: relation.toCharacterId,
            relation: relation
          })
        }
      })
    }
  })
}

function animate() {
  if (!ctx || !canvas.value) return

  ctx.clearRect(0, 0, canvas.value.width, canvas.value.height)
  
  ctx.save()
  ctx.translate(offsetX, offsetY)
  ctx.scale(scale, scale)

  applyForces()
  
  edges.forEach(edge => {
    const fromNode = nodes.find(n => n.id === edge.from)
    const toNode = nodes.find(n => n.id === edge.to)
    
    if (fromNode && toNode) {
      drawEdge(fromNode, toNode, edge.relation)
    }
  })

  nodes.forEach(node => {
    drawNode(node)
  })
  
  ctx.restore()

  animationId = requestAnimationFrame(animate)
}

function applyForces() {
  const centerX = (canvas.value?.width || 600) / 2
  const centerY = (canvas.value?.height || 400) / 2

  nodes.forEach(node => {
    if (dragNode && node.id === dragNode.id) return

    const dx = centerX - node.x
    const dy = centerY - node.y
    node.vx += dx * 0.001
    node.vy += dy * 0.001

    nodes.forEach(other => {
      if (node.id === other.id) return
      
      const dx = other.x - node.x
      const dy = other.y - node.y
      const dist = Math.sqrt(dx * dx + dy * dy)
      
      if (dist < 100) {
        const force = (100 - dist) * 0.05
        node.vx -= (dx / dist) * force
        node.vy -= (dy / dist) * force
      }
    })

    edges.forEach(edge => {
      if (edge.from === node.id || edge.to === node.id) {
        const otherId = edge.from === node.id ? edge.to : edge.from
        const other = nodes.find(n => n.id === otherId)
        
        if (other) {
          const dx = other.x - node.x
          const dy = other.y - node.y
          const dist = Math.sqrt(dx * dx + dy * dy)
          
          if (dist > 150) {
            const force = (dist - 150) * 0.01
            node.vx += (dx / dist) * force
            node.vy += (dy / dist) * force
          }
        }
      }
    })

    node.vx *= 0.9
    node.vy *= 0.9
    node.x += node.vx
    node.y += node.vy
  })
}

function drawNode(node: Node) {
  if (!ctx) return

  const radius = 30

  ctx.beginPath()
  ctx.arc(node.x, node.y, radius, 0, 2 * Math.PI)
  
  const gradient = ctx.createRadialGradient(node.x, node.y, 0, node.x, node.y, radius)
  const color = node.character.color || getCharacterColor(node.character.name)
  gradient.addColorStop(0, color)
  gradient.addColorStop(1, adjustColor(color, -30))
  
  ctx.fillStyle = gradient
  ctx.fill()
  
  ctx.strokeStyle = '#fff'
  ctx.lineWidth = 3
  ctx.stroke()

  ctx.fillStyle = '#fff'
  ctx.font = 'bold 16px Arial'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  
  const name = node.character.name
  const textWidth = ctx.measureText(name).width
  
  if (textWidth > radius * 1.8) {
    ctx.font = 'bold 12px Arial'
  }
  
  ctx.fillText(name, node.x, node.y)
}

function drawEdge(from: Node, to: Node, relation: CharacterRelation) {
  if (!ctx) return

  const dx = to.x - from.x
  const dy = to.y - from.y
  const dist = Math.sqrt(dx * dx + dy * dy)
  
  const startX = from.x + (dx / dist) * 30
  const startY = from.y + (dy / dist) * 30
  const endX = to.x - (dx / dist) * 30
  const endY = to.y - (dy / dist) * 30

  ctx.beginPath()
  ctx.moveTo(startX, startY)
  ctx.lineTo(endX, endY)
  
  ctx.strokeStyle = getRelationColor(relation.relationType)
  ctx.lineWidth = 2
  ctx.stroke()

  const midX = (startX + endX) / 2
  const midY = (startY + endY) / 2
  
  ctx.fillStyle = '#fff'
  ctx.beginPath()
  ctx.arc(midX, midY, 15, 0, 2 * Math.PI)
  ctx.fill()
  
  ctx.fillStyle = getRelationColor(relation.relationType)
  ctx.font = '12px Arial'
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(relationTypes[relation.relationType], midX, midY)
}

function getRelationColor(type: CharacterRelation['relationType']): string {
  const colors: Record<CharacterRelation['relationType'], string> = {
    friend: '#4CAF50',
    enemy: '#F44336',
    family: '#FF9800',
    lover: '#E91E63',
    colleague: '#2196F3',
    rival: '#9C27B0',
    master: '#795548',
    student: '#00BCD4',
    other: '#607D8B'
  }
  return colors[type]
}

function getCharacterColor(name: string): string {
  const colors = [
    '#667eea', '#764ba2', '#f093fb', '#f5576c',
    '#4facfe', '#00f2fe', '#43e97b', '#38f9d7',
    '#fa709a', '#fee140'
  ]
  
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  
  return colors[Math.abs(hash) % colors.length]
}

function adjustColor(color: string, amount: number): string {
  const hex = color.replace('#', '')
  const num = parseInt(hex, 16)
  
  let r = (num >> 16) + amount
  let g = ((num >> 8) & 0x00FF) + amount
  let b = (num & 0x0000FF) + amount
  
  r = Math.max(0, Math.min(255, r))
  g = Math.max(0, Math.min(255, g))
  b = Math.max(0, Math.min(255, b))
  
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')}`
}

function handleMouseDown(event: MouseEvent) {
  const rect = canvas.value?.getBoundingClientRect()
  if (!rect) return
  
  const mouseX = (event.clientX - rect.left - offsetX) / scale
  const mouseY = (event.clientY - rect.top - offsetY) / scale
  
  dragNode = nodes.find(node => {
    const dx = mouseX - node.x
    const dy = mouseY - node.y
    return Math.sqrt(dx * dx + dy * dy) < 30
  }) || null
  
  if (dragNode) {
    isDragging = true
  } else {
    isDragging = true
    lastMouseX = event.clientX
    lastMouseY = event.clientY
  }
}

function handleMouseMove(event: MouseEvent) {
  if (!isDragging) return
  
  if (dragNode) {
    const rect = canvas.value?.getBoundingClientRect()
    if (!rect) return
    
    dragNode.x = (event.clientX - rect.left - offsetX) / scale
    dragNode.y = (event.clientY - rect.top - offsetY) / scale
    dragNode.vx = 0
    dragNode.vy = 0
  } else {
    const dx = event.clientX - lastMouseX
    const dy = event.clientY - lastMouseY
    
    offsetX += dx
    offsetY += dy
    
    lastMouseX = event.clientX
    lastMouseY = event.clientY
  }
}

function handleMouseUp(event: MouseEvent) {
  if (dragNode && !isDragging) {
    selectedNode.value = dragNode.character
    nodeDetailVisible.value = true
  }
  
  isDragging = false
  dragNode = null
}

function handleWheel(event: WheelEvent) {
  event.preventDefault()
  
  const rect = canvas.value?.getBoundingClientRect()
  if (!rect) return
  
  const mouseX = event.clientX - rect.left
  const mouseY = event.clientY - rect.top
  
  const zoom = event.deltaY > 0 ? 0.9 : 1.1
  const newScale = scale * zoom
  
  if (newScale >= 0.1 && newScale <= 5) {
    offsetX = mouseX - (mouseX - offsetX) * zoom
    offsetY = mouseY - (mouseY - offsetY) * zoom
    scale = newScale
  }
}

function resetView() {
  scale = 1
  offsetX = 0
  offsetY = 0
  initGraph()
}

function showAddRelationDialog() {
  relationForm.value = {
    fromCharacterId: '',
    toCharacterId: '',
    relationType: 'friend',
    description: ''
  }
  relationDialogVisible.value = true
}

function addRelation() {
  if (!relationForm.value.fromCharacterId || !relationForm.value.toCharacterId) {
    ElMessage.warning('请选择两个角色')
    return
  }
  
  if (relationForm.value.fromCharacterId === relationForm.value.toCharacterId) {
    ElMessage.warning('不能选择相同的角色')
    return
  }

  const fromCharacter = characters.value.find(c => c.id === relationForm.value.fromCharacterId)
  const toCharacter = characters.value.find(c => c.id === relationForm.value.toCharacterId)
  
  if (!fromCharacter || !toCharacter) {
    ElMessage.error('角色不存在')
    return
  }

  const newRelation: CharacterRelation = {
    id: 'rel_' + Date.now().toString(36) + Math.random().toString(36).substr(2),
    fromCharacterId: relationForm.value.fromCharacterId,
    toCharacterId: relationForm.value.toCharacterId,
    relationType: relationForm.value.relationType,
    description: relationForm.value.description,
    createdAt: Date.now(),
    updatedAt: Date.now()
  }

  if (!fromCharacter.relations) {
    fromCharacter.relations = []
  }
  fromCharacter.relations.push(newRelation)

  const reverseRelation: CharacterRelation = {
    ...newRelation,
    id: 'rel_' + Date.now().toString(36) + Math.random().toString(36).substr(2),
    fromCharacterId: relationForm.value.toCharacterId,
    toCharacterId: relationForm.value.fromCharacterId,
    relationType: getReverseRelationType(relationForm.value.relationType)
  }

  if (!toCharacter.relations) {
    toCharacter.relations = []
  }
  toCharacter.relations.push(reverseRelation)

  characterStore.updateCharacter(relationForm.value.fromCharacterId, { relations: fromCharacter.relations })
  characterStore.updateCharacter(relationForm.value.toCharacterId, { relations: toCharacter.relations })

  relationDialogVisible.value = false
  ElMessage.success('关系添加成功')
}

function getReverseRelationType(type: CharacterRelation['relationType']): CharacterRelation['relationType'] {
  const reverseMap: Partial<Record<CharacterRelation['relationType'], CharacterRelation['relationType']>> = {
    master: 'student',
    student: 'master'
  }
  return reverseMap[type] || type
}

function getNodeRelationCount(nodeId: string): number {
  const node = nodes.find(n => n.id === nodeId)
  return node?.character.relations?.length || 0
}
</script>

<style scoped>
.relationship-graph {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: linear-gradient(135deg, #f5f7fa 0%, #e8eef5 100%);
  border-radius: 12px;
  overflow: hidden;
}

.graph-header {
  padding: 20px;
  background: white;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.graph-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
  display: flex;
  align-items: center;
  gap: 8px;
}

.graph-actions {
  display: flex;
  gap: 10px;
}

.graph-container {
  flex: 1;
  position: relative;
  overflow: hidden;
}

canvas {
  display: block;
  cursor: move;
}

.empty-state {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  text-align: center;
  color: #909399;
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-hint {
  font-size: 14px;
  margin-top: 8px;
}

.graph-legend {
  padding: 16px 20px;
  background: white;
  border-top: 1px solid #e4e7ed;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.04);
}

.legend-title {
  font-weight: 600;
  margin-bottom: 12px;
  color: #303133;
}

.legend-items {
  display: flex;
  flex-wrap: wrap;
  gap: 16px;
}

.legend-item {
  display: flex;
  align-items: center;
  gap: 6px;
}

.legend-color {
  width: 16px;
  height: 16px;
  border-radius: 4px;
}

.legend-label {
  font-size: 13px;
  color: #606266;
}

.node-detail {
  padding: 10px 0;
}

.detail-item {
  margin-bottom: 12px;
  display: flex;
  gap: 8px;
}

.detail-label {
  font-weight: 600;
  color: #606266;
  min-width: 80px;
}

@media (max-width: 768px) {
  .graph-header {
    padding: 16px;
    flex-direction: column;
    gap: 12px;
  }

  .graph-actions {
    width: 100%;
    justify-content: space-between;
  }

  .legend-items {
    gap: 12px;
  }
}
</style>
