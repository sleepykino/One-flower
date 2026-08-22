/**
 * ComfyUIImageProvider（P4-M2）：本地 ComfyUI 生图
 * 流程：注入参数到工作流 -> POST /prompt 提交 -> 轮询 GET /history/{id} -> GET /view 下载
 * 参数注入按节点 class_type 匹配（不硬编码节点 id，兼容用户自定义工作流）；
 * 正/负面提示词经 KSampler 的 positive/negative 连线解析定位
 */

import { tauriFetch } from './sse';
import type { GeneratedImage, ImageGenParams, ImageProvider } from './ImageProvider';

/** ComfyUI 工作流节点（API 格式 graph） */
export interface ComfyNode {
  class_type: string;
  inputs: Record<string, unknown>;
  _meta?: { title?: string };
}

export type ComfyWorkflow = Record<string, ComfyNode>;

/** 默认 txt2img 工作流（标准 graph；ckpt_name 会被配置的 Checkpoint 名覆盖） */
export const BUILTIN_COMFY_WORKFLOW: ComfyWorkflow = {
  '4': {
    class_type: 'CheckpointLoaderSimple',
    inputs: { ckpt_name: 'model.safetensors' }
  },
  '6': {
    class_type: 'CLIPTextEncode',
    inputs: { text: '', clip: ['4', 1] }
  },
  '7': {
    class_type: 'CLIPTextEncode',
    inputs: { text: '', clip: ['4', 1] }
  },
  '5': {
    class_type: 'EmptyLatentImage',
    inputs: { width: 1024, height: 1024, batch_size: 1 }
  },
  '3': {
    class_type: 'KSampler',
    inputs: {
      seed: 0,
      steps: 25,
      cfg: 7,
      sampler_name: 'euler',
      scheduler: 'normal',
      denoise: 1,
      model: ['4', 0],
      positive: ['6', 0],
      negative: ['7', 0],
      latent_image: ['5', 0]
    }
  },
  '8': {
    class_type: 'VAEDecode',
    inputs: { samples: ['3', 0], vae: ['4', 2] }
  },
  '9': {
    class_type: 'SaveImage',
    inputs: { filename_prefix: 'oneflower', images: ['8', 0] }
  }
};

const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 5 * 60 * 1000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => window.setTimeout(resolve, ms));
}

function randomSeed(): number {
  return Math.floor(Math.random() * 1_000_000_000_000);
}

function mimeOf(filename: string): string {
  const ext = filename.split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  return 'image/png';
}

/** 参数注入：按 class_type 匹配节点，正/负面提示词经 KSampler 连线定位（自定义工作流兼容的关键） */
function injectParams(
  wf: ComfyWorkflow,
  opts: { prompt: string; negative: string; width: number; height: number; seed: number; checkpoint?: string }
): void {
  const nodes = Object.values(wf);
  const sampler = nodes.find((n) => /KSampler/.test(n.class_type));
  if (sampler) {
    const positive = sampler.inputs.positive;
    const negative = sampler.inputs.negative;
    if (Array.isArray(positive) && wf[String(positive[0])]) {
      wf[String(positive[0])].inputs.text = opts.prompt;
    }
    if (Array.isArray(negative) && wf[String(negative[0])]) {
      wf[String(negative[0])].inputs.text = opts.negative;
    }
    sampler.inputs.seed = opts.seed;
  } else {
    // 无采样器节点的异常工作流：按 CLIPTextEncode 出现顺序兜底
    const clips = nodes.filter((n) => n.class_type === 'CLIPTextEncode');
    if (clips[0]) clips[0].inputs.text = opts.prompt;
    if (clips[1]) clips[1].inputs.text = opts.negative;
  }
  for (const n of nodes) {
    if (n.class_type === 'EmptyLatentImage') {
      n.inputs.width = opts.width;
      n.inputs.height = opts.height;
    }
    if (n.class_type === 'CheckpointLoaderSimple' && opts.checkpoint) {
      n.inputs.ckpt_name = opts.checkpoint;
    }
  }
}

interface HistoryImage {
  filename: string;
  subfolder?: string;
  type?: string;
}

export class ComfyUIImageProvider implements ImageProvider {
  readonly name = 'comfyui';
  private baseUrl: string;
  private workflow: ComfyWorkflow;
  /** Checkpoint 名（provider_configs.model，空则不覆盖工作流默认值） */
  private checkpoint?: string;

  constructor(opts: { baseUrl: string; workflow?: ComfyWorkflow; model?: string }) {
    this.baseUrl = opts.baseUrl.trim().replace(/\/+$/, '');
    this.workflow = opts.workflow ?? BUILTIN_COMFY_WORKFLOW;
    this.checkpoint = opts.model?.trim() || undefined;
  }

  async generate(params: ImageGenParams): Promise<GeneratedImage[]> {
    const [width, height] = params.size.split('x').map((n) => parseInt(n, 10));
    const negative = params.negativePrompt ?? '';
    const baseSeed = params.seed ?? randomSeed();
    const out: GeneratedImage[] = [];
    for (let i = 0; i < params.count; i++) {
      // 深拷贝工作流，逐张注入（seed 递增避免同图）
      const wf: ComfyWorkflow = JSON.parse(JSON.stringify(this.workflow));
      injectParams(wf, {
        prompt: params.prompt,
        negative,
        width: Number.isFinite(width) ? width : 1024,
        height: Number.isFinite(height) ? height : 1024,
        seed: (baseSeed + i) % 1_000_000_000_000,
        checkpoint: this.checkpoint
      });
      const images = await this.runWorkflow(wf);
      out.push(...images);
    }
    return out;
  }

  /** 提交单个工作流并等待完成，下载全部输出图片 */
  private async runWorkflow(wf: ComfyWorkflow): Promise<GeneratedImage[]> {
    const clientId = crypto.randomUUID();
    const res = await tauriFetch(`${this.baseUrl}/prompt`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: wf, client_id: clientId })
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`ComfyUI 提交失败 HTTP ${res.status}：${text.slice(0, 300)}`);
    }
    const { prompt_id: promptId } = (await res.json()) as { prompt_id?: string };
    if (!promptId) throw new Error('ComfyUI 未返回 prompt_id');

    // 轮询 history 直到 outputs 出现（上限 5 分钟）
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    let images: HistoryImage[] = [];
    while (Date.now() < deadline) {
      await sleep(POLL_INTERVAL_MS);
      const h = await tauriFetch(`${this.baseUrl}/history/${promptId}`);
      if (!h.ok) continue;
      const json = (await h.json()) as Record<
        string,
        { outputs?: Record<string, { images?: HistoryImage[] }> } | undefined
      >;
      const entry = json[promptId];
      const collected: HistoryImage[] = [];
      for (const nodeOut of Object.values(entry?.outputs ?? {})) {
        collected.push(...(nodeOut.images ?? []));
      }
      if (collected.length > 0) {
        images = collected;
        break;
      }
    }
    if (images.length === 0) {
      throw new Error('ComfyUI 生成超时（5 分钟无输出），请检查节点是否报错');
    }
    return Promise.all(images.map((f) => this.downloadImage(f)));
  }

  private async downloadImage(f: HistoryImage): Promise<GeneratedImage> {
    const url =
      `${this.baseUrl}/view?filename=${encodeURIComponent(f.filename)}` +
      `&subfolder=${encodeURIComponent(f.subfolder ?? '')}&type=${encodeURIComponent(f.type ?? 'output')}`;
    const res = await tauriFetch(url);
    if (!res.ok) throw new Error(`下载 ComfyUI 输出失败 HTTP ${res.status}（${f.filename}）`);
    const buf = await res.arrayBuffer();
    return { bytes: new Uint8Array(buf), mimeType: mimeOf(f.filename) };
  }

  /** 连接测试：GET /system_stats（3 秒超时） */
  static async healthCheck(baseUrl: string): Promise<boolean> {
    const base = baseUrl.trim().replace(/\/+$/, '');
    const controller = new AbortController();
    const timer = window.setTimeout(() => controller.abort(), 3000);
    try {
      const res = await tauriFetch(`${base}/system_stats`, { signal: controller.signal });
      return res.ok;
    } catch {
      return false;
    } finally {
      window.clearTimeout(timer);
    }
  }
}
