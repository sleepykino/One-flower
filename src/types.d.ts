type NoInfer<T> = [T][T extends any ? 0 : never];

export interface CharacterRelation {
  id: string
  fromCharacterId: string
  toCharacterId: string
  relationType: 'friend' | 'enemy' | 'family' | 'lover' | 'colleague' | 'rival' | 'master' | 'student' | 'other'
  description: string
  createdAt: number
  updatedAt: number
}

export interface Character {
  id: string
  name: string
  description: string
  personality: string
  background: string
  appearance: string
  speech_style: string
  relationships: string
  notes: string
  avatar?: string
  tags: string[]
  enabled: boolean
  collectionId?: string
  color?: string
  relations?: CharacterRelation[]
  createdAt: number
  updatedAt: number
}

export interface WorldBookEntry {
  id: string
  key: string
  keywords: string[]
  content: string
  enabled: boolean
  insertion_order: number
  priority: number
  position: 'before_char' | 'after_char' | 'before_example' | 'after_example'
  case_sensitive: boolean
  use_regex: boolean
  tags: string[]
  groupId?: string
  createdAt: number
  updatedAt: number
}

export interface WorldBookGroup {
  id: string
  name: string
  description: string
  entries: WorldBookEntry[]
  enabled: boolean
  worldBookId?: string
  createdAt: number
  updatedAt: number
}

export interface WorldBook {
  id: string
  name: string
  description: string
  groups: WorldBookGroup[]
  scan_depth: number
  token_budget: number
  recursive_scanning: boolean
  enabled: boolean
  collectionId?: string
  color?: string
  icon?: string
  createdAt: number
  updatedAt: number
}

export interface Collection {
  id: string
  name: string
  description: string
  type: 'character' | 'worldbook'
  color: string
  icon: string
  createdAt: number
  updatedAt: number
}

export interface ExtendedContinuationRequest {
  prompt: string
  model: AIModel
  maxTokens: number
  temperature?: number
  stylePrompt?: string
  characters?: Character[]
  worldBookEntries?: WorldBookEntry[]
  useWorldBook?: boolean
  useCharacters?: boolean
}

export type ContinuationLengthType = 'words' | 'paragraphs' | 'scenes'

export interface ContinuationLengthConfig {
  type: ContinuationLengthType
  value: number
}

export type ContinuationDirection = 'plot' | 'emotion' | 'scene' | 'dialogue' | 'action' | 'suspense'

export interface ContinuationDirectionConfig {
  direction: ContinuationDirection
  intensity: number // 0-10
}

export interface ContinuationCandidate {
  id: string
  text: string
  direction?: ContinuationDirection
  created: number
}

export type PolishingType = 'polish' | 'rewrite' | 'expand'

export interface PolishingRequest {
  text: string
  type: PolishingType
  instruction?: string
  model?: AIModel
  temperature?: number
}

export interface StyleAnalysis {
  styleType: string
  keywords: string[]
  sentenceStructure: string
  vocabularyLevel: string
  tone: string
}

export type AIProviderType = 'glm' | 'deepseek' | 'openai' | 'anthropic' | 'xai' | 'nalang' | 'custom'

export interface AIProvider {
  id: string
  name: string
  type: AIProviderType
  baseUrl: string
  apiKey: string
  models: AIModel[]
  enabled: boolean
  isCustom?: boolean
  headers?: Record<string, string>
  bodyTemplate?: string
}

export interface AIModel {
  name: string
  id: string
  providerId: string
  maxTokens: number
  supportsSystemPrompt?: boolean
}

export interface CustomAPIConfig {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  modelName: string
  headers?: Record<string, string>
  requestBody?: string
  responsePath?: string
}
