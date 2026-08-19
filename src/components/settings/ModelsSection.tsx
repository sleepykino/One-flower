/**
 * 模型接入子页：供应商快捷接入卡片 + 自定义 Provider 配置 CRUD + 连接测试
 */

import { useEffect, useState } from 'react';
import { useSettingsStore } from '../../store/settingsStore';
import { getAppContext } from '../../context/app-context';
import { alertDialog, confirmDialog } from '../../native/dialog';
import { PROVIDER_PRESETS, type ProviderPreset } from '../../services/ai/providerPresets';
import { QuickAddProviderDialog } from './QuickAddProviderDialog';
import type { ProviderConfig } from '../../types';

type ProviderType = ProviderConfig['provider'];

const PROVIDER_LABEL: Record<ProviderType, string> = {
  openai_compat: 'OpenAI 兼容（OpenAI / DeepSeek / Kimi / 智谱 / 通义…）',
  anthropic: 'Anthropic（Claude）',
  google: 'Google（Gemini）'
};

export function ModelsSection(): JSX.Element {
  const configs = useSettingsStore((s) => s.configs);
  const loadConfigs = useSettingsStore((s) => s.loadConfigs);
  const saveConfig = useSettingsStore((s) => s.saveConfig);
  const removeConfig = useSettingsStore((s) => s.removeConfig);
  const testConnection = useSettingsStore((s) => s.testConnection);

  const [editing, setEditing] = useState<{
    id?: string;
    name: string;
    provider: ProviderType;
    baseUrl: string;
    model: string;
    apiKey: string;
  } | null>(null);
  const [testing, setTesting] = useState<string | null>(null);
  const [testResult, setTestResult] = useState<Record<string, string>>({});
  const [quickAdd, setQuickAdd] = useState<ProviderPreset | null>(null);

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  /** 该预设是否已添加过（按名称+协议判断） */
  const presetAdded = (p: ProviderPreset): boolean =>
    configs.some((c) => c.name === p.label && c.provider === p.provider);

  const submit = async (): Promise<void> => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.model.trim()) {
      void alertDialog('名称与模型必填');
      return;
    }
    if (editing.provider === 'openai_compat' && !editing.baseUrl.trim()) {
      void alertDialog('OpenAI 兼容协议需填写 baseURL');
      return;
    }
    await saveConfig(editing);
    setEditing(null);
  };

  const test = async (id: string): Promise<void> => {
    setTesting(id);
    setTestResult((r) => ({ ...r, [id]: '' }));
    const r = await testConnection(id);
    setTestResult((prev) => ({ ...prev, [id]: `${r.ok ? '✅' : '❌'} ${r.message}` }));
    setTesting(null);
  };

  return (
    <div>
      {/* 快捷接入 */}
      <div className="mb-1 flex items-center justify-between">
        <h2 className="font-medium">快捷接入</h2>
        <button
          type="button"
          className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-100"
          onClick={() =>
            setEditing({ name: '', provider: 'openai_compat', baseUrl: 'https://api.openai.com/v1', model: '', apiKey: '' })
          }
        >
          + 自定义配置
        </button>
      </div>
      <p className="mb-2 text-xs text-ink-400">
        选择常用供应商，预填地址与推荐模型，只需粘贴 API Key 即可完成接入。
      </p>
      <div className="grid grid-cols-3 gap-2">
        {PROVIDER_PRESETS.map((p) => {
          const added = presetAdded(p);
          return (
            <button
              key={p.key}
              type="button"
              onClick={() => setQuickAdd(p)}
              className={`relative rounded-lg border px-3 py-2.5 text-left transition-colors ${
                added
                  ? 'border-emerald-200 bg-emerald-50/50 hover:border-emerald-300'
                  : 'border-ink-200 bg-white hover:border-violet-300'
              }`}
            >
              <div className="flex items-center gap-1.5">
                <span className="text-sm font-medium">{p.label}</span>
                {added && (
                  <span className="rounded bg-emerald-100 px-1 text-[10px] text-emerald-700">已添加</span>
                )}
              </div>
              <div className="mt-0.5 truncate text-[11px] text-ink-400">{p.defaultModel}</div>
            </button>
          );
        })}
      </div>

      {/* 自定义编辑表单 */}
      {editing && (
        <div className="mt-4 rounded border border-violet-200 bg-violet-50/40 p-3">
          <div className="mb-2 text-sm font-medium">{editing.id ? '编辑配置' : '新建自定义配置'}</div>
          <div className="grid grid-cols-2 gap-2">
            <input
              value={editing.name}
              onChange={(e) => setEditing({ ...editing, name: e.target.value })}
              placeholder="配置名称，如「我的 DeepSeek」"
              className="rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
            />
            <select
              value={editing.provider}
              onChange={(e) => setEditing({ ...editing, provider: e.target.value as ProviderType })}
              className="rounded border border-ink-200 px-2 py-1 text-sm"
            >
              {(Object.keys(PROVIDER_LABEL) as ProviderType[]).map((p) => (
                <option key={p} value={p}>
                  {PROVIDER_LABEL[p]}
                </option>
              ))}
            </select>
            <input
              value={editing.baseUrl}
              onChange={(e) => setEditing({ ...editing, baseUrl: e.target.value })}
              placeholder={editing.provider === 'openai_compat' ? 'baseURL *，如 https://api.deepseek.com' : 'baseURL（可选）'}
              className={editing.provider === 'openai_compat' ? 'col-span-1 rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400' : 'col-span-2 rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400'}
            />
            <input
              value={editing.model}
              onChange={(e) => setEditing({ ...editing, model: e.target.value })}
              placeholder="模型名，如 deepseek-v4-pro / gpt-5.5 / claude-sonnet-4-5"
              className="rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
            />
            <input
              type="password"
              value={editing.apiKey}
              onChange={(e) => setEditing({ ...editing, apiKey: e.target.value })}
              placeholder={editing.id ? 'API Key（留空保持不变）' : 'API Key *'}
              className="col-span-2 rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
            />
          </div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded bg-violet-600 px-3 py-1 text-sm text-white hover:bg-violet-700"
              onClick={() => void submit()}
            >
              保存
            </button>
            <button
              type="button"
              className="rounded border border-ink-200 px-3 py-1 text-sm hover:bg-ink-100"
              onClick={() => setEditing(null)}
            >
              取消
            </button>
          </div>
        </div>
      )}

      {/* 已添加配置列表 */}
      <h2 className="mb-2 mt-5 font-medium">已添加配置（{configs.length}）</h2>
      {configs.length === 0 && !editing && (
        <div className="rounded border border-dashed border-ink-200 p-6 text-center text-sm text-ink-400">
          暂无配置。AI 功能需要至少一组 Provider 配置，可从上方快捷接入开始。
        </div>
      )}
      {configs.map((c) => (
        <div
          key={c.id}
          className="mb-2 flex items-center gap-3 rounded border border-ink-100 bg-white px-3 py-2"
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium">{c.name}</span>
              <span className="rounded bg-ink-100 px-1.5 text-[10px] text-ink-500">
                {c.provider === 'openai_compat' ? 'OpenAI 兼容' : c.provider}
              </span>
            </div>
            <div className="truncate text-xs text-ink-400">
              {c.model} · {c.baseUrl ?? '默认地址'}
            </div>
            {testResult[c.id] && (
              <div className={`mt-1 text-xs ${testResult[c.id].startsWith('✅') ? 'text-emerald-600' : 'text-red-500'}`}>
                {testResult[c.id]}
              </div>
            )}
          </div>
          <button
            type="button"
            disabled={testing === c.id}
            className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-100 disabled:opacity-40"
            onClick={() => void test(c.id)}
          >
            {testing === c.id ? '测试中…' : '测试连接'}
          </button>
          <button
            type="button"
            className="text-xs text-violet-600 hover:underline"
            onClick={() =>
              setEditing({
                id: c.id,
                name: c.name,
                provider: c.provider,
                baseUrl: c.baseUrl ?? '',
                model: c.model,
                apiKey: ''
              })
            }
          >
            编辑
          </button>
          <button
            type="button"
            className="text-xs text-ink-400 hover:text-red-600"
            onClick={() => {
              void confirmDialog(`删除配置「${c.name}」？`).then((ok) => {
                if (ok) void removeConfig(c.id);
              });
            }}
          >
            删除
          </button>
        </div>
      ))}

      <p className="mt-3 text-[11px] leading-5 text-ink-400">
        API Key 存于系统钥匙串（Windows 凭据管理器），不落数据库。书籍未绑定模型时默认使用第一组配置。
      </p>

      {/* 快捷接入弹窗（已添加过则传入 existingId 走更新） */}
      {quickAdd && (
        <QuickAddProviderDialog
          preset={quickAdd}
          existingId={
            configs.find((c) => c.name === quickAdd.label && c.provider === quickAdd.provider)?.id
          }
          onClose={() => setQuickAdd(null)}
        />
      )}
    </div>
  );
}
