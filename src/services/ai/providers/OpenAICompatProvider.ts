/**
 * OpenAI 兼容协议 Provider（baseURL 可配 → OpenAI / DeepSeek / Kimi / 智谱 / 通义）
 */

import type {
  ChatChunk,
  ChatMessage,
  ChatOptions,
  ChatResponse,
  LLMProvider,
  ProviderConfig
} from './LLMProvider';
import { countTokens } from '../../../utils/tokens';
import { sseLines, tauriFetch } from './sse';

export class OpenAICompatProvider implements LLMProvider {
  readonly name = 'openai_compat';
  private config: ProviderConfig;
  private apiKey: string;

  constructor(config: ProviderConfig, apiKey: string) {
    this.config = config;
    this.apiKey = apiKey;
  }

  private get baseUrl(): string {
    return (this.config.baseUrl ?? 'https://api.openai.com/v1').replace(/\/$/, '');
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse> {
    const res = await tauriFetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        temperature: options.temperature ?? 0.8,
        max_tokens: options.maxTokens ?? 2048
      }),
      signal: options.signal
    });
    if (!res.ok) {
      throw new Error(`OpenAI 兼容接口错误 ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as {
      choices: Array<{ message: { content: string } }>;
      usage?: { prompt_tokens: number; completion_tokens: number };
    };
    return {
      content: data.choices?.[0]?.message?.content ?? '',
      usage: {
        promptTokens: data.usage?.prompt_tokens ?? 0,
        completionTokens: data.usage?.completion_tokens ?? 0
      }
    };
  }

  async *stream(messages: ChatMessage[], options: ChatOptions): AsyncIterable<ChatChunk> {
    const res = await tauriFetch(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`
      },
      body: JSON.stringify({
        model: options.model,
        messages,
        temperature: options.temperature ?? 0.8,
        max_tokens: options.maxTokens ?? 2048,
        stream: true
      }),
      signal: options.signal
    });
    if (!res.ok) {
      throw new Error(`OpenAI 兼容接口错误 ${res.status}: ${await res.text()}`);
    }
    for await (const data of sseLines(res, options.signal)) {
      if (data === '[DONE]') {
        yield { delta: '', done: true };
        return;
      }
      try {
        const json = JSON.parse(data) as {
          choices?: Array<{ delta?: { content?: string } }>;
        };
        const delta = json.choices?.[0]?.delta?.content;
        if (delta) {
          yield { delta, done: false };
        }
      } catch {
        // 忽略无法解析的行
      }
    }
    yield { delta: '', done: true };
  }

  countTokens(text: string): number {
    return countTokens(text);
  }
}
