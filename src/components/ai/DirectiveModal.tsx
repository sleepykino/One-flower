/**
 * 本书指令编辑器（重设计版）
 * 左侧文件导航 + 右侧编辑区：
 * - agents.md：编辑 / 预览 / 分屏三视图，实时 markdown 渲染
 * - hook.md：规则可视化编辑（动作/匹配/值，行内校验）+ 源码模式 + 规则测试沙盒
 */

import { useEffect, useMemo, useState } from 'react';
import {
  BookOpen,
  ShieldCheck,
  FileCode,
  Eye,
  Columns2,
  Pencil,
  ListChecks,
  Plus,
  Trash2,
  Play,
  X,
  AlertTriangle
} from 'lucide-react';
import { getAppContext } from '../../context/app-context';
import {
  AGENTS_TEMPLATE,
  HOOK_TEMPLATE,
  applyHookRules,
  isValidHookPattern,
  parseHookRules
} from '../../services/ai/ProjectDirectiveService';
import type { HookApplyResult, HookRule } from '../../services/ai/ProjectDirectiveService';
import { renderMarkdown } from '../../utils/markdown';
import { alertDialog, confirmDialog } from '../../native/dialog';

type FileKey = 'agents' | 'hook';
type AgentsView = 'edit' | 'preview' | 'split';

const ACTION_META: Record<HookRule['action'], { label: string; chip: string; hint: string }> = {
  replace: { label: '替换', chip: 'bg-violet-100 text-violet-700', hint: '自动替换命中文本（支持 $1 反向引用）' },
  warn: { label: '提醒', chip: 'bg-amber-100 text-amber-700', hint: '生成后仅提示，不修改文本' },
  block: { label: '阻断', chip: 'bg-red-100 text-red-700', hint: '命中则丢弃本次输出并自动重试一次' }
};

/** 提取文件头部的注释块（# 与 <!-- 行），结构化编辑时保留 */
function extractHeader(md: string): string {
  const out: string[] = [];
  for (const l of md.split(/\r?\n/)) {
    if (/^\s*(#|<!--)/.test(l)) {
      out.push(l);
    } else if (l.trim() === '' && out.length === 0) {
      continue;
    } else {
      break;
    }
  }
  return out.length > 0 ? `${out.join('\n')}\n\n` : '';
}

export function DirectiveModal({ bookId, onClose }: { bookId: string; onClose: () => void }): JSX.Element {
  const [file, setFile] = useState<FileKey>('agents');
  const [agents, setAgents] = useState('');
  const [hook, setHook] = useState('');
  const [origAgents, setOrigAgents] = useState('');
  const [origHook, setOrigHook] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [agentsView, setAgentsView] = useState<AgentsView>('split');
  const [hookView, setHookView] = useState<'rules' | 'source'>('rules');
  // 规则测试沙盒
  const [sample, setSample] = useState('');
  const [testResult, setTestResult] = useState<HookApplyResult | null>(null);

  useEffect(() => {
    void (async () => {
      const pd = getAppContext().projectDirectives;
      const [a, h] = await Promise.all([pd.getAgentsMd(bookId), pd.getHookMd(bookId)]);
      setAgents(a);
      setHook(h);
      setOrigAgents(a);
      setOrigHook(h);
      setLoaded(true);
    })().catch(() => setLoaded(true));
  }, [bookId]);

  const dirty = loaded && (agents !== origAgents || hook !== origHook);
  /** 当前文件头部注释（结构化编辑重建时保留） */
  const hookHeader = useMemo(() => extractHeader(hook), [hook]);
  const rules = useMemo(() => parseHookRules(hook), [hook]);
  const agentsChars = useMemo(
    () =>
      agents
        .split('\n')
        .filter((l) => !/^\s*(#|<!--)/.test(l))
        .join('')
        .replace(/\s/g, '').length,
    [agents]
  );

  /** 结构化编辑后整体重建 hook.md（保留头部注释） */
  const serializeRules = (next: HookRule[]): void => {
    const body =
      next.length === 0
        ? ''
        : next.map((r) => `${r.action} ${r.source} => ${r.value}`).join('\n');
    setHook(body === '' ? hookHeader.trimEnd() : `${hookHeader}${body}\n`);
  };

  const updateRule = (i: number, patch: Partial<Pick<HookRule, 'action' | 'source' | 'value'>>): void => {
    serializeRules(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
    setTestResult(null);
  };
  const removeRule = (i: number): void => {
    serializeRules(rules.filter((_, idx) => idx !== i));
    setTestResult(null);
  };
  const addRule = (): void => {
    serializeRules([...rules, { action: 'replace', source: '', regex: /(?:)/g, value: '' }]);
    setTestResult(null);
  };

  const runTest = (): void => {
    setTestResult(applyHookRules(rules, sample));
  };

  const save = async (): Promise<void> => {
    const pd = getAppContext().projectDirectives;
    try {
      await pd.saveAgentsMd(bookId, agents);
      await pd.saveHookMd(bookId, hook);
      setOrigAgents(agents);
      setOrigHook(hook);
      onClose();
    } catch (e) {
      void alertDialog(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  const requestClose = async (): Promise<void> => {
    if (!dirty || (await confirmDialog('有未保存的修改，确定放弃并关闭？'))) onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
      <div className="flex h-full max-h-[88vh] w-full max-w-5xl flex-col overflow-hidden rounded-lg bg-white shadow-xl">
        {/* 标题栏 */}
        <div className="flex items-center justify-between border-b border-ink-200 px-5 py-3">
          <div>
            <div className="text-sm font-semibold text-ink-900">本书指令</div>
            <div className="text-xs text-ink-500">agents.md 注入所有 AI 生成 · hook.md 在生成完成后自动执行 · 随书保存于项目目录</div>
          </div>
          <button
            type="button"
            className="rounded p-1 text-ink-400 hover:bg-ink-100 hover:text-ink-700"
            onClick={() => void requestClose()}
          >
            <X size={18} />
          </button>
        </div>

        <div className="flex min-h-0 flex-1">
          {/* 左侧文件导航 */}
          <div className="w-56 shrink-0 space-y-2 border-r border-ink-100 bg-ink-50/50 p-3">
            <FileCard
              active={file === 'agents'}
              icon={<BookOpen size={18} />}
              name="agents.md"
              desc="全局指令书，优先级最高"
              meta={`约 ${agentsChars} 字`}
              onClick={() => setFile('agents')}
            />
            <FileCard
              active={file === 'hook'}
              icon={<ShieldCheck size={18} />}
              name="hook.md"
              desc="输出校验与替换规则"
              meta={`${rules.length} 条规则`}
              onClick={() => setFile('hook')}
            />
            <div className="mt-4 rounded border border-ink-100 bg-white p-2.5 text-[11px] leading-relaxed text-ink-500">
              <div className="mb-1 flex items-center gap-1 font-medium text-ink-600">
                <AlertTriangle size={12} /> 优先级
              </div>
              agents.md &gt; 全局提示词 &gt; Skill 文风包
            </div>
          </div>

          {/* 右侧编辑区 */}
          <div className="flex min-w-0 flex-1 flex-col">
            {file === 'agents' ? (
              <>
                <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2">
                  <Segmented
                    value={agentsView}
                    onChange={(v) => setAgentsView(v as AgentsView)}
                    items={[
                      { value: 'edit', label: '编辑', icon: <Pencil size={13} /> },
                      { value: 'split', label: '分屏', icon: <Columns2 size={13} /> },
                      { value: 'preview', label: '预览', icon: <Eye size={13} /> }
                    ]}
                  />
                  <button
                    type="button"
                    className="text-xs text-violet-600 hover:underline"
                    onClick={() => setAgents(AGENTS_TEMPLATE)}
                  >
                    填入模板
                  </button>
                </div>
                <div className="flex min-h-0 flex-1">
                  {agentsView !== 'preview' && (
                    <textarea
                      className={`min-h-0 flex-1 resize-none border-ink-100 p-4 font-mono text-xs leading-relaxed outline-none focus:border-violet-400 ${
                        agentsView === 'split' ? 'border-r' : ''
                      }`}
                      value={agents}
                      onChange={(e) => setAgents(e.target.value)}
                      disabled={!loaded}
                      spellCheck={false}
                      placeholder="写入世界观铁律、称谓规范、写作禁令……（支持 markdown）"
                    />
                  )}
                  {agentsView !== 'edit' && (
                    <div className="min-h-0 flex-1 overflow-y-auto p-5">
                      {agents.trim() === '' ? (
                        <div className="text-xs text-ink-400">暂无内容，切换到「编辑」或填入模板开始。</div>
                      ) : (
                        <div
                          className="md-content text-sm leading-relaxed text-ink-800"
                          dangerouslySetInnerHTML={{ __html: renderMarkdown(agents) }}
                        />
                      )}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <>
                <div className="flex items-center justify-between border-b border-ink-100 px-4 py-2">
                  <Segmented
                    value={hookView}
                    onChange={(v) => setHookView(v as 'rules' | 'source')}
                    items={[
                      { value: 'rules', label: '规则编辑', icon: <ListChecks size={13} /> },
                      { value: 'source', label: '源码', icon: <FileCode size={13} /> }
                    ]}
                  />
                  <button
                    type="button"
                    className="text-xs text-violet-600 hover:underline"
                    onClick={() => setHook(HOOK_TEMPLATE)}
                  >
                    填入模板
                  </button>
                </div>
                <div className="min-h-0 flex-1 overflow-y-auto p-4">
                  {hookView === 'source' ? (
                    <textarea
                      className="h-full w-full resize-none rounded border border-ink-200 p-3 font-mono text-xs leading-relaxed outline-none focus:border-violet-400"
                      value={hook}
                      onChange={(e) => {
                        setHook(e.target.value);
                        setTestResult(null);
                      }}
                      disabled={!loaded}
                      spellCheck={false}
                    />
                  ) : (
                    <div className="space-y-2">
                      {rules.length === 0 && (
                        <div className="rounded border border-dashed border-ink-200 p-4 text-center text-xs text-ink-400">
                          暂无规则。点击下方「添加规则」，或切到「源码」填入模板。
                        </div>
                      )}
                      {rules.map((r, i) => (
                        <RuleRow key={i} rule={r} onChange={(p) => updateRule(i, p)} onRemove={() => removeRule(i)} />
                      ))}
                      <button
                        type="button"
                        onClick={addRule}
                        className="flex w-full items-center justify-center gap-1 rounded border border-dashed border-ink-200 py-1.5 text-xs text-ink-500 hover:border-violet-300 hover:text-violet-600"
                      >
                        <Plus size={13} /> 添加规则
                      </button>

                      {/* 规则测试沙盒 */}
                      <div className="mt-4 rounded border border-ink-200 bg-ink-50/60 p-3">
                        <div className="mb-2 flex items-center gap-1 text-xs font-medium text-ink-600">
                          <Play size={12} className="text-violet-500" /> 测试沙盒：粘贴一段文本试试规则效果
                        </div>
                        <textarea
                          rows={3}
                          value={sample}
                          onChange={(e) => setSample(e.target.value)}
                          placeholder="粘贴示例文本，例如 AI 生成的一段正文……"
                          className="w-full resize-none rounded border border-ink-200 bg-white p-2 text-xs outline-none focus:border-violet-400"
                        />
                        <div className="mt-2 flex items-center gap-2">
                          <button
                            type="button"
                            disabled={sample.trim() === '' || rules.length === 0}
                            className="rounded bg-violet-600 px-3 py-1 text-xs text-white hover:bg-violet-700 disabled:opacity-40"
                            onClick={runTest}
                          >
                            运行测试
                          </button>
                          {testResult && testResult.hits.length === 0 && (
                            <span className="text-xs text-ink-500">未命中任何规则</span>
                          )}
                        </div>
                        {testResult && testResult.hits.length > 0 && (
                          <div className="mt-2 space-y-1.5">
                            {testResult.hits.map((h, i) => (
                              <div key={i} className="flex items-center gap-2 text-xs">
                                <span className={`rounded px-1.5 py-0.5 font-medium ${ACTION_META[h.rule.action].chip}`}>
                                  {ACTION_META[h.rule.action].label}
                                </span>
                                <span className="truncate font-mono text-ink-600">{h.rule.source}</span>
                                <span className="text-ink-400">× {h.count}</span>
                              </div>
                            ))}
                            {testResult.replaced && (
                              <div className="rounded border border-ink-200 bg-white p-2 text-xs text-ink-700">
                                <div className="mb-1 text-[11px] text-ink-400">替换后：</div>
                                {testResult.text}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        </div>

        {/* 底栏 */}
        <div className="flex items-center justify-between border-t border-ink-100 px-5 py-3">
          <div className="text-xs text-ink-400">
            {dirty ? (
              <span className="flex items-center gap-1.5 text-amber-600">
                <span className="inline-block h-1.5 w-1.5 rounded-full bg-amber-500" /> 有未保存的修改
              </span>
            ) : (
              '修改即时保存在本地缓冲，点击保存后生效'
            )}
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded border border-ink-200 px-4 py-1.5 text-sm text-ink-600 hover:bg-ink-50"
              onClick={() => void requestClose()}
            >
              取消
            </button>
            <button
              type="button"
              disabled={!loaded}
              className="rounded bg-violet-600 px-5 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
              onClick={() => void save()}
            >
              保存
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

/** 左侧文件导航卡片 */
function FileCard({
  active,
  icon,
  name,
  desc,
  meta,
  onClick
}: {
  active: boolean;
  icon: React.ReactNode;
  name: string;
  desc: string;
  meta: string;
  onClick: () => void;
}): JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`w-full rounded-lg border p-2.5 text-left transition-colors ${
        active
          ? 'border-violet-300 bg-white shadow-sm ring-1 ring-violet-200'
          : 'border-transparent bg-white/60 hover:border-ink-200 hover:bg-white'
      }`}
    >
      <div className="flex items-center gap-2">
        <span className={`rounded-md p-1 ${active ? 'bg-violet-100 text-violet-600' : 'bg-ink-100 text-ink-500'}`}>
          {icon}
        </span>
        <span className={`font-mono text-xs font-semibold ${active ? 'text-violet-700' : 'text-ink-700'}`}>{name}</span>
      </div>
      <div className="mt-1.5 text-[11px] text-ink-500">{desc}</div>
      <div className="text-[11px] text-ink-400">{meta}</div>
    </button>
  );
}

/** 分段切换控件 */
function Segmented({
  value,
  onChange,
  items
}: {
  value: string;
  onChange: (v: string) => void;
  items: Array<{ value: string; label: string; icon: React.ReactNode }>;
}): JSX.Element {
  return (
    <div className="flex rounded-md border border-ink-200 bg-ink-50 p-0.5">
      {items.map((it) => (
        <button
          key={it.value}
          type="button"
          onClick={() => onChange(it.value)}
          className={`flex items-center gap-1 rounded px-2.5 py-1 text-xs transition-colors ${
            value === it.value ? 'bg-white font-medium text-violet-700 shadow-sm' : 'text-ink-500 hover:text-ink-800'
          }`}
        >
          {it.icon}
          {it.label}
        </button>
      ))}
    </div>
  );
}

/** 单条规则编辑行：动作 + 匹配模式（行内校验）+ 值 */
function RuleRow({
  rule,
  onChange,
  onRemove
}: {
  rule: HookRule;
  onChange: (patch: Partial<Pick<HookRule, 'action' | 'source' | 'value'>>) => void;
  onRemove: () => void;
}): JSX.Element {
  const patternBad = rule.source.trim() !== '' && !isValidHookPattern(rule.source);
  return (
    <div className="rounded-lg border border-ink-200 bg-white p-2">
      <div className="flex items-center gap-2">
        <select
          value={rule.action}
          onChange={(e) => onChange({ action: e.target.value as HookRule['action'] })}
          className={`shrink-0 rounded border-0 py-1 text-xs font-medium outline-none ring-1 ring-inset ${
            rule.action === 'replace'
              ? 'bg-violet-100 text-violet-700 ring-violet-200'
              : rule.action === 'warn'
                ? 'bg-amber-100 text-amber-700 ring-amber-200'
                : 'bg-red-100 text-red-700 ring-red-200'
          }`}
        >
          <option value="replace">替换</option>
          <option value="warn">提醒</option>
          <option value="block">阻断</option>
        </select>
        <input
          value={rule.source}
          onChange={(e) => onChange({ source: e.target.value })}
          placeholder="/正则/g 或关键词"
          spellCheck={false}
          className={`min-w-0 flex-1 rounded border px-2 py-1 font-mono text-xs outline-none focus:border-violet-400 ${
            patternBad ? 'border-red-300 bg-red-50' : 'border-ink-200'
          }`}
        />
        <span className="shrink-0 font-mono text-xs text-ink-400">=&gt;</span>
        <input
          value={rule.value}
          onChange={(e) => onChange({ value: e.target.value })}
          placeholder={rule.action === 'replace' ? '替换文本' : '提示 / 原因'}
          className={`min-w-0 flex-1 rounded border border-ink-200 px-2 py-1 text-xs outline-none focus:border-violet-400`}
        />
        <button
          type="button"
          onClick={onRemove}
          className="shrink-0 rounded p-1 text-ink-300 hover:bg-red-50 hover:text-red-500"
          title="删除规则"
        >
          <Trash2 size={14} />
        </button>
      </div>
      {patternBad && (
        <div className="mt-1 pl-1 text-[11px] text-red-500">正则表达式无效，该规则将被跳过</div>
      )}
    </div>
  );
}
