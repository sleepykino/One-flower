import axios from 'axios'
import { useAIProviderStore } from '@/stores/aiProvider'
import { useSettingsStore } from '@/stores/settings'
import type { Character, WorldBookEntry, AIModel, ContinuationLengthConfig, ContinuationDirectionConfig, ContinuationCandidate, PolishingRequest, PolishingType, StyleAnalysis } from '@/types'

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
  lengthConfig?: ContinuationLengthConfig
  directionConfig?: ContinuationDirectionConfig
  context?: string
}

export interface ContinuationResponse {
  text: string
  success: boolean
  error?: string
  candidates?: ContinuationCandidate[]
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
  useWorldBook: boolean = true,
  lengthConfig?: ContinuationLengthConfig,
  directionConfig?: ContinuationDirectionConfig,
  learnedStyle?: string
): string {
  let systemPrompt = '你是一个专业的小说续写助手，根据用户提供的提示词续写小说内容，保持文笔连贯，风格一致，只回复续写内容。'

  if (stylePrompt) {
    systemPrompt += `\n\n${stylePrompt}`
  }

  if (learnedStyle) {
    systemPrompt += `\n\n写作风格参考：${learnedStyle}`
  }

  if (lengthConfig) {
    systemPrompt += `\n\n续写长度要求：`
    switch (lengthConfig.type) {
      case 'words':
        systemPrompt += `约${lengthConfig.value}字`
        break
      case 'paragraphs':
        systemPrompt += `${lengthConfig.value}个段落`
        break
      case 'scenes':
        systemPrompt += `${lengthConfig.value}个完整场景`
        break
    }
  }

  if (directionConfig) {
    const directionDescriptions: Record<string, string> = {
      plot: '重点推动情节发展，制造戏剧冲突',
      emotion: '注重情感描写，细腻刻画人物心理',
      scene: '详细描写场景环境，营造氛围',
      dialogue: '通过对话展开情节，展现人物性格',
      action: '侧重动作描写，紧张刺激',
      suspense: '设置悬念，引发读者好奇心'
    }
    systemPrompt += `\n\n续写方向：${directionDescriptions[directionConfig.direction] || '自然续写'}`
    systemPrompt += `\n该方向的侧重程度：${directionConfig.intensity}/10`
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

export function smartContextCrop(
  fullText: string,
  targetTokens: number = 2000,
  recentRatio: number = 0.7
): string {
  if (!fullText) return ''

  const charsPerToken = 2
  const targetChars = targetTokens * charsPerToken

  if (fullText.length <= targetChars) {
    return fullText
  }

  const recentChars = Math.floor(targetChars * recentRatio)
  const startChars = targetChars - recentChars

  const recentText = fullText.slice(-recentChars)

  let startText = ''
  if (startChars > 0) {
    const firstParagraphEnd = fullText.indexOf('\n\n')
    if (firstParagraphEnd > 0 && firstParagraphEnd < startChars) {
      startText = fullText.slice(0, firstParagraphEnd) + '\n\n...\n\n'
    } else {
      startText = fullText.slice(0, Math.min(startChars, 200)) + '\n\n...\n\n'
    }
  }

  return startText + recentText
}

export function generateId(): string {
  return Date.now().toString(36) + Math.random().toString(36).substring(2, 8)
}

export async function generateCandidates(
  request: ContinuationRequest,
  candidateCount: number = 3
): Promise<ContinuationCandidate[]> {
  const candidates: ContinuationCandidate[] = []
  const directions: ContinuationDirectionConfig[] = [
    { direction: 'plot', intensity: 7 },
    { direction: 'dialogue', intensity: 6 },
    { direction: 'scene', intensity: 5 }
  ]

  for (let i = 0; i < candidateCount && i < directions.length; i++) {
    try {
      const candidateRequest: ContinuationRequest = {
        ...request,
        directionConfig: directions[i]
      }
      const response = await continueNovel(candidateRequest)

      if (response.success && response.text) {
        candidates.push({
          id: generateId(),
          text: response.text,
          direction: directions[i].direction,
          created: Date.now()
        })
      }
    } catch (error) {
      console.error('候选生成失败:', error)
    }
  }

  return candidates
}

export async function polishText(request: PolishingRequest): Promise<ContinuationResponse> {
  const aiProviderStore = useAIProviderStore()
  const settingsStore = useSettingsStore()

  try {
    let model = request.model || aiProviderStore.selectedModel
    const provider = model ? aiProviderStore.getProviderById(model.providerId) : aiProviderStore.selectedProvider

    if (!model || !provider) {
      return { success: false, text: '', error: '请先选择AI模型' }
    }

    const polishingPrompts: Record<PolishingType, string> = {
      polish: '请润色以下文本，保持原意不变，但让文笔更优美流畅：',
      rewrite: '请改写以下文本，用不同的表达方式但保持核心内容不变：',
      expand: '请扩写以下文本，丰富细节描写，让内容更生动具体：'
    }

    let prompt = polishingPrompts[request.type] || polishingPrompts.polish
    prompt += `\n\n${request.text}`

    if (request.instruction) {
      prompt += `\n\n额外要求：${request.instruction}`
    }

    const temperature = request.temperature ?? 0.7
    const maxTokens = Math.max(request.text.length * 2, 500)

    const systemPrompt = '你是一个专业的文字编辑，擅长润色、改写和扩写小说文本。'

    let result = ''

    switch (provider.type) {
      case 'glm':
      case 'deepseek':
      case 'openai':
      case 'xai':
        result = await callOpenAICompatibleApi(
          prompt,
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
          prompt,
          provider.apiKey,
          model.id,
          temperature,
          maxTokens,
          systemPrompt
        )
        break

      case 'custom':
        if (provider.isCustom && provider.models.length > 0) {
          result = await callCustomApi(
            prompt,
            {
              baseUrl: provider.baseUrl,
              apiKey: provider.apiKey,
              modelName: provider.models[0].id,
              headers: provider.headers,
              requestBody: provider.bodyTemplate
            },
            systemPrompt,
            temperature,
            maxTokens
          )
        }
        break
    }

    return { success: true, text: result }
  } catch (error) {
    let errorMessage = '未知错误'
    if (error instanceof Error) errorMessage = error.message
    else if (axios.isAxiosError(error)) errorMessage = error.response?.data?.error?.message || error.message

    return { success: false, text: '', error: errorMessage }
  }
}

export async function analyzeWritingStyle(text: string): Promise<StyleAnalysis> {
  const styleAnalysis: StyleAnalysis = {
    styleType: 'default',
    keywords: [],
    sentenceStructure: 'mixed',
    vocabularyLevel: 'medium',
    tone: 'neutral'
  }

  if (!text || text.length < 100) return styleAnalysis

  const shortSentenceCount = (text.match(/[.!?。！？]/g) || []).length
  const avgSentenceLength = text.length / Math.max(shortSentenceCount, 1)

  if (avgSentenceLength < 20) styleAnalysis.sentenceStructure = 'short'
  else if (avgSentenceLength > 50) styleAnalysis.sentenceStructure = 'long'

  const emotionalWords = ['难过', '开心', '愤怒', '悲伤', '快乐', '痛苦', '幸福', '恐惧', '惊讶', '厌恶']
  styleAnalysis.keywords = emotionalWords.filter(word => text.includes(word))

  if (text.includes('描述') || text.includes('描写')) {
    styleAnalysis.styleType = 'descriptive'
  } else if (text.includes('对话') || text.includes('说')) {
    styleAnalysis.styleType = 'dialogue-heavy'
  } else if (text.includes('战斗') || text.includes('杀')) {
    styleAnalysis.styleType = 'action'
  }

  if (text.includes('啊') || text.includes('呢') || text.includes('吧')) {
    styleAnalysis.tone = 'casual'
  } else if (text.includes('阁下') || text.includes('大人')) {
    styleAnalysis.tone = 'formal'
  }

  return styleAnalysis
}

export function generateStylePrompt(analysis: StyleAnalysis): string {
  let prompt = '请在续写时保持以下风格特点：'

  const structureDescriptions: Record<string, string> = {
    short: '句子简短有力，节奏明快',
    long: '句子优美流畅，结构复杂',
    mixed: '长短句结合，富有节奏感'
  }

  prompt += `\n- 句子结构：${structureDescriptions[analysis.sentenceStructure] || '保持自然'}`
  prompt += `\n- 整体基调：${analysis.tone === 'formal' ? '正式庄重' : analysis.tone === 'casual' ? '轻松随意' : '中性自然'}`

  if (analysis.keywords.length > 0) {
    prompt += `\n- 情感元素：适当包含${analysis.keywords.slice(0, 3).join('、')}等情感描写`
  }

  return prompt
}
