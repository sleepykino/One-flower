<template>
  <div class="sidebar" :class="{ 'sidebar-collapsed': isCollapsed }">
    <div class="sidebar-header">
      <h3 v-if="!isCollapsed">设置</h3>
      <el-button 
        class="collapse-btn" 
        :icon="isCollapsed ? 'Expand' : 'Fold'" 
        circle 
        @click="toggleCollapse"
        size="small"
      />
    </div>

    <div v-if="!isCollapsed">
      <el-collapse v-model="activeNames" accordion>
        <el-collapse-item title="章节管理" name="chapters">
          <ChapterList ref="chapterListRef" />
        </el-collapse-item>
        <el-collapse-item title="角色卡" name="characters">
          <CharacterCard />
        </el-collapse-item>
        <el-collapse-item title="世界书" name="worldbook">
          <WorldBook />
        </el-collapse-item>
        <el-collapse-item title="文风选择" name="style">
          <el-form :model="styleSettings" label-position="top" size="small">
            <el-form-item label="写作风格">
              <el-select v-model="styleSettings.selectedStyle" placeholder="选择写作风格" @change="handleStyleChange">
                <el-option
                  v-for="style in writingStyles"
                  :key="style.id"
                  :label="style.name"
                  :value="style.id"
                />
              </el-select>
            </el-form-item>
            <el-form-item label="提示词">
              <el-input
                v-model="styleSettings.prompt"
                type="textarea"
                :rows="4"
                placeholder="自定义提示词，用于控制AI续写风格"
              />
            </el-form-item>
          </el-form>
        </el-collapse-item>
        <el-collapse-item title="GLM模型" name="glm">
          <el-form :model="glmSettings" label-position="top" size="small">
            <el-form-item label="API Key">
              <el-input v-model="glmSettings.apiKey" type="password" show-password placeholder="请输入GLM的API Key" />
            </el-form-item>
            <el-form-item label="温度">
              <el-slider v-model="glmSettings.temperature" :min="0" :max="2" :step="0.1" show-stops />
            </el-form-item>
          </el-form>
        </el-collapse-item>
        <el-collapse-item title="DeepSeek模型" name="deepseek">
          <el-form :model="deepseekSettings" label-position="top" size="small">
            <el-form-item label="API Key">
              <el-input v-model="deepseekSettings.apiKey" type="password" show-password placeholder="请输入DeepSeek的API Key" />
            </el-form-item>
            <el-form-item label="温度">
              <el-slider v-model="deepseekSettings.temperature" :min="0" :max="2" :step="0.1" show-stops />
            </el-form-item>
          </el-form>
        </el-collapse-item>
      </el-collapse>
    </div>
    <div v-else class="collapsed-menu">
      <el-tooltip content="章节管理" placement="right">
        <div class="collapsed-item" @click="expandToChapters">
          <el-icon><Document /></el-icon>
        </div>
      </el-tooltip>
      <el-tooltip content="角色卡" placement="right">
        <div class="collapsed-item" @click="expandToCharacters">
          <el-icon><User /></el-icon>
        </div>
      </el-tooltip>
      <el-tooltip content="世界书" placement="right">
        <div class="collapsed-item" @click="expandToWorldBook">
          <el-icon><Reading /></el-icon>
        </div>
      </el-tooltip>
      <el-tooltip content="文风选择" placement="right">
        <div class="collapsed-item" @click="expandToStyle">
          <el-icon><EditPen /></el-icon>
        </div>
      </el-tooltip>
      <el-tooltip content="GLM模型" placement="right">
        <div class="collapsed-item" @click="expandToGlm">
          <el-icon><Cpu /></el-icon>
        </div>
      </el-tooltip>
      <el-tooltip content="DeepSeek模型" placement="right">
        <div class="collapsed-item" @click="expandToDeepseek">
          <el-icon><Connection /></el-icon>
        </div>
      </el-tooltip>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, computed, onMounted } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import ChapterList from './ChapterList.vue'
import CharacterCard from './CharacterCard.vue'
import WorldBook from './WorldBook.vue'

const emit = defineEmits(['sidebar-toggle'])

const activeNames = ref(['glm'])
const isCollapsed = ref(false)

const settingsStore = useSettingsStore()
const chapterListRef = ref()

const glmSettings = reactive({
  apiKey: settingsStore.glmApiKey,
  temperature: settingsStore.glmTemperature
})

const deepseekSettings = reactive({
  apiKey: settingsStore.deepseekApiKey,
  temperature: settingsStore.deepseekTemperature
})

const styleSettings = reactive({
  selectedStyle: settingsStore.selectedStyle || 'default',
  prompt: settingsStore.stylePrompt || ''
})

const writingStyles = [
  { id: 'default', name: '默认(和原文保持一致)', prompt: '' },
  { id: 'fast-paced', name: '快节奏爽文', prompt: '请以快节奏爽文风格续写，情节紧凑，爽点密集，语言简练有力。' },
  { id: 'romantic', name: '言情细腻', prompt: '请以细腻的言情风格续写，注重情感描写，语言优美，情感丰富。' },
  { id: 'suspense', name: '悬疑智斗', prompt: '请以悬疑智斗风格续写，设置悬念，逻辑严密，注重推理过程。' },
  { id: 'poetic', name: '诗意文学', prompt: '请以诗意文学风格续写，语言优美，意境深远，富有文学性。' }
]

watch(() => glmSettings.apiKey, (newValue) => {
  settingsStore.updateGlmApiKey(newValue)
})

watch(() => glmSettings.temperature, (newValue) => {
  settingsStore.updateGlmTemperature(newValue)
})

watch(() => deepseekSettings.apiKey, (newValue) => {
  settingsStore.updateDeepseekApiKey(newValue)
})

watch(() => deepseekSettings.temperature, (newValue) => {
  settingsStore.updateDeepseekTemperature(newValue)
})

function handleStyleChange(styleId: string) {
  const selectedStyle = writingStyles.find(style => style.id === styleId)
  if (selectedStyle) {
    styleSettings.prompt = selectedStyle.prompt
    settingsStore.updateSelectedStyle(styleId)
    settingsStore.updateStylePrompt(selectedStyle.prompt)
  }
}

watch(() => styleSettings.selectedStyle, (newValue) => {
  settingsStore.updateSelectedStyle(newValue)
})

watch(() => styleSettings.prompt, (newValue) => {
  settingsStore.updateStylePrompt(newValue)
})

function toggleCollapse() {
  isCollapsed.value = !isCollapsed.value
  emit('sidebar-toggle', isCollapsed.value)
}

function expandToStyle() {
  isCollapsed.value = false
  activeNames.value = ['style']
  emit('sidebar-toggle', false)
}

function expandToGlm() {
  isCollapsed.value = false
  activeNames.value = ['glm']
  emit('sidebar-toggle', false)
}

function expandToChapters() {
  isCollapsed.value = false
  activeNames.value = ['chapters']
  emit('sidebar-toggle', false)
}

function expandToDeepseek() {
  isCollapsed.value = false
  activeNames.value = ['deepseek']
  emit('sidebar-toggle', false)
}

function expandToCharacters() {
  isCollapsed.value = false
  activeNames.value = ['characters']
  emit('sidebar-toggle', false)
}

function expandToWorldBook() {
  isCollapsed.value = false
  activeNames.value = ['worldbook']
  emit('sidebar-toggle', false)
}
</script>

<style scoped>
.sidebar {
  padding: 20px;
  height: 100vh;
  overflow-y: auto;
  transition: width 0.3s ease;
  width: 280px;
  position: relative;
}

.sidebar-collapsed {
  width: 60px;
  padding: 20px 10px;
}

.sidebar-header {
  margin-bottom: 20px;
  padding-bottom: 10px;
  border-bottom: 1px solid #ebeef5;
  display: flex;
  justify-content: space-between;
  align-items: center;
}

.sidebar-header h3 {
  font-size: 18px;
  color: #303133;
  margin: 0;
}

.collapse-btn {
  position: absolute;
  right: 10px;
  top: 20px;
  z-index: 10;
  background-color: #fff;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
}

.collapsed-menu {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 20px;
}

.collapsed-item {
  width: 40px;
  height: 40px;
  border-radius: 4px;
  background-color: #f5f7fa;
  display: flex;
  justify-content: center;
  align-items: center;
  cursor: pointer;
  transition: background-color 0.3s;
}

.collapsed-item:hover {
  background-color: #e6e8eb;
}
</style>
