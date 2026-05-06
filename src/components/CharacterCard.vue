<template>
  <div class="character-page">
    <div class="page-header">
      <div class="header-title">
        <h2>角色卡管理</h2>
        <p class="subtitle">创建和管理你的小说角色</p>
      </div>
      <div class="header-actions">
        <el-button-group class="view-switcher">
          <el-button 
            :type="activeView === 'cards' ? 'primary' : ''"
            @click="activeView = 'cards'"
          >
            <el-icon><Grid /></el-icon>
            卡片视图
          </el-button>
          <el-button 
            :type="activeView === 'graph' ? 'primary' : ''"
            @click="activeView = 'graph'"
          >
            <el-icon><Share /></el-icon>
            关系图谱
          </el-button>
        </el-button-group>
        <el-button @click="showCollectionDialog" v-if="activeView === 'cards'">
          <el-icon><Folder /></el-icon>
          管理合集
        </el-button>
        <el-button @click="showImportDialog" v-if="activeView === 'cards'">
          <el-icon><Upload /></el-icon>
          导入
        </el-button>
        <el-button type="primary" @click="showAddDialog" v-if="activeView === 'cards'">
          <el-icon><Plus /></el-icon>
          新建角色
        </el-button>
      </div>
    </div>

    <div v-if="activeView === 'cards'" class="cards-view">
      <div class="collection-bar">
      <div 
        class="collection-chip all"
        :class="{ active: selectedCollectionId === null }"
        @click="selectedCollectionId = null"
      >
        <span class="chip-icon">📚</span>
        <span class="chip-name">全部角色</span>
        <span class="chip-count">{{ characterStore.characters.length }}</span>
      </div>
      <div 
        v-for="collection in collectionStore.characterCollections" 
        :key="collection.id"
        class="collection-chip"
        :class="{ active: selectedCollectionId === collection.id }"
        :style="{ '--collection-color': collection.color }"
        @click="selectedCollectionId = collection.id"
      >
        <span class="chip-icon">{{ collection.icon }}</span>
        <span class="chip-name">{{ collection.name }}</span>
        <span class="chip-count">{{ getCollectionCharacterCount(collection.id) }}</span>
      </div>
    </div>

    <div class="characters-grid">
      <transition-group name="card-list">
        <div
          v-for="character in filteredCharacters"
          :key="character.id"
          class="character-card"
          :class="{ disabled: !character.enabled }"
          :style="{ '--card-color': character.color || getCharacterColor(character.name) }"
        >
          <div class="card-header">
            <div class="character-avatar" :style="{ background: getAvatarGradient(character.name) }">
              <span v-if="!character.avatar">{{ character.name.charAt(0) }}</span>
              <img v-else :src="character.avatar" :alt="character.name" />
            </div>
            <div class="card-status">
              <el-switch
                v-model="character.enabled"
                size="small"
                @change="toggleEnabled(character.id)"
              />
            </div>
          </div>

          <div class="card-body">
            <h3 class="character-name">{{ character.name }}</h3>
            <p class="character-desc">{{ character.description || '暂无描述' }}</p>
            
            <div class="character-tags" v-if="character.tags.length > 0">
              <span 
                v-for="tag in character.tags.slice(0, 3)" 
                :key="tag" 
                class="tag"
              >
                {{ tag }}
              </span>
              <span v-if="character.tags.length > 3" class="tag more">
                +{{ character.tags.length - 3 }}
              </span>
            </div>
          </div>

          <div class="card-footer">
            <div class="card-meta">
              <span class="meta-item">
                <el-icon><Calendar /></el-icon>
                {{ formatDate(character.updatedAt) }}
              </span>
            </div>
            <div class="card-actions">
              <el-button text size="small" @click="editCharacter(character)">
                <el-icon><Edit /></el-icon>
              </el-button>
              <el-button text size="small" @click="duplicateCharacter(character.id)">
                <el-icon><CopyDocument /></el-icon>
              </el-button>
              <el-button text size="small" type="danger" @click="confirmDelete(character.id)">
                <el-icon><Delete /></el-icon>
              </el-button>
            </div>
          </div>

          <div class="card-decoration"></div>
        </div>
      </transition-group>

      <div class="add-card" @click="showAddDialog">
        <el-icon class="add-icon"><Plus /></el-icon>
        <span>添加新角色</span>
      </div>
    </div>

    <el-dialog
      v-model="editDialogVisible"
      :title="isEditing ? '编辑角色' : '创建新角色'"
      width="800px"
      :close-on-click-modal="false"
      class="character-dialog"
    >
      <div class="dialog-content" v-if="editForm">
        <div class="form-sidebar">
          <div class="avatar-preview" :style="editForm.avatar ? {} : { background: editForm.name ? getAvatarGradient(editForm.name) : '#e5e7eb' }">
            <img v-if="editForm.avatar" :src="editForm.avatar" :alt="editForm.name" class="avatar-img" />
            <span v-else-if="editForm.name">{{ editForm.name.charAt(0) }}</span>
            <el-icon v-else><User /></el-icon>
          </div>
          <div class="avatar-upload-section">
            <el-button size="small" @click="triggerAvatarUpload">
              <el-icon><Upload /></el-icon>
              上传头像
            </el-button>
            <el-button v-if="editForm.avatar" size="small" type="danger" plain @click="editForm.avatar = ''">
              移除头像
            </el-button>
            <input
              ref="avatarInput"
              type="file"
              accept="image/*"
              style="display: none"
              @change="handleAvatarUpload"
            />
          </div>
          <div class="color-picker-section">
            <label>主题色</label>
            <div class="color-options">
              <div 
                v-for="color in colorOptions" 
                :key="color"
                class="color-option"
                :class="{ active: editForm.color === color }"
                :style="{ background: color }"
                @click="editForm.color = color"
              ></div>
            </div>
          </div>
          <div class="form-section">
            <label>所属合集</label>
            <el-select v-model="editForm.collectionId" placeholder="选择合集" clearable>
              <el-option
                v-for="collection in collectionStore.characterCollections"
                :key="collection.id"
                :label="collection.name"
                :value="collection.id"
              >
                <span>{{ collection.icon }} {{ collection.name }}</span>
              </el-option>
            </el-select>
          </div>
        </div>

        <div class="form-main">
          <el-tabs v-model="activeTab" class="form-tabs">
            <el-tab-pane label="基本信息" name="basic">
              <div class="form-section">
                <label>角色名称 <span class="required">*</span></label>
                <el-input v-model="editForm.name" placeholder="输入角色名称" />
              </div>
              <div class="form-section">
                <label>角色描述</label>
                <el-input
                  v-model="editForm.description"
                  type="textarea"
                  :rows="3"
                  placeholder="简要描述这个角色..."
                />
              </div>
              <div class="form-section">
                <label>头像</label>
                <div class="avatar-input-group">
                  <el-input v-model="editForm.avatar" placeholder="图片URL或上传本地图片" />
                  <el-button size="small" @click="triggerAvatarUpload">
                    <el-icon><Upload /></el-icon>
                  </el-button>
                </div>
                <div v-if="editForm.avatar" class="avatar-preview-inline">
                  <img :src="editForm.avatar" alt="预览" />
                </div>
              </div>
              <div class="form-section">
                <label>标签</label>
                <el-select
                  v-model="editForm.tags"
                  multiple
                  filterable
                  allow-create
                  default-first-option
                  placeholder="添加标签"
                >
                  <el-option
                    v-for="tag in allTags"
                    :key="tag"
                    :label="tag"
                    :value="tag"
                  />
                </el-select>
              </div>
            </el-tab-pane>

            <el-tab-pane label="性格特征" name="personality">
              <div class="form-section">
                <label>性格特点</label>
                <el-input
                  v-model="editForm.personality"
                  type="textarea"
                  :rows="4"
                  placeholder="描述角色的性格特点..."
                />
              </div>
              <div class="form-section">
                <label>说话风格</label>
                <el-input
                  v-model="editForm.speech_style"
                  type="textarea"
                  :rows="3"
                  placeholder="描述角色的说话方式和语言风格..."
                />
              </div>
            </el-tab-pane>

            <el-tab-pane label="背景故事" name="background">
              <div class="form-section">
                <label>外貌描述</label>
                <el-input
                  v-model="editForm.appearance"
                  type="textarea"
                  :rows="3"
                  placeholder="描述角色的外貌特征..."
                />
              </div>
              <div class="form-section">
                <label>背景故事</label>
                <el-input
                  v-model="editForm.background"
                  type="textarea"
                  :rows="5"
                  placeholder="描述角色的背景故事..."
                />
              </div>
            </el-tab-pane>

            <el-tab-pane label="关系备注" name="relations">
              <div class="form-section">
                <label>人物关系</label>
                <el-input
                  v-model="editForm.relationships"
                  type="textarea"
                  :rows="4"
                  placeholder="描述与其他角色的关系..."
                />
              </div>
              <div class="form-section">
                <label>备注</label>
                <el-input
                  v-model="editForm.notes"
                  type="textarea"
                  :rows="4"
                  placeholder="其他备注信息..."
                />
              </div>
            </el-tab-pane>
          </el-tabs>
        </div>
      </div>

      <template #footer>
        <div class="dialog-footer">
          <el-button @click="editDialogVisible = false">取消</el-button>
          <el-button v-if="isEditing" type="danger" plain @click="deleteCharacter">删除角色</el-button>
          <el-button type="primary" @click="saveCharacter">保存</el-button>
        </div>
      </template>
    </el-dialog>

    <el-dialog
      v-model="importDialogVisible"
      title="导入角色"
      width="500px"
    >
      <el-input
        v-model="importData"
        type="textarea"
        :rows="10"
        placeholder="粘贴角色JSON数据..."
      />
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="importCharacters">导入</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="collectionDialogVisible"
      title="合集管理"
      width="600px"
    >
      <div class="collection-manager">
        <div class="collection-list">
          <div 
            v-for="collection in collectionStore.characterCollections" 
            :key="collection.id"
            class="collection-item"
          >
            <div class="collection-info">
              <span class="collection-icon">{{ collection.icon }}</span>
              <span class="collection-name">{{ collection.name }}</span>
              <span class="collection-count">{{ getCollectionCharacterCount(collection.id) }} 个角色</span>
            </div>
            <div class="collection-actions">
              <el-button text size="small" @click="editCollection(collection)">编辑</el-button>
              <el-button text size="small" type="danger" @click="deleteCollection(collection.id)">删除</el-button>
            </div>
          </div>
        </div>
        <el-button class="add-collection-btn" @click="showAddCollectionDialog">
          <el-icon><Plus /></el-icon>
          新建合集
        </el-button>
      </div>
    </el-dialog>

    <el-dialog
      v-model="collectionFormDialogVisible"
      :title="isEditingCollection ? '编辑合集' : '新建合集'"
      width="400px"
    >
      <el-form :model="collectionForm" label-position="top">
        <el-form-item label="合集名称">
          <el-input v-model="collectionForm.name" placeholder="输入合集名称" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="collectionForm.description" type="textarea" :rows="2" placeholder="描述这个合集" />
        </el-form-item>
        <el-form-item label="图标">
          <div class="icon-grid">
            <div 
              v-for="icon in iconOptions" 
              :key="icon"
              class="icon-option"
              :class="{ active: collectionForm.icon === icon }"
              @click="collectionForm.icon = icon"
            >
              {{ icon }}
            </div>
          </div>
        </el-form-item>
        <el-form-item label="颜色">
          <div class="color-grid">
            <div 
              v-for="color in colorOptions" 
              :key="color"
              class="color-option"
              :class="{ active: collectionForm.color === color }"
              :style="{ background: color }"
              @click="collectionForm.color = color"
            ></div>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="collectionFormDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveCollection">保存</el-button>
      </template>
    </el-dialog>
    
    <div v-if="activeView === 'graph'" class="graph-view">
      <RelationshipGraph />
    </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Upload, Folder, Edit, Delete, CopyDocument, Calendar, User, Grid, Share } from '@element-plus/icons-vue'
import { useCharacterStore } from '@/stores/character'
import { useCollectionStore } from '@/stores/collection'
import RelationshipGraph from './RelationshipGraph.vue'
import type { Character, Collection } from '@/types'

const characterStore = useCharacterStore()
const collectionStore = useCollectionStore()

type ViewType = 'cards' | 'graph'
const activeView = ref<ViewType>('cards')
const selectedCollectionId = ref<string | null>(null)
const editDialogVisible = ref(false)
const importDialogVisible = ref(false)
const collectionDialogVisible = ref(false)
const collectionFormDialogVisible = ref(false)
const isEditing = ref(false)
const isEditingCollection = ref(false)
const activeTab = ref('basic')
const importData = ref('')
const editingCollectionId = ref<string | null>(null)
const avatarInput = ref<HTMLInputElement | null>(null)

const editForm = ref<Partial<Character>>({
  name: '',
  description: '',
  personality: '',
  background: '',
  appearance: '',
  speech_style: '',
  relationships: '',
  notes: '',
  avatar: '',
  tags: [],
  enabled: true,
  color: '',
  collectionId: undefined
})

const collectionForm = reactive({
  name: '',
  description: '',
  icon: '📚',
  color: '#6366f1'
})

const colorOptions = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', 
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#BB8FCE', '#85C1E9', '#F8B500', '#6366f1'
]

const iconOptions = [
  '📚', '📖', '📕', '📗', '📘', '📙',
  '✨', '🌟', '💫', '🎭', '🎪', '🎨',
  '👑', '⚔️', '🔮', '🏰', '🌸', '🔥'
]

const allTags = computed(() => {
  const tags = new Set<string>()
  characterStore.characters.forEach(char => {
    char.tags.forEach(tag => tags.add(tag))
  })
  return Array.from(tags)
})

const filteredCharacters = computed(() => {
  if (!selectedCollectionId.value) {
    return characterStore.characters
  }
  return characterStore.characters.filter(c => c.collectionId === selectedCollectionId.value)
})

onMounted(() => {
  characterStore.loadCharactersFromStorage()
  collectionStore.loadCollectionsFromStorage()
})

function getCharacterColor(name: string): string {
  const colors = colorOptions
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

function getAvatarGradient(name: string): string {
  const color = getCharacterColor(name)
  return `linear-gradient(135deg, ${color}, ${adjustColor(color, -20)})`
}

function adjustColor(color: string, amount: number): string {
  const hex = color.replace('#', '')
  const r = Math.max(0, Math.min(255, parseInt(hex.substr(0, 2), 16) + amount))
  const g = Math.max(0, Math.min(255, parseInt(hex.substr(2, 2), 16) + amount))
  const b = Math.max(0, Math.min(255, parseInt(hex.substr(4, 2), 16) + amount))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function formatDate(timestamp: number): string {
  return new Date(timestamp).toLocaleDateString('zh-CN', {
    month: 'short',
    day: 'numeric'
  })
}

function getCollectionCharacterCount(collectionId: string): number {
  return characterStore.characters.filter(c => c.collectionId === collectionId).length
}

function showAddDialog() {
  editForm.value = {
    name: '',
    description: '',
    personality: '',
    background: '',
    appearance: '',
    speech_style: '',
    relationships: '',
    notes: '',
    avatar: '',
    tags: [],
    enabled: true,
    color: '',
    collectionId: selectedCollectionId.value || undefined
  }
  isEditing.value = false
  editDialogVisible.value = true
  activeTab.value = 'basic'
}

function editCharacter(character: Character) {
  editForm.value = { ...character }
  isEditing.value = true
  editDialogVisible.value = true
  activeTab.value = 'basic'
}

function showImportDialog() {
  importData.value = ''
  importDialogVisible.value = true
}

function showCollectionDialog() {
  collectionDialogVisible.value = true
}

function showAddCollectionDialog() {
  collectionForm.name = ''
  collectionForm.description = ''
  collectionForm.icon = '📚'
  collectionForm.color = '#6366f1'
  isEditingCollection.value = false
  editingCollectionId.value = null
  collectionFormDialogVisible.value = true
}

function editCollection(collection: Collection) {
  collectionForm.name = collection.name
  collectionForm.description = collection.description
  collectionForm.icon = collection.icon
  collectionForm.color = collection.color
  isEditingCollection.value = true
  editingCollectionId.value = collection.id
  collectionFormDialogVisible.value = true
}

function saveCharacter() {
  if (!editForm.value.name) {
    ElMessage.warning('请输入角色名称')
    return
  }

  if (isEditing.value && editForm.value.id) {
    characterStore.updateCharacter(editForm.value.id, editForm.value)
    ElMessage.success('角色已更新')
  } else {
    characterStore.addCharacter(editForm.value)
    ElMessage.success('角色已创建')
  }

  editDialogVisible.value = false
}

function deleteCharacter() {
  if (!editForm.value.id) return
  
  ElMessageBox.confirm('确定要删除这个角色吗？', '确认删除', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(() => {
    characterStore.deleteCharacter(editForm.value.id!)
    ElMessage.success('角色已删除')
    editDialogVisible.value = false
  }).catch(() => {})
}

function confirmDelete(id: string) {
  ElMessageBox.confirm('确定要删除这个角色吗？', '确认删除', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(() => {
    characterStore.deleteCharacter(id)
    ElMessage.success('角色已删除')
  }).catch(() => {})
}

function duplicateCharacter(id: string) {
  const duplicated = characterStore.duplicateCharacter(id)
  if (duplicated) {
    ElMessage.success('角色已复制')
  }
}

function toggleEnabled(id: string) {
  characterStore.toggleCharacterEnabled(id)
}

function triggerAvatarUpload() {
  avatarInput.value?.click()
}

function handleAvatarUpload(event: Event) {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  if (!file) return

  if (!file.type.startsWith('image/')) {
    ElMessage.warning('请选择图片文件')
    return
  }

  if (file.size > 2 * 1024 * 1024) {
    ElMessage.warning('图片大小不能超过2MB')
    return
  }

  const reader = new FileReader()
  reader.onload = (e) => {
    const result = e.target?.result as string
    if (result) {
      const canvas = document.createElement('canvas')
      const img = new Image()
      img.onload = () => {
        const maxSize = 256
        let width = img.width
        let height = img.height

        if (width > height) {
          if (width > maxSize) {
            height = Math.round((height * maxSize) / width)
            width = maxSize
          }
        } else {
          if (height > maxSize) {
            width = Math.round((width * maxSize) / height)
            height = maxSize
          }
        }

        canvas.width = width
        canvas.height = height
        const ctx = canvas.getContext('2d')
        if (ctx) {
          ctx.drawImage(img, 0, 0, width, height)
          const compressed = canvas.toDataURL('image/jpeg', 0.8)
          editForm.value.avatar = compressed
        }
      }
      img.src = result
    }
  }
  reader.readAsDataURL(file)

  target.value = ''
}

function importCharacters() {
  if (!importData.value.trim()) {
    ElMessage.warning('请输入角色数据')
    return
  }

  const success = characterStore.importCharacters(importData.value)
  if (success) {
    ElMessage.success('角色导入成功')
    importDialogVisible.value = false
  } else {
    ElMessage.error('角色导入失败，请检查数据格式')
  }
}

function saveCollection() {
  if (!collectionForm.name) {
    ElMessage.warning('请输入合集名称')
    return
  }

  if (isEditingCollection.value && editingCollectionId.value) {
    collectionStore.updateCollection(editingCollectionId.value, {
      name: collectionForm.name,
      description: collectionForm.description,
      icon: collectionForm.icon,
      color: collectionForm.color
    })
    ElMessage.success('合集已更新')
  } else {
    collectionStore.addCollection({
      name: collectionForm.name,
      description: collectionForm.description,
      icon: collectionForm.icon,
      color: collectionForm.color,
      type: 'character'
    })
    ElMessage.success('合集已创建')
  }

  collectionFormDialogVisible.value = false
}

function deleteCollection(id: string) {
  ElMessageBox.confirm('删除合集不会删除其中的角色，确定要删除吗？', '确认删除', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(() => {
    collectionStore.deleteCollection(id)
    if (selectedCollectionId.value === id) {
      selectedCollectionId.value = null
    }
    ElMessage.success('合集已删除')
  }).catch(() => {})
}
</script>

<style scoped>
.character-page {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.page-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 24px;
}

.header-title h2 {
  font-family: 'Noto Serif SC', serif;
  font-size: 28px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.subtitle {
  color: var(--text-secondary);
  font-size: 14px;
}

.header-actions {
  display: flex;
  gap: 12px;
  align-items: center;
}

.view-switcher {
  margin-right: 12px;
}

.cards-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.graph-view {
  flex: 1;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.collection-bar {
  display: flex;
  gap: 12px;
  margin-bottom: 24px;
  flex-wrap: wrap;
}

.collection-chip {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  background: var(--card-bg);
  border-radius: 24px;
  cursor: pointer;
  transition: all 0.3s ease;
  border: 2px solid var(--border-color);
  font-size: 14px;
}

.collection-chip:hover {
  border-color: var(--primary-light);
  transform: translateY(-2px);
}

.collection-chip.active {
  border-color: var(--primary-color);
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.1), rgba(244, 114, 182, 0.1));
}

.collection-chip:not(.all) {
  border-color: var(--collection-color, var(--border-color));
}

.collection-chip:not(.all).active {
  background: linear-gradient(135deg, 
    color-mix(in srgb, var(--collection-color) 10%, transparent),
    color-mix(in srgb, var(--collection-color) 5%, transparent)
  );
}

.chip-icon {
  font-size: 16px;
}

.chip-name {
  font-weight: 500;
  color: var(--text-primary);
}

.chip-count {
  background: var(--bg-secondary);
  padding: 2px 8px;
  border-radius: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

.characters-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 20px;
  flex: 1;
  overflow-y: auto;
  padding-bottom: 20px;
}

.character-card {
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  padding: 20px;
  position: relative;
  overflow: hidden;
  transition: all 0.3s ease;
  border: 1px solid var(--border-color);
}

.character-card:hover {
  transform: translateY(-4px);
  box-shadow: var(--shadow-lg);
}

.character-card.disabled {
  opacity: 0.6;
}

.card-decoration {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 4px;
  background: linear-gradient(90deg, var(--card-color), transparent);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  margin-bottom: 16px;
}

.character-avatar {
  width: 56px;
  height: 56px;
  border-radius: 16px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 24px;
  font-weight: 600;
  overflow: hidden;
}

.character-avatar img {
  width: 100%;
  height: 100%;
  object-fit: cover;
}

.card-body {
  margin-bottom: 16px;
}

.character-name {
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 8px;
}

.character-desc {
  font-size: 14px;
  color: var(--text-secondary);
  line-height: 1.5;
  margin-bottom: 12px;
  display: -webkit-box;
  line-clamp: 2;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
}

.character-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.tag {
  background: var(--bg-secondary);
  padding: 4px 10px;
  border-radius: 12px;
  font-size: 12px;
  color: var(--text-secondary);
}

.tag.more {
  background: var(--primary-light);
  color: white;
}

.card-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 12px;
  border-top: 1px solid var(--border-color);
}

.card-meta {
  display: flex;
  gap: 12px;
}

.meta-item {
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  color: var(--text-muted);
}

.card-actions {
  display: flex;
  gap: 4px;
}

.add-card {
  background: var(--bg-secondary);
  border: 2px dashed var(--border-color);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 12px;
  cursor: pointer;
  transition: all 0.3s ease;
  min-height: 200px;
}

.add-card:hover {
  border-color: var(--primary-light);
  background: rgba(99, 102, 241, 0.05);
}

.add-icon {
  font-size: 32px;
  color: var(--text-muted);
}

.add-card span {
  color: var(--text-secondary);
  font-size: 14px;
}

.card-list-enter-active,
.card-list-leave-active {
  transition: all 0.3s ease;
}

.card-list-enter-from,
.card-list-leave-to {
  opacity: 0;
  transform: translateY(20px);
}

.dialog-content {
  display: flex;
  gap: 24px;
}

.form-sidebar {
  width: 200px;
  flex-shrink: 0;
}

.avatar-preview {
  width: 120px;
  height: 120px;
  border-radius: 24px;
  display: flex;
  align-items: center;
  justify-content: center;
  color: white;
  font-size: 48px;
  font-weight: 600;
  margin: 0 auto 12px;
  overflow: hidden;
}

.avatar-preview .avatar-img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  border-radius: 24px;
}

.avatar-upload-section {
  display: flex;
  gap: 8px;
  justify-content: center;
  margin-bottom: 16px;
}

.avatar-input-group {
  display: flex;
  gap: 8px;
}

.avatar-input-group .el-input {
  flex: 1;
}

.avatar-preview-inline {
  margin-top: 8px;
  text-align: center;
}

.avatar-preview-inline img {
  max-width: 120px;
  max-height: 120px;
  border-radius: 12px;
  object-fit: cover;
}

.color-picker-section {
  margin-bottom: 20px;
}

.color-picker-section label,
.form-section label {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--text-secondary);
  margin-bottom: 8px;
}

.required {
  color: #f56c6c;
}

.color-options,
.color-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.color-option {
  width: 28px;
  height: 28px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
  border: 2px solid transparent;
}

.color-option:hover {
  transform: scale(1.1);
}

.color-option.active {
  border-color: var(--text-primary);
  box-shadow: 0 0 0 2px white, 0 0 0 4px var(--text-primary);
}

.form-main {
  flex: 1;
}

.form-tabs {
  height: 100%;
}

.form-section {
  margin-bottom: 20px;
}

.icon-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
}

.icon-option {
  width: 40px;
  height: 40px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
  border-radius: 8px;
  cursor: pointer;
  font-size: 20px;
  transition: all 0.2s ease;
  border: 2px solid transparent;
}

.icon-option:hover {
  background: var(--bg-color);
}

.icon-option.active {
  border-color: var(--primary-color);
  background: rgba(99, 102, 241, 0.1);
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
  gap: 12px;
}

.collection-manager {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.collection-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.collection-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 16px;
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
}

.collection-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.collection-icon {
  font-size: 24px;
}

.collection-name {
  font-weight: 500;
  color: var(--text-primary);
}

.collection-count {
  font-size: 13px;
  color: var(--text-secondary);
}

.collection-actions {
  display: flex;
  gap: 8px;
}

.add-collection-btn {
  width: 100%;
}
</style>
