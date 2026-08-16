/**
 * Google Provider（Gemini 系列）
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

interface GeminiResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
  }>;
  usageMetadata?: {
    promptTokenCount: number;
    candidatesTokenCount: number;
  };
}

export class GoogleProvider implements LLMProvider {
  readonly name = 'google';
  private config: ProviderConfig;
  private apiKey: string;

  constructor(config: ProviderConfig, apiKey: string) {
    this.config = config;
    this.apiKey = apiKey;
  }

  private get baseUrl(): string {
    return (this.config.baseUrl ?? 'https://generativelanguage.googleapis.com').replace(
      /\/$/,
      ''
    );
  }

  private buildBody(messages: ChatMessage[]) {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const contents = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({
        role: m.role === 'assistant' ? 'model' : 'user',
        parts: [{ text: m.content }]
      }));
    return {
      ...(system ? { systemInstruction: { parts: [{ text: system }] } } : {}),
      contents
    };
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse> {
    const res = await tauriFetch(
      `${this.baseUrl}/v1beta/models/${options.model}:generateContent`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey
        },
        body: JSON.stringify(this.buildBody(messages)),
        signal: options.signal
      }
    );
    if (!res.ok) {
      throw new Error(`Google 接口错误 ${res.status}: ${await res.text()}`);
    }
    const data = (await res.json()) as GeminiResponse;
    return {
      content:
        data.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '',
      usage: {
        promptTokens: data.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: data.usageMetadata?.candidatesTokenCount ?? 0
      }
    };
  }

  async *stream(messages: ChatMessage[], options: ChatOptions): AsyncIterable<ChatChunk> {
    const res = await tauriFetch(
      `${this.baseUrl}/v1beta/models/${options.model}:streamGenerateContent?alt=sse`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey
        },
        body: JSON.stringify(this.buildBody(messages)),
        signal: options.signal
      }
    );
    if (!res.ok) {
      throw new Error(`Google 接口错误 ${res.status}: ${await res.text()}`);
    }
    for await (const data of sseLines(res, options.signal)) {
      try {
        const json = JSON.parse(data) as GeminiResponse;
        const delta =
          json.candidates?.[0]?.content?.parts?.map((p) => p.text ?? '').join('') ?? '';
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
