/**
 * Provider 解析工具：按书籍绑定关系解析 configId / Provider 实例 / 模型名
 * 供 AIOrchestrator 之外的服务复用（SummaryService / WorldbookRAGService 等）
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { LLMProvider } from './providers/LLMProvider';

/** 解析书籍绑定的 provider configId（书籍未配置时回退到第一组配置） */
export async function resolveProviderConfigId(
  bridge: NativeBridge,
  bookId: string
): Promise<string | null> {
  const book = await bridge.db.queryOne<{ provider_config_id: string | null }>(
    'SELECT provider_config_id FROM books WHERE id = ?',
    [bookId]
  );
  let configId = book?.provider_config_id ?? null;
  if (!configId) {
    const first = await bridge.db.queryOne<{ id: string }>(
      'SELECT id FROM provider_configs ORDER BY created_at ASC LIMIT 1'
    );
    configId = first?.id ?? null;
  }
  return configId;
}

/** 书籍绑定的模型名 */
export async function resolveModelName(
  bridge: NativeBridge,
  bookId: string
): Promise<string> {
  const configId = await resolveProviderConfigId(bridge, bookId);
  if (!configId) throw new Error('未配置任何模型，请先到设置页添加 Provider 配置');
  const row = await bridge.db.queryOne<{ model: string }>(
    'SELECT model FROM provider_configs WHERE id = ?',
    [configId]
  );
  if (!row) throw new Error('模型配置不存在');
  return row.model;
}

/** 解析书籍可用的 Provider 实例 */
export async function resolveProvider(
  bridge: NativeBridge,
  bookId: string,
  factory: (configId: string) => Promise<LLMProvider>
): Promise<LLMProvider> {
  const configId = await resolveProviderConfigId(bridge, bookId);
  if (!configId) throw new Error('未配置任何模型，请先到设置页添加 Provider 配置');
  return factory(configId);
}
