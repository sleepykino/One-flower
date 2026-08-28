/**
 * Anthropic Provider（Claude 系列）
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
import { sseLines, tauriFetch, withNetworkTimeout } from './sse';

interface AnthropicResponse {
  content: Array<{ type: string; text?: string }>;
  usage?: { input_tokens: number; output_tokens: number };
}

export class AnthropicProvider implements LLMProvider {
  readonly name = 'anthropic';
  private config: ProviderConfig;
  private apiKey: string;

  constructor(config: ProviderConfig, apiKey: string) {
    this.config = config;
    this.apiKey = apiKey;
  }

  private get baseUrl(): string {
    return (this.config.baseUrl ?? 'https://api.anthropic.com').replace(/\/$/, '');
  }

  private buildBody(messages: ChatMessage[], options: ChatOptions, stream: boolean) {
    const system = messages
      .filter((m) => m.role === 'system')
      .map((m) => m.content)
      .join('\n\n');
    const rest = messages
      .filter((m) => m.role !== 'system')
      .map((m) => ({ role: m.role, content: m.content }));
    return {
      model: options.model,
      max_tokens: options.maxTokens ?? 2048,
      temperature: options.temperature ?? 0.8,
      ...(system ? { system } : {}),
      messages: rest,
      ...(stream ? { stream: true } : {})
    };
  }

  async chat(messages: ChatMessage[], options: ChatOptions): Promise<ChatResponse> {
    const nt = withNetworkTimeout('Anthropic', options.signal);
    try {
      const res = await tauriFetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(this.buildBody(messages, options, false)),
        signal: nt.fetchSignal
      });
      nt.markFirstByte();
      if (!res.ok) {
        throw new Error(`Anthropic 接口错误 ${res.status}: ${await res.text()}`);
      }
      const data = (await res.json()) as AnthropicResponse;
      return {
        content: (data.content ?? [])
          .filter((c) => c.type === 'text')
          .map((c) => c.text ?? '')
          .join(''),
        usage: {
          promptTokens: data.usage?.input_tokens ?? 0,
          completionTokens: data.usage?.output_tokens ?? 0
        }
      };
    } catch (e) {
      nt.rethrowTimeout();
      throw e;
    } finally {
      nt.dispose();
    }
  }

  async *stream(messages: ChatMessage[], options: ChatOptions): AsyncIterable<ChatChunk> {
    const nt = withNetworkTimeout('Anthropic', options.signal);
    try {
      const res = await tauriFetch(`${this.baseUrl}/v1/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-api-key': this.apiKey,
          'anthropic-version': '2023-06-01'
        },
        body: JSON.stringify(this.buildBody(messages, options, true)),
        signal: nt.fetchSignal
      });
      nt.markFirstByte();
      if (!res.ok) {
        throw new Error(`Anthropic 接口错误 ${res.status}: ${await res.text()}`);
      }
      for await (const data of sseLines(res, nt.readSignal)) {
        try {
          const json = JSON.parse(data) as {
            type: string;
            delta?: { text?: string };
          };
          if (json.type === 'content_block_delta' && json.delta?.text) {
            yield { delta: json.delta.text, done: false };
          } else if (json.type === 'message_stop') {
            yield { delta: '', done: true };
            return;
          }
        } catch {
          // 忽略无法解析的行
        }
      }
      yield { delta: '', done: true };
    } catch (e) {
      nt.rethrowTimeout();
      throw e;
    } finally {
      nt.dispose();
    }
  }

  countTokens(text: string): number {
    return countTokens(text);
  }
}
