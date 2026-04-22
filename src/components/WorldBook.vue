<template>
  <div class="worldbook-page">
    <div class="page-header">
      <div class="header-title">
        <h2>世界书管理</h2>
        <p class="subtitle">创建和管理你的世界观设定</p>
      </div>
      <div class="header-actions">
        <el-button @click="showCollectionDialog">
          <el-icon><Folder /></el-icon>
          管理合集
        </el-button>
        <el-button @click="showImportDialog">
          <el-icon><Upload /></el-icon>
          导入
        </el-button>
        <el-button type="primary" @click="showAddWorldBookDialog">
          <el-icon><Plus /></el-icon>
          新建世界书
        </el-button>
      </div>
    </div>

    <div class="collection-bar">
      <div 
        class="collection-chip all"
        :class="{ active: selectedCollectionId === null }"
        @click="selectedCollectionId = null"
      >
        <span class="chip-icon">🌍</span>
        <span class="chip-name">全部世界书</span>
        <span class="chip-count">{{ worldBookStore.worldBooks.length }}</span>
      </div>
      <div 
        v-for="collection in collectionStore.worldbookCollections" 
        :key="collection.id"
        class="collection-chip"
        :class="{ active: selectedCollectionId === collection.id }"
        :style="{ '--collection-color': collection.color }"
        @click="selectedCollectionId = collection.id"
      >
        <span class="chip-icon">{{ collection.icon }}</span>
        <span class="chip-name">{{ collection.name }}</span>
        <span class="chip-count">{{ getCollectionWorldBookCount(collection.id) }}</span>
      </div>
    </div>

    <div class="worldbooks-container">
      <div class="worldbooks-grid">
        <transition-group name="card-list">
          <div
            v-for="worldBook in filteredWorldBooks"
            :key="worldBook.id"
            class="worldbook-card"
            :class="{ disabled: !worldBook.enabled, expanded: expandedWorldBookId === worldBook.id }"
            :style="{ '--card-color': worldBook.color || getWorldBookColor(worldBook.name) }"
          >
            <div class="card-header" @click="toggleExpand(worldBook.id)">
              <div class="worldbook-icon" :style="{ background: getIconGradient(worldBook.name) }">
                <span>{{ worldBook.icon || '📖' }}</span>
              </div>
              <div class="worldbook-info">
                <h3 class="worldbook-name">{{ worldBook.name }}</h3>
                <p class="worldbook-desc">{{ worldBook.description || '暂无描述' }}</p>
              </div>
              <div class="card-controls">
                <el-switch
                  v-model="worldBook.enabled"
                  size="small"
                  @click.stop
                  @change="toggleWorldBookEnabled(worldBook.id)"
                />
                <el-icon class="expand-icon" :class="{ rotated: expandedWorldBookId === worldBook.id }">
                  <ArrowDown />
                </el-icon>
              </div>
            </div>

            <div class="card-stats">
              <div class="stat-item">
                <span class="stat-value">{{ worldBook.groups.length }}</span>
                <span class="stat-label">分组</span>
              </div>
              <div class="stat-item">
                <span class="stat-value">{{ getTotalEntries(worldBook) }}</span>
                <span class="stat-label">条目</span>
              </div>
              <div class="stat-item">
                <span class="stat-value">{{ worldBook.scan_depth }}</span>
                <span class="stat-label">扫描深度</span>
              </div>
            </div>

            <transition name="expand">
              <div v-if="expandedWorldBookId === worldBook.id" class="card-expanded">
                <div class="expanded-toolbar">
                  <el-button size="small" @click="editWorldBook(worldBook)">
                    <el-icon><Edit /></el-icon>
                    编辑
                  </el-button>
                  <el-button size="small" @click="exportWorldBook(worldBook)">
                    <el-icon><Download /></el-icon>
                    导出
                  </el-button>
                  <el-button size="small" type="danger" @click="confirmDeleteWorldBook(worldBook.id)">
                    <el-icon><Delete /></el-icon>
                    删除
                  </el-button>
                </div>

                <div class="groups-section">
                  <div class="section-header">
                    <h4>分组管理</h4>
                    <el-button size="small" type="primary" @click="showAddGroupDialog(worldBook.id)">
                      <el-icon><Plus /></el-icon>
                      添加分组
                    </el-button>
                  </div>

                  <div class="groups-list">
                    <div 
                      v-for="group in worldBook.groups" 
                      :key="group.id"
                      class="group-card"
                    >
                      <div class="group-header" @click="toggleGroupExpand(group.id)">
                        <div class="group-info">
                          <span class="group-name">{{ group.name }}</span>
                          <el-tag size="small" type="info">{{ group.entries.length }} 条</el-tag>
                        </div>
                        <el-icon class="expand-icon" :class="{ rotated: expandedGroupIds.includes(group.id) }">
                          <ArrowDown />
                        </el-icon>
                      </div>

                      <transition name="expand">
                        <div v-if="expandedGroupIds.includes(group.id)" class="group-content">
                          <div class="group-actions">
                            <el-button size="small" @click="showAddEntryDialog(worldBook.id, group.id)">
                              添加条目
                            </el-button>
                            <el-button size="small" @click="editGroup(worldBook.id, group)">编辑</el-button>
                            <el-button size="small" type="danger" @click="deleteGroup(worldBook.id, group.id)">删除</el-button>
                          </div>

                          <div class="entries-grid">
                            <div 
                              v-for="entry in group.entries" 
                              :key="entry.id"
                              class="entry-card"
                              :class="{ disabled: !entry.enabled }"
                            >
                              <div class="entry-header">
                                <span class="entry-key">{{ entry.key }}</span>
                                <el-switch
                                  v-model="entry.enabled"
                                  size="small"
                                  @change="toggleEntryEnabled(worldBook.id, group.id, entry.id)"
                                />
                              </div>
                              <div class="entry-keywords">
                                <span 
                                  v-for="keyword in entry.keywords.slice(0, 4)" 
                                  :key="keyword" 
                                  class="keyword-tag"
                                >
                                  {{ keyword }}
                                </span>
                                <span v-if="entry.keywords.length > 4" class="keyword-tag more">
                                  +{{ entry.keywords.length - 4 }}
                                </span>
                              </div>
                              <div class="entry-content">{{ entry.content }}</div>
                              <div class="entry-footer">
                                <span class="entry-priority">优先级: {{ entry.priority }}</span>
                                <div class="entry-actions">
                                  <el-button text size="small" @click="editEntry(worldBook.id, group, entry)">编辑</el-button>
                                  <el-button text size="small" type="danger" @click="deleteEntry(worldBook.id, group.id, entry.id)">删除</el-button>
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </transition>
                    </div>
                  </div>
                </div>
              </div>
            </transition>

            <div class="card-decoration"></div>
          </div>
        </transition-group>

        <div class="add-card" @click="showAddWorldBookDialog">
          <el-icon class="add-icon"><Plus /></el-icon>
          <span>创建新世界书</span>
        </div>
      </div>
    </div>

    <el-dialog
      v-model="worldBookDialogVisible"
      :title="isEditingWorldBook ? '编辑世界书' : '创建新世界书'"
      width="600px"
      :close-on-click-modal="false"
    >
      <div class="dialog-content" v-if="worldBookForm">
        <div class="form-sidebar">
          <div class="icon-preview" :style="{ background: worldBookForm.name ? getIconGradient(worldBookForm.name) : '#e5e7eb' }">
            <span>{{ worldBookForm.icon || '📖' }}</span>
          </div>
          <div class="form-section">
            <label>图标</label>
            <div class="icon-grid-small">
              <div 
                v-for="icon in iconOptions" 
                :key="icon"
                class="icon-option"
                :class="{ active: worldBookForm.icon === icon }"
                @click="worldBookForm.icon = icon"
              >
                {{ icon }}
              </div>
            </div>
          </div>
          <div class="form-section">
            <label>主题色</label>
            <div class="color-options">
              <div 
                v-for="color in colorOptions" 
                :key="color"
                class="color-option"
                :class="{ active: worldBookForm.color === color }"
                :style="{ background: color }"
                @click="worldBookForm.color = color"
              ></div>
            </div>
          </div>
          <div class="form-section">
            <label>所属合集</label>
            <el-select v-model="worldBookForm.collectionId" placeholder="选择合集" clearable size="small">
              <el-option
                v-for="collection in collectionStore.worldbookCollections"
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
          <div class="form-section">
            <label>名称 <span class="required">*</span></label>
            <el-input v-model="worldBookForm.name" placeholder="输入世界书名称" />
          </div>
          <div class="form-section">
            <label>描述</label>
            <el-input v-model="worldBookForm.description" type="textarea" :rows="2" placeholder="描述这个世界书..." />
          </div>
          <div class="form-row">
            <div class="form-section half">
              <label>扫描深度</label>
              <el-input-number v-model="worldBookForm.scan_depth" :min="1" :max="10" size="small" />
            </div>
            <div class="form-section half">
              <label>令牌预算</label>
              <el-input-number v-model="worldBookForm.token_budget" :min="100" :max="10000" :step="100" size="small" />
            </div>
          </div>
          <div class="form-section">
            <label>递归扫描</label>
            <el-switch v-model="worldBookForm.recursive_scanning" />
          </div>
        </div>
      </div>

      <template #footer>
        <el-button @click="worldBookDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveWorldBook">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="groupDialogVisible"
      :title="isEditingGroup ? '编辑分组' : '添加分组'"
      width="400px"
    >
      <el-form :model="groupForm" label-position="top">
        <el-form-item label="分组名称">
          <el-input v-model="groupForm.name" placeholder="输入分组名称" />
        </el-form-item>
        <el-form-item label="描述">
          <el-input v-model="groupForm.description" type="textarea" :rows="2" placeholder="描述这个分组" />
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="groupDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveGroup">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog
      v-model="entryDialogVisible"
      :title="isEditingEntry ? '编辑条目' : '添加条目'"
      width="650px"
    >
      <el-form :model="entryForm" label-position="top">
        <div class="form-row">
          <div class="form-section half">
            <el-form-item label="键名">
              <el-input v-model="entryForm.key" placeholder="条目的唯一标识" />
            </el-form-item>
          </div>
          <div class="form-section half">
            <el-form-item label="优先级">
              <el-input-number v-model="entryForm.priority" :min="1" :max="100" size="small" style="width: 100%" />
            </el-form-item>
          </div>
        </div>
        <el-form-item label="关键词">
          <el-select
            v-model="entryForm.keywords"
            multiple
            filterable
            allow-create
            default-first-option
            placeholder="触发关键词（支持多个）"
            style="width: 100%"
          />
        </el-form-item>
        <el-form-item label="内容">
          <el-input v-model="entryForm.content" type="textarea" :rows="4" placeholder="条目内容" />
        </el-form-item>
        <div class="form-row">
          <div class="form-section half">
            <el-form-item label="插入位置">
              <el-select v-model="entryForm.position" style="width: 100%">
                <el-option label="角色前" value="before_char" />
                <el-option label="角色后" value="after_char" />
                <el-option label="示例前" value="before_example" />
                <el-option label="示例后" value="after_example" />
              </el-select>
            </el-form-item>
          </div>
          <div class="form-section half">
            <el-form-item label="插入顺序">
              <el-input-number v-model="entryForm.insertion_order" :min="1" :max="1000" size="small" style="width: 100%" />
            </el-form-item>
          </div>
        </div>
        <div class="form-row">
          <div class="form-section half">
            <el-form-item label="区分大小写">
              <el-switch v-model="entryForm.case_sensitive" />
            </el-form-item>
          </div>
          <div class="form-section half">
            <el-form-item label="使用正则">
              <el-switch v-model="entryForm.use_regex" />
            </el-form-item>
          </div>
        </div>
      </el-form>
      <template #footer>
        <el-button @click="entryDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="saveEntry">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="importDialogVisible" title="导入世界书" width="500px">
      <el-input
        v-model="importData"
        type="textarea"
        :rows="10"
        placeholder="粘贴世界书JSON数据..."
      />
      <template #footer>
        <el-button @click="importDialogVisible = false">取消</el-button>
        <el-button type="primary" @click="importWorldBook">导入</el-button>
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
            v-for="collection in collectionStore.worldbookCollections" 
            :key="collection.id"
            class="collection-item"
          >
            <div class="collection-info">
              <span class="collection-icon">{{ collection.icon }}</span>
              <span class="collection-name">{{ collection.name }}</span>
              <span class="collection-count">{{ getCollectionWorldBookCount(collection.id) }} 个世界书</span>
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
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, reactive } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Plus, Upload, Folder, Edit, Delete, Download, ArrowDown } from '@element-plus/icons-vue'
import { useWorldBookStore } from '@/stores/worldBook'
import { useCollectionStore } from '@/stores/collection'
import type { WorldBook, WorldBookGroup, WorldBookEntry, Collection } from '@/types'

const worldBookStore = useWorldBookStore()
const collectionStore = useCollectionStore()

const selectedCollectionId = ref<string | null>(null)
const expandedWorldBookId = ref<string | null>(null)
const expandedGroupIds = ref<string[]>([])

const worldBookDialogVisible = ref(false)
const groupDialogVisible = ref(false)
const entryDialogVisible = ref(false)
const importDialogVisible = ref(false)
const collectionDialogVisible = ref(false)
const collectionFormDialogVisible = ref(false)

const isEditingWorldBook = ref(false)
const isEditingGroup = ref(false)
const isEditingEntry = ref(false)
const isEditingCollection = ref(false)

const currentWorldBookId = ref<string | null>(null)
const currentGroupId = ref<string | null>(null)
const currentEntryId = ref<string | null>(null)
const editingCollectionId = ref<string | null>(null)
const importData = ref('')

const worldBookForm = ref<Partial<WorldBook>>({
  name: '',
  description: '',
  scan_depth: 2,
  token_budget: 2048,
  recursive_scanning: false,
  enabled: true,
  icon: '📖',
  color: '',
  collectionId: undefined
})

const groupForm = ref<Partial<WorldBookGroup>>({
  name: '',
  description: '',
  enabled: true
})

const entryForm = ref<Partial<WorldBookEntry>>({
  key: '',
  keywords: [],
  content: '',
  enabled: true,
  priority: 10,
  insertion_order: 100,
  position: 'before_char',
  case_sensitive: false,
  use_regex: false,
  tags: []
})

const collectionForm = reactive({
  name: '',
  description: '',
  icon: '🌍',
  color: '#6366f1'
})

const colorOptions = [
  '#FF6B6B', '#4ECDC4', '#45B7D1', '#96CEB4', 
  '#FFEAA7', '#DDA0DD', '#98D8C8', '#F7DC6F',
  '#BB8FCE', '#85C1E9', '#F8B500', '#6366f1'
]

const iconOptions = [
  '🌍', '🗺️', '🏰', '⚔️', '🔮', '📜',
  '📚', '📖', '📕', '✨', '🌟', '💫',
  '🎭', '🎪', '🎨', '👑', '🌸', '🔥'
]

const filteredWorldBooks = computed(() => {
  if (!selectedCollectionId.value) {
    return worldBookStore.worldBooks
  }
  return worldBookStore.worldBooks.filter(wb => wb.collectionId === selectedCollectionId.value)
})

onMounted(() => {
  worldBookStore.loadWorldBooksFromStorage()
  collectionStore.loadCollectionsFromStorage()
})

function getWorldBookColor(name: string): string {
  const colors = colorOptions
  let hash = 0
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash)
  }
  return colors[Math.abs(hash) % colors.length]
}

function getIconGradient(name: string): string {
  const color = getWorldBookColor(name)
  return `linear-gradient(135deg, ${color}, ${adjustColor(color, -20)})`
}

function adjustColor(color: string, amount: number): string {
  const hex = color.replace('#', '')
  const r = Math.max(0, Math.min(255, parseInt(hex.substr(0, 2), 16) + amount))
  const g = Math.max(0, Math.min(255, parseInt(hex.substr(2, 2), 16) + amount))
  const b = Math.max(0, Math.min(255, parseInt(hex.substr(4, 2), 16) + amount))
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`
}

function getTotalEntries(worldBook: WorldBook): number {
  return worldBook.groups.reduce((sum, group) => sum + group.entries.length, 0)
}

function getCollectionWorldBookCount(collectionId: string): number {
  return worldBookStore.worldBooks.filter(wb => wb.collectionId === collectionId).length
}

function toggleExpand(id: string) {
  expandedWorldBookId.value = expandedWorldBookId.value === id ? null : id
}

function toggleGroupExpand(id: string) {
  const index = expandedGroupIds.value.indexOf(id)
  if (index === -1) {
    expandedGroupIds.value.push(id)
  } else {
    expandedGroupIds.value.splice(index, 1)
  }
}

function showAddWorldBookDialog() {
  worldBookForm.value = {
    name: '',
    description: '',
    scan_depth: 2,
    token_budget: 2048,
    recursive_scanning: false,
    enabled: true,
    icon: '📖',
    color: '',
    collectionId: selectedCollectionId.value || undefined
  }
  isEditingWorldBook.value = false
  worldBookDialogVisible.value = true
}

function editWorldBook(worldBook: WorldBook) {
  worldBookForm.value = { ...worldBook }
  currentWorldBookId.value = worldBook.id
  isEditingWorldBook.value = true
  worldBookDialogVisible.value = true
}

function saveWorldBook() {
  if (!worldBookForm.value.name) {
    ElMessage.warning('请输入世界书名称')
    return
  }

  if (isEditingWorldBook.value && currentWorldBookId.value) {
    worldBookStore.updateWorldBook(currentWorldBookId.value, worldBookForm.value)
    ElMessage.success('世界书已更新')
  } else {
    const newWorldBook = worldBookStore.addWorldBook(worldBookForm.value)
    expandedWorldBookId.value = newWorldBook.id
    ElMessage.success('世界书已创建')
  }

  worldBookDialogVisible.value = false
  currentWorldBookId.value = null
}

function confirmDeleteWorldBook(id: string) {
  ElMessageBox.confirm('确定要删除这个世界书吗？', '确认删除', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(() => {
    worldBookStore.deleteWorldBook(id)
    if (expandedWorldBookId.value === id) {
      expandedWorldBookId.value = null
    }
    ElMessage.success('世界书已删除')
  }).catch(() => {})
}

function toggleWorldBookEnabled(id: string) {
  worldBookStore.updateWorldBook(id, {})
}

function exportWorldBook(worldBook: WorldBook) {
  const data = JSON.stringify(worldBook, null, 2)
  navigator.clipboard.writeText(data).then(() => {
    ElMessage.success('世界书已复制到剪贴板')
  }).catch(() => {
    ElMessage.error('复制失败')
  })
}

function showAddGroupDialog(worldBookId: string) {
  currentWorldBookId.value = worldBookId
  groupForm.value = {
    name: '',
    description: '',
    enabled: true
  }
  isEditingGroup.value = false
  groupDialogVisible.value = true
}

function editGroup(worldBookId: string, group: WorldBookGroup) {
  currentWorldBookId.value = worldBookId
  currentGroupId.value = group.id
  groupForm.value = { ...group }
  isEditingGroup.value = true
  groupDialogVisible.value = true
}

function saveGroup() {
  if (!groupForm.value.name) {
    ElMessage.warning('请输入分组名称')
    return
  }

  if (!currentWorldBookId.value) return

  if (isEditingGroup.value && currentGroupId.value) {
    worldBookStore.updateGroup(currentWorldBookId.value, currentGroupId.value, groupForm.value)
    ElMessage.success('分组已更新')
  } else {
    worldBookStore.addGroup(currentWorldBookId.value, groupForm.value)
    ElMessage.success('分组已添加')
  }

  groupDialogVisible.value = false
  currentGroupId.value = null
}

function deleteGroup(worldBookId: string, groupId: string) {
  ElMessageBox.confirm('确定要删除这个分组吗？', '确认删除', {
    confirmButtonText: '删除',
    cancelButtonText: '取消',
    type: 'warning'
  }).then(() => {
    worldBookStore.deleteGroup(worldBookId, groupId)
    const index = expandedGroupIds.value.indexOf(groupId)
    if (index !== -1) {
      expandedGroupIds.value.splice(index, 1)
    }
    ElMessage.success('分组已删除')
  }).catch(() => {})
}

function showAddEntryDialog(worldBookId: string, groupId: string) {
  currentWorldBookId.value = worldBookId
  currentGroupId.value = groupId
  entryForm.value = {
    key: '',
    keywords: [],
    content: '',
    enabled: true,
    priority: 10,
    insertion_order: 100,
    position: 'before_char',
    case_sensitive: false,
    use_regex: false,
    tags: []
  }
  isEditingEntry.value = false
  entryDialogVisible.value = true
}

function editEntry(worldBookId: string, group: WorldBookGroup, entry: WorldBookEntry) {
  currentWorldBookId.value = worldBookId
  currentGroupId.value = group.id
  currentEntryId.value = entry.id
  entryForm.value = { ...entry }
  isEditingEntry.value = true
  entryDialogVisible.value = true
}

function saveEntry() {
  if (!entryForm.value.key) {
    ElMessage.warning('请输入键名')
    return
  }

  if (!entryForm.value.keywords || entryForm.value.keywords.length === 0) {
    ElMessage.warning('请输入至少一个关键词')
    return
  }

  if (!currentWorldBookId.value || !currentGroupId.value) return

  if (isEditingEntry.value && currentEntryId.value) {
    worldBookStore.updateEntry(currentWorldBookId.value, currentGroupId.value, currentEntryId.value, entryForm.value)
    ElMessage.success('条目已更新')
  } else {
    worldBookStore.addEntry(currentWorldBookId.value, currentGroupId.value, entryForm.value)
    ElMessage.success('条目已添加')
  }

  entryDialogVisible.value = false
  currentEntryId.value = null
}

function deleteEntry(worldBookId: string, groupId: string, entryId: string) {
  worldBookStore.deleteEntry(worldBookId, groupId, entryId)
  ElMessage.success('条目已删除')
}

function toggleEntryEnabled(worldBookId: string, groupId: string, entryId: string) {
  worldBookStore.updateEntry(worldBookId, groupId, entryId, {})
}

function showImportDialog() {
  importData.value = ''
  importDialogVisible.value = true
}

function importWorldBook() {
  if (!importData.value.trim()) {
    ElMessage.warning('请输入世界书数据')
    return
  }

  const success = worldBookStore.importWorldBook(importData.value)
  if (success) {
    ElMessage.success('世界书导入成功')
    importDialogVisible.value = false
  } else {
    ElMessage.error('世界书导入失败，请检查数据格式')
  }
}

function showCollectionDialog() {
  collectionDialogVisible.value = true
}

function showAddCollectionDialog() {
  collectionForm.name = ''
  collectionForm.description = ''
  collectionForm.icon = '🌍'
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
      type: 'worldbook'
    })
    ElMessage.success('合集已创建')
  }

  collectionFormDialogVisible.value = false
}

function deleteCollection(id: string) {
  ElMessageBox.confirm('删除合集不会删除其中的世界书，确定要删除吗？', '确认删除', {
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
.worldbook-page {
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

.worldbooks-container {
  flex: 1;
  overflow-y: auto;
}

.worldbooks-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(400px, 1fr));
  gap: 20px;
  padding-bottom: 20px;
}

.worldbook-card {
  background: var(--card-bg);
  border-radius: var(--radius-lg);
  overflow: hidden;
  transition: all 0.3s ease;
  border: 1px solid var(--border-color);
  position: relative;
}

.worldbook-card:hover {
  box-shadow: var(--shadow-md);
}

.worldbook-card.disabled {
  opacity: 0.6;
}

.worldbook-card.expanded {
  grid-column: 1 / -1;
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
  align-items: center;
  gap: 16px;
  padding: 20px;
  cursor: pointer;
}

.worldbook-icon {
  width: 48px;
  height: 48px;
  border-radius: 12px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  flex-shrink: 0;
}

.worldbook-info {
  flex: 1;
  min-width: 0;
}

.worldbook-name {
  font-size: 16px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 4px;
}

.worldbook-desc {
  font-size: 13px;
  color: var(--text-secondary);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.card-controls {
  display: flex;
  align-items: center;
  gap: 12px;
}

.expand-icon {
  transition: transform 0.3s ease;
  color: var(--text-muted);
}

.expand-icon.rotated {
  transform: rotate(180deg);
}

.card-stats {
  display: flex;
  gap: 24px;
  padding: 0 20px 16px;
  border-bottom: 1px solid var(--border-color);
}

.stat-item {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.stat-value {
  font-size: 20px;
  font-weight: 600;
  color: var(--text-primary);
}

.stat-label {
  font-size: 12px;
  color: var(--text-muted);
}

.card-expanded {
  padding: 20px;
}

.expanded-toolbar {
  display: flex;
  gap: 12px;
  margin-bottom: 20px;
}

.groups-section {
  background: var(--bg-secondary);
  border-radius: var(--radius-md);
  padding: 16px;
}

.section-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 16px;
}

.section-header h4 {
  font-size: 15px;
  font-weight: 600;
  color: var(--text-primary);
}

.groups-list {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.group-card {
  background: var(--card-bg);
  border-radius: var(--radius-md);
  overflow: hidden;
}

.group-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 16px;
  cursor: pointer;
}

.group-info {
  display: flex;
  align-items: center;
  gap: 12px;
}

.group-name {
  font-weight: 500;
  color: var(--text-primary);
}

.group-content {
  padding: 0 16px 16px;
}

.group-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 12px;
}

.entries-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(250px, 1fr));
  gap: 12px;
}

.entry-card {
  background: var(--bg-secondary);
  border-radius: var(--radius-sm);
  padding: 12px;
  transition: all 0.2s ease;
}

.entry-card:hover {
  background: var(--bg-color);
}

.entry-card.disabled {
  opacity: 0.5;
}

.entry-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-bottom: 8px;
}

.entry-key {
  font-weight: 600;
  color: var(--text-primary);
  font-size: 14px;
}

.entry-keywords {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 8px;
}

.keyword-tag {
  background: var(--card-bg);
  padding: 2px 8px;
  border-radius: 10px;
  font-size: 11px;
  color: var(--text-secondary);
}

.keyword-tag.more {
  background: var(--primary-light);
  color: white;
}

.entry-content {
  font-size: 12px;
  color: var(--text-secondary);
  line-height: 1.5;
  max-height: 48px;
  overflow: hidden;
  margin-bottom: 8px;
}

.entry-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding-top: 8px;
  border-top: 1px solid var(--border-color);
}

.entry-priority {
  font-size: 11px;
  color: var(--text-muted);
}

.entry-actions {
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
  min-height: 150px;
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

.expand-enter-active,
.expand-leave-active {
  transition: all 0.3s ease;
  overflow: hidden;
}

.expand-enter-from,
.expand-leave-to {
  opacity: 0;
  max-height: 0;
}

.expand-enter-to,
.expand-leave-from {
  max-height: 2000px;
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
  width: 180px;
  flex-shrink: 0;
}

.icon-preview {
  width: 80px;
  height: 80px;
  border-radius: 20px;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 36px;
  margin: 0 auto 20px;
}

.form-main {
  flex: 1;
}

.form-section {
  margin-bottom: 16px;
}

.form-section.half {
  flex: 1;
  margin-bottom: 0;
}

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

.form-row {
  display: flex;
  gap: 16px;
  margin-bottom: 16px;
}

.color-options {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.color-option {
  width: 24px;
  height: 24px;
  border-radius: 6px;
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

.icon-grid-small {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 6px;
}

.icon-grid {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 8px;
}

.icon-option {
  width: 36px;
  height: 36px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-secondary);
  border-radius: 8px;
  cursor: pointer;
  font-size: 18px;
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

.color-grid {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}
</style>
