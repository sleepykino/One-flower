/**
 * Provider 解析工具：按功能点路由 configId / Provider 实例 / 模型名
 * 供 AIOrchestrator / SummaryService / LongFormService / SettingInferenceService 等复用
 *
 * P2 二期（简化版）：两级路由 —— 功能绑定（设置页「模型分工」）-> 第一组配置
 * 不再按书籍绑定模型（书籍级设定已移除，全部在设置页统一配置）
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { LLMProvider } from './providers/LLMProvider';
import type { FeatureKey } from './modelRouting';

/** 第一组配置的 configId（模型分工未指定时的全局默认） */
export async function resolveDefaultProviderConfigId(
  bridge: NativeBridge
): Promise<string | null> {
  const first = await bridge.db.queryOne<{ id: string }>(
    'SELECT id FROM provider_configs ORDER BY created_at ASC LIMIT 1'
  );
  return first?.id ?? null;
}

/** 读取功能点绑定表（app_settings ai.featureModels） */
async function readFeatureBindings(
  bridge: NativeBridge
): Promise<Partial<Record<FeatureKey, string>>> {
  const row = await bridge.db.queryOne<{ value: string | null }>(
    'SELECT value FROM app_settings WHERE key = ?',
    ['ai.featureModels']
  );
  if (!row?.value) return {};
  try {
    const parsed = JSON.parse(row.value) as Record<string, unknown>;
    const out: Partial<Record<FeatureKey, string>> = {};
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === 'string' && v) out[k as FeatureKey] = v;
    }
    return out;
  } catch {
    console.warn('[ModelRouting] ai.featureModels 解析失败，已忽略并回退默认配置');
    return {};
  }
}

/**
 * 按功能点解析 configId：功能绑定 -> 第一组配置
 * （embedding 功能走专用 key embedding.providerConfigId；历史书籍绑定不再参与）
 */
export async function resolveProviderConfigIdForFeature(
  bridge: NativeBridge,
  bookId: string,
  feature: FeatureKey
): Promise<string | null> {
  const settingKey =
    feature === 'embedding' ? 'embedding.providerConfigId' : 'ai.featureModels';
  let bound: string | undefined;
  if (feature === 'embedding') {
    const row = await bridge.db.queryOne<{ value: string | null }>(
      'SELECT value FROM app_settings WHERE key = ?',
      [settingKey]
    );
    bound = row?.value ?? undefined;
  } else {
    bound = (await readFeatureBindings(bridge))[feature];
  }
  if (bound) {
    const exists = await bridge.db.queryOne<{ id: string }>(
      'SELECT id FROM provider_configs WHERE id = ?',
      [bound]
    );
    if (exists) return bound;
    console.warn(`[ModelRouting] 功能「${feature}」绑定的配置已不存在，回退默认配置`);
  }
  return resolveDefaultProviderConfigId(bridge);
}

/** 按功能点解析模型名（ContextPanel 路由可见性等） */
export async function resolveModelNameForFeature(
  bridge: NativeBridge,
  bookId: string,
  feature: FeatureKey
): Promise<string> {
  const configId = await resolveProviderConfigIdForFeature(bridge, bookId, feature);
  if (!configId) throw new Error('未配置任何模型，请先到设置页「模型接入」添加 Provider 配置');
  const row = await bridge.db.queryOne<{ model: string }>(
    'SELECT model FROM provider_configs WHERE id = ?',
    [configId]
  );
  if (!row) throw new Error('模型配置不存在');
  return row.model;
}

/** 按功能点解析 Provider 实例（所有 AI 功能点统一入口） */
export async function resolveProviderForFeature(
  bridge: NativeBridge,
  bookId: string,
  feature: FeatureKey,
  factory: (configId: string) => Promise<LLMProvider>
): Promise<LLMProvider> {
  const configId = await resolveProviderConfigIdForFeature(bridge, bookId, feature);
  if (!configId) throw new Error('未配置任何模型，请先到设置页「模型接入」添加 Provider 配置');
  return factory(configId);
}
