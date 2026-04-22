<template>
  <div class="app-container">
    <div class="app-header">
      <div class="header-left">
        <div class="logo">
          <span class="logo-icon">✨</span>
          <span class="logo-text">一花一世界</span>
        </div>
      </div>
      <div class="header-center">
        <div class="main-tabs">
          <div 
            class="tab-item" 
            :class="{ active: activeMainTab === 'editor' }"
            @click="activeMainTab = 'editor'"
          >
            <el-icon><EditPen /></el-icon>
            <span>编辑器</span>
          </div>
          <div 
            class="tab-item" 
            :class="{ active: activeMainTab === 'characters' }"
            @click="activeMainTab = 'characters'"
          >
            <el-icon><User /></el-icon>
            <span>角色卡</span>
          </div>
          <div 
            class="tab-item" 
            :class="{ active: activeMainTab === 'worldbook' }"
            @click="activeMainTab = 'worldbook'"
          >
            <el-icon><Reading /></el-icon>
            <span>世界书</span>
          </div>
          <div 
            class="tab-item" 
            :class="{ active: activeMainTab === 'map' }"
            @click="activeMainTab = 'map'"
          >
            <el-icon><MapLocation /></el-icon>
            <span>地图</span>
          </div>
          <div 
            class="tab-item" 
            :class="{ active: activeMainTab === 'settings' }"
            @click="activeMainTab = 'settings'"
          >
            <el-icon><Setting /></el-icon>
            <span>设置</span>
          </div>
        </div>
      </div>
      <div class="header-right">
        <el-button type="primary" @click="saveAll">
          <el-icon><Document /></el-icon>
          保存
        </el-button>
      </div>
    </div>
    
    <div class="app-body">
      <transition name="fade-slide" mode="out-in">
        <div v-if="activeMainTab === 'editor'" class="editor-page">
          <div class="sidebar-panel">
            <ChapterList />
          </div>
          <div class="editor-panel">
            <Editor ref="editorRef" />
          </div>
        </div>
        
        <div v-else-if="activeMainTab === 'characters'" class="characters-page">
          <CharacterCard />
        </div>
        
        <div v-else-if="activeMainTab === 'worldbook'" class="worldbook-page">
          <WorldBook />
        </div>
        
        <div v-else-if="activeMainTab === 'map'" class="map-page">
          <div class="map-container">
            <div class="map-sidebar">
              <MapList />
            </div>
            <div class="map-editor-wrapper">
              <MapEditor v-if="mapStore.currentMapId" />
              <div v-else class="map-empty">
                <el-empty description="请选择或创建一个地图" />
              </div>
            </div>
          </div>
        </div>
        
        <div v-else-if="activeMainTab === 'settings'" class="settings-page">
          <div class="settings-container">
            <APIConfig />
            
            <div class="settings-section">
              <h3 class="section-title">
                <el-icon><EditPen /></el-icon>
                写作风格
              </h3>
              <div class="style-grid">
                <div 
                  v-for="style in writingStyles" 
                  :key="style.id"
                  class="style-card"
                  :class="{ active: styleSettings.selectedStyle === style.id }"
                  @click="handleStyleChange(style.id)"
                >
                  <div class="style-icon">{{ style.icon }}</div>
                  <div class="style-name">{{ style.name }}</div>
                </div>
              </div>
              <el-input
                v-model="styleSettings.prompt"
                type="textarea"
                :rows="4"
                placeholder="自定义提示词，用于控制AI续写风格"
                class="custom-prompt"
              />
            </div>
          </div>
        </div>
      </transition>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, reactive, watch, onMounted } from 'vue'
import { EditPen, User, Reading, Setting, Document, MapLocation } from '@element-plus/icons-vue'
import { useSettingsStore } from '@/stores/settings'
import { useChapterStore } from '@/stores/chapter'
import { useCharacterStore } from '@/stores/character'
import { useWorldBookStore } from '@/stores/worldBook'
import { useCollectionStore } from '@/stores/collection'
import { useAIProviderStore } from '@/stores/aiProvider'
import { useMapStore } from '@/stores/map'
import ChapterList from './components/ChapterList.vue'
import CharacterCard from './components/CharacterCard.vue'
import WorldBook from './components/WorldBook.vue'
import Editor from './components/Editor.vue'
import APIConfig from './components/APIConfig.vue'
import MapList from './components/map/MapList.vue'
import MapEditor from './components/map/MapEditor.vue'

const settingsStore = useSettingsStore()
const chapterStore = useChapterStore()
const characterStore = useCharacterStore()
const worldBookStore = useWorldBookStore()
const collectionStore = useCollectionStore()
const aiProviderStore = useAIProviderStore()
const mapStore = useMapStore()

const editorRef = ref()

const activeMainTab = ref('editor')

const styleSettings = reactive({
  selectedStyle: 'default',
  prompt: ''
})

const writingStyles = [
  { id: 'default', name: '默认风格', icon: '📝', prompt: '' },
  { id: 'fast-paced', name: '快节奏爽文', icon: '⚡', prompt: '请以快节奏爽文风格续写，情节紧凑，爽点密集，语言简练有力。' },
  { id: 'romantic', name: '言情细腻', icon: '💕', prompt: '请以细腻的言情风格续写，注重情感描写，语言优美，情感丰富。' },
  { id: 'suspense', name: '悬疑智斗', icon: '🔍', prompt: '请以悬疑智斗风格续写，设置悬念，逻辑严密，注重推理过程。' },
  { id: 'poetic', name: '诗意文学', icon: '🌸', prompt: '请以诗意文学风格续写，语言优美，意境深远，富有文学性。' }
]

onMounted(async () => {
  await Promise.all([
    settingsStore.loadSettings(),
    chapterStore.loadChaptersFromStorage(),
    characterStore.loadCharactersFromStorage(),
    worldBookStore.loadWorldBooksFromStorage(),
    collectionStore.loadCollectionsFromStorage(),
    aiProviderStore.init(),
    mapStore.loadMaps()
  ])
  
  styleSettings.selectedStyle = settingsStore.selectedStyle || 'default'
  styleSettings.prompt = settingsStore.stylePrompt || ''
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

function saveAll() {
  if (editorRef.value) {
    editorRef.value.saveDocument()
  }
}
</script>

<style>
@import url('https://fonts.googleapis.com/css2?family=Noto+Serif+SC:wght@400;500;600;700&family=Noto+Sans+SC:wght@300;400;500;600&display=swap');

* {
  margin: 0;
  padding: 0;
  box-sizing: border-box;
}

:root {
  --primary-color: #6366f1;
  --primary-light: #818cf8;
  --primary-dark: #4f46e5;
  --accent-color: #f472b6;
  --bg-color: #faf9f7;
  --bg-secondary: #f3f1ee;
  --card-bg: #ffffff;
  --text-primary: #1f2937;
  --text-secondary: #6b7280;
  --text-muted: #9ca3af;
  --border-color: #e5e7eb;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.05);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.1);
  --radius-sm: 8px;
  --radius-md: 12px;
  --radius-lg: 16px;
}

body {
  font-family: 'Noto Sans SC', -apple-system, BlinkMacSystemFont, sans-serif;
  background-color: var(--bg-color);
  color: var(--text-primary);
  line-height: 1.6;
}

#app {
  height: 100vh;
}

.app-container {
  height: 100vh;
  display: flex;
  flex-direction: column;
  background: linear-gradient(135deg, var(--bg-color) 0%, var(--bg-secondary) 100%);
}

.app-header {
  height: 64px;
  background: var(--card-bg);
  border-bottom: 1px solid var(--border-color);
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 0 24px;
  box-shadow: var(--shadow-sm);
  position: relative;
  z-index: 100;
}

.header-left {
  display: flex;
  align-items: center;
}

.logo {
  display: flex;
  align-items: center;
  gap: 10px;
}

.logo-icon {
  font-size: 28px;
  animation: sparkle 2s ease-in-out infinite;
}

@keyframes sparkle {
  0%, 100% { transform: scale(1) rotate(0deg); }
  50% { transform: scale(1.1) rotate(10deg); }
}

.logo-text {
  font-family: 'Noto Serif SC', serif;
  font-size: 20px;
  font-weight: 600;
  background: linear-gradient(135deg, var(--primary-color), var(--accent-color));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.header-center {
  position: absolute;
  left: 50%;
  transform: translateX(-50%);
}

.main-tabs {
  display: flex;
  gap: 8px;
  background: var(--bg-secondary);
  padding: 6px;
  border-radius: var(--radius-md);
}

.tab-item {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 20px;
  border-radius: var(--radius-sm);
  cursor: pointer;
  transition: all 0.3s ease;
  color: var(--text-secondary);
  font-size: 14px;
  font-weight: 500;
}

.tab-item:hover {
  color: var(--text-primary);
  background: rgba(255, 255, 255, 0.5);
}

.tab-item.active {
  background: var(--card-bg);
  color: var(--primary-color);
  box-shadow: var(--shadow-sm);
}

.header-right {
  display: flex;
  align-items: center;
  gap: 12px;
}

.app-body {
  flex: 1;
  overflow: hidden;
  position: relative;
}

.editor-page {
  display: flex;
  height: 100%;
}

.sidebar-panel {
  width: 280px;
  background: var(--card-bg);
  border-right: 1px solid var(--border-color);
  overflow-y: auto;
}

.editor-panel {
  flex: 1;
  overflow: hidden;
}

.characters-page,
.worldbook-page,
.settings-page {
  height: 100%;
  overflow-y: auto;
  padding: 24px;
}

.map-page {
  height: 100%;
  overflow: hidden;
}

.map-container {
  display: flex;
  height: 100%;
}

.map-sidebar {
  width: 280px;
  background: var(--card-bg);
  border-right: 1px solid var(--border-color);
  overflow: hidden;
}

.map-editor-wrapper {
  flex: 1;
  overflow: hidden;
}

.map-empty {
  height: 100%;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--bg-color);
}

.settings-container {
  max-width: 1200px;
  margin: 0 auto;
}

.settings-section {
  margin-bottom: 32px;
}

.section-title {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 18px;
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: 20px;
  padding-bottom: 12px;
  border-bottom: 2px solid var(--border-color);
}

.settings-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 20px;
}

.settings-card {
  background: var(--card-bg);
  border-radius: var(--radius-md);
  padding: 20px;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color);
  transition: all 0.3s ease;
}

.settings-card:hover {
  box-shadow: var(--shadow-md);
  transform: translateY(-2px);
}

.card-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--border-color);
}

.model-name {
  font-weight: 600;
  font-size: 16px;
}

.style-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
  gap: 16px;
  margin-bottom: 20px;
}

.style-card {
  background: var(--card-bg);
  border-radius: var(--radius-md);
  padding: 20px;
  text-align: center;
  cursor: pointer;
  transition: all 0.3s ease;
  border: 2px solid var(--border-color);
}

.style-card:hover {
  border-color: var(--primary-light);
  transform: translateY(-4px);
  box-shadow: var(--shadow-md);
}

.style-card.active {
  border-color: var(--primary-color);
  background: linear-gradient(135deg, rgba(99, 102, 241, 0.05), rgba(244, 114, 182, 0.05));
}

.style-icon {
  font-size: 32px;
  margin-bottom: 8px;
}

.style-name {
  font-size: 14px;
  font-weight: 500;
  color: var(--text-primary);
}

.custom-prompt {
  margin-top: 16px;
}

.fade-slide-enter-active,
.fade-slide-leave-active {
  transition: all 0.4s cubic-bezier(0.4, 0, 0.2, 1);
}

.fade-slide-enter-from {
  opacity: 0;
  transform: translateY(20px);
}

.fade-slide-leave-to {
  opacity: 0;
  transform: translateY(-20px);
}

@keyframes fadeInUp {
  from {
    opacity: 0;
    transform: translateY(30px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

@keyframes pulse {
  0%, 100% {
    opacity: 1;
  }
  50% {
    opacity: 0.7;
  }
}

@keyframes shimmer {
  0% {
    background-position: -1000px 0;
  }
  100% {
    background-position: 1000px 0;
  }
}

.loading-shimmer {
  animation: shimmer 2s infinite linear;
  background: linear-gradient(to right, var(--bg-secondary) 4%, var(--card-bg) 25%, var(--bg-secondary) 36%);
  background-size: 1000px 100%;
}

::-webkit-scrollbar {
  width: 8px;
  height: 8px;
}

::-webkit-scrollbar-track {
  background: var(--bg-secondary);
  border-radius: 4px;
}

::-webkit-scrollbar-thumb {
  background: linear-gradient(135deg, var(--primary-light), var(--accent-color));
  border-radius: 4px;
  transition: background 0.3s ease;
}

::-webkit-scrollbar-thumb:hover {
  background: linear-gradient(135deg, var(--primary-color), var(--accent-color));
}

@media (max-width: 1024px) {
  .app-header {
    padding: 0 16px;
  }

  .header-center {
    position: static;
    transform: none;
  }

  .main-tabs {
    gap: 4px;
  }

  .tab-item {
    padding: 8px 16px;
    font-size: 13px;
  }

  .tab-item span {
    display: none;
  }

  .sidebar-panel {
    width: 240px;
  }
}

@media (max-width: 768px) {
  .app-header {
    height: 56px;
    padding: 0 12px;
  }

  .logo-text {
    font-size: 16px;
  }

  .header-right {
    display: none;
  }

  .sidebar-panel {
    width: 100%;
    max-width: 280px;
  }

  .editor-page {
    flex-direction: column;
  }

  .characters-page,
  .worldbook-page,
  .settings-page {
    padding: 16px;
  }

  .settings-grid {
    grid-template-columns: 1fr;
  }

  .style-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}
</style>
