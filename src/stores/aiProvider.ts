import { defineStore } from 'pinia'
import { ref, computed } from 'vue'
import type { AIProvider, AIModel } from '@/types'
import { db } from '@/database'

const DEFAULT_PROVIDERS: AIProvider[] = [
  {
    id: 'glm',
    name: '智谱AI (GLM)',
    type: 'glm',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4/chat/completions',
    apiKey: '',
    enabled: true,
    models: [
      { id: 'glm-5.3', name: 'glm-5.3', providerId: 'glm', maxTokens: 8192 },
      { id: 'glm-5.2', name: 'glm-5.2', providerId: 'glm', maxTokens: 8192 },
    ]
  },
  {
    id: 'deepseek',
    name: 'DeepSeek',
    type: 'deepseek',
    baseUrl: 'https://api.deepseek.com/chat/completions',
    apiKey: '',
    enabled: true,
    models: [
      { id: 'deepseek-v4-flash', name: 'deepseek-v4-flash', providerId: 'deepseek', maxTokens: 8192 },
      { id: 'deepseek-v4-pro', name: 'deepseek-v4-pro', providerId: 'deepseek', maxTokens: 8192 }
    ]
  },
  {
    id: 'openai',
    name: 'OpenAI',
    type: 'openai',
    baseUrl: 'https://api.openai.com/v1/chat/completions',
    apiKey: '',
    enabled: false,
    models: [
      { id: 'gpt-4o', name: 'GPT-4o', providerId: 'openai', maxTokens: 8192 },
      { id: 'gpt-4o-mini', name: 'GPT-4o Mini', providerId: 'openai', maxTokens: 8192 },
      { id: 'gpt-4-turbo', name: 'GPT-4 Turbo', providerId: 'openai', maxTokens: 8192 },
      { id: 'gpt-3.5-turbo', name: 'GPT-3.5 Turbo', providerId: 'openai', maxTokens: 4096 }
    ]
  },
  {
    id: 'anthropic',
    name: 'Anthropic (Claude)',
    type: 'anthropic',
    baseUrl: 'https://api.anthropic.com/v1/messages',
    apiKey: '',
    enabled: false,
    headers: {
      'anthropic-version': '2023-06-01'
    },
    models: [
      { id: 'claude-3-5-sonnet-20241022', name: 'Claude 3.5 Sonnet', providerId: 'anthropic', maxTokens: 8192 },
      { id: 'claude-3-5-haiku-20241022', name: 'Claude 3.5 Haiku', providerId: 'anthropic', maxTokens: 8192 },
      { id: 'claude-3-opus-20240229', name: 'Claude 3 Opus', providerId: 'anthropic', maxTokens: 8192 }
    ]
  },
  {
    id: 'xai',
    name: 'xAI (Grok)',
    type: 'xai',
    baseUrl: 'https://api.x.ai/v1/chat/completions',
    apiKey: '',
    enabled: false,
    models: [
      { id: 'grok-beta', name: 'Grok Beta', providerId: 'xai', maxTokens: 8192 }
    ]
  },
  {
    id: 'nalang',
    name: '纳澜AI (Nalang)',
    type: 'nalang',
    baseUrl: 'https://www.gpt4novel.com/api/xiaoshuoai/ext/v1/chat/completions',
    apiKey: '',
    enabled: false,
    models: [
      { id: 'nalang-max-0826', name: 'Nalang Max 32K', providerId: 'nalang', maxTokens: 8192 },
      { id: 'nalang-max-0826-16k', name: 'Nalang Max 16K', providerId: 'nalang', maxTokens: 8192 },
      { id: 'nalang-max-0826-10k', name: 'Nalang Max 10K', providerId: 'nalang', maxTokens: 8192 },
      { id: 'nalang-xl-0826', name: 'Nalang XL 32K', providerId: 'nalang', maxTokens: 8192 },
      { id: 'nalang-xl-0826-16k', name: 'Nalang XL 16K', providerId: 'nalang', maxTokens: 8192 },
      { id: 'nalang-xl-0826-10k', name: 'Nalang XL 10K', providerId: 'nalang', maxTokens: 8192 },
      { id: 'nalang-medium-0826', name: 'Nalang Medium 32K', providerId: 'nalang', maxTokens: 8192 },
      { id: 'nalang-turbo-0826', name: 'Nalang Turbo 32K', providerId: 'nalang', maxTokens: 8192 }
    ]
  }
]

export const useAIProviderStore = defineStore('aiProvider', () => {
  const providers = ref<AIProvider[]>([])
  const customProviders = ref<AIProvider[]>([])
  const selectedProviderId = ref('glm')
  const selectedModelId = ref('glm-4-plus')
  const isInitialized = ref(false)
  const isLoading = ref(false)

  const allProviders = computed(() => [...providers.value, ...customProviders.value])
  
  const enabledProviders = computed(() => 
    [...providers.value, ...customProviders.value].filter(p => p.enabled && p.apiKey)
  )
  
  const selectedProvider = computed(() => {
    return allProviders.value.find(p => p.id === selectedProviderId.value)
  })
  
  const selectedModel = computed(() => {
    for (const provider of allProviders.value) {
      const model = provider.models.find(m => m.id === selectedModelId.value)
      if (model) return model
    }
    return null
  })
  
  const allModels = computed(() => {
    const models: AIModel[] = []
    allProviders.value.forEach(provider => {
      if (provider.enabled && provider.apiKey) {
        models.push(...provider.models)
      }
    })
    return models
  })

  async function init() {
    if (isInitialized.value) return
    
    isLoading.value = true
    try {
      const savedProviders = await db.aiProviders.toArray()
      
      if (savedProviders.length > 0) {
        const savedMap = new Map(savedProviders.map(p => [p.id, p]))
        
        providers.value = DEFAULT_PROVIDERS.map(defaultProvider => {
          const saved = savedMap.get(defaultProvider.id)
          if (saved) {
            return {
              ...defaultProvider,
              apiKey: saved.apiKey || '',
              enabled: saved.enabled,
              baseUrl: saved.baseUrl || defaultProvider.baseUrl,
              headers: saved.headers || defaultProvider.headers,
              bodyTemplate: saved.bodyTemplate || defaultProvider.bodyTemplate
            }
          }
          return defaultProvider
        })
        
        customProviders.value = savedProviders.filter(p => p.isCustom)
      } else {
        providers.value = [...DEFAULT_PROVIDERS]
        await save()
      }

      const savedSelectedProviderId = await db.settings.get('selectedProviderId')
      if (savedSelectedProviderId) {
        selectedProviderId.value = savedSelectedProviderId.value
      }

      const savedSelectedModelId = await db.settings.get('selectedModelId')
      if (savedSelectedModelId) {
        selectedModelId.value = savedSelectedModelId.value
      }

      isInitialized.value = true
    } catch (e) {
      console.error('加载 AI 提供商数据失败:', e)
      providers.value = [...DEFAULT_PROVIDERS]
    } finally {
      isLoading.value = false
    }
  }

  async function save() {
    try {
      const allProviderData = JSON.parse(JSON.stringify([...providers.value, ...customProviders.value]))
      console.log('保存 AI 提供商数据:', allProviderData)
      await db.aiProviders.clear()
      await db.aiProviders.bulkPut(allProviderData)
      
      await db.settings.put({ key: 'selectedProviderId', value: selectedProviderId.value })
      await db.settings.put({ key: 'selectedModelId', value: selectedModelId.value })
      console.log('AI 提供商数据保存成功')
    } catch (e) {
      console.error('保存 AI 提供商数据失败:', e)
      throw e
    }
  }

  async function updateProvider(id: string, updates: Partial<AIProvider>) {
    console.log('updateProvider:', id, updates)
    const providerIndex = providers.value.findIndex(p => p.id === id)
    if (providerIndex !== -1) {
      providers.value[providerIndex] = { ...providers.value[providerIndex], ...updates }
      console.log('更新后的 provider:', providers.value[providerIndex])
    } else {
      const customIndex = customProviders.value.findIndex(p => p.id === id)
      if (customIndex !== -1) {
        customProviders.value[customIndex] = { ...customProviders.value[customIndex], ...updates }
      }
    }
    await save()
  }

  async function addCustomProvider(provider: AIProvider) {
    customProviders.value.push({ ...provider, isCustom: true })
    await save()
  }

  async function removeCustomProvider(id: string) {
    const index = customProviders.value.findIndex(p => p.id === id)
    if (index !== -1) {
      customProviders.value.splice(index, 1)
      await save()
    }
  }

  async function setSelectedProvider(id: string) {
    selectedProviderId.value = id
    const provider = allProviders.value.find(p => p.id === id)
    if (provider && provider.models.length > 0) {
      selectedModelId.value = provider.models[0].id
    }
    await save()
  }

  async function setSelectedModel(id: string) {
    selectedModelId.value = id
    await save()
  }

  function getProviderById(id: string): AIProvider | undefined {
    return allProviders.value.find(p => p.id === id)
  }

  function getModelById(id: string): AIModel | undefined {
    for (const provider of allProviders.value) {
      const model = provider.models.find(m => m.id === id)
      if (model) return model
    }
    return undefined
  }

  return {
    providers,
    customProviders,
    selectedProviderId,
    selectedModelId,
    isInitialized,
    isLoading,
    allProviders,
    enabledProviders,
    selectedProvider,
    selectedModel,
    allModels,
    init,
    save,
    updateProvider,
    addCustomProvider,
    removeCustomProvider,
    setSelectedProvider,
    setSelectedModel,
    getProviderById,
    getModelById
  }
})
