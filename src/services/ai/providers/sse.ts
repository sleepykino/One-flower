/**
 * SSE 流解析工具（fetch ReadableStream → SSE data 事件）
 */

/** @vite-ignore */
import { fetch as tauriFetch } from '@tauri-apps/plugin-http';

export async function* sseLines(
  response: Response,
  signal?: AbortSignal
): AsyncGenerator<string, void, undefined> {
  const body = response.body;
  if (!body) throw new Error('响应无内容（流式响应需要 body）');
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  try {
    while (true) {
      if (signal?.aborted) throw new DOMException('Aborted', 'AbortError');
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      // SSE 事件以空行分隔
      let sep: number;
      while ((sep = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, sep).replace(/\r$/, '');
        buffer = buffer.slice(sep + 1);
        if (line.startsWith('data:')) {
          yield line.slice(5).trim();
        }
      }
    }
    const rest = buffer.trim();
    if (rest.startsWith('data:')) {
      yield rest.slice(5).trim();
    }
  } finally {
    reader.releaseLock();
  }
}

export { tauriFetch };
