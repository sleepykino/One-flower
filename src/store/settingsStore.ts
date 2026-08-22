/** 设置状态：Provider 配置管理（SQLite + keytar） */

import { create } from 'zustand';
import type { ProviderConfig } from '../types';
import { getAppContext } from '../context/app-context';

interface SettingsStore {
  configs: ProviderConfig[];
  loadConfigs: () => Promise<void>;
  saveConfig: (input: {
    id?: string;
    name: string;
    provider: ProviderConfig['provider'];
    baseUrl: string;
    model: string;
    apiKey: string;
  }) => Promise<void>;
  removeConfig: (id: string) => Promise<void>;
  /** 将某配置标记为默认（其它配置取消默认标记） */
  setDefaultConfig: (id: string) => Promise<void>;
  /** 连接测试：发送极小请求验证配置与 Key */
  testConnection: (id: string) => Promise<{ ok: boolean; message: string }>;
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  configs: [],

  loadConfigs: async () => {
    const rows = await getAppContext().db.query<Record<string, unknown>>(
      'SELECT * FROM provider_configs ORDER BY created_at ASC'
    );
    set({
      configs: rows.map((r) => ({
        id: String(r.id),
        name: String(r.name),
        provider: String(r.provider) as ProviderConfig['provider'],
        baseUrl: (r.base_url as string) ?? null,
        model: String(r.model),
        isDefault: Number(r.is_default ?? 0) === 1,
        createdAt: Number(r.created_at)
      }))
    });
  },

  saveConfig: async (input) => {
    const { bridge, wq } = getAppContext();
    if (input.id) {
      await wq.enqueue(() =>
        bridge.db.exec(
          'UPDATE provider_configs SET name = ?, provider = ?, base_url = ?, model = ? WHERE id = ?',
          [input.name, input.provider, input.baseUrl || null, input.model, input.id]
        )
      );
      if (input.apiKey) {
        await bridge.keyStore.setSecret(`provider_${input.id}`, input.apiKey);
      }
    } else {
      const id = crypto.randomUUID();
      await wq.enqueue(() =>
        bridge.db.exec(
          'INSERT INTO provider_configs (id, name, provider, base_url, model, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          [id, input.name, input.provider, input.baseUrl || null, input.model, Date.now()]
        )
      );
      if (input.apiKey) {
        await bridge.keyStore.setSecret(`provider_${id}`, input.apiKey);
      }
    }
    await get().loadConfigs();
  },

  removeConfig: async (id) => {
    const { bridge, wq } = getAppContext();
    await wq.enqueue(() => bridge.db.exec('DELETE FROM provider_configs WHERE id = ?', [id]));
    await bridge.keyStore.deleteSecret(`provider_${id}`).catch(() => undefined);
    await get().loadConfigs();
  },

  setDefaultConfig: async (id) => {
    const { bridge, wq } = getAppContext();
    // 先清除全部默认标记，再标记目标配置（单条 SQL 原子完成）
    await wq.enqueue(() =>
      bridge.db.exec('UPDATE provider_configs SET is_default = (id = ?)', [id])
    );
    await get().loadConfigs();
  },

  testConnection: async (id) => {
    const { bridge } = getAppContext();
    const row = await bridge.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM provider_configs WHERE id = ?',
      [id]
    );
    if (!row) return { ok: false, message: '配置不存在' };
    // ComfyUI：走 /system_stats 健康检查（生图专用，无对话接口）
    if (String(row.provider) === 'comfyui') {
      const { ComfyUIImageProvider } = await import('../services/ai/providers/ComfyUIImageProvider');
      const ok = await ComfyUIImageProvider.healthCheck((row.base_url as string) || 'http://127.0.0.1:8188');
      return ok
        ? { ok: true, message: 'ComfyUI 连接成功' }
        : { ok: false, message: '无法连接 ComfyUI（/system_stats 无响应），请确认服务已启动' };
    }
    const apiKey = (await bridge.keyStore.getSecret(`provider_${id}`)) ?? '';
    // 本地端点（Ollama 等 localhost 服务）允许无 API Key
    if (!apiKey) {
      const { isLocalBaseUrl } = await import('../services/ai/providers/LLMProvider');
      if (!isLocalBaseUrl((row.base_url as string) ?? '')) {
        return { ok: false, message: '未设置 API Key' };
      }
    }
    try {
      const { createProvider } = await import('../services/ai/providers/LLMProvider');
      const provider = createProvider(
        {
          id: String(row.id),
          name: String(row.name),
          provider: String(row.provider),
          baseUrl: (row.base_url as string) ?? undefined,
          model: String(row.model)
        },
        apiKey
      );
      const res = await provider.chat(
        [{ role: 'user', content: '请回复：ok' }],
        { model: String(row.model), maxTokens: 16, temperature: 0 }
      );
      return { ok: true, message: `连接成功，模型回复：${res.content.slice(0, 50)}` };
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) };
    }
  }
}));
