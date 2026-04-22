<template>
  <div class="editor-container">
    <div class="editor-toolbar">
      <el-button-group>
        <el-button type="primary" @click="saveDocument">
          <el-icon><Document /></el-icon>
          保存
        </el-button>
        <el-button type="success" @click="openContinuationDialog">
          <el-icon><MagicStick /></el-icon>
          续写
        </el-button>
      </el-button-group>

      <el-dropdown @command="handlePolishingCommand" style="margin-left: 10px;">
        <el-button type="warning">
          <el-icon><Edit /></el-icon>
          智能润色
          <el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="polish">
              <el-icon><Brush /></el-icon>
              润色文本
            </el-dropdown-item>
            <el-dropdown-item command="rewrite">
              <el-icon><Refresh /></el-icon>
              改写内容
            </el-dropdown-item>
            <el-dropdown-item command="expand">
              <el-icon><Plus /></el-icon>
              扩写内容
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      
      <el-dropdown @command="handleExportCommand" style="margin-left: 10px;">
        <el-button type="info">
          <el-icon><Download /></el-icon>
          导出
          <el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="txt">
              <el-icon><Document /></el-icon>
              导出为 TXT
            </el-dropdown-item>
            <el-dropdown-item command="markdown">
              <el-icon><Document /></el-icon>
              导出为 Markdown
            </el-dropdown-item>
            <el-dropdown-item command="epub">
              <el-icon><Notebook /></el-icon>
              导出为 EPUB
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      
      <el-dropdown @command="handleImportCommand" style="margin-left: 10px;">
        <el-button type="warning">
          <el-icon><Upload /></el-icon>
          导入
          <el-icon class="el-icon--right"><ArrowDown /></el-icon>
        </el-button>
        <template #dropdown>
          <el-dropdown-menu>
            <el-dropdown-item command="txt">
              <el-icon><Document /></el-icon>
              导入 TXT 文件
            </el-dropdown-item>
            <el-dropdown-item command="markdown">
              <el-icon><Document /></el-icon>
              导入 Markdown 文件
            </el-dropdown-item>
          </el-dropdown-menu>
        </template>
      </el-dropdown>
      
      <input
        ref="fileInput"
        type="file"
        style="display: none"
        @change="handleFileSelect"
        accept=".txt,.md"
      />
    </div>
    <div class="editor-content">
      <div ref="quillEditor" class="quill-editor"></div>
    </div>
    <div class="word-count">
      字数统计: {{ wordCount }} 字
    </div>

    <el-dialog
      v-model="continuationDialogVisible"
      title="小说续写"
      width="800px"
      :close-on-click-modal="false"
    >
      <el-tabs v-model="continuationTab">
        <el-tab-pane label="续写设置" name="settings">
          <el-form :model="continuationForm" label-width="100px">
            <el-form-item label="提示词">
              <el-input
                v-model="continuationForm.prompt"
                type="textarea"
                rows="3"
                placeholder="请输入续写的提示词..."
              />
            </el-form-item>
            <el-form-item label="选择模型">
              <el-select 
                v-model="continuationForm.selectedModelId" 
                placeholder="请选择模型"
                style="width: 100%;"
              >
                <el-option-group
                  v-for="provider in enabledProviders"
                  :key="provider.id"
                  :label="provider.name"
                >
                  <el-option
                    v-for="model in provider.models"
                    :key="model.id"
                    :label="model.name"
                    :value="model.id"
                  >
                    <span>{{ model.name }}</span>
                    <span style="float: right; color: var(--el-text-color-secondary); font-size: 12px;">
                      {{ provider.name }}
                    </span>
                  </el-option>
                </el-option-group>
              </el-select>
            </el-form-item>

            <el-divider>续写长度</el-divider>
            <el-form-item label="长度类型">
              <el-radio-group v-model="continuationForm.lengthType">
                <el-radio value="words">字数</el-radio>
                <el-radio value="paragraphs">段落</el-radio>
                <el-radio value="scenes">场景</el-radio>
              </el-radio-group>
            </el-form-item>
            <el-form-item :label="lengthTypeLabel">
              <el-slider
                v-model="continuationForm.lengthValue"
                :min="lengthConfig.min"
                :max="lengthConfig.max"
                :step="lengthConfig.step"
                show-stops
                show-input
              />
            </el-form-item>

            <el-divider>续写方向</el-divider>
            <el-form-item label="方向引导">
              <el-select v-model="continuationForm.direction" placeholder="选择续写方向（可选）" clearable style="width: 100%;">
                <el-option value="plot">情节推进</el-option>
                <el-option value="emotion">情感描写</el-option>
                <el-option value="scene">场景切换</el-option>
                <el-option value="dialogue">对话展开</el-option>
                <el-option value="action">战斗/动作</el-option>
                <el-option value="suspense">悬念设置</el-option>
              </el-select>
            </el-form-item>
            <el-form-item v-if="continuationForm.direction" label="侧重程度">
              <el-slider
                v-model="continuationForm.directionIntensity"
                :min="1"
                :max="10"
                :step="1"
                show-stops
                show-input
              />
            </el-form-item>

            <el-divider>高级选项</el-divider>
            <el-form-item label="多候选生成">
              <el-switch v-model="continuationForm.useCandidates" />
              <span style="margin-left: 10px; color: var(--el-text-color-secondary); font-size: 12px;">
                生成3个不同方向的候选供选择
              </span>
            </el-form-item>
            <el-form-item label="学习用户风格">
              <el-switch v-model="continuationForm.learnStyle" />
              <span style="margin-left: 10px; color: var(--el-text-color-secondary); font-size: 12px;">
                自动分析你的写作风格并模仿
              </span>
            </el-form-item>
            <el-form-item label="上下文裁剪">
              <el-switch v-model="continuationForm.smartCrop" />
              <span style="margin-left: 10px; color: var(--el-text-color-secondary); font-size: 12px;">
                智能裁剪过长的上下文，保留开头和结尾
              </span>
            </el-form-item>

            <el-divider>角色与世界书</el-divider>
            <el-form-item label="使用角色卡">
              <el-switch v-model="continuationForm.useCharacters" />
              <el-tag v-if="enabledCharactersCount > 0" size="small" type="success" style="margin-left: 10px;">
                已启用 {{ enabledCharactersCount }} 个角色
              </el-tag>
              <el-tag v-else size="small" type="info" style="margin-left: 10px;">
                暂无启用的角色
              </el-tag>
            </el-form-item>
            <el-form-item label="使用世界书">
              <el-switch v-model="continuationForm.useWorldBook" />
              <el-tag v-if="matchedEntriesCount > 0" size="small" type="success" style="margin-left: 10px;">
                匹配 {{ matchedEntriesCount }} 条条目
              </el-tag>
              <el-tag v-else size="small" type="info" style="margin-left: 10px;">
                暂无匹配条目
              </el-tag>
            </el-form-item>
            <el-form-item v-if="continuationForm.useWorldBook && matchedEntries.length > 0" label="匹配的条目">
              <div class="matched-entries">
                <el-tag
                  v-for="entry in matchedEntries.slice(0, 5)"
                  :key="entry.id"
                  size="small"
                  style="margin: 2px;"
                >
                  {{ entry.key }}
                </el-tag>
                <el-tag v-if="matchedEntries.length > 5" size="small" type="info">
                  +{{ matchedEntries.length - 5 }} 更多
                </el-tag>
              </div>
            </el-form-item>
          </el-form>
        </el-tab-pane>
        <el-tab-pane label="候选选择" name="candidates" :disabled="!candidates.length">
          <div class="candidates-container">
            <div
              v-for="(candidate, index) in candidates"
              :key="candidate.id"
              class="candidate-card"
              :class="{ selected: selectedCandidateIndex === index }"
              @click="selectedCandidateIndex = index"
            >
              <div class="candidate-header">
                <el-tag size="small" type="primary">{{ directionLabels[candidate.direction || ''] || '候选 ' + (index + 1) }}</el-tag>
              </div>
              <div class="candidate-preview">{{ candidate.text.substring(0, 200) }}{{ candidate.text.length > 200 ? '...' : '' }}</div>
            </div>
          </div>
          <div v-if="selectedCandidateIndex >= 0" class="selected-candidate-detail">
            <h4>选中的候选</h4>
            <div class="candidate-text">{{ candidates[selectedCandidateIndex]?.text }}</div>
          </div>
        </el-tab-pane>
      </el-tabs>
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="continuationDialogVisible = false">取消</el-button>
          <el-button
            v-if="continuationTab === 'settings'"
            type="primary"
            @click="continueWriting"
            :loading="isContinuing"
          >
            开始续写
          </el-button>
          <el-button
            v-if="continuationTab === 'candidates' && selectedCandidateIndex >= 0"
            type="primary"
            @click="insertCandidate"
          >
            插入选中的候选
          </el-button>
        </span>
      </template>
    </el-dialog>

    <el-dialog
      v-model="polishingDialogVisible"
      :title="polishingTypeLabel"
      width="600px"
      :close-on-click-modal="false"
    >
      <el-form label-width="100px">
        <el-form-item label="目标文本">
          <el-input
            v-model="polishingForm.selectedText"
            type="textarea"
            :rows="4"
            :readonly="polishingForm.selectedText.length > 0"
            placeholder="请先在编辑器中选择要润色的文本"
          />
        </el-form-item>
        <el-form-item label="额外要求" v-if="polishingForm.type !== 'polish'">
          <el-input
            v-model="polishingForm.instruction"
            type="textarea"
            :rows="2"
            placeholder="可选，输入具体的要求..."
          />
        </el-form-item>
        <el-form-item label="选择模型">
          <el-select 
            v-model="polishingForm.selectedModelId" 
            placeholder="请选择模型"
            style="width: 100%;"
          >
            <el-option-group
              v-for="provider in enabledProviders"
              :key="provider.id"
              :label="provider.name"
            >
              <el-option
                v-for="model in provider.models"
                :key="model.id"
                :label="model.name"
                :value="model.id"
              >
                <span>{{ model.name }}</span>
              </el-option>
            </el-option-group>
          </el-select>
        </el-form-item>
      </el-form>

      <div v-if="polishingResult" class="polishing-result">
        <el-divider>润色结果</el-divider>
        <div class="result-text">{{ polishingResult }}</div>
      </div>

      <template #footer>
        <span class="dialog-footer">
          <el-button @click="polishingDialogVisible = false">取消</el-button>
          <el-button v-if="polishingResult" type="success" @click="insertPolishingResult">
            插入结果
          </el-button>
          <el-button type="primary" @click="performPolishing" :loading="isPolishing">
            开始{{ polishingTypeLabel }}
          </el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, watch, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import {
  Document, MagicStick, Download, Upload, ArrowDown, Notebook,
  Edit, Brush, Refresh, Plus
} from '@element-plus/icons-vue'
import Quill from 'quill'
import {
  continueNovel,
  getDefaultModel,
  getAllAvailableModels,
  smartContextCrop,
  generateCandidates,
  polishText,
  analyzeWritingStyle,
  generateStylePrompt,
  type ContinuationCandidate
} from '@/services/aiService'
import { useSettingsStore } from '@/stores/settings'
import { useCharacterStore } from '@/stores/character'
import { useWorldBookStore } from '@/stores/worldBook'
import { useAIProviderStore } from '@/stores/aiProvider'
import {
  exportToTxt,
  exportToMarkdown,
  exportToEpub,
  importFromMarkdown,
  importFromTxt,
  readFileAsText,
  type Chapter
} from '@/utils/exportImport'
import type { ContinuationLengthType, ContinuationDirection, PolishingType } from '@/types'

const settingsStore = useSettingsStore()
const characterStore = useCharacterStore()
const worldBookStore = useWorldBookStore()
const aiProviderStore = useAIProviderStore()

let currentChapter: any = null

const quillEditor = ref<HTMLElement | null>(null)
const fileInput = ref<HTMLInputElement | null>(null)
let quill: Quill | null = null
let importType = ''

const wordCount = ref(0)

const continuationDialogVisible = ref(false)
const continuationTab = ref('settings')
const isContinuing = ref(false)
const candidates = ref<ContinuationCandidate[]>([])
const selectedCandidateIndex = ref(-1)

const polishingDialogVisible = ref(false)
const isPolishing = ref(false)
const polishingResult = ref('')

const aiModels = computed(() => getAllAvailableModels())

const continuationForm = reactive({
  prompt: '',
  lengthType: 'words' as ContinuationLengthType,
  lengthValue: 500,
  direction: '' as ContinuationDirection | '',
  directionIntensity: 7,
  useCharacters: true,
  useWorldBook: true,
  useCandidates: false,
  learnStyle: false,
  smartCrop: true,
  selectedModelId: aiProviderStore.selectedModelId
})

const polishingForm = reactive({
  type: 'polish' as PolishingType,
  selectedText: '',
  instruction: '',
  selectedModelId: aiProviderStore.selectedModelId
})

const directionLabels: Record<string, string> = {
  plot: '情节推进',
  emotion: '情感描写',
  scene: '场景切换',
  dialogue: '对话展开',
  action: '战斗/动作',
  suspense: '悬念设置'
}

const lengthConfig = computed(() => {
  switch (continuationForm.lengthType) {
    case 'words':
      return { min: 100, max: 5000, step: 100 }
    case 'paragraphs':
      return { min: 1, max: 20, step: 1 }
    case 'scenes':
      return { min: 1, max: 10, step: 1 }
    default:
      return { min: 100, max: 5000, step: 100 }
  }
})

const lengthTypeLabel = computed(() => {
  switch (continuationForm.lengthType) {
    case 'words': return '目标字数'
    case 'paragraphs': return '段落数'
    case 'scenes': return '场景数'
    default: return '目标字数'
  }
})

const polishingTypeLabel = computed(() => {
  const labels: Record<PolishingType, string> = {
    polish: '润色',
    rewrite: '改写',
    expand: '扩写'
  }
  return labels[polishingForm.type]
})

const enabledProviders = computed(() => {
  return aiProviderStore.allProviders.filter(p => p.enabled && p.apiKey)
})

const selectedModel = computed(() => aiProviderStore.selectedModel)

const enabledCharactersCount = computed(() => {
  return characterStore.enabledCharacters.length
})

const matchedEntries = ref(worldBookStore.scanTextForEntries(''))

const matchedEntriesCount = computed(() => {
  return matchedEntries.value.length
})

onMounted(() => {
  characterStore.loadCharactersFromStorage()
  worldBookStore.loadWorldBooksFromStorage()

  if (quillEditor.value) {
    quill = new Quill(quillEditor.value, {
      theme: 'snow',
      placeholder: '开始编写你的小说...',
      modules: {
        toolbar: [
          [{ 'header': [1, 2, 3, 4, 5, 6, false] }],
          ['bold', 'italic', 'underline', 'strike'],
          [{ 'color': [] }, { 'background': [] }],
          [{ 'list': 'ordered'}, { 'list': 'bullet' }],
          [{ 'indent': '-1'}, { 'indent': '+1' }],
          ['link', 'image'],
          ['clean']
        ]
      }
    })
    
    window.addEventListener('chapter-changed', (event: any) => {
      if (currentChapter && quill) {
        currentChapter.content = quill.root.innerHTML
        currentChapter.wordCount = quill.getText().replace(/\s/g, '').length
        
        const chapters = JSON.parse(localStorage.getItem('chapters') || '[]')
        const index = chapters.findIndex((c: any) => c.id === currentChapter.id)
        if (index !== -1) {
          chapters[index] = currentChapter
          localStorage.setItem('chapters', JSON.stringify(chapters))
        }
      }
      
      currentChapter = event.detail
      if (quill) {
        quill.root.innerHTML = currentChapter.content || ''
        updateWordCount()
      }
    })
    
    updateWordCount()
    
    quill.on('text-change', () => {
      updateWordCount()
    })
  }
})

const saveDocument = () => {
  if (!quill) return

  if (currentChapter) {
    currentChapter.content = quill.root.innerHTML
    currentChapter.wordCount = quill.getText().replace(/\s/g, '').length
    
    const chapters = JSON.parse(localStorage.getItem('chapters') || '[]')
    const index = chapters.findIndex((c: any) => c.id === currentChapter.id)
    if (index !== -1) {
      chapters[index] = currentChapter
      localStorage.setItem('chapters', JSON.stringify(chapters))
    }
  }
  
  ElMessage.success('章节已保存')
}

const getSelectedText = (): string => {
  if (!quill) return ''
  const range = quill.getSelection()
  if (range && range.length > 0) {
    return quill.getText(range.index, range.length)
  }
  return ''
}

const handlePolishingCommand = (command: PolishingType) => {
  polishingForm.type = command
  polishingForm.selectedText = getSelectedText()
  polishingForm.instruction = ''
  polishingResult.value = ''
  polishingForm.selectedModelId = aiProviderStore.selectedModelId

  if (!polishingForm.selectedText) {
    ElMessage.warning('请先在编辑器中选择要润色的文本')
    return
  }

  polishingDialogVisible.value = true
}

const performPolishing = async () => {
  if (!polishingForm.selectedText) {
    ElMessage.warning('请先选择要润色的文本')
    return
  }

  isPolishing.value = true
  polishingResult.value = ''

  try {
    const selectedModelForPolishing = aiProviderStore.getModelById(polishingForm.selectedModelId)
    const response = await polishText({
      text: polishingForm.selectedText,
      type: polishingForm.type,
      instruction: polishingForm.instruction,
      model: selectedModelForPolishing
    })

    if (response.success) {
      polishingResult.value = response.text
      ElMessage.success('润色成功')
    } else {
      ElMessage.error(`润色失败: ${response.error}`)
    }
  } catch (error) {
    console.error('润色错误:', error)
    ElMessage.error('润色过程中发生错误')
  } finally {
    isPolishing.value = false
  }
}

const insertPolishingResult = () => {
  if (!quill || !polishingResult.value) return

  const range = quill.getSelection()
  if (range && range.length > 0) {
    quill.deleteText(range.index, range.length)
    quill.insertText(range.index, polishingResult.value)
  } else {
    const currentLength = quill.getLength()
    quill.insertText(currentLength, '\n\n' + polishingResult.value)
  }

  polishingDialogVisible.value = false
  ElMessage.success('已插入润色结果')
}

const openContinuationDialog = () => {
  if (!quill) return

  continuationForm.prompt = ''
  continuationForm.useCharacters = true
  continuationForm.useWorldBook = true
  continuationForm.lengthType = 'words'
  continuationForm.lengthValue = 500
  continuationForm.direction = ''
  continuationForm.directionIntensity = 7
  continuationForm.useCandidates = false
  continuationForm.learnStyle = false
  continuationForm.smartCrop = true
  continuationForm.selectedModelId = aiProviderStore.selectedModelId
  candidates.value = []
  selectedCandidateIndex.value = -1
  continuationTab.value = 'settings'

  if (quill) {
    const text = quill.getText()
    matchedEntries.value = worldBookStore.scanTextForEntries(text)
  }

  continuationDialogVisible.value = true
}

const updateWordCount = () => {
  if (!quill) return
  const text = quill.getText()
  wordCount.value = text.replace(/\s/g, '').length
}

const handleExportCommand = (command: string) => {
  saveDocument()

  setTimeout(() => {
    const chapters = JSON.parse(localStorage.getItem('chapters') || '[]')
    
    switch (command) {
      case 'txt':
        exportToTxt(chapters)
        break
      case 'markdown':
        exportToMarkdown(chapters, undefined, { includeMetadata: true })
        break
      case 'epub':
        exportToEpub(chapters)
        break
    }
  }, 100)
}

const handleImportCommand = (command: string) => {
  importType = command
  if (fileInput.value) {
    fileInput.value.accept = command === 'markdown' ? '.md' : '.txt'
    fileInput.value.click()
  }
}

const handleFileSelect = async (event: Event) => {
  const target = event.target as HTMLInputElement
  const file = target.files?.[0]
  
  if (!file) return
  
  try {
    const content = await readFileAsText(file)
    let chapters: Chapter[]
    
    if (importType === 'markdown') {
      chapters = importFromMarkdown(content)
    } else {
      chapters = importFromTxt(content)
    }
    
    if (chapters.length === 0) {
      ElMessage.warning('未能从文件中识别到章节内容')
      return
    }
    
    await ElMessageBox.confirm(
      `检测到 ${chapters.length} 个章节，是否导入？这将替换当前的章节内容。`,
      '导入确认',
      {
        confirmButtonText: '确定导入',
        cancelButtonText: '取消',
        type: 'warning'
      }
    )
    
    localStorage.setItem('chapters', JSON.stringify(chapters))
    localStorage.setItem('currentChapterId', chapters[0].id)
    
    window.dispatchEvent(new CustomEvent('chapter-changed', { detail: chapters[0] }))
    
    window.location.reload()
    
    ElMessage.success(`成功导入 ${chapters.length} 个章节`)
  } catch (error) {
    if (error !== 'cancel') {
      console.error('导入错误:', error)
      ElMessage.error('导入失败，请检查文件格式')
    }
  } finally {
    if (target) {
      target.value = ''
    }
  }
}

const continueWriting = async () => {
  if (!quill) return

  isContinuing.value = true
  candidates.value = []
  selectedCandidateIndex.value = -1

  try {
    const fullText = quill.getText()
    let contextText = fullText

    if (continuationForm.smartCrop) {
      contextText = smartContextCrop(fullText, 2000, 0.7)
    } else if (fullText.length > 4000) {
      contextText = fullText.substring(fullText.length - 4000)
    }

    const fullPrompt = `${contextText}\n\n---\n\n${continuationForm.prompt}`

    let characters = undefined
    let worldBookEntries = undefined

    if (continuationForm.useCharacters) {
      characters = characterStore.enabledCharacters
    }

    if (continuationForm.useWorldBook) {
      worldBookEntries = matchedEntries.value
    }

    const selectedModelForContinuation = aiProviderStore.getModelById(continuationForm.selectedModelId)

    let lengthConfig = undefined
    if (continuationForm.lengthType) {
      lengthConfig = {
        type: continuationForm.lengthType,
        value: continuationForm.lengthValue
      }
    }

    let directionConfig = undefined
    if (continuationForm.direction) {
      directionConfig = {
        direction: continuationForm.direction,
        intensity: continuationForm.directionIntensity
      }
    }

    let learnedStylePrompt = ''
    if (continuationForm.learnStyle) {
      const analysis = await analyzeWritingStyle(fullText)
      learnedStylePrompt = generateStylePrompt(analysis)
    }

    const stylePrompt = settingsStore.stylePrompt
      ? settingsStore.stylePrompt + (learnedStylePrompt ? '\n' + learnedStylePrompt : '')
      : learnedStylePrompt

    if (continuationForm.useCandidates) {
      candidates.value = await generateCandidates({
        prompt: fullPrompt,
        model: selectedModelForContinuation,
        maxTokens: 1000,
        stylePrompt,
        characters,
        worldBookEntries,
        useCharacters: continuationForm.useCharacters,
        useWorldBook: continuationForm.useWorldBook,
        lengthConfig,
        directionConfig
      })

      if (candidates.value.length > 0) {
        continuationTab.value = 'candidates'
        ElMessage.success(`已生成 ${candidates.value.length} 个候选`)
      } else {
        ElMessage.warning('未能生成候选，请尝试直接续写')
      }
    } else {
      const response = await continueNovel({
        prompt: fullPrompt,
        model: selectedModelForContinuation,
        maxTokens: continuationForm.lengthType === 'words' ? continuationForm.lengthValue : 1000,
        stylePrompt,
        characters,
        worldBookEntries,
        useCharacters: continuationForm.useCharacters,
        useWorldBook: continuationForm.useWorldBook,
        lengthConfig,
        directionConfig
      })

      if (response.success) {
        const currentLength = quill.getLength()
        quill.setSelection(currentLength, 0)
        quill.insertText(currentLength, '\n\n' + response.text)
        ElMessage.success('续写成功')
        continuationDialogVisible.value = false
      } else {
        ElMessage.error(`续写失败: ${response.error}`)
      }
    }
  } catch (error) {
    console.error('续写错误:', error)
    ElMessage.error('续写过程中发生错误')
  } finally {
    isContinuing.value = false
  }
}

const insertCandidate = () => {
  if (!quill || selectedCandidateIndex.value < 0 || !candidates.value[selectedCandidateIndex.value]) return

  const candidate = candidates.value[selectedCandidateIndex.value]
  const currentLength = quill.getLength()
  quill.setSelection(currentLength, 0)
  quill.insertText(currentLength, '\n\n' + candidate.text)

  continuationDialogVisible.value = false
  ElMessage.success('已插入选中的候选')
}
</script>

<style scoped>
.editor-container {
  display: flex;
  flex-direction: column;
  height: 100%;
  background-color: #fff;
  border-radius: 4px;
  box-shadow: 0 2px 12px 0 rgba(0, 0, 0, 0.1);
}

.editor-toolbar {
  padding: 10px 15px;
  border-bottom: 1px solid #ebeef5;
  display: flex;
  align-items: center;
}

.editor-content {
  flex: 1;
  padding: 15px;
  overflow: auto;
}

.quill-editor {
  height: 92%;
  min-height: 300px;
}

.quill-editor :v-deep(.ql-container) {
  height: calc(100% - 42px);
  font-size: 16px;
  line-height: 1.6;
}

.quill-editor :v-deep(.ql-editor) {
  min-height: 300px;
}

.word-count {
  padding: 8px 15px;
  border-top: 1px solid #ebeef5;
  font-size: 14px;
  color: #909399;
  text-align: right;
  background-color: #f5f7fa;
}

.dialog-footer {
  display: flex;
  justify-content: flex-end;
}

.matched-entries {
  max-height: 100px;
  overflow-y: auto;
  padding: 5px;
  background-color: #f5f7fa;
  border-radius: 4px;
}

.candidates-container {
  display: flex;
  flex-direction: column;
  gap: 12px;
  max-height: 400px;
  overflow-y: auto;
}

.candidate-card {
  padding: 12px;
  border: 2px solid #e4e7ed;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.candidate-card:hover {
  border-color: #6366f1;
  background-color: #f5f7ff;
}

.candidate-card.selected {
  border-color: #e94560;
  background-color: #ffeff2;
}

.candidate-header {
  margin-bottom: 8px;
}

.candidate-preview {
  color: #606266;
  font-size: 13px;
  line-height: 1.5;
}

.selected-candidate-detail {
  margin-top: 16px;
}

.selected-candidate-detail h4 {
  margin-bottom: 8px;
  color: #303133;
}

.candidate-text {
  padding: 12px;
  background-color: #f5f7fa;
  border-radius: 6px;
  line-height: 1.6;
  color: #303133;
  max-height: 200px;
  overflow-y: auto;
}

.polishing-result {
  margin-top: 16px;
}

.result-text {
  padding: 12px;
  background-color: #f0f9ff;
  border-radius: 6px;
  line-height: 1.6;
  color: #303133;
  border: 1px solid #7dd3fc;
  max-height: 300px;
  overflow-y: auto;
}
</style>
