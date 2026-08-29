/**
 * Settings 页：侧边栏分区导航（Trae 式）+ 内容区（PR-B 重组）
 * 分区：模型与服务（模型接入 / 模型分工）· 指令与风格（全局提示词 / 指令说明）· 外观（编辑器）
 *      数据（备份与恢复 / 数据管理）· 通用（更新与关于）
 */

import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plug,
  Route,
  PenLine,
  BookMarked,
  Palette,
  FolderOpen,
  DatabaseBackup,
  Settings2,
  Keyboard,
  Gauge,
  GraduationCap,
  type LucideIcon
} from 'lucide-react';
import { ModelsSection } from '../components/settings/ModelsSection';
import { FeatureModelsSection } from '../components/settings/FeatureModelsSection';
import { GlobalPromptsSection } from '../components/settings/GlobalPromptsSection';
import { AppearanceSection } from '../components/settings/AppearanceSection';
import { BackupSection } from '../components/settings/BackupSection';
import { DataSection } from '../components/settings/DataSection';
import { GeneralSection } from '../components/settings/GeneralSection';
import { DirectivesGuideSection } from '../components/settings/DirectivesGuideSection';
import { ShortcutsSection } from '../components/settings/ShortcutsSection';
import { UsageSection } from '../components/settings/UsageSection';
import { OnboardingSection } from '../components/settings/OnboardingSection';

type SectionKey =
  | 'models'
  | 'routing'
  | 'usage'
  | 'prompts'
  | 'directives'
  | 'appearance'
  | 'backup'
  | 'data'
  | 'shortcuts'
  | 'onboarding'
  | 'general';

interface NavItem {
  key: SectionKey;
  label: string;
  icon: LucideIcon;
}

const NAV_GROUPS: Array<{ label: string; items: NavItem[] }> = [
  {
    label: '模型与服务',
    items: [
      { key: 'models', label: '模型接入', icon: Plug },
      { key: 'routing', label: '模型分工', icon: Route },
      { key: 'usage', label: '用量统计', icon: Gauge }
    ]
  },
  {
    label: '指令与风格',
    items: [
      { key: 'prompts', label: '全局提示词', icon: PenLine },
      { key: 'directives', label: '指令说明', icon: BookMarked }
    ]
  },
  {
    label: '外观',
    items: [{ key: 'appearance', label: '编辑器', icon: Palette }]
  },
  {
    label: '数据',
    items: [
      { key: 'backup', label: '备份与恢复', icon: DatabaseBackup },
      { key: 'data', label: '数据管理', icon: FolderOpen }
    ]
  },
  {
    label: '通用',
    items: [
      { key: 'shortcuts', label: '快捷键', icon: Keyboard },
      { key: 'onboarding', label: '使用引导', icon: GraduationCap },
      { key: 'general', label: '更新与关于', icon: Settings2 }
    ]
  }
];

const SECTION_TITLES: Record<SectionKey, string> = {
  models: '模型接入',
  routing: 'AI 模型分工',
  usage: '用量统计',
  prompts: '全局提示词',
  directives: '指令说明',
  appearance: '编辑器外观',
  backup: '备份与恢复',
  data: '数据管理',
  shortcuts: '快捷键',
  onboarding: '使用引导',
  general: '更新与关于'
};

export function Settings(): JSX.Element {
  const navigate = useNavigate();
  const [section, setSection] = useState<SectionKey>('models');

  return (
    <div className="flex h-full">
      {/* 左侧导航栏 */}
      <aside className="flex w-52 shrink-0 flex-col border-r border-ink-200 bg-ink-50">
        <div className="flex items-center justify-between px-4 py-4">
          <span className="text-base font-bold">设置</span>
          <button
            type="button"
            className="rounded border border-ink-200 bg-white px-2 py-1 text-xs hover:bg-ink-100"
            onClick={() => navigate('/')}
          >
            ← 返回
          </button>
        </div>
        <nav className="flex-1 overflow-y-auto px-2 pb-4">
          {NAV_GROUPS.map((g) => (
            <div key={g.label} className="mb-3">
              <div className="px-2 py-1 text-[10px] font-medium uppercase tracking-wider text-ink-400">
                {g.label}
              </div>
              {g.items.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setSection(item.key)}
                  className={`mb-0.5 flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-sm ${
                    section === item.key
                      ? 'bg-violet-100 font-medium text-violet-700'
                      : 'text-ink-600 hover:bg-ink-100 hover:text-ink-900'
                  }`}
                >
                  <item.icon size={15} className="shrink-0" />
                  {item.label}
                </button>
              ))}
            </div>
          ))}
        </nav>
      </aside>

      {/* 右侧内容区 */}
      <main className="min-w-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-2xl px-6 py-6">
          <h1 className="mb-4 text-lg font-bold">{SECTION_TITLES[section]}</h1>
          {section === 'models' && <ModelsSection />}
          {section === 'routing' && <FeatureModelsSection />}
          {section === 'usage' && <UsageSection />}
          {section === 'prompts' && <GlobalPromptsSection />}
          {section === 'directives' && <DirectivesGuideSection onGoSection={(s) => setSection(s)} />}
          {section === 'appearance' && <AppearanceSection />}
          {section === 'backup' && <BackupSection />}
          {section === 'data' && <DataSection />}
          {section === 'shortcuts' && <ShortcutsSection />}
          {section === 'onboarding' && <OnboardingSection />}
          {section === 'general' && <GeneralSection />}
        </div>
      </main>
    </div>
  );
}
