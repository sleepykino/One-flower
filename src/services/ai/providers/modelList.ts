/**
 * 模型列表拉取（P4-M1）：GET {baseUrl}/models，OpenAI 兼容端点通用
 * Ollama / LM Studio / 各云平台均支持；错误信息带端点便于排查
 */

import { tauriFetch } from './sse';

/** 拉取端点模型列表（解析 data[].id），失败抛错（含端点信息） */
export async function listRemoteModels(baseUrl: string, apiKey?: string): Promise<string[]> {
  const trimmed = baseUrl.trim().replace(/\/+$/, '');
  if (!trimmed) throw new Error('未填写 baseURL');
  const url = `${trimmed}/models`;
  const controller = new AbortController();
  const timer = window.setTimeout(() => controller.abort(), 5000);
  try {
    const res = await tauriFetch(url, {
      headers: apiKey ? { Authorization: `Bearer ${apiKey}` } : undefined,
      signal: controller.signal
    });
    if (!res.ok) {
      throw new Error(`HTTP ${res.status}（${url}）`);
    }
    const json = (await res.json()) as { data?: Array<{ id?: unknown }> };
    const ids = (json?.data ?? [])
      .map((m) => (typeof m?.id === 'string' ? m.id.trim() : ''))
      .filter((id) => id !== '');
    return Array.from(new Set(ids)).sort((a, b) => a.localeCompare(b));
  } catch (e) {
    if (e instanceof DOMException && e.name === 'AbortError') {
      throw new Error(`连接超时（${url}），请确认服务已启动`);
    }
    throw e instanceof Error ? e : new Error(String(e));
  } finally {
    window.clearTimeout(timer);
  }
}
