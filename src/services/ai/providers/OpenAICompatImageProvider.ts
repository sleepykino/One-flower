/**
 * OpenAI 兼容 images/generations 端点实现（硅基流动 / OpenAI / 火山方舟 Seedream 等）
 * 兼容性处理：
 * - 响应 b64_json 或 url 两种形态（url 时经 tauriFetch 下载为字节）
 * - 参数风格自适应：OpenAI/方舟（n + size）-> 硅基流动（batch_size + image_size）-> 最小参数
 * - 服务端不支持 n>1 时自动降级为循环请求
 */

import { sniffImageMime, base64ToUint8Array } from '../../../utils/imageMeta';
import type { GeneratedImage, ImageGenParams, ImageProvider } from './ImageProvider';
import { tauriFetch } from './sse';

interface RawImageItem {
  b64_json?: string;
  url?: string;
  revised_prompt?: string;
  revisedPrompt?: string;
}

export class OpenAICompatImageProvider implements ImageProvider {
  readonly name = 'openai_compat';
  /** 最终请求端点：baseUrl 已含 /images/generations 时直接使用，否则自动拼接 */
  private readonly endpoint: string;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(config: { baseUrl: string; apiKey: string; model: string }) {
    this.endpoint = OpenAICompatImageProvider.normalizeEndpoint(config.baseUrl);
    this.apiKey = config.apiKey;
    this.model = config.model;
  }

  /** 兼容「base 地址」与「完整 images/generations 端点」两种配置写法 */
  private static normalizeEndpoint(baseUrl: string): string {
    const base = (baseUrl || 'https://api.openai.com/v1').replace(/\/+$/, '');
    if (/\/images\/generations$/i.test(base)) return base;
    return `${base}/images/generations`;
  }

  async generate(params: ImageGenParams): Promise<GeneratedImage[]> {
    const count = Math.max(1, Math.min(4, Math.floor(params.count) || 1));
    const negative = params.negativePrompt?.trim() ?? '';

    /** 生成指定数量的请求体候选风格（按兼容性排序） */
    const makeBodies = (n: number): Array<Record<string, unknown>> => {
      const bodies: Array<Record<string, unknown>> = [];
      const common: Record<string, unknown> = { model: this.model, prompt: params.prompt };
      if (negative) common.negative_prompt = negative;
      if (params.seed !== undefined) common.seed = params.seed;
      // 风格 1：OpenAI / 火山方舟 Seedream（n + size）
      bodies.push({ ...common, n, size: params.size, response_format: 'b64_json' });
      // 风格 2：硅基流动（batch_size + image_size）
      bodies.push({ ...common, batch_size: n, image_size: params.size, response_format: 'b64_json' });
      // 风格 3：最小参数（部分端点不接受 negative_prompt / 数量 / 响应格式字段）
      const prompt = negative ? `${params.prompt}\n\nAvoid: ${negative}` : params.prompt;
      bodies.push({ model: this.model, prompt, size: params.size });
      return bodies;
    };

    /** 把请求体降为单张（保留该风格的参数键） */
    const singleOf = (body: Record<string, unknown>): Record<string, unknown> => {
      const b = { ...body };
      if ('n' in b) b.n = 1;
      if ('batch_size' in b) b.batch_size = 1;
      if ('seed' in b && params.seed !== undefined) delete b.seed; // 多候选时避免同 seed 重复图
      return b;
    };

    let lastErr: unknown = null;
    for (const body of makeBodies(count)) {
      try {
        const images = await this.request(body);
        if (images.length === 0) throw new Error('生图响应为空');
        // 成功但数量不足：用同风格单张补齐
        while (images.length < count) {
          const more = await this.request(singleOf(body));
          if (more.length === 0) break;
          images.push(...more);
        }
        return images;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr instanceof Error ? lastErr : new Error('生图失败');
  }

  /** 单次请求：POST images/generations 并解析响应 */
  private async request(body: Record<string, unknown>): Promise<GeneratedImage[]> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`;
    const res = await tauriFetch(this.endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(body)
    });
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`生图接口错误 ${res.status}: ${text.slice(0, 400)}`);
    }
    const json = (await res.json()) as {
      data?: RawImageItem[];
      images?: RawImageItem[];
      output?: RawImageItem[];
    };
    const items: RawImageItem[] = json.data ?? json.images ?? json.output ?? [];
    const out: GeneratedImage[] = [];
    for (const item of items) {
      const revisedPrompt = item.revised_prompt ?? item.revisedPrompt;
      if (item.b64_json) {
        const bytes = base64ToUint8Array(item.b64_json);
        out.push({ bytes, mimeType: sniffImageMime(bytes), revisedPrompt });
      } else if (item.url) {
        const imgRes = await tauriFetch(item.url, { method: 'GET' });
        if (!imgRes.ok) throw new Error(`下载生成图片失败 ${imgRes.status}`);
        const buf = new Uint8Array(await imgRes.arrayBuffer());
        const headerMime = imgRes.headers.get('content-type')?.split(';')[0]?.trim();
        const mime = headerMime?.startsWith('image/') ? headerMime : sniffImageMime(buf);
        out.push({ bytes: buf, mimeType: mime, revisedPrompt });
      }
    }
    return out;
  }
}
