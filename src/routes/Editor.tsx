/**
 * Editor 页：左侧章节树 / 中间编辑器 / 右侧多面板（AI / 角色 / 世界书 / 伏笔 / 历史 / Skill）
 * 顶栏：专注模式（沉浸写作）/ 地图 / 时间线 / 命名生成器 / 全局查找
 * Ctrl+Shift+F 全局查找
 */

import { Fragment, useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Sparkles,
  Layers,
  Database,
  Users,
  BookOpen,
  GitBranch,
  History,
  Puzzle,
  BarChart3,
  Mic,
  FlaskConical,
  type LucideIcon
} from 'lucide-react';
import { useEditorStore } from '../store/editorStore';
import { NovelEditor } from '../components/editor/NovelEditor';
import { FocusMode } from '../components/editor/FocusMode';
import { ChapterTree } from '../components/chapter-tree/ChapterTree';
import { AIPanel } from '../components/ai/AIPanel';
import { ContextPanel } from '../components/ai/ContextPanel';
import { CharacterList } from '../components/character-card/CharacterList';
import { WorldbookPanel } from '../components/worldbook/WorldbookPanel';
import { ForeshadowPanel } from '../components/foreshadow/ForeshadowPanel';
import { VersionHistory } from '../components/version/VersionHistory';
import { SkillPanel } from '../components/skill/SkillPanel';
import { WritingStatsPanel } from '../components/stats/WritingStats';
import { GlobalSearchModal } from '../components/search/GlobalSearch';
import { ExportDialog } from '../components/export/ExportDialog';
import { MapEditor } from '../components/map/MapEditor';
import { TimelineView } from '../components/timeline/TimelineView';
import { NameGenerator } from '../components/namegen/NameGenerator';
import { TaskIndicator } from '../components/task/TaskIndicator';
import { CharacterInterview } from '../components/inspiration/CharacterInterview';
import { WhatIfPanel } from '../components/inspiration/WhatIfPanel';
import { getAppContext } from '../context/app-context';
import type { LongFormSession } from '../services/longform/types';
import { resolveProviderConfigIdForFeature } from '../services/ai/providerResolver';
import { createProvider } from '../services/ai/providers/LLMProvider';

type RightTab =
  | 'ai'
  | 'longform' // P2.1-M7：长文模式（Phase 7 启用）
  | 'context'
  | 'characters'
  | 'worldbook'
  | 'foreshadow'
  | 'history'
  | 'skills'
  | 'stats'
  | 'interview' // P2.1-B M3：角色采访
  | 'whatif'; // P2.1-B M4：推演器

/** P2.1-M7 长文 tab 启用开关（Phase 7 已启用） */
const LONGFORM_ENABLED = true;

/** P2.1-M3：右侧面板分组（AI / 资料 / 工具），icon rail 呈现 */
const RIGHT_TAB_GROUPS: Array<{
  label: string;
  tabs: Array<{ key: RightTab; title: string; icon: LucideIcon; hidden?: boolean }>;
}> = [
  {
    label: 'AI',
    tabs: [
      { key: 'ai', title: 'AI 助手', icon: Sparkles },
      { key: 'longform', title: '长文', icon: Layers, hidden: !LONGFORM_ENABLED }
    ]
  },
  {
    label: '资料',
    tabs: [
      { key: 'context', title: '上下文', icon: Database },
      { key: 'characters', title: '角色', icon: Users },
      { key: 'worldbook', title: '世界书', icon: BookOpen },
      { key: 'foreshadow', title: '伏笔', icon: GitBranch }
    ]
  },
  {
    label: '工具',
    tabs: [
      { key: 'history', title: '版本', icon: History },
      { key: 'skills', title: 'Skill', icon: Puzzle },
      { key: 'stats', title: '统计', icon: BarChart3 }
    ]
  },
  {
    label: '灵感',
    tabs: [
      { key: 'interview', title: '角色采访', icon: Mic },
      { key: 'whatif', title: '如果…会怎样', icon: FlaskConical }
    ]
  }
];

/** AI 生成地图的系统提示词（输出 { nodes, connections } JSON，契约见 MapEditor.parseAiContent；icon id 全集见 map/types.ts ICON_LIBRARY） */
const MAP_AI_SYSTEM = `你是小说世界地图设计师。根据用户描述生成地图 JSON，严格只输出 JSON 对象（不要 markdown 代码围栏、不要解释）：
{"nodes":[{"id":"n1","type":"location","label":"地点名","x":600,"y":400,"shape":"icon","icon":"city","radius":26,"color":"#7c3aed","desc":"一句话设定"}],"connections":[{"id":"c1","fromNodeId":"n1","toNodeId":"n2","label":"官道","style":"solid","lineType":"curve","arrow":false}]}
规则：
- 画布 1600x1000：x∈[100,1500]、y∈[100,900]，布局疏朗、节点不重叠，按地理逻辑分布（港口靠海、山脉在边缘、河流沿岸有聚落）
- type 只用 location（主要地点）与 marker（次要文字标注，radius 用 8），不生成 region；shape 一律用 "icon"，location 的 radius 用 22~30
- icon 从以下 id 中选择（按含义匹配）：
  地形：mountain山脉/snowpeak雪山/volcano火山/desert沙漠/island岛屿/hills丘陵/valley溪谷/icefield冰原
  水文：ocean海洋/lake湖泊/river河流/spring泉水/hotspring温泉/waterfall瀑布/wetland湿地
  植被：forest森林/jungle丛林/grassland草原/autumn秋林/gobi戈壁
  聚居：city城市/town城镇/village村庄/tribe部落/camp营地/ruins废墟/farm农场/fishing渔村
  建筑：castle城堡/palace宫殿/temple神殿/shrine神社/tower高塔/bridge桥梁/tavern酒馆/market集市/academy学院/cemetery墓地
  军事：fortress要塞/battle战场/barracks军营/beacon烽火台/pass关隘
  奇幻：cave洞穴/dragon龙巢/secret秘境/astro占星台/relic遗迹/crystal水晶矿/mine矿坑/holy圣地/demon魔窟/teleport传送门/harbor港口/stable驿站
- color 从 #7c3aed #2563eb #0891b2 #16a34a #ca8a04 #ea580c #dc2626 #db2777 #524c44 #1f2937 中选取，同类地点用同色
- connections 表示道路/航线等关联，label 简短（如"官道""海路"），style 用 solid 或 dashed；lineType 用 curve（道路）或 straight（航线/边界），单方向关系加 arrow:true
- 可选给主要地点写 desc（一句话设定，≤20 字）；生成 8~18 个节点`;

export function Editor(): JSX.Element {
  const { bookId = '' } = useParams();
  const navigate = useNavigate();
  const setBookId = useEditorStore((s) => s.setBookId);
  const loadChapters = useEditorStore((s) => s.loadChapters);
  const chapters = useEditorStore((s) => s.chapters);
  const currentChapterId = useEditorStore((s) => s.currentChapterId);
  const saveState = useEditorStore((s) => s.saveState);
  const [tab, setTab] = useState<RightTab>('ai');
  const [searchOpen, setSearchOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [bookTitle, setBookTitle] = useState('');
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  // P2：工具 overlay + 沉浸模式
  const [mapOpen, setMapOpen] = useState(false);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [namegenOpen, setNamegenOpen] = useState(false);
  const [focusOn, setFocusOn] = useState(false);
  // P2.1-M7：未完成长文会话恢复横幅
  const [lfActive, setLfActive] = useState<LongFormSession | null>(null);

  useEffect(() => {
    setLfActive(null);
    void getAppContext()
      .longformService.findActive(bookId)
      .then(setLfActive)
      .catch(() => undefined);
  }, [bookId]);

  useEffect(() => {
    setBookId(bookId);
    void loadChapters(bookId);
    void getAppContext()
      .bookService.get(bookId)
      .then((b) => setBookTitle(b?.title ?? ''));
    // 写作统计：进入编辑器开启会话，离开时记录字数差 + 时长
    const { statsService } = getAppContext();
    void statsService.beginSession(bookId);
    return () => {
      void statsService.endSession(bookId);
    };
  }, [bookId, setBookId, loadChapters]);

  // Ctrl+Shift+F 全局查找
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === 'f') {
        e.preventDefault();
        setSearchOpen(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** AI 生成地图：解析书籍绑定的 provider，chat 生成 { nodes, connections } JSON 字符串 */
  const aiGenerateMap = useCallback(
    async (prompt: string): Promise<string> => {
      const { bridge, db } = getAppContext();
      const configId = await resolveProviderConfigIdForFeature(bridge, bookId, 'map');
      if (!configId) throw new Error('未配置模型，请先到设置页添加 Provider 配置');
      const row = await db.queryOne<Record<string, unknown>>(
        'SELECT * FROM provider_configs WHERE id = ?',
        [configId]
      );
      if (!row) throw new Error('模型配置不存在');
      const apiKey = (await bridge.keyStore.getSecret(`provider_${String(row.id)}`)) ?? '';
      if (!apiKey) throw new Error(`配置「${String(row.name)}」未设置 API Key`);
      const model = String(row.model);
      const provider = createProvider(
        {
          id: String(row.id),
          name: String(row.name),
          provider: String(row.provider),
          baseUrl: (row.base_url as string) ?? undefined,
          model
        },
        apiKey
      );
      const res = await provider.chat(
        [
          { role: 'system', content: MAP_AI_SYSTEM },
          { role: 'user', content: prompt }
        ],
        { model, maxTokens: 8192, temperature: 0.5 }
      );
      return res.content;
    },
    [bookId]
  );

  const currentChapter = chapters.find((c) => c.id === currentChapterId);

  return (
    <div className="flex h-full flex-col">
      {/* 顶栏 */}
      <header className="flex items-center gap-3 border-b border-ink-200 bg-white px-4 py-2">
        <button
          type="button"
          className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100"
          onClick={() => navigate('/')}
        >
          ← 书架
        </button>
        <div className="font-medium">{bookTitle}</div>
        <div className="text-xs text-ink-400">
          {currentChapter ? `${currentChapter.title} · ${currentChapter.wordCount} 字` : '未选择章节'}
        </div>
        <div className="ml-auto flex items-center gap-2 text-xs">
          {/* P2 工具组：专注 / 地图 / 时间线 / 命名 */}
          <button
            type="button"
            className={`rounded border px-2 py-1 hover:bg-ink-100 ${
              focusOn ? 'border-violet-300 text-violet-700' : 'border-ink-200 text-ink-500'
            }`}
            title="沉浸写作模式（打字机居中，Esc 退出）"
            onClick={() => setFocusOn(true)}
          >
            专注
          </button>
          <button
            type="button"
            className="rounded border border-ink-200 px-2 py-1 text-ink-500 hover:bg-ink-100"
            title="世界地图编辑"
            onClick={() => setMapOpen(true)}
          >
            地图
          </button>
          <button
            type="button"
            className="rounded border border-ink-200 px-2 py-1 text-ink-500 hover:bg-ink-100"
            title="多时间线管理"
            onClick={() => setTimelineOpen(true)}
          >
            时间线
          </button>
          <button
            type="button"
            className="rounded border border-ink-200 px-2 py-1 text-ink-500 hover:bg-ink-100"
            title="角色 / 地点 / 招式 / 势力命名"
            onClick={() => setNamegenOpen(true)}
          >
            命名
          </button>
          <button
            type="button"
            className={`rounded border px-2 py-1 hover:bg-ink-100 ${leftOpen ? 'border-violet-300 text-violet-700' : 'border-ink-200 text-ink-500'}`}
            title={leftOpen ? '收起章节目录' : '展开章节目录'}
            onClick={() => setLeftOpen((v) => !v)}
          >
            {leftOpen ? '◀ 目录' : '▶ 目录'}
          </button>
          <button
            type="button"
            className={`rounded border px-2 py-1 hover:bg-ink-100 ${rightOpen ? 'border-violet-300 text-violet-700' : 'border-ink-200 text-ink-500'}`}
            title={rightOpen ? '收起功能面板' : '展开功能面板'}
            onClick={() => setRightOpen((v) => !v)}
          >
            {rightOpen ? '面板 ▶' : '◀ 面板'}
          </button>
          <button
            type="button"
            className="rounded border border-ink-200 px-2 py-1 hover:bg-ink-100"
            onClick={() => setSearchOpen(true)}
          >
            全局查找 Ctrl+Shift+F
          </button>
          <button
            type="button"
            className="rounded bg-violet-600 px-2 py-1 text-white hover:bg-violet-700"
            onClick={() => setExportOpen(true)}
          >
            导出
          </button>
        </div>
      </header>

      {/* P2.1-M7：长文会话恢复横幅 */}
      {lfActive && lfActive.beats.length > 0 && (
        <div className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-1.5 text-xs text-amber-800">
          <span>
            检测到未完成的长文生成（第{' '}
            {Math.min(lfActive.currentBeatIndex + 1, lfActive.beats.length)}/{lfActive.beats.length}{' '}
            拍，状态：{lfActive.status === 'running' ? '进行中' : lfActive.status === 'paused' ? '已暂停' : '待审阅'}）
          </span>
          <button
            type="button"
            className="rounded bg-amber-600 px-2 py-0.5 text-white hover:bg-amber-700"
            onClick={() => {
              setTab('longform');
              setLfActive(null);
            }}
          >
            恢复
          </button>
          <button
            type="button"
            className="rounded border border-amber-300 px-2 py-0.5 hover:bg-amber-100"
            onClick={() => {
              void getAppContext().longformService.deleteSession(lfActive.id);
              setLfActive(null);
            }}
          >
            丢弃
          </button>
        </div>
      )}

      {/* 三栏布局 */}
      <div className="flex min-h-0 flex-1">
        <aside
          className={`shrink-0 overflow-hidden border-r border-ink-200 bg-ink-50 transition-[width] duration-200 ${
            leftOpen ? 'w-64' : 'w-0 border-r-0'
          }`}
        >
          <div className="h-full w-64">
            <ChapterTree />
          </div>
        </aside>

        <main className="min-w-0 flex-1">
          {currentChapterId ? (
            <FocusMode active={focusOn} onExit={() => setFocusOn(false)}>
              <NovelEditor bookId={bookId} />
            </FocusMode>
          ) : (
            <div className="flex h-full items-center justify-center text-ink-400">
              左侧选择或新建一个章节开始写作
            </div>
          )}
        </main>

        {/* P2.1-M3：右侧 icon rail + 内容区（rail 随 rightOpen 整体折叠） */}
        <aside
          className={`shrink-0 overflow-hidden border-l border-ink-200 bg-white transition-[width] duration-200 ${
            rightOpen ? 'w-[368px]' : 'w-0 border-l-0'
          }`}
        >
          <div className="flex h-full w-[368px]">
            {/* 竖排图标栏 */}
            <nav className="flex w-12 shrink-0 flex-col items-center gap-1 border-r border-ink-100 py-2">
              {RIGHT_TAB_GROUPS.map((g, gi) => (
                <Fragment key={g.label}>
                  {gi > 0 && <div className="my-1 w-8 border-t border-ink-200" />}
                  {g.tabs.map((t) => (
                    <button
                      key={t.key}
                      type="button"
                      title={t.title}
                      onClick={() => setTab(t.key)}
                      className={`flex h-9 w-9 items-center justify-center rounded-md ${
                        tab === t.key
                          ? 'bg-violet-100 text-violet-700'
                          : 'text-ink-500 hover:bg-ink-100 hover:text-ink-800'
                      } ${t.hidden ? 'hidden' : ''}`}
                    >
                      <t.icon size={18} />
                    </button>
                  ))}
                </Fragment>
              ))}
            </nav>
            {/* 内容区 */}
            <div className="flex min-w-0 flex-1 flex-col">
              <div className="min-h-0 flex-1">
                {tab === 'ai' && <AIPanel bookId={bookId} />}
                {tab === 'longform' && <AIPanel bookId={bookId} initialTab="longform" />}
                {tab === 'context' && <ContextPanel bookId={bookId} />}
                {tab === 'characters' && <CharacterList bookId={bookId} />}
                {tab === 'worldbook' && <WorldbookPanel bookId={bookId} />}
                {tab === 'foreshadow' && <ForeshadowPanel bookId={bookId} />}
                {tab === 'history' && <VersionHistory />}
                {tab === 'skills' && <SkillPanel bookId={bookId} />}
                {tab === 'stats' && <WritingStatsPanel bookId={bookId} />}
                {tab === 'interview' && <CharacterInterview bookId={bookId} />}
                {tab === 'whatif' && <WhatIfPanel bookId={bookId} />}
              </div>
            </div>
          </div>
        </aside>
      </div>

      {/* P2.1-M4 底部状态栏：保存状态 + 任务指示器 */}
      <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-ink-200 bg-white px-3 text-[11px]">
        <span
          className={
            saveState === 'saved'
              ? 'text-emerald-600'
              : saveState === 'saving'
                ? 'text-amber-600'
                : 'text-ink-400'
          }
        >
          {saveState === 'saved' ? '已保存' : saveState === 'saving' ? '保存中…' : '未保存'}
        </span>
        <TaskIndicator />
      </footer>

      {searchOpen && <GlobalSearchModal bookId={bookId} onClose={() => setSearchOpen(false)} />}
      {exportOpen && <ExportDialog bookId={bookId} onClose={() => setExportOpen(false)} />}
      {/* P2 工具 overlay */}
      {mapOpen && (
        <MapEditor bookId={bookId} onClose={() => setMapOpen(false)} aiGenerateMap={aiGenerateMap} />
      )}
      {timelineOpen && <TimelineView bookId={bookId} onClose={() => setTimelineOpen(false)} />}
      {namegenOpen && <NameGenerator bookId={bookId} onClose={() => setNamegenOpen(false)} />}
    </div>
  );
}
