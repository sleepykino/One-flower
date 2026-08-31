/**
 * ForgePreviewDialog（P7.4 M3）：炼化结果的预览编辑与保存。
 * 表单结构、校验、样式照抄 SkillCreateDialog；差异：
 * - 初始值注入生成结果（draft 为 null 时打开空白模板手动填写兜底）
 * - body 超长软提示（可继续保存，truncateToTokenBudget 是最终兜底）
 * - 同名冲突：软件内弹窗「改名 / 覆盖」二选一，不静默覆盖
 * - 落盘：buildSkillMarkdown -> writeFile -> skillLoader.reload（watch 双保险）
 * - 原始素材不留档；来源书名仅在用户勾选时追加到 description
 */

import { useState } from 'react';
import type { FormEvent } from 'react';
import { getAppContext } from '../../context/app-context';
import { confirmDialog } from '../../native/dialog';
import { toast } from '../common/toast';
import { buildSkillMarkdown, BODY_MAX_CHARS, DEFAULT_FORGE_BODY } from '../../services/skill/SkillForgeService';
import type { SkillForgeDraft } from '../../services/skill/SkillForgeService';
import type { AIMode } from '../../services/skill/types';

const MODE_OPTIONS: Array<{ value: AIMode; label: string; hint?: string }> = [
  { value: 'continue', label: '续写' },
  { value: 'rewrite', label: '改写' },
  { value: 'dialogue', label: '对白' },
  { value: 'check', label: '检查', hint: '一致性检查不注入文风' }
];

/** 合法 Skill 目录名（与 SkillCreateDialog / SkillPackService 同规则） */
function isSafeName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !/[\\/:*?"<>|]/.test(name);
}

interface Props {
  /** 生成结果；null = 自动解析失败，打开空白模板手动填写 */
  draft: SkillForgeDraft | null;
  /** 来源书名（book 来源且勾选「描述中注明来源书名」时传入，仅用于 description 后缀） */
  sourceTitle: string | null;
  onClose: () => void;
}

export function ForgePreviewDialog({ draft, sourceTitle, onClose }: Props): JSX.Element {
  const [name, setName] = useState(draft?.name ?? '');
  const [description, setDescription] = useState(draft?.description ?? '');
  const [appliesTo, setAppliesTo] = useState<AIMode[]>(
    draft?.appliesTo ?? ['continue', 'rewrite', 'dialogue']
  );
  const [priority, setPriority] = useState(draft?.priority ?? 5);
  const [body, setBody] = useState(draft?.body ?? DEFAULT_FORGE_BODY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const bodyOverlong = body.length > BODY_MAX_CHARS;

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
    const ctx = getAppContext();

    // 同名冲突：软件内弹窗二选一（改名 / 覆盖），不静默覆盖
    const exists = ctx.skillLoader.all.some((s) => s.name === trimmed);
    if (exists) {
      const ok = await confirmDialog(
        `已存在同名 Skill「${trimmed}」。\n「确认」将覆盖该 Skill 原文件；「取消」可返回修改名称（改名保存，不覆盖）。`,
        '同名冲突'
      );
      if (!ok) {
        setError('请修改名称后再保存（同名不会被静默覆盖）');
        return;
      }
    }

    // 来源书名后缀：仅用户勾选时写入 description（原始素材不留档）
    let finalDescription = description.trim();
    if (sourceTitle) finalDescription = `${finalDescription}（提炼自《${sourceTitle}》）`;

    const content = buildSkillMarkdown({
      name: trimmed,
      description: finalDescription,
      appliesTo,
      priority: priorityNum,
      body
    });

    setSaving(true);
    try {
      const path = `${ctx.skillLoader.dir}/${trimmed}/SKILL.md`;
      await ctx.bridge.fs.writeFile(path, content);
      await ctx.skillLoader.reload(); // 重扫目录（watch 亦会触发，双保险）
      toast.success(`已保存 Skill「${trimmed}」，到编辑器右侧 Skill 面板为书籍启用即可生效`);
      onClose();
    } catch (err) {
      setError(`保存失败：${err instanceof Error ? err.message : String(err)}`);
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
        <div className="mb-3 text-base font-medium">预览与保存文风 Skill</div>

        {!draft && (
          <div className="mb-3 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            自动解析失败，已打开空白模板，请手动填写
          </div>
        )}

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
            {sourceTitle && (
              <p className="text-[11px] text-ink-400">保存时将追加来源书名：{`（提炼自《${sourceTitle}》）`}</p>
            )}
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
            {bodyOverlong && (
              <div className="rounded bg-red-50 px-2 py-1.5 text-xs text-red-600">
                正文超 {BODY_MAX_CHARS} 字，将挤占每次生成的 Skill token 预算（约 2000），建议精简（可继续保存）
              </div>
            )}
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
            {saving ? '保存中…' : '保存'}
          </button>
        </div>
      </form>
    </div>
  );
}
