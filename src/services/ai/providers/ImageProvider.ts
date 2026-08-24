/**
 * ImageProvider 生图抽象（P3）：对齐 LLMProvider 模式，为未来本地 SD（ComfyUI/A1111）预留扩展点
 * 生图配置同样存 provider_configs + keystore，走 'image' 功能路由
 */

import type { NativeBridge } from '../../../native/NativeBridge';
import { resolveProviderConfigIdForFeature } from '../providerResolver';
import { isLocalBaseUrl, type ProviderConfig } from './LLMProvider';
import { OpenAICompatImageProvider } from './OpenAICompatImageProvider';
import { ComfyUIImageProvider, type ComfyWorkflow } from './ComfyUIImageProvider';

/** 自定义工作流存 app_settings 的 key（P4-M2） */
export const KEY_COMFY_WORKFLOW = 'comfyui.workflow';
export const KEY_COMFY_WORKFLOW_ACTIVE = 'comfyui.workflow.active';

export type ImageSize = '512x512' | '768x768' | '1024x1024' | '1024x1536' | '1536x1024';

export const IMAGE_SIZES: ImageSize[] = ['512x512', '768x768', '1024x1024', '1024x1536', '1536x1024'];

/** 多候选数量上限 */
export const MAX_IMAGE_CANDIDATES = 4;

export interface ImageGenParams {
  prompt: string;
  /** 不支持该参数的端点会拼入 prompt 尾部或忽略（见 OpenAICompatImageProvider 降级链） */
  negativePrompt?: string;
  size: ImageSize;
  /** 1-4 多候选；服务端不支持 n>1 时前端循环请求 */
  count: number;
  seed?: number;
  /** 取消信号：传入后底层 HTTP 请求与轮询都会被中止 */
  signal?: AbortSignal;
}

export interface GeneratedImage {
  bytes: Uint8Array;
  /** image/png | image/jpeg | image/webp */
  mimeType: string;
  /** 部分服务返回改写后的 prompt，入库留档 */
  revisedPrompt?: string;
}

/** 生图 Provider 抽象 */
export interface ImageProvider {
  readonly name: string; // 'openai_compat' | 未来 'comfyui' ...
  generate(params: ImageGenParams): Promise<GeneratedImage[]>;
}

/** 工厂：按 ProviderConfig.provider 创建（生图配置存 provider_configs，走 'image' 功能路由） */
export function createImageProvider(
  config: ProviderConfig,
  apiKey: string,
  extra?: { workflow?: ComfyWorkflow }
): ImageProvider {
  switch (config.provider) {
    case 'openai_compat':
      return new OpenAICompatImageProvider({
        baseUrl: config.baseUrl ?? 'https://api.openai.com/v1',
        apiKey,
        model: config.model
      });
    case 'comfyui':
      return new ComfyUIImageProvider({
        baseUrl: config.baseUrl ?? 'http://127.0.0.1:8188',
        workflow: extra?.workflow,
        model: config.model
      });
    default:
      throw new Error(
        `Provider 类型「${config.provider}」不支持生图，请在设置页「模型分工」中为图片生成绑定 OpenAI 兼容平台配置（硅基流动 / OpenAI / 火山方舟等）`
      );
  }
}

/** 按功能路由解析生图 Provider（含 API Key 校验与本地端点豁免；comfyui 时读 app_settings 自定义工作流） */
export async function resolveImageProvider(
  bridge: NativeBridge,
  bookId: string
): Promise<{ provider: ImageProvider; model: string; configId: string; configName: string }> {
  const configId = await resolveProviderConfigIdForFeature(bridge, bookId, 'image');
  if (!configId) {
    throw new Error('未配置生图模型，请先到设置页「模型接入」添加 Provider 配置，并在「模型分工」中绑定图片生成');
  }
  const row = await bridge.db.queryOne<Record<string, unknown>>(
    'SELECT * FROM provider_configs WHERE id = ?',
    [configId]
  );
  if (!row) throw new Error('模型配置不存在');
  const baseUrl = (row.base_url as string) ?? '';
  const apiKey = (await bridge.keyStore.getSecret(`provider_${String(row.id)}`)) ?? '';
  if (!apiKey && !isLocalBaseUrl(baseUrl)) {
    throw new Error(`配置「${String(row.name)}」未设置 API Key`);
  }
  // comfyui：从 app_settings 读取自定义工作流与启用选择
  let workflow: ComfyWorkflow | undefined;
  if (String(row.provider) === 'comfyui') {
    try {
      const settingsRow = await bridge.db.queryOne<{ value: string }>(
        'SELECT value FROM app_settings WHERE key = ?',
        [KEY_COMFY_WORKFLOW]
      );
      if (settingsRow?.value) {
        const parsed = JSON.parse(settingsRow.value) as ComfyWorkflow;
        if (parsed && typeof parsed === 'object') {
          const active = await bridge.db.queryOne<{ value: string }>(
            'SELECT value FROM app_settings WHERE key = ?',
            [KEY_COMFY_WORKFLOW_ACTIVE]
          );
          if (active?.value !== 'custom') workflow = undefined;
          else workflow = parsed;
        }
      }
    } catch {
      // 自定义工作流损坏则回退默认工作流
    }
  }
  const provider = createImageProvider(
    {
      id: String(row.id),
      name: String(row.name),
      provider: String(row.provider),
      baseUrl: baseUrl || undefined,
      model: String(row.model)
    },
    apiKey,
    { workflow }
  );
  return { provider, model: String(row.model), configId, configName: String(row.name) };
}
