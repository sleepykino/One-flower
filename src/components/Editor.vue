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
      width="700px"
      :close-on-click-modal="false"
    >
      <el-form :model="continuationForm" label-width="100px">
        <el-form-item label="提示词">
          <el-input
            v-model="continuationForm.prompt"
            type="textarea"
            rows="4"
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
        <el-form-item label="回复长度">
          <el-slider
            v-model="continuationForm.maxTokens"
            :min="100"
            :max="5000"
            :step="100"
            show-stops
            show-input
          />
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
      <template #footer>
        <span class="dialog-footer">
          <el-button @click="continuationDialogVisible = false">取消</el-button>
          <el-button type="primary" @click="continueWriting" :loading="isContinuing">
            开始续写
          </el-button>
        </span>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted, reactive, watch, computed } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { Document, MagicStick, Download, Upload, ArrowDown, Notebook } from '@element-plus/icons-vue'
import Quill from 'quill'
import { continueNovel, getDefaultModel, getAllAvailableModels } from '@/services/aiService'
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
const isContinuing = ref(false)
const aiModels = computed(() => getAllAvailableModels())

const continuationForm = reactive({
  prompt: '',
  maxTokens: 500,
  useCharacters: true,
  useWorldBook: true,
  selectedModelId: aiProviderStore.selectedModelId
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

const openContinuationDialog = () => {
  if (!quill) return

  continuationForm.prompt = `以下为续写要求：\n\n`
  continuationForm.useCharacters = true
  continuationForm.useWorldBook = true

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

  try {
    const fullText = quill.getText()
    let contextText = ''
    
    if (fullText.length > 2000) {
      contextText = fullText.substring(fullText.length - 2000)
    } else {
      contextText = fullText
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
    
    const response = await continueNovel({
      prompt: fullPrompt,
      model: selectedModelForContinuation,
      maxTokens: continuationForm.maxTokens,
      stylePrompt: settingsStore.stylePrompt,
      characters,
      worldBookEntries,
      useCharacters: continuationForm.useCharacters,
      useWorldBook: continuationForm.useWorldBook
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
  } catch (error) {
    console.error('续写错误:', error)
    ElMessage.error('续写过程中发生错误')
  } finally {
    isContinuing.value = false
  }
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

.current-model-info {
  display: flex;
  align-items: center;
}

.no-model-warning {
  font-size: 13px;
}
</style>
