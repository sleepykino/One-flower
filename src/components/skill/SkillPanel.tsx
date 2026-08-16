/**
 * Skill 勾选面板：列出全部 Skill，按书籍勾选启用
 */

import { useEffect, useState } from 'react';
import { getAppContext } from '../../context/app-context';
import type { SkillManifest } from '../../services/skill/types';

const MODE_LABEL: Record<string, string> = {
  continue: '续写',
  rewrite: '改写',
  dialogue: '对白',
  check: '检查'
};

export function SkillPanel({ bookId }: { bookId: string }): JSX.Element {
  const [skills, setSkills] = useState<SkillManifest[]>([]);
  const [enabled, setEnabled] = useState<string[]>([]);

  const load = async (): Promise<void> => {
    const ctx = getAppContext();
    setSkills([...ctx.skillLoader.all].sort((a, b) => b.priority - a.priority));
    setEnabled(await ctx.bookService.getEnabledSkills(bookId));
  };

  useEffect(() => {
    void load();
    // Skill 目录热重载
    const unwatch = ctxWatch();
    return unwatch;
    function ctxWatch(): () => void {
      const ctx = getAppContext();
      return ctx.skillLoader.watch(() => {
        void load();
      });
    }
  }, [bookId]);

  const toggle = async (name: string): Promise<void> => {
    const next = enabled.includes(name) ? enabled.filter((n) => n !== name) : [...enabled, name];
    setEnabled(next);
    await getAppContext().bookService.setEnabledSkills(bookId, next);
  };

  const reload = async (): Promise<void> => {
    await getAppContext().skillLoader.reload();
    await load();
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
        <span className="text-sm font-medium">文风 Skill（{skills.length}）</span>
        <button
          type="button"
          className="text-xs text-violet-600 hover:underline"
          onClick={() => void reload()}
        >
          重新扫描
        </button>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        <div className="mb-2 rounded bg-ink-50 p-2 text-[11px] text-ink-500">
          Skill 目录：{getAppContext().skillLoader.dir}
          <br />
          勾选后按 applies_to 在对应 AI 模式注入 Prompt；一致性检查不注入文风。
        </div>
        {skills.length === 0 && (
          <div className="px-2 py-4 text-center text-xs text-ink-400">
            未发现 Skill。放置 SKILL.md 到 Skill 目录后点「重新扫描」。
          </div>
        )}
        {skills.map((s) => (
          <label
            key={s.name}
            className="mb-1 flex cursor-pointer items-start gap-2 rounded border border-ink-100 bg-white px-2 py-1.5 hover:border-violet-300"
          >
            <input
              type="checkbox"
              checked={enabled.includes(s.name)}
              onChange={() => void toggle(s.name)}
              className="mt-0.5"
            />
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1">
                <span className="text-sm font-medium">{s.name}</span>
                <span className="rounded bg-ink-100 px-1 text-[10px] text-ink-500">
                  P{s.priority}
                </span>
              </div>
              <div className="text-xs text-ink-400">{s.description}</div>
              <div className="mt-0.5 flex gap-1">
                {s.appliesTo.map((m) => (
                  <span key={m} className="rounded bg-violet-50 px-1 text-[10px] text-violet-600">
                    {MODE_LABEL[m] ?? m}
                  </span>
                ))}
              </div>
            </div>
          </label>
        ))}
      </div>
    </div>
  );
}
