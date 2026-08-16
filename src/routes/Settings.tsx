/**
 * Settings 页：Provider 配置 CRUD + API Key（keytar）+ 连接测试
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '../store/settingsStore';
import type { ProviderConfig } from '../types';

type ProviderType = ProviderConfig['provider'];

const PROVIDER_LABEL: Record<ProviderType, string> = {
  openai_compat: 'OpenAI 兼容（OpenAI / DeepSeek / Kimi / 智谱 / 通义…）',
  anthropic: 'Anthropic（Claude）',
  google: 'Google（Gemini）'
};

export function Settings(): JSX.Element {
  const navigate = useNavigate();
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

  useEffect(() => {
    void loadConfigs();
  }, [loadConfigs]);

  const submit = async (): Promise<void> => {
    if (!editing) return;
    if (!editing.name.trim() || !editing.model.trim()) {
      window.alert('名称与模型必填');
      return;
    }
    if (editing.provider === 'openai_compat' && !editing.baseUrl.trim()) {
      window.alert('OpenAI 兼容协议需填写 baseURL');
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
    <div className="h-full overflow-y-auto">
      <header className="mx-auto flex max-w-3xl items-center justify-between px-6 py-6">
        <h1 className="text-xl font-bold">设置</h1>
        <button
          type="button"
          className="rounded border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
          onClick={() => navigate('/')}
        >
          返回书架
        </button>
      </header>

      <main className="mx-auto max-w-3xl px-6 pb-10">
        <section className="rounded-lg border border-ink-200 bg-white p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <h2 className="font-medium">模型 Provider 配置</h2>
              <p className="text-xs text-ink-400">
                API Key 存于系统钥匙串（Windows 凭据管理器），不落数据库。
              </p>
            </div>
            <button
              type="button"
              className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700"
              onClick={() =>
                setEditing({ name: '', provider: 'openai_compat', baseUrl: 'https://api.openai.com/v1', model: '', apiKey: '' })
              }
            >
              新建配置
            </button>
          </div>

          {editing && (
            <div className="mb-3 rounded border border-violet-200 bg-violet-50/40 p-3">
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
                  placeholder={editing.provider === 'openai_compat' ? 'baseURL *，如 https://api.deepseek.com/v1' : 'baseURL（可选）'}
                  className={editing.provider === 'openai_compat' ? 'col-span-1 rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400' : 'col-span-2 rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400'}
                />
                <input
                  value={editing.model}
                  onChange={(e) => setEditing({ ...editing, model: e.target.value })}
                  placeholder="模型名，如 deepseek-chat / gpt-4o / claude-3-5-sonnet"
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

          {configs.length === 0 && !editing && (
            <div className="rounded border border-dashed border-ink-200 p-8 text-center text-sm text-ink-400">
              暂无配置。AI 功能需要至少一组 Provider 配置。
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
                    {c.provider}
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
                  if (window.confirm(`删除配置「${c.name}」？`)) void removeConfig(c.id);
                }}
              >
                删除
              </button>
            </div>
          ))}
        </section>

        <section className="mt-4 rounded-lg border border-ink-200 bg-white p-4 text-sm text-ink-600">
          <h2 className="mb-2 font-medium">数据与 Skill</h2>
          <ul className="list-disc space-y-1 pl-5 text-xs text-ink-500">
            <li>数据库与书籍文件存于应用数据目录（SQLite WAL 模式，单写队列）。</li>
            <li>Skill 目录：~/.novelagent/skills/，放入 SKILL.md 后在书籍 Skill 面板勾选启用。</li>
            <li>每本书可在 Skill 面板指定启用的文风；书籍默认模型取第一组配置或在书籍设置中指定。</li>
          </ul>
        </section>
      </main>
    </div>
  );
}
