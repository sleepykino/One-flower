/**
 * 指令说明（PR-B 新增）：一页讲清三层指令体系（agents.md > 全局提示词 > Skill）
 * 与 hook.md 输出规则机制，附各入口跳转/位置说明——只做说明，不重复编辑入口
 */

import { BookOpen, PenLine, Puzzle, ShieldCheck, ArrowRight } from 'lucide-react';

type SectionKey = 'models' | 'routing' | 'prompts' | 'directives' | 'appearance' | 'backup' | 'data' | 'general';

const LAYERS: Array<{
  icon: React.ReactNode;
  name: string;
  scope: string;
  where: string;
  desc: string;
  goSection?: SectionKey;
}> = [
  {
    icon: <BookOpen size={16} />,
    name: 'agents.md 本书创作总纲',
    scope: '项目级（每本书独立，随书保存与备份）',
    where: '编辑器右侧「AI 助手」面板顶部 → 本书指令',
    desc: '世界观铁律、称谓规范、写作禁令等。注入所有 AI 生成（续写/改写/对白/检查/长文/剧本）系统提示词的最高优先级处。'
  },
  {
    icon: <PenLine size={16} />,
    name: '全局提示词',
    scope: '应用级（跨所有书生效）',
    where: '本设置页 → 指令与风格 → 全局提示词',
    desc: '多条目启停排序，适合放个人写作习惯（如"避免使用仿佛"）。优先级低于 agents.md、高于 Skill。',
    goSection: 'prompts'
  },
  {
    icon: <Puzzle size={16} />,
    name: 'Skill 文风包',
    scope: '书级启停（本体全局共享，可导入导出 zip）',
    where: '编辑器右侧 rail「AI」分组 → Skill',
    desc: '声明式文风指令包（SKILL.md），按模式过滤生效（如武侠古典只作用于正文生成）。优先级最低。'
  }
];

export function DirectivesGuideSection({ onGoSection }: { onGoSection: (s: SectionKey) => void }): JSX.Element {
  return (
    <div>
      <p className="mb-4 text-xs leading-5 text-ink-500">
        三种机制控制 AI 的行为，注入优先级从高到低：
        <span className="font-medium text-violet-700"> agents.md &gt; 全局提示词 &gt; Skill 文风包</span>
        ；冲突时高优先级一方生效。另有 hook.md 在生成完成后做输出校验。
      </p>

      <div className="space-y-2">
        {LAYERS.map((l, i) => (
          <div key={l.name} className="rounded-lg border border-ink-100 bg-white p-3">
            <div className="flex items-center gap-2">
              <span className="rounded-md bg-violet-100 p-1 text-violet-600">{l.icon}</span>
              <span className="text-sm font-medium text-ink-800">{l.name}</span>
              <span className="rounded bg-ink-100 px-1.5 py-px text-[10px] text-ink-500">
                优先级 {i + 1}
              </span>
            </div>
            <div className="mt-2 grid grid-cols-[64px_1fr] gap-x-3 gap-y-1 text-xs">
              <span className="text-ink-400">作用域</span>
              <span className="text-ink-600">{l.scope}</span>
              <span className="text-ink-400">编辑位置</span>
              <span className="flex items-center gap-2 text-ink-600">
                {l.where}
                {l.goSection && (
                  <button
                    type="button"
                    className="flex items-center gap-0.5 text-violet-600 hover:underline"
                    onClick={() => onGoSection(l.goSection!)}
                  >
                    前往 <ArrowRight size={11} />
                  </button>
                )}
              </span>
              <span className="text-ink-400">说明</span>
              <span className="leading-5 text-ink-600">{l.desc}</span>
            </div>
          </div>
        ))}

        {/* hook.md：不是指令层，是输出校验机制 */}
        <div className="rounded-lg border border-amber-200 bg-amber-50/60 p-3">
          <div className="flex items-center gap-2">
            <span className="rounded-md bg-amber-100 p-1 text-amber-600">
              <ShieldCheck size={16} />
            </span>
            <span className="text-sm font-medium text-ink-800">hook.md 输出规则</span>
            <span className="rounded bg-amber-100 px-1.5 py-px text-[10px] text-amber-700">生成后执行</span>
          </div>
          <div className="mt-2 grid grid-cols-[64px_1fr] gap-x-3 gap-y-1 text-xs">
            <span className="text-ink-400">作用域</span>
            <span className="text-ink-600">项目级（与 agents.md 同在「本书指令」中编辑）</span>
            <span className="text-ink-400">机制</span>
            <span className="leading-5 text-ink-600">
              AI 生成完成后自动执行三类规则：<span className="font-medium">replace</span>（正则替换，如敏感词）、
              <span className="font-medium">warn</span>（提醒不改文本）、
              <span className="font-medium">block</span>（命中违规则丢弃本次输出并携带原因自动重试一次）。
              命中结果以卡片显示在 AI 面板。
            </span>
          </div>
        </div>
      </div>

      <div className="mt-4 rounded border border-ink-100 bg-ink-50/60 p-3 text-xs leading-5 text-ink-500">
        建议：世界观层面的硬约束写进 agents.md（随书走）；个人习惯写进全局提示词（跨书生效）；
        成体系的文风写进 Skill（可分享导入导出）；敏感词与称谓修正交给 hook.md 自动处理。
      </div>
    </div>
  );
}
