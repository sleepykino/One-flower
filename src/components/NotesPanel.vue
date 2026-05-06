<template>
  <div class="notes-panel">
    <div class="notes-header">
      <h4>
        <el-icon><Memo /></el-icon>
        写作笔记
      </h4>
      <div class="notes-actions">
        <el-button text size="small" @click="addNote" title="添加笔记">
          <el-icon><Plus /></el-icon>
        </el-button>
        <el-button text size="small" @click="$emit('close')">
          <el-icon><Close /></el-icon>
        </el-button>
      </div>
    </div>

    <div class="notes-filter">
      <el-select v-model="filterType" size="small" placeholder="筛选类型" clearable style="width: 100%;">
        <el-option value="idea" label="💡 灵感" />
        <el-option value="note" label="📝 笔记" />
        <el-option value="todo" label="✅ 待办" />
        <el-option value="question" label="❓ 疑问" />
        <el-option value="revision" label="🔄 修改" />
      </el-select>
    </div>

    <div class="notes-content">
      <transition-group name="note-list" tag="div">
        <div
          v-for="note in filteredNotes"
          :key="note.id"
          class="note-card"
          :class="'type-' + note.type"
        >
          <div class="note-header">
            <span class="note-type-badge">{{ typeIcons[note.type] }}</span>
            <span class="note-time">{{ formatTime(note.updatedAt) }}</span>
            <div class="note-actions">
              <el-button text size="small" @click="editNote(note)">
                <el-icon><Edit /></el-icon>
              </el-button>
              <el-button text size="small" type="danger" @click="deleteNote(note.id)">
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
          </div>
          <div v-if="editingNoteId === note.id" class="note-edit">
            <el-select v-model="editForm.type" size="small" style="width: 100%; margin-bottom: 8px;">
              <el-option value="idea" label="💡 灵感" />
              <el-option value="note" label="📝 笔记" />
              <el-option value="todo" label="✅ 待办" />
              <el-option value="question" label="❓ 疑问" />
              <el-option value="revision" label="🔄 修改" />
            </el-select>
            <el-input
              v-model="editForm.title"
              size="small"
              placeholder="标题（可选）"
              style="margin-bottom: 8px;"
            />
            <el-input
              v-model="editForm.content"
              type="textarea"
              :rows="3"
              size="small"
              placeholder="笔记内容..."
            />
            <div class="note-edit-actions">
              <el-button size="small" @click="cancelEdit">取消</el-button>
              <el-button size="small" type="primary" @click="saveNote">保存</el-button>
            </div>
          </div>
          <div v-else class="note-body">
            <div v-if="note.title" class="note-title">{{ note.title }}</div>
            <div class="note-text">{{ note.content }}</div>
            <div v-if="note.selection" class="note-selection">
              <span class="selection-label">引用文本：</span>
              <span class="selection-text">"{{ note.selection.substring(0, 80) }}{{ note.selection.length > 80 ? '...' : '' }}"</span>
            </div>
          </div>
        </div>
      </transition-group>

      <div v-if="filteredNotes.length === 0" class="notes-empty">
        <el-icon style="font-size: 32px; color: #dcdfe6;"><Memo /></el-icon>
        <p>暂无笔记</p>
        <span>点击 + 添加写作笔记</span>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Memo, Plus, Close, Edit, Delete } from '@element-plus/icons-vue'
import { db, type WritingNote } from '@/database'

const props = defineProps<{
  chapterId: string
}>()

defineEmits<{
  close: []
}>()

const notes = ref<WritingNote[]>([])
const filterType = ref<string>('')
const editingNoteId = ref<string | null>(null)

const editForm = ref({
  type: 'note' as WritingNote['type'],
  title: '',
  content: '',
  selection: ''
})

const typeIcons: Record<string, string> = {
  idea: '💡',
  note: '📝',
  todo: '✅',
  question: '❓',
  revision: '🔄'
}

const filteredNotes = computed(() => {
  if (!filterType.value) return notes.value
  return notes.value.filter((n: WritingNote) => n.type === filterType.value)
})

async function loadNotes() {
  if (!props.chapterId) return
  try {
    const chapterNotes = await db.writingNotes
      .where('chapterId')
      .equals(props.chapterId)
      .sortBy('updatedAt')
    notes.value = chapterNotes.reverse()
  } catch {
    notes.value = []
  }
}

function addNote() {
  editingNoteId.value = 'new'
  editForm.value = {
    type: 'note',
    title: '',
    content: '',
    selection: ''
  }
}

function editNote(note: WritingNote) {
  editingNoteId.value = note.id
  editForm.value = {
    type: note.type,
    title: note.title,
    content: note.content,
    selection: note.selection || ''
  }
}

function cancelEdit() {
  editingNoteId.value = null
}

async function saveNote() {
  if (!editForm.value.content.trim()) {
    ElMessage.warning('请输入笔记内容')
    return
  }

  const now = Date.now()

  if (editingNoteId.value === 'new') {
    const newNote: WritingNote = {
      id: 'note_' + now.toString(36) + Math.random().toString(36).substring(2),
      chapterId: props.chapterId,
      type: editForm.value.type,
      title: editForm.value.title,
      content: editForm.value.content,
      selection: editForm.value.selection || undefined,
      createdAt: now,
      updatedAt: now
    }
    await db.writingNotes.put(newNote)
    notes.value.unshift(newNote)
    ElMessage.success('笔记已添加')
  } else {
    const existing = notes.value.find((n: WritingNote) => n.id === editingNoteId.value)
    if (existing) {
      existing.type = editForm.value.type
      existing.title = editForm.value.title
      existing.content = editForm.value.content
      existing.selection = editForm.value.selection || undefined
      existing.updatedAt = now
      await db.writingNotes.put(existing)
      ElMessage.success('笔记已更新')
    }
  }

  editingNoteId.value = null
}

async function deleteNote(id: string) {
  try {
    await ElMessageBox.confirm('确定删除此笔记？', '确认', {
      confirmButtonText: '删除',
      cancelButtonText: '取消',
      type: 'warning'
    })
    await db.writingNotes.delete(id)
    notes.value = notes.value.filter((n: WritingNote) => n.id !== id)
    ElMessage.success('笔记已删除')
  } catch {
    // cancelled
  }
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const diff = now.getTime() - date.getTime()

  if (diff < 60000) return '刚刚'
  if (diff < 3600000) return Math.floor(diff / 60000) + '分钟前'
  if (diff < 86400000) return Math.floor(diff / 3600000) + '小时前'
  if (diff < 604800000) return Math.floor(diff / 86400000) + '天前'

  return date.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' })
}

watch(() => props.chapterId, () => {
  loadNotes()
})

onMounted(() => {
  loadNotes()
})

defineExpose({
  addNoteWithSelection: (selection: string) => {
    editingNoteId.value = 'new'
    editForm.value = {
      type: 'note',
      title: '',
      content: '',
      selection
    }
  },
  loadNotes
})
</script>

<style scoped>
.notes-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
  background: var(--card-bg, #fff);
  border-left: 1px solid var(--border-color, #e5e7eb);
  width: 280px;
}

.notes-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}

.notes-header h4 {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--text-primary, #1f2937);
  margin: 0;
}

.notes-actions {
  display: flex;
  gap: 4px;
}

.notes-filter {
  padding: 8px 12px;
  border-bottom: 1px solid var(--border-color, #e5e7eb);
}

.notes-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px;
}

.note-card {
  background: var(--bg-secondary, #f3f1ee);
  border-radius: 8px;
  padding: 10px 12px;
  margin-bottom: 8px;
  border-left: 3px solid var(--text-muted, #9ca3af);
  transition: all 0.2s ease;
}

.note-card:hover {
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.08);
}

.note-card.type-idea {
  border-left-color: #f59e0b;
}

.note-card.type-note {
  border-left-color: #6366f1;
}

.note-card.type-todo {
  border-left-color: #10b981;
}

.note-card.type-question {
  border-left-color: #ef4444;
}

.note-card.type-revision {
  border-left-color: #8b5cf6;
}

.note-header {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 6px;
}

.note-type-badge {
  font-size: 14px;
}

.note-time {
  font-size: 11px;
  color: var(--text-muted, #9ca3af);
  flex: 1;
}

.note-actions {
  display: flex;
  gap: 2px;
  opacity: 0;
  transition: opacity 0.2s;
}

.note-card:hover .note-actions {
  opacity: 1;
}

.note-body {
  cursor: default;
}

.note-title {
  font-size: 13px;
  font-weight: 600;
  color: var(--text-primary, #1f2937);
  margin-bottom: 4px;
}

.note-text {
  font-size: 12px;
  color: var(--text-secondary, #6b7280);
  line-height: 1.5;
  white-space: pre-wrap;
  word-break: break-word;
}

.note-selection {
  margin-top: 6px;
  padding: 6px 8px;
  background: rgba(99, 102, 241, 0.06);
  border-radius: 4px;
  font-size: 11px;
}

.selection-label {
  color: var(--primary-color, #6366f1);
  font-weight: 500;
}

.selection-text {
  color: var(--text-secondary, #6b7280);
  font-style: italic;
}

.note-edit {
  padding-top: 4px;
}

.note-edit-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 8px;
}

.notes-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 40px 20px;
  color: var(--text-muted, #9ca3af);
  text-align: center;
}

.notes-empty p {
  margin: 12px 0 4px;
  font-size: 15px;
  color: var(--text-secondary, #6b7280);
}

.notes-empty span {
  font-size: 12px;
}

.note-list-enter-active,
.note-list-leave-active {
  transition: all 0.3s ease;
}

.note-list-enter-from {
  opacity: 0;
  transform: translateX(20px);
}

.note-list-leave-to {
  opacity: 0;
  transform: translateX(-20px);
}
</style>
