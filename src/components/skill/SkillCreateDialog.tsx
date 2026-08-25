/**
 * Skill 创建向导：表单填写 frontmatter 与正文 → 生成 SKILL.md → 写入 ~/.novelagent/skills/<name>/
 * 生成格式与 SkillLoader 解析规则完全兼容（单行 key: value、数组 [a, b]）
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { getAppContext } from '../../context/app-context';
import { toast } from '../common/toast';
import type { AIMode } from '../../services/skill/types';

const MODE_OPTIONS: Array<{ value: AIMode; label: string; hint?: string }> = [
  { value: 'continue', label: '续写' },
  { value: 'rewrite', label: '改写' },
  { value: 'dialogue', label: '对白' },
  { value: 'check', label: '检查', hint: '一致性检查不注入文风' }
];

const DEFAULT_BODY = `# 文风指令

## 用词偏好
- 在此描述用词偏好，例如：对白半文半白、动词具象化

## 句式
- 在此描述句式特征，例如：短句为主、段落首句即立场

## 禁忌
- 在此列出应避免的表达，例如：不出现现代科技词汇、不使用网络流行语
`;

/** 合法 Skill 目录名（与 SkillPackService 同规则） */
function isSafeName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !/[\\/:*?"<>|]/.test(name);
}

interface Props {
  onClose: () => void;
  onCreated: (name: string) => void | Promise<void>;
}

export function SkillCreateDialog({ onClose, onCreated }: Props): JSX.Element {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [appliesTo, setAppliesTo] = useState<AIMode[]>(['continue', 'rewrite', 'dialogue']);
  const [priority, setPriority] = useState(5);
  const [body, setBody] = useState(DEFAULT_BODY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const toggleMode = (m: AIMode): void => {
    setAppliesTo((cur) => (cur.includes(m) ? cur.filter((x) => x !== m) : [...cur, m]));
  };

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    const trimmed = name.trim();
    if (!isSafeName(trimmed)) {
      setError('名称不合法：仅限字母/数字/短横线，不能包含 \\ / : * ? " < > | 等字符');
      return;
    }
    if (!description.trim()) {
      setError('请填写一句话描述（将展示在 Skill 列表）');
      return;
    }
    if (appliesTo.length === 0) {
      setError('请至少选择一种适用的 AI 模式');
      return;
    }
    if (!body.trim()) {
      setError('文风指令正文不能为空');
      return;
    }

    const priorityNum = Math.max(1, Math.min(99, Math.floor(priority) || 0));
    const content = [
      '---',
      `name: ${trimmed}`,
      `description: ${description.trim()}`,
      'trigger: manual',
      `applies_to: [${appliesTo.join(', ')}]`,
      `priority: ${priorityNum}`,
      '---',
      '',
      body.trim(),
      ''
    ].join('\n');

    setSaving(true);
    try {
      const ctx = getAppContext();
      const path = `${ctx.skillLoader.dir}/${trimmed}/SKILL.md`;
      await ctx.bridge.fs.writeFile(path, content);
      await ctx.skillLoader.reload(); // 重扫目录（watch 亦会触发，双保险）
      toast.success(`已创建 Skill「${trimmed}」`);
      await onCreated(trimmed);
      onClose();
    } catch (err) {
      setError(`创建失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center bg-black/30"
      onClick={() => {
        if (!saving) onClose();
      }}
    >
      <form
        className="flex max-h-[90vh] w-[520px] flex-col rounded-lg bg-white p-4 shadow-2xl"
        onSubmit={(e) => void submit(e)}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 text-base font-medium">创建文风 Skill</div>

        <div className="flex-1 space-y-3 overflow-y-auto pr-1">
          <div className="space-y-1">
            <label className="block text-xs font-medium text-ink-600">名称（目录名）*</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="如 my-style，仅限字母/数字/短横线"
              autoFocus
              className="w-full rounded border border-ink-200 px-2 py-1.5 text-sm"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-ink-600">描述 *</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="一句话说明文风，如：民国悬疑，冷峻白描"
              className="w-full rounded border border-ink-200 px-2 py-1.5 text-sm"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-ink-600">适用模式 *</label>
            <div className="flex flex-wrap gap-2">
              {MODE_OPTIONS.map((m) => (
                <label
                  key={m.value}
                  className={`flex cursor-pointer items-center gap-1 rounded border px-2 py-1 text-xs ${
                    appliesTo.includes(m.value)
                      ? 'border-violet-300 bg-violet-50 text-violet-700'
                      : 'border-ink-200 text-ink-500 hover:bg-ink-50'
                  }`}
                  title={m.hint}
                >
                  <input
                    type="checkbox"
                    className="hidden"
                    checked={appliesTo.includes(m.value)}
                    onChange={() => toggleMode(m.value)}
                  />
                  {m.label}
                </label>
              ))}
            </div>
            <p className="text-[11px] text-ink-400">检查模式不会注入文风（一致性审查排除文风包）</p>
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-ink-600">优先级（1–99，数字大优先）</label>
            <input
              type="number"
              min={1}
              max={99}
              value={priority}
              onChange={(e) => setPriority(Number(e.target.value))}
              className="w-24 rounded border border-ink-200 px-2 py-1.5 text-sm"
            />
          </div>

          <div className="space-y-1">
            <label className="block text-xs font-medium text-ink-600">文风指令正文 *</label>
            <textarea
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={10}
              className="w-full rounded border border-ink-200 px-2 py-1.5 font-mono text-xs leading-5"
              spellCheck={false}
            />
            <p className="text-[11px] text-ink-400">
              这段 Markdown 会注入 AI 的每次生成 Prompt。以「用词偏好 / 句式 / 禁忌」结构起步，越具体越有效。
            </p>
          </div>

          {error && (
            <div className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-600">{error}</div>
          )}
        </div>

        <div className="mt-3 flex justify-end gap-2 border-t border-ink-100 pt-3">
          <button
            type="button"
            className="rounded border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
            onClick={onClose}
            disabled={saving}
          >
            取消
          </button>
          <button
            type="submit"
            disabled={saving}
            className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {saving ? '创建中…' : '创建'}
          </button>
        </div>
      </form>
    </div>
  );
}