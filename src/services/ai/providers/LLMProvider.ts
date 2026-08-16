/**
 * LLMProvider 接口定义（模型接入抽象，自研薄抽象，不用 LangChain）
 * 三个实现：OpenAICompatProvider / AnthropicProvider / GoogleProvider
 */

export type ChatRole = 'system' | 'user' | 'assistant';

export interface ChatMessage {
  role: ChatRole;
  content: string;
}

export interface ChatOptions {
  model: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal; // 必须支持中断
}

export interface ChatResponse {
  content: string;
  usage: { promptTokens: number; completionTokens: number };
}

export interface ChatChunk {
  delta: string;
  done: boolean;
}

export interface LLMProvider {
  readonly name: string; // 'openai_compat' | 'anthropic' | 'google'
  chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse>;
  stream(messages: ChatMessage[], options: ChatOptions): AsyncIterable<ChatChunk>;
  countTokens(text: string): number; // 近似估算即可
  /** 向量嵌入（P1 世界书 RAG 用；Anthropic 无此能力，不实现） */
  embed?(texts: string[], model: string): Promise<number[][]>;
}

/** 向量嵌入结果 */
export interface EmbeddingVector {
  values: number[];
  model: string;
}

/** Provider 配置（存 SQLite，apiKey 存 keytar） */
export interface ProviderConfig {
  id: string;
  name: string; // 用户起的名字，如"我的 OpenAI"
  provider: string; // 'openai_compat' | 'anthropic' | 'google'
  baseUrl?: string; // openai_compat 必填，可指向 DeepSeek/Kimi 等
  model: string; // 如 'gpt-4o' / 'claude-3-5-sonnet' / 'gemini-1.5-pro'
  // apiKey 通过 keytar 存取，key = `provider_${id}`
}

import { countTokens } from '../../../utils/tokens';
import { OpenAICompatProvider } from './OpenAICompatProvider';
import { AnthropicProvider } from './AnthropicProvider';
import { GoogleProvider } from './GoogleProvider';

/** 工厂：按配置创建 Provider */
export function createProvider(config: ProviderConfig, apiKey: string): LLMProvider {
  switch (config.provider) {
    case 'openai_compat':
      return new OpenAICompatProvider(config, apiKey);
    case 'anthropic':
      return new AnthropicProvider(config, apiKey);
    case 'google':
      return new GoogleProvider(config, apiKey);
    default:
      throw new Error(`未知 provider 类型: ${config.provider}`);
  }
}

/** token 近似估算（共享） */
export function estimateTokens(text: string): number {
  return countTokens(text);
}
