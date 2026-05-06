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
            :class="{ active: activeMainTab === 'stats' }"
            @click="activeMainTab = 'stats'"
          >
            <el-icon><DataLine /></el-icon>
            <span>统计</span>
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
        <div class="writing-stats-badge" v-if="writingStatsStore.todayWordsWritten.value > 0">
          <el-icon><EditPen /></el-icon>
          {{ writingStatsStore.todayWordsWritten.value }} / {{ writingStatsStore.dailyGoal.value }}
        </div>
        <el-button size="small" @click="darkMode.toggleDark()" :title="darkMode.isDark.value ? '切换浅色模式' : '切换暗黑模式'">
          <el-icon v-if="darkMode.isDark.value"><Sunny /></el-icon>
          <el-icon v-else><Moon /></el-icon>
        </el-button>
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
        
        <div v-else-if="activeMainTab === 'stats'" class="stats-page">
          <div class="stats-container">
            <div class="stats-hero">
              <div class="stats-hero-content">
                <div class="stats-hero-title">今日写作进度</div>
                <div class="stats-hero-value">
                  <span class="hero-number">{{ writingStatsStore.todayWordsWritten.value }}</span>
                  <span class="hero-unit">/ {{ writingStatsStore.dailyGoal.value }} 字</span>
                </div>
                <div class="stats-hero-progress">
                  <div class="hero-progress-bar">
                    <div
                      class="hero-progress-fill"
                      :class="{ 'goal-complete': writingStatsStore.todayProgress.value >= 100 }"
                      :style="{ width: Math.min(writingStatsStore.todayProgress.value, 100) + '%' }"
                    ></div>
                  </div>
                  <span class="hero-progress-text">{{ writingStatsStore.todayProgress.value }}%</span>
                </div>
              </div>
              <div class="stats-hero-decoration">
                <svg viewBox="0 0 120 120" class="progress-ring">
                  <circle cx="60" cy="60" r="54" class="progress-ring-bg" />
                  <circle
                    cx="60" cy="60" r="54"
                    class="progress-ring-fill"
                    :class="{ 'goal-complete': writingStatsStore.todayProgress.value >= 100 }"
                    :stroke-dasharray="2 * Math.PI * 54"
                    :stroke-dashoffset="2 * Math.PI * 54 * (1 - Math.min(writingStatsStore.todayProgress.value, 100) / 100)"
                  />
                  <text x="60" y="55" text-anchor="middle" class="ring-text-value">{{ writingStatsStore.todayProgress.value }}%</text>
                  <text x="60" y="72" text-anchor="middle" class="ring-text-label">完成度</text>
                </svg>
              </div>
            </div>

            <div class="stats-cards">
              <div class="stat-card stat-card-words">
                <div class="stat-card-icon">📝</div>
                <div class="stat-card-info">
                  <div class="stat-card-value">{{ writingStatsStore.todayWordsWritten.value }}</div>
                  <div class="stat-card-label">今日字数</div>
                </div>
              </div>
              <div class="stat-card stat-card-goal">
                <div class="stat-card-icon">🎯</div>
                <div class="stat-card-info">
                  <div class="stat-card-value">{{ writingStatsStore.dailyGoal.value }}</div>
                  <div class="stat-card-label">每日目标</div>
                </div>
              </div>
              <div class="stat-card stat-card-streak">
                <div class="stat-card-icon">🔥</div>
                <div class="stat-card-info">
                  <div class="stat-card-value">{{ writingStatsStore.streakDays.value }}</div>
                  <div class="stat-card-label">连续天数</div>
                </div>
              </div>
              <div class="stat-card stat-card-avg">
                <div class="stat-card-icon">📊</div>
                <div class="stat-card-info">
                  <div class="stat-card-value">{{ writingStatsStore.weeklyAverage.value }}</div>
                  <div class="stat-card-label">周均字数</div>
                </div>
              </div>
            </div>

            <div class="stats-section">
              <h3 class="section-title">
                <el-icon><Calendar /></el-icon>
                近7日统计
              </h3>
              <div class="weekly-chart">
                <div class="chart-y-axis">
                  <span>{{ writingStatsStore.dailyGoal.value }}</span>
                  <span>{{ Math.round(writingStatsStore.dailyGoal.value / 2) }}</span>
                  <span>0</span>
                </div>
                <div class="chart-bars">
                  <div
                    v-for="(day, index) in weeklyData"
                    :key="index"
                    class="chart-bar-wrapper"
                  >
                    <div class="chart-bar-tooltip">{{ day.wordCount }} 字</div>
                    <div class="chart-bar-container">
                      <div
                        class="chart-bar"
                        :style="{ height: getBarHeight(day.wordCount) + '%' }"
                        :class="{ 'goal-reached': day.wordCount >= writingStatsStore.dailyGoal.value }"
                      ></div>
                    </div>
                    <div class="chart-label">{{ day.label }}</div>
                  </div>
                </div>
              </div>
            </div>

            <div class="stats-bottom-row">
              <div class="stats-section stats-section-goal">
                <h3 class="section-title">
                  <el-icon><Setting /></el-icon>
                  目标设置
                </h3>
                <div class="goal-setting-content">
                  <div class="goal-setting-row">
                    <span class="goal-label">每日目标字数</span>
                    <div class="goal-input-group">
                      <el-input-number
                        v-model="dailyGoalInput"
                        :min="100"
                        :max="50000"
                        :step="100"
                        @change="updateDailyGoal"
                        size="large"
                      />
                      <span class="goal-unit">字</span>
                    </div>
                  </div>
                  <div class="goal-presets">
                    <span class="preset-label">快速设置：</span>
                    <el-button size="small" v-for="preset in [1000, 2000, 3000, 5000]" :key="preset"
                      :type="dailyGoalInput === preset ? 'primary' : 'default'"
                      @click="dailyGoalInput = preset; updateDailyGoal(preset)">
                      {{ preset }}字
                    </el-button>
                  </div>
                </div>
              </div>

              <div class="stats-section stats-section-appearance">
                <h3 class="section-title">
                  <el-icon><Sunny /></el-icon>
                  外观设置
                </h3>
                <div class="appearance-settings">
                  <div class="appearance-item">
                    <div class="appearance-info">
                      <span class="appearance-label">暗黑模式</span>
                      <span class="appearance-desc">切换深色主题，保护眼睛</span>
                    </div>
                    <el-switch :model-value="darkMode.isDark.value" @change="(val: boolean) => darkMode.applyTheme(val)" />
                  </div>
                </div>
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
import { ref, reactive, watch, onMounted, computed } from 'vue'
import { EditPen, User, Reading, Setting, Document, MapLocation, DataLine, Sunny, Moon, Calendar } from '@element-plus/icons-vue'
import { useSettingsStore } from '@/stores/settings'
import { useChapterStore } from '@/stores/chapter'
import { useCharacterStore } from '@/stores/character'
import { useWorldBookStore } from '@/stores/worldBook'
import { useCollectionStore } from '@/stores/collection'
import { useAIProviderStore } from '@/stores/aiProvider'
import { useMapStore } from '@/stores/map'
import { useWritingStatsStore } from '@/stores/writingStats'
import { useDarkMode } from '@/composables/useDarkMode'
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
const writingStatsStore = useWritingStatsStore()
const darkMode = useDarkMode()

const editorRef = ref()

const activeMainTab = ref('editor')
const dailyGoalInput = ref(2000)

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
    mapStore.loadMaps(),
    writingStatsStore.loadStats(),
    darkMode.loadDarkModePreference()
  ])
  
  styleSettings.selectedStyle = settingsStore.selectedStyle || 'default'
  styleSettings.prompt = settingsStore.stylePrompt || ''
  dailyGoalInput.value = writingStatsStore.dailyGoal.value
  loadWeeklyData()
})

const weeklyData = ref<{ label: string; wordCount: number }[]>([])

async function loadWeeklyData() {
  const stats = await writingStatsStore.getLast7DaysStats()
  const dayNames = ['日', '一', '二', '三', '四', '五', '六']
  weeklyData.value = stats.map(s => {
    const d = new Date(s.date)
    return {
      label: '周' + dayNames[d.getDay()],
      wordCount: s.wordCount
    }
  })
}

function getBarHeight(wordCount: number): number {
  const goal = writingStatsStore.dailyGoal.value
  if (goal <= 0) return 0
  return Math.min(100, Math.round((wordCount / goal) * 100))
}

function updateDailyGoal(value: number) {
  writingStatsStore.updateDailyGoal(value)
}

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

[data-theme="dark"] {
  --primary-color: #818cf8;
  --primary-light: #a5b4fc;
  --primary-dark: #6366f1;
  --accent-color: #f9a8d4;
  --bg-color: #0f1117;
  --bg-secondary: #1a1b26;
  --card-bg: #1e1f2e;
  --text-primary: #e5e7eb;
  --text-secondary: #9ca3af;
  --text-muted: #6b7280;
  --border-color: #2d2e3f;
  --shadow-sm: 0 1px 2px rgba(0, 0, 0, 0.3);
  --shadow-md: 0 4px 6px -1px rgba(0, 0, 0, 0.4);
  --shadow-lg: 0 10px 15px -3px rgba(0, 0, 0, 0.5);
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

.stats-page {
  height: 100%;
  overflow-y: auto;
  padding: 24px;
  background: var(--bg-color);
}

.stats-container {
  max-width: 960px;
  margin: 0 auto;
}

.stats-hero {
  background: linear-gradient(135deg, var(--primary-color), var(--accent-color));
  border-radius: var(--radius-lg);
  padding: 32px 36px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 24px;
  box-shadow: 0 8px 32px rgba(99, 102, 241, 0.25);
  position: relative;
  overflow: hidden;
}

.stats-hero::before {
  content: '';
  position: absolute;
  top: -50%;
  right: -20%;
  width: 300px;
  height: 300px;
  background: rgba(255, 255, 255, 0.08);
  border-radius: 50%;
}

.stats-hero::after {
  content: '';
  position: absolute;
  bottom: -30%;
  left: 10%;
  width: 200px;
  height: 200px;
  background: rgba(255, 255, 255, 0.05);
  border-radius: 50%;
}

.stats-hero-content {
  flex: 1;
  z-index: 1;
}

.stats-hero-title {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.8);
  font-weight: 500;
  margin-bottom: 8px;
  letter-spacing: 1px;
  text-transform: uppercase;
}

.stats-hero-value {
  margin-bottom: 16px;
}

.hero-number {
  font-size: 48px;
  font-weight: 700;
  color: #fff;
  line-height: 1;
}

.hero-unit {
  font-size: 16px;
  color: rgba(255, 255, 255, 0.7);
  margin-left: 4px;
}

.stats-hero-progress {
  display: flex;
  align-items: center;
  gap: 12px;
}

.hero-progress-bar {
  flex: 1;
  max-width: 300px;
  height: 8px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 4px;
  overflow: hidden;
}

.hero-progress-fill {
  height: 100%;
  background: #fff;
  border-radius: 4px;
  transition: width 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}

.hero-progress-fill.goal-complete {
  background: #67c23a;
}

.hero-progress-text {
  font-size: 14px;
  color: rgba(255, 255, 255, 0.9);
  font-weight: 600;
  min-width: 40px;
}

.stats-hero-decoration {
  z-index: 1;
  flex-shrink: 0;
  margin-left: 24px;
}

.progress-ring {
  width: 120px;
  height: 120px;
  transform: rotate(-90deg);
}

.progress-ring-bg {
  fill: none;
  stroke: rgba(255, 255, 255, 0.15);
  stroke-width: 8;
}

.progress-ring-fill {
  fill: none;
  stroke: #fff;
  stroke-width: 8;
  stroke-linecap: round;
  transition: stroke-dashoffset 0.6s cubic-bezier(0.4, 0, 0.2, 1);
}

.progress-ring-fill.goal-complete {
  stroke: #67c23a;
}

.ring-text-value {
  fill: #fff;
  font-size: 20px;
  font-weight: 700;
  transform: rotate(90deg);
  transform-origin: 60px 60px;
}

.ring-text-label {
  fill: rgba(255, 255, 255, 0.7);
  font-size: 10px;
  transform: rotate(90deg);
  transform-origin: 60px 60px;
}

.stats-cards {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  margin-bottom: 24px;
}

.stat-card {
  background: var(--card-bg);
  border-radius: var(--radius-md);
  padding: 20px;
  display: flex;
  align-items: center;
  gap: 16px;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color);
  transition: all 0.3s ease;
}

.stat-card:hover {
  transform: translateY(-2px);
  box-shadow: var(--shadow-md);
}

.stat-card-icon {
  width: 48px;
  height: 48px;
  border-radius: var(--radius-sm);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 24px;
  flex-shrink: 0;
}

.stat-card-words .stat-card-icon {
  background: rgba(99, 102, 241, 0.1);
}

.stat-card-goal .stat-card-icon {
  background: rgba(16, 185, 129, 0.1);
}

.stat-card-streak .stat-card-icon {
  background: rgba(245, 158, 11, 0.1);
}

.stat-card-avg .stat-card-icon {
  background: rgba(139, 92, 246, 0.1);
}

.stat-card-info {
  flex: 1;
  min-width: 0;
}

.stat-card-value {
  font-size: 24px;
  font-weight: 700;
  color: var(--text-primary);
  line-height: 1.2;
}

.stat-card-label {
  font-size: 12px;
  color: var(--text-muted);
  margin-top: 2px;
}

.stats-section {
  background: var(--card-bg);
  border-radius: var(--radius-md);
  padding: 24px;
  margin-bottom: 24px;
  box-shadow: var(--shadow-sm);
  border: 1px solid var(--border-color);
}

.weekly-chart {
  display: flex;
  gap: 0;
  height: 220px;
  position: relative;
}

.chart-y-axis {
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding-right: 12px;
  padding-bottom: 36px;
  font-size: 11px;
  color: var(--text-muted);
  text-align: right;
  min-width: 48px;
}

.chart-bars {
  flex: 1;
  display: flex;
  align-items: flex-end;
  gap: 12px;
  padding-bottom: 36px;
  position: relative;
  border-bottom: 1px solid var(--border-color);
}

.chart-bar-wrapper {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  position: relative;
  height: 100%;
}

.chart-bar-tooltip {
  position: absolute;
  top: -8px;
  left: 50%;
  transform: translateX(-50%);
  background: var(--text-primary);
  color: var(--card-bg);
  font-size: 11px;
  padding: 2px 8px;
  border-radius: 4px;
  white-space: nowrap;
  opacity: 0;
  transition: opacity 0.2s;
  pointer-events: none;
  z-index: 2;
}

.chart-bar-wrapper:hover .chart-bar-tooltip {
  opacity: 1;
}

.chart-bar-container {
  flex: 1;
  width: 100%;
  display: flex;
  align-items: flex-end;
  justify-content: center;
}

.chart-bar {
  width: 70%;
  max-width: 48px;
  min-height: 4px;
  background: linear-gradient(180deg, var(--primary-color), var(--primary-light));
  border-radius: 6px 6px 2px 2px;
  transition: height 0.5s cubic-bezier(0.4, 0, 0.2, 1);
  position: relative;
}

.chart-bar:hover {
  filter: brightness(1.1);
}

.chart-bar.goal-reached {
  background: linear-gradient(180deg, #10b981, #34d399);
}

.chart-label {
  position: absolute;
  bottom: -28px;
  font-size: 12px;
  color: var(--text-secondary);
  white-space: nowrap;
}

.stats-bottom-row {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 24px;
}

.stats-section-goal,
.stats-section-appearance {
  margin-bottom: 0;
}

.goal-setting-content {
  padding: 4px 0;
}

.goal-setting-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 16px;
}

.goal-label {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 500;
}

.goal-input-group {
  display: flex;
  align-items: center;
  gap: 8px;
}

.goal-unit {
  font-size: 14px;
  color: var(--text-secondary);
}

.goal-presets {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}

.preset-label {
  font-size: 12px;
  color: var(--text-muted);
}

.appearance-settings {
  padding: 4px 0;
}

.appearance-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 0;
}

.appearance-info {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.appearance-label {
  font-size: 14px;
  color: var(--text-primary);
  font-weight: 500;
}

.appearance-desc {
  font-size: 12px;
  color: var(--text-muted);
}

@media (max-width: 768px) {
  .stats-hero {
    flex-direction: column;
    text-align: center;
    padding: 24px;
  }

  .stats-hero-decoration {
    margin-left: 0;
    margin-top: 16px;
  }

  .stats-cards {
    grid-template-columns: repeat(2, 1fr);
  }

  .stats-bottom-row {
    grid-template-columns: 1fr;
  }

  .hero-number {
    font-size: 36px;
  }
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
