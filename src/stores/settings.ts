import { defineStore } from 'pinia'
import { ref } from 'vue'
import { db } from '@/database'

export const useSettingsStore = defineStore('settings', () => {
  const glmApiKey = ref('')
  const glmTemperature = ref(0.7)
  const deepseekApiKey = ref('')
  const deepseekTemperature = ref(0.7)
  const selectedStyle = ref('default')
  const stylePrompt = ref('')
  const isInitialized = ref(false)
  const isLoading = ref(false)

  async function loadSettings() {
    if (isInitialized.value) return
    
    isLoading.value = true
    try {
      const settings = await db.settings.toArray()
      const settingsMap = new Map(settings.map(s => [s.key, s.value]))
      
      glmApiKey.value = settingsMap.get('glmApiKey') || ''
      glmTemperature.value = Number(settingsMap.get('glmTemperature')) || 0.7
      deepseekApiKey.value = settingsMap.get('deepseekApiKey') || ''
      deepseekTemperature.value = Number(settingsMap.get('deepseekTemperature')) || 0.7
      selectedStyle.value = settingsMap.get('selectedStyle') || 'default'
      stylePrompt.value = settingsMap.get('stylePrompt') || ''
      
      isInitialized.value = true
    } catch (e) {
      console.error('加载设置失败:', e)
    } finally {
      isLoading.value = false
    }
  }

  async function updateGlmApiKey(key: string) {
    glmApiKey.value = key
    await db.settings.put({ key: 'glmApiKey', value: key })
  }

  async function updateGlmTemperature(temp: number) {
    glmTemperature.value = temp
    await db.settings.put({ key: 'glmTemperature', value: temp })
  }

  async function updateDeepseekApiKey(key: string) {
    deepseekApiKey.value = key
    await db.settings.put({ key: 'deepseekApiKey', value: key })
  }

  async function updateDeepseekTemperature(temp: number) {
    deepseekTemperature.value = temp
    await db.settings.put({ key: 'deepseekTemperature', value: temp })
  }

  async function updateSelectedStyle(styleId: string) {
    selectedStyle.value = styleId
    await db.settings.put({ key: 'selectedStyle', value: styleId })
  }

  async function updateStylePrompt(prompt: string) {
    stylePrompt.value = prompt
    await db.settings.put({ key: 'stylePrompt', value: prompt })
  }

  return {
    glmApiKey,
    glmTemperature,
    deepseekApiKey,
    deepseekTemperature,
    selectedStyle,
    stylePrompt,
    isInitialized,
    isLoading,
    loadSettings,
    updateGlmApiKey,
    updateGlmTemperature,
    updateDeepseekApiKey,
    updateDeepseekTemperature,
    updateSelectedStyle,
    updateStylePrompt
  }
})
