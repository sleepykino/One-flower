<template>
  <div class="chapter-list-container">
    <div class="chapter-list-header">
      <div class="header-title">
        <el-icon class="title-icon"><Notebook /></el-icon>
        <h3>章节管理</h3>
      </div>
      <el-button type="primary" size="small" @click="addChapter" class="add-btn">
        <el-icon><Plus /></el-icon>
        新建
      </el-button>
    </div>

    <div class="chapter-list-content">
      <transition-group name="chapter-list" tag="div" class="chapters-wrapper">
        <div
          v-for="(chapter, index) in chapters"
          :key="chapter.id"
          class="chapter-card"
          :class="{
            'is-current': chapter.id === currentChapterId,
            'drag-over': dragOverIndex === index,
            'dragging': dragIndex === index
          }"
          :style="{ '--card-color': getChapterColor(index) }"
          @click="selectChapter(chapter.id)"
          draggable="true"
          @dragstart="onDragStart($event, index)"
          @dragover.prevent="onDragOver($event, index)"
          @dragenter.prevent="dragOverIndex = index"
          @dragleave="onDragLeave($event, index)"
          @drop="onDrop($event, index)"
          @dragend="onDragEnd"
        >
          <div class="drag-handle" @click.stop>
            <el-icon><Rank /></el-icon>
          </div>
          <div class="chapter-number">{{ String(index + 1).padStart(2, '0') }}</div>
          <div class="chapter-info">
            <div class="chapter-title">{{ chapter.title }}</div>
            <div class="chapter-meta">
              <span class="word-count">
                <el-icon><Document /></el-icon>
                {{ chapter.wordCount }} 字
              </span>
              <span class="create-time">{{ formatTime(chapter.id) }}</span>
            </div>
          </div>
          <div class="chapter-actions">
            <el-dropdown trigger="click" @command="handleCommand($event, chapter)" @click.stop>
              <el-button type="text" size="small" class="action-btn">
                <el-icon><MoreFilled /></el-icon>
              </el-button>
              <template #dropdown>
                <el-dropdown-menu>
                  <el-dropdown-item command="rename">
                    <el-icon><Edit /></el-icon>
                    重命名
                  </el-dropdown-item>
                  <el-dropdown-item command="duplicate">
                    <el-icon><CopyDocument /></el-icon>
                    复制
                  </el-dropdown-item>
                  <el-dropdown-item command="delete" :disabled="chapters.length <= 1" divided>
                    <el-icon><Delete /></el-icon>
                    删除
                  </el-dropdown-item>
                </el-dropdown-menu>
              </template>
            </el-dropdown>
          </div>
          <div class="current-indicator" v-if="chapter.id === currentChapterId">
            <el-icon><Check /></el-icon>
          </div>
        </div>
      </transition-group>

      <div class="empty-state" v-if="chapters.length === 0">
        <el-icon class="empty-icon"><Notebook /></el-icon>
        <p>暂无章节</p>
        <el-button type="primary" size="small" @click="addChapter">
          创建第一个章节
        </el-button>
      </div>
    </div>

    <div class="chapter-stats">
      <div class="stat-item">
        <span class="stat-label">总章节</span>
        <span class="stat-value">{{ chapters.length }}</span>
      </div>
      <div class="stat-item">
        <span class="stat-label">总字数</span>
        <span class="stat-value">{{ totalWordCount }}</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Edit, Delete, MoreFilled, Notebook, Document, CopyDocument, Check, Rank } from '@element-plus/icons-vue'

interface Chapter {
  id: string
  title: string
  content: string
  wordCount: number
}

const chapters = ref<Chapter[]>([])
const currentChapterId = ref<string | null>(null)
const dragIndex = ref<number | null>(null)
const dragOverIndex = ref<number | null>(null)

const totalWordCount = computed(() => {
  return chapters.value.reduce((sum, chapter) => sum + chapter.wordCount, 0)
})

onMounted(() => {
  const savedChapters = localStorage.getItem('chapters')
  if (savedChapters) {
    try {
      chapters.value = JSON.parse(savedChapters)
    } catch (e) {
      console.error('加载章节数据失败:', e)
    }
  }

  const savedCurrentChapterId = localStorage.getItem('currentChapterId')
  if (savedCurrentChapterId) {
    currentChapterId.value = savedCurrentChapterId
  }
})

function selectChapter(chapterId: string) {
  currentChapterId.value = chapterId
  localStorage.setItem('currentChapterId', chapterId)

  const chapter = chapters.value.find(c => c.id === chapterId)
  if (chapter) {
    window.dispatchEvent(new CustomEvent('chapter-changed', { detail: chapter }))
  }
}

function addChapter() {
  ElMessageBox.prompt('请输入章节标题', '创建新章节', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    inputValue: `第${chapters.value.length + 1}章`,
    inputPattern: /^.{1,50}$/,
    inputErrorMessage: '标题长度应在1-50个字符之间'
  })
    .then(({ value }) => {
      if (value) {
        const newChapter: Chapter = {
          id: Date.now().toString(),
          title: value,
          content: '',
          wordCount: 0
        }

        chapters.value.push(newChapter)
        saveChapters()
        selectChapter(newChapter.id)
        ElMessage.success('已添加新章节')
      }
    })
    .catch(() => {})
}

function saveChapters() {
  localStorage.setItem('chapters', JSON.stringify(chapters.value))
}

function handleCommand(command: string, chapter: Chapter) {
  switch (command) {
    case 'rename':
      renameChapter(chapter)
      break
    case 'duplicate':
      duplicateChapter(chapter)
      break
    case 'delete':
      deleteChapter(chapter)
      break
  }
}

function renameChapter(chapter: Chapter) {
  ElMessageBox.prompt('请输入新的章节标题', '重命名章节', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    inputValue: chapter.title,
    inputPattern: /^.{1,50}$/,
    inputErrorMessage: '标题长度应在1-50个字符之间'
  })
    .then(({ value }) => {
      if (value) {
        chapter.title = value
        saveChapters()
        ElMessage.success('章节标题已更新')
      }
    })
    .catch(() => {})
}

function duplicateChapter(chapter: Chapter) {
  const newChapter: Chapter = {
    id: Date.now().toString(),
    title: `${chapter.title} (副本)`,
    content: chapter.content,
    wordCount: chapter.wordCount
  }

  const index = chapters.value.findIndex(c => c.id === chapter.id)
  chapters.value.splice(index + 1, 0, newChapter)
  saveChapters()
  ElMessage.success('章节已复制')
}

function deleteChapter(chapter: Chapter) {
  if (chapters.value.length <= 1) {
    ElMessage.warning('至少需要保留一个章节')
    return
  }
  
  ElMessageBox.confirm('确定要删除该章节吗？此操作不可恢复。', '删除确认', {
    confirmButtonText: '确定',
    cancelButtonText: '取消',
    type: 'warning'
  })
    .then(() => {
      const index = chapters.value.findIndex(c => c.id === chapter.id)
      if (index !== -1) {
        chapters.value.splice(index, 1)
        
        if (currentChapterId.value === chapter.id && chapters.value.length > 0) {
          selectChapter(chapters.value[0].id)
        }
        
        saveChapters()
        ElMessage.success('章节已删除')
      }
    })
    .catch(() => {})
}

function getChapterColor(index: number): string {
  const colors = [
    '#667eea',
    '#764ba2',
    '#f093fb',
    '#f5576c',
    '#4facfe',
    '#00f2fe',
    '#43e97b',
    '#38f9d7',
    '#fa709a',
    '#fee140'
  ]
  return colors[index % colors.length]
}

function formatTime(id: string): string {
  const timestamp = parseInt(id)
  if (isNaN(timestamp)) return ''
  
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  
  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return `${Math.floor(diff / 60000)}分钟前`
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}小时前`
  if (diff < 604800000) return `${Math.floor(diff / 86400000)}天前`
  
  return date.toLocaleDateString()
}

function onDragStart(event: DragEvent, index: number) {
  dragIndex.value = index
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move'
    event.dataTransfer.setData('text/plain', String(index))
  }
}

function onDragOver(event: DragEvent, index: number) {
  event.preventDefault()
  if (event.dataTransfer) {
    event.dataTransfer.dropEffect = 'move'
  }
}

function onDragLeave(event: DragEvent, index: number) {
  if (dragOverIndex.value === index) {
    dragOverIndex.value = null
  }
}

function onDrop(event: DragEvent, index: number) {
  event.preventDefault()
  if (dragIndex.value === null || dragIndex.value === index) {
    dragIndex.value = null
    dragOverIndex.value = null
    return
  }

  const fromIndex = dragIndex.value
  const movedChapter = chapters.value[fromIndex]
  chapters.value.splice(fromIndex, 1)
  chapters.value.splice(index, 0, movedChapter)
  saveChapters()
  ElMessage.success('章节顺序已更新')

  dragIndex.value = null
  dragOverIndex.value = null
}

function onDragEnd() {
  dragIndex.value = null
  dragOverIndex.value = null
}

defineExpose({
  saveChapters,
  getCurrentChapter: () => chapters.value.find(c => c.id === currentChapterId.value)
})
</script>

<style scoped>
.chapter-list-container {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: linear-gradient(135deg, #f5f7fa 0%, #e8eef5 100%);
}

.chapter-list-header {
  padding: 20px;
  background: white;
  border-bottom: 1px solid #e4e7ed;
  display: flex;
  justify-content: space-between;
  align-items: center;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.04);
}

.header-title {
  display: flex;
  align-items: center;
  gap: 10px;
}

.title-icon {
  font-size: 20px;
  color: #667eea;
}

.chapter-list-header h3 {
  margin: 0;
  font-size: 18px;
  font-weight: 600;
  color: #303133;
}

.add-btn {
  border-radius: 8px;
  font-weight: 500;
}

.chapter-list-content {
  flex: 1;
  overflow: auto;
  padding: 16px;
}

.chapters-wrapper {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.chapter-card {
  position: relative;
  background: white;
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
  border: 2px solid transparent;
  display: flex;
  align-items: center;
  gap: 16px;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
}

.chapter-card.dragging {
  opacity: 0.5;
  transform: scale(0.95);
}

.chapter-card.drag-over {
  border-color: var(--primary-color, #6366f1);
  box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2);
}

.drag-handle {
  cursor: grab;
  color: var(--text-muted, #9ca3af);
  font-size: 16px;
  padding: 4px;
  border-radius: 4px;
  transition: color 0.2s;
}

.drag-handle:hover {
  color: var(--primary-color, #6366f1);
}

.drag-handle:active {
  cursor: grabbing;
}

.chapter-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.12);
  border-color: var(--card-color);
}

.chapter-card.is-current {
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  border-color: transparent;
  box-shadow: 0 4px 20px rgba(102, 126, 234, 0.4);
}

.chapter-card.is-current .chapter-number,
.chapter-card.is-current .chapter-title,
.chapter-card.is-current .word-count,
.chapter-card.is-current .create-time {
  color: white;
}

.chapter-card.is-current .chapter-number {
  background: rgba(255, 255, 255, 0.2);
}

.chapter-number {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  background: linear-gradient(135deg, var(--card-color), color-mix(in srgb, var(--card-color) 80%, white));
  color: white;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 16px;
  font-weight: 700;
  flex-shrink: 0;
}

.chapter-info {
  flex: 1;
  min-width: 0;
}

.chapter-title {
  font-size: 15px;
  font-weight: 600;
  color: #303133;
  margin-bottom: 6px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.chapter-meta {
  display: flex;
  align-items: center;
  gap: 12px;
  font-size: 12px;
  color: #909399;
}

.word-count {
  display: flex;
  align-items: center;
  gap: 4px;
}

.word-count .el-icon {
  font-size: 14px;
}

.chapter-actions {
  opacity: 0;
  transition: opacity 0.2s;
}

.chapter-card:hover .chapter-actions {
  opacity: 1;
}

.action-btn {
  color: #909399;
  padding: 8px;
  border-radius: 8px;
  transition: all 0.2s;
}

.action-btn:hover {
  background: #f5f7fa;
  color: #606266;
}

.chapter-card.is-current .action-btn {
  color: rgba(255, 255, 255, 0.8);
}

.chapter-card.is-current .action-btn:hover {
  background: rgba(255, 255, 255, 0.2);
  color: white;
}

.current-indicator {
  position: absolute;
  top: 8px;
  right: 8px;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: rgba(255, 255, 255, 0.3);
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 14px;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 60px 20px;
  color: #909399;
}

.empty-icon {
  font-size: 64px;
  margin-bottom: 16px;
  opacity: 0.5;
}

.empty-state p {
  margin: 0 0 20px 0;
  font-size: 14px;
}

.chapter-stats {
  padding: 16px 20px;
  background: white;
  border-top: 1px solid #e4e7ed;
  display: flex;
  justify-content: space-around;
  box-shadow: 0 -2px 8px rgba(0, 0, 0, 0.04);
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 4px;
}

.stat-label {
  font-size: 12px;
  color: #909399;
}

.stat-value {
  font-size: 20px;
  font-weight: 700;
  background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.chapter-list-enter-active,
.chapter-list-leave-active {
  transition: all 0.3s ease;
}

.chapter-list-enter-from {
  opacity: 0;
  transform: translateX(-30px);
}

.chapter-list-leave-to {
  opacity: 0;
  transform: translateX(30px);
}

.chapter-list-move {
  transition: transform 0.3s ease;
}

@media (max-width: 768px) {
  .chapter-list-header {
    padding: 16px;
  }

  .chapter-list-content {
    padding: 12px;
  }

  .chapter-card {
    padding: 12px;
  }

  .chapter-number {
    width: 40px;
    height: 40px;
    font-size: 14px;
  }

  .chapter-title {
    font-size: 14px;
  }
}
</style>
