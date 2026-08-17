/**
 * Editor 页：左侧章节树 / 中间编辑器 / 右侧多面板（AI / 角色 / 世界书 / 伏笔 / 历史 / Skill）
 * 顶栏：专注模式（沉浸写作）/ 地图 / 时间线 / 命名生成器 / 全局查找
 * Ctrl+Shift+F 全局查找
 */

import { useCallback, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
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
import { getAppContext } from '../context/app-context';
import { resolveProviderConfigId } from '../services/ai/providerResolver';
import { createProvider } from '../services/ai/providers/LLMProvider';

type RightTab =
  | 'ai'
  | 'context'
  | 'characters'
  | 'worldbook'
  | 'foreshadow'
  | 'history'
  | 'skills'
  | 'stats';

const TABS: Array<{ key: RightTab; label: string }> = [
  { key: 'ai', label: 'AI' },
  { key: 'context', label: '上下文' },
  { key: 'characters', label: '角色' },
  { key: 'worldbook', label: '世界书' },
  { key: 'foreshadow', label: '伏笔' },
  { key: 'history', label: '历史' },
  { key: 'skills', label: 'Skill' },
  { key: 'stats', label: '统计' }
];

/** AI 生成地图的系统提示词（输出 { nodes, connections } JSON，契约见 MapEditor.parseAiContent） */
const MAP_AI_SYSTEM = `你是小说世界地图设计师。根据用户描述生成地图 JSON，严格只输出 JSON 对象（不要 markdown 代码围栏、不要解释）：
{"nodes":[{"id":"n1","type":"location","label":"地点名","x":600,"y":400,"shape":"circle","radius":24,"color":"#7c3aed","icon":"city"}],"connections":[{"id":"c1","fromNodeId":"n1","toNodeId":"n2","label":"道路","style":"solid"}]}
规则：
- 画布 1200x800：x∈[80,1120]、y∈[80,720]，布局疏朗、节点不重叠
- type 只用 location（地点圆节点）与 marker（小圆点文字标注），不生成 region
- icon 从以下选择：city城市/castle城堡/mountain山脉/forest森林/river河流/lake湖泊/port港口/ruins遗迹/cave洞穴/tower高塔/bridge桥梁/camp营地/shrine神殿/village村庄/battle战场
- color 从 #7c3aed #2563eb #16a34a #ea580c #dc2626 #524c44 中选取
- connections 表示道路/航线等关联，label 简短（如"官道""海路"），style 用 solid 或 dashed
- 按地理逻辑布局（如港口靠海、山脉在边缘），生成 6-15 个节点`;

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
      const configId = await resolveProviderConfigId(bridge, bookId);
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
        { model, maxTokens: 4096, temperature: 0.7 }
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

        <aside
          className={`shrink-0 overflow-hidden border-l border-ink-200 bg-white transition-[width] duration-200 ${
            rightOpen ? 'w-80' : 'w-0 border-l-0'
          }`}
        >
          <div className="flex h-full w-80 flex-col">
            <div className="flex border-b border-ink-200 text-xs">
              {TABS.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`flex-1 py-2 ${
                    tab === t.key
                      ? 'border-b-2 border-violet-600 font-medium text-violet-700'
                      : 'text-ink-500 hover:text-ink-800'
                  }`}
                >
                  {t.label}
                </button>
              ))}
            </div>
            <div className="min-h-0 flex-1">
              {tab === 'ai' && <AIPanel bookId={bookId} />}
              {tab === 'context' && <ContextPanel bookId={bookId} />}
              {tab === 'characters' && <CharacterList bookId={bookId} />}
              {tab === 'worldbook' && <WorldbookPanel bookId={bookId} />}
              {tab === 'foreshadow' && <ForeshadowPanel bookId={bookId} />}
              {tab === 'history' && <VersionHistory />}
              {tab === 'skills' && <SkillPanel bookId={bookId} />}
              {tab === 'stats' && <WritingStatsPanel bookId={bookId} />}
            </div>
          </div>
        </aside>
      </div>

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
