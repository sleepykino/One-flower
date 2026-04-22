import axios from 'axios'
import { useAIProviderStore } from '@/stores/aiProvider'
import { useSettingsStore } from '@/stores/settings'
import type { Character, WorldBookEntry, AIModel } from '@/types'

export interface ContinuationRequest {
  prompt: string
  model?: AIModel
  maxTokens: number
  temperature?: number
  stylePrompt?: string
  characters?: Character[]
  worldBookEntries?: WorldBookEntry[]
  useWorldBook?: boolean
  useCharacters?: boolean
}

export interface ContinuationResponse {
  text: string
  success: boolean
  error?: string
}

function buildCharacterInfo(characters: Character[]): string {
  if (!characters || characters.length === 0) return ''

  const characterInfos = characters.map(char => {
    let info = `【角色：${char.name}】\n`
    if (char.description) info += `描述：${char.description}\n`
    if (char.personality) info += `性格：${char.personality}\n`
    if (char.appearance) info += `外貌：${char.appearance}\n`
    if (char.background) info += `背景：${char.background}\n`
    if (char.speech_style) info += `说话风格：${char.speech_style}\n`
    if (char.relationships) info += `人物关系：${char.relationships}\n`
    if (char.notes) info += `备注：${char.notes}\n`
    return info
  })

  return `\n\n=== 角色信息 ===\n${characterInfos.join('\n')}\n=== 角色信息结束 ===\n`
}

function buildWorldBookInfo(entries: WorldBookEntry[]): string {
  if (!entries || entries.length === 0) return ''

  const entryInfos = entries.map(entry => {
    return `【${entry.key}】\n${entry.content}`
  })

  return `\n\n=== 世界设定 ===\n${entryInfos.join('\n\n')}\n=== 世界设定结束 ===\n`
}

function buildSystemPrompt(
  stylePrompt: string = '',
  characters?: Character[],
  worldBookEntries?: WorldBookEntry[],
  useCharacters: boolean = true,
  useWorldBook: boolean = true
): string {
  let systemPrompt = '你是一个专业的小说续写助手，根据用户提供的提示词续写小说内容，保持文笔连贯，风格一致，只回复续写内容。'

  if (stylePrompt) {
    systemPrompt += `\n\n${stylePrompt}`
  }

  if (useCharacters && characters && characters.length > 0) {
    systemPrompt += buildCharacterInfo(characters)
  }

  if (useWorldBook && worldBookEntries && worldBookEntries.length > 0) {
    systemPrompt += buildWorldBookInfo(worldBookEntries)
  }

  return systemPrompt
}

async function callOpenAICompatibleApi(
  prompt: string,
  baseUrl: string,
  apiKey: string,
  modelId: string,
  temperature: number,
  maxTokens: number,
  systemPrompt?: string,
  extraHeaders?: Record<string, string>
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...extraHeaders
  }
  
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  }

  const messages: { role: string; content: string }[] = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  messages.push({ role: 'user', content: prompt })

  const response = await axios.post(
    baseUrl,
    {
      model: modelId,
      messages,
      temperature,
      max_tokens: maxTokens
    },
    { headers }
  )

  return response.data.choices[0].message.content
}

async function callAnthropicApi(
  prompt: string,
  apiKey: string,
  modelId: string,
  temperature: number,
  maxTokens: number,
  systemPrompt?: string
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'anthropic-version': '2023-06-01',
    'x-api-key': apiKey
  }

  const messages: { role: string; content: string }[] = []
  if (systemPrompt) {
    messages.push({ role: 'system', content: systemPrompt })
  }
  messages.push({ role: 'user', content: prompt })

  const response = await axios.post(
    'https://api.anthropic.com/v1/messages',
    {
      model: modelId,
      messages,
      temperature,
      max_tokens: maxTokens
    },
    { headers }
  )

  return response.data.content[0].text
}

async function callCustomApi(
  prompt: string,
  config: {
    baseUrl: string
    apiKey: string
    modelName: string
    headers?: Record<string, string>
    requestBody?: string
    responsePath?: string
  },
  systemPrompt?: string,
  temperature?: number,
  maxTokens?: number
): Promise<string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...config.headers
  }
  
  if (config.apiKey) {
    headers['Authorization'] = `Bearer ${config.apiKey}`
  }

  let body: Record<string, unknown>
  
  if (config.requestBody) {
    try {
      body = JSON.parse(config.requestBody)
    } catch {
      body = {
        model: config.modelName,
        messages: [],
        temperature,
        max_tokens: maxTokens
      }
    }
  } else {
    body = {
      model: config.modelName,
      messages: [],
      temperature,
      max_tokens: maxTokens
    }
  }

  const messages = body.messages as { role: string; content: string }[]
  if (systemPrompt) {
    messages.unshift({ role: 'system', content: systemPrompt })
  }
  messages.push({ role: 'user', content: prompt })

  const response = await axios.post(config.baseUrl, body, { headers })

  let result = ''
  if (config.responsePath) {
    const paths = config.responsePath.split('.')
    let current: unknown = response.data
    for (const path of paths) {
      if (current && typeof current === 'object') {
        current = (current as Record<string, unknown>)[path]
      }
    }
    result = String(current || '')
  } else {
    result = response.data.choices?.[0]?.message?.content || response.data.content?.[0]?.text || JSON.stringify(response.data)
  }

  return result
}

export async function continueNovel(request: ContinuationRequest): Promise<ContinuationResponse> {
  const aiProviderStore = useAIProviderStore()
  const settingsStore = useSettingsStore()

  try {
    let model: AIModel | undefined = request.model
    let provider = model ? aiProviderStore.getProviderById(model.providerId) : aiProviderStore.selectedProvider

    if (!model && aiProviderStore.selectedModel) {
      model = aiProviderStore.selectedModel
      provider = aiProviderStore.getProviderById(model.providerId)
    }

    if (!model || !provider) {
      return {
        success: false,
        text: '',
        error: '请先选择AI模型'
      }
    }

    if (!provider.apiKey) {
      return {
        success: false,
        text: '',
        error: `请先配置${provider.name}的API Key`
      }
    }

    const useCharacters = request.useCharacters !== undefined ? request.useCharacters : true
    const useWorldBook = request.useWorldBook !== undefined ? request.useWorldBook : true

    const temperature = request.temperature ?? settingsStore.glmTemperature
    const maxTokens = request.maxTokens
    const systemPrompt = buildSystemPrompt(
      request.stylePrompt || settingsStore.stylePrompt,
      request.characters,
      request.worldBookEntries,
      useCharacters,
      useWorldBook
    )

    let result = ''

    switch (provider.type) {
      case 'glm':
      case 'deepseek':
      case 'openai':
      case 'xai':
        result = await callOpenAICompatibleApi(
          request.prompt,
          provider.baseUrl,
          provider.apiKey,
          model.id,
          temperature,
          maxTokens,
          systemPrompt,
          provider.headers
        )
        break
        
      case 'anthropic':
        result = await callAnthropicApi(
          request.prompt,
          provider.apiKey,
          model.id,
          temperature,
          maxTokens,
          systemPrompt
        )
        break
        
      case 'custom':
        if (provider.isCustom && provider.models.length > 0) {
          const customModel = provider.models[0]
          result = await callCustomApi(
            request.prompt,
            {
              baseUrl: provider.baseUrl,
              apiKey: provider.apiKey,
              modelName: customModel.id,
              headers: provider.headers,
              requestBody: provider.bodyTemplate
            },
            systemPrompt,
            temperature,
            maxTokens
          )
        } else {
          return {
            success: false,
            text: '',
            error: '自定义API配置不正确'
          }
        }
        break
        
      default:
        return {
          success: false,
          text: '',
          error: '不支持的AI提供商'
        }
    }

    return {
      success: true,
      text: result
    }
  } catch (error) {
    let errorMessage = '未知错误'

    if (error instanceof Error) {
      errorMessage = error.message
    } else if (axios.isAxiosError(error)) {
      errorMessage = error.response?.data?.error?.message || error.message
    }

    return {
      success: false,
      text: '',
      error: errorMessage
    }
  }
}

export function getDefaultModel(): AIModel | null {
  const aiProviderStore = useAIProviderStore()
  return aiProviderStore.selectedModel
}

export function getAllAvailableModels(): AIModel[] {
  const aiProviderStore = useAIProviderStore()
  return aiProviderStore.allModels
}
