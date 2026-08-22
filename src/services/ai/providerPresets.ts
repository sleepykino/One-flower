/**
 * 常见模型供应商预设（快捷接入模板）
 * 预设仅是"新建 provider_configs 的模板"，无独立存储
 * 模型/baseURL 数据核实于 2026-08（各官方文档），可能随厂商迭代过期，卡片上均可修改
 */

import type { ProviderConfig } from '../../types';

export interface ProviderPreset {
  /** 预设标识（用于已添加判断） */
  key: string;
  label: string;
  /** 协议 */
  provider: ProviderConfig['provider'];
  baseUrl: string;
  /** 推荐模型（下拉可选 + 默认） */
  models: string[];
  defaultModel: string;
  /** API Key 获取地址 */
  keyUrl: string;
  /** 卡片上的特殊说明 */
  note?: string;
}

export const PROVIDER_PRESETS: ProviderPreset[] = [
  {
    key: 'deepseek',
    label: 'DeepSeek',
    provider: 'openai_compat',
    baseUrl: 'https://api.deepseek.com',
    models: ['deepseek-v4-pro', 'deepseek-v4-flash'],
    defaultModel: 'deepseek-v4-pro',
    keyUrl: 'https://platform.deepseek.com/api_keys',
    note: 'v4-pro 为旗舰（可思考），v4-flash 更便宜适合摘要等辅助任务'
  },
  {
    key: 'zhipu',
    label: '智谱 GLM',
    provider: 'openai_compat',
    baseUrl: 'https://open.bigmodel.cn/api/paas/v4',
    models: ['glm-5.2', 'glm-4.7', 'glm-4.5-air', 'glm-4.5-flash'],
    defaultModel: 'glm-4.7',
    keyUrl: 'https://bigmodel.cn/',
    note: 'glm-4.5-flash 有免费额度，适合做后台摘要'
  },
  {
    key: 'volcark',
    label: '火山方舟·豆包',
    provider: 'openai_compat',
    baseUrl: 'https://ark.cn-beijing.volces.com/api/v3',
    models: ['doubao-seed-2-1-pro-260628', 'doubao-seed-2-0-lite-260428'],
    defaultModel: 'doubao-seed-2-1-pro-260628',
    keyUrl: 'https://console.volcengine.com/ark/region:cn-beijing/apikey',
    note: '模型 ID 带日期后缀会持续更新，可按官方「模型列表」改为最新版或您的接入点 ID'
  },
  {
    key: 'kimi',
    label: 'Kimi 月之暗面',
    provider: 'openai_compat',
    baseUrl: 'https://api.moonshot.cn/v1',
    models: ['kimi-k3', 'kimi-k2.6'],
    defaultModel: 'kimi-k3',
    keyUrl: 'https://platform.moonshot.cn/',
    note: 'kimi-k3 为最新旗舰（1M 上下文）'
  },
  {
    key: 'qwen',
    label: '通义千问·百炼',
    provider: 'openai_compat',
    baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
    models: ['qwen3.8-max', 'qwen3.7-plus', 'qwen3.7-flash'],
    defaultModel: 'qwen3.7-plus',
    keyUrl: 'https://bailian.console.aliyun.com/?tab=model#/api-key',
    note: 'flash 档便宜快速，适合摘要/命名等辅助任务'
  },
  {
    key: 'openai',
    label: 'OpenAI',
    provider: 'openai_compat',
    baseUrl: 'https://api.openai.com/v1',
    models: ['gpt-5.5', 'gpt-5.4', 'gpt-4o-mini'],
    defaultModel: 'gpt-5.5',
    keyUrl: 'https://platform.openai.com/api-keys'
  },
  {
    key: 'anthropic',
    label: 'Anthropic Claude',
    provider: 'anthropic',
    baseUrl: '',
    models: ['claude-sonnet-4-5', 'claude-opus-4-1', 'claude-3-5-haiku-latest'],
    defaultModel: 'claude-sonnet-4-5',
    keyUrl: 'https://console.anthropic.com/settings/keys',
    note: 'haiku 档便宜，适合辅助任务'
  },
  {
    key: 'gemini',
    label: 'Google Gemini',
    provider: 'google',
    baseUrl: '',
    models: ['gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-2.5-pro'],
    defaultModel: 'gemini-3.7-flash',
    keyUrl: 'https://aistudio.google.com/app/apikey'
  },
  {
    key: 'siliconflow',
    label: '硅基流动',
    provider: 'openai_compat',
    baseUrl: 'https://api.siliconflow.cn/v1',
    models: [
      'deepseek-ai/DeepSeek-V4-Flash',
      'Qwen/Qwen3.5-397B-A17B',
      'zai-org/GLM-5.2',
      'moonshotai/Kimi-K2.6'
    ],
    defaultModel: 'deepseek-ai/DeepSeek-V4-Flash',
    keyUrl: 'https://cloud.siliconflow.cn/account/ak',
    note: '国内聚合平台，一个 Key 调用多家开源模型，免费额度可用'
  },
  {
    key: 'ollama',
    label: 'Ollama（本地）',
    provider: 'openai_compat',
    baseUrl: 'http://localhost:11434/v1',
    models: [],
    defaultModel: '',
    keyUrl: 'https://ollama.com/library',
    note: '本地运行，无需 API Key；需先安装 Ollama 并 ollama pull 拉取模型，接入后点「拉取模型列表」选择'
  },
  {
    key: 'lmstudio',
    label: 'LM Studio（本地）',
    provider: 'openai_compat',
    baseUrl: 'http://localhost:1234/v1',
    models: [],
    defaultModel: '',
    keyUrl: 'https://lmstudio.ai/',
    note: '本地运行，无需 API Key；需在 LM Studio 中下载模型并启动本地服务器（Developer → Start Server）'
  },
  {
    key: 'comfyui',
    label: 'ComfyUI（本地生图）',
    provider: 'comfyui',
    baseUrl: 'http://127.0.0.1:8188',
    models: [],
    defaultModel: '',
    keyUrl: 'https://github.com/comfyanonymous/ComfyUI',
    note: '本地 ComfyUI，无需 API Key；需运行中并加载模型。配置的「模型」填 Checkpoint 名（可选），绑定到「模型分工 → 视觉生成 → 图片生成」'
  }
];
