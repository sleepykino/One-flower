/**
 * Editor 页：左侧章节树 / 中间编辑器 / 右侧多面板（AI / 角色 / 世界书 / 伏笔 / 历史 / Skill）
 * Ctrl+Shift+F 全局查找
 */

import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useEditorStore } from '../store/editorStore';
import { NovelEditor } from '../components/editor/NovelEditor';
import { ChapterTree } from '../components/chapter-tree/ChapterTree';
import { AIPanel } from '../components/ai/AIPanel';
import { CharacterList } from '../components/character-card/CharacterList';
import { WorldbookPanel } from '../components/worldbook/WorldbookPanel';
import { ForeshadowPanel } from '../components/foreshadow/ForeshadowPanel';
import { VersionHistory } from '../components/version/VersionHistory';
import { SkillPanel } from '../components/skill/SkillPanel';
import { GlobalSearchModal } from '../components/search/GlobalSearch';
import { ExportDialog } from '../components/export/ExportDialog';
import { getAppContext } from '../context/app-context';

type RightTab = 'ai' | 'characters' | 'worldbook' | 'foreshadow' | 'history' | 'skills';

const TABS: Array<{ key: RightTab; label: string }> = [
  { key: 'ai', label: 'AI' },
  { key: 'characters', label: '角色' },
  { key: 'worldbook', label: '世界书' },
  { key: 'foreshadow', label: '伏笔' },
  { key: 'history', label: '历史' },
  { key: 'skills', label: 'Skill' }
];

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

  useEffect(() => {
    setBookId(bookId);
    void loadChapters(bookId);
    void getAppContext()
      .bookService.get(bookId)
      .then((b) => setBookTitle(b?.title ?? ''));
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
            <NovelEditor bookId={bookId} />
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
              {tab === 'characters' && <CharacterList bookId={bookId} />}
              {tab === 'worldbook' && <WorldbookPanel bookId={bookId} />}
              {tab === 'foreshadow' && <ForeshadowPanel bookId={bookId} />}
              {tab === 'history' && <VersionHistory />}
              {tab === 'skills' && <SkillPanel bookId={bookId} />}
            </div>
          </div>
        </aside>
      </div>

      {searchOpen && <GlobalSearchModal bookId={bookId} onClose={() => setSearchOpen(false)} />}
      {exportOpen && <ExportDialog bookId={bookId} onClose={() => setExportOpen(false)} />}
    </div>
  );
}
