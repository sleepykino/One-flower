/**
 * 编辑器状态：章节虚拟化（一次只载入一章）+ 编辑器 API 句柄 + 保存状态
 */

import { create } from 'zustand';
import type { Chapter, ProseMirrorDoc } from '../types';
import { getAppContext } from '../context/app-context';

/** 编辑器暴露给 AI 面板等外部的命令句柄 */
export interface EditorApi {
  getDoc(): ProseMirrorDoc;
  getPlainText(): string;
  /** 编辑器直接载入文档（版本回退用） */
  setContent(doc: ProseMirrorDoc): void;
  getSelectedText(): string;
  /** 当前选区范围（无选区返回 null） */
  getSelectionRange(): { from: number; to: number } | null;
  /** 在光标处创建 AI 临时节点（改写模式传入待替换选区） */
  startAITemp(replaceRange?: { from: number; to: number }): void;
  /** 向 AI 临时节点追加流式文本 */
  appendAITemp(text: string): void;
  /** 标记临时节点完成（done 状态），返回其文本 */
  finishAITemp(): string | null;
  /** 保留：临时节点内容转为正式内容（续写在末尾；改写则替换选区） */
  acceptAITemp(): void;
  /** 丢弃：删除临时节点 */
  discardAITemp(): void;
  /** 光标聚焦编辑器 */
  focus(): void;
}

interface EditorStore {
  bookId: string | null;
  chapters: Chapter[];
  currentChapterId: string | null;
  selectedText: string;
  saveState: 'saved' | 'dirty' | 'saving';
  editorApi: EditorApi | null;

  setBookId: (bookId: string) => void;
  loadChapters: (bookId: string) => Promise<void>;
  setCurrentChapter: (chapterId: string | null) => void;
  setChapters: (chapters: Chapter[]) => void;
  setSelectedText: (text: string) => void;
  setSaveState: (s: EditorStore['saveState']) => void;
  setEditorApi: (api: EditorApi | null) => void;

  createChapter: (title: string, parentId?: string | null) => Promise<void>;
  deleteChapter: (chapterId: string) => Promise<void>;
  updateChapter: (
    chapterId: string,
    patch: { title?: string; outline?: string | null; status?: Chapter['status'] }
  ) => Promise<void>;

  /** 保存当前章节正文（含版本快照 + FTS 同步） */
  saveCurrentChapter: () => Promise<void>;
}

export const useEditorStore = create<EditorStore>((set, get) => ({
  bookId: null,
  chapters: [],
  currentChapterId: null,
  selectedText: '',
  saveState: 'saved',
  editorApi: null,

  setBookId: (bookId) => set({ bookId, chapters: [], currentChapterId: null }),

  loadChapters: async (bookId) => {
    const chapters = await getAppContext().chapterService.list(bookId);
    set((s) => ({
      chapters,
      currentChapterId:
        s.currentChapterId && chapters.some((c) => c.id === s.currentChapterId)
          ? s.currentChapterId
          : chapters[0]?.id ?? null
    }));
  },

  setCurrentChapter: (chapterId) => set({ currentChapterId: chapterId, selectedText: '' }),
  setChapters: (chapters) => set({ chapters }),
  setSelectedText: (selectedText) => set({ selectedText }),
  setSaveState: (saveState) => set({ saveState }),
  setEditorApi: (editorApi) => set({ editorApi }),

  createChapter: async (title, parentId) => {
    const { bookId, loadChapters } = get();
    if (!bookId) return;
    const ch = await getAppContext().chapterService.create(bookId, { title, parentId });
    await loadChapters(bookId);
    set({ currentChapterId: ch.id });
  },

  deleteChapter: async (chapterId) => {
    await getAppContext().chapterService.remove(chapterId);
    const { bookId, loadChapters, currentChapterId } = get();
    if (bookId) await loadChapters(bookId);
    if (currentChapterId === chapterId) {
      set({ currentChapterId: get().chapters[0]?.id ?? null });
    }
  },

  updateChapter: async (chapterId, patch) => {
    await getAppContext().chapterService.update(chapterId, patch);
    set((s) => ({
      chapters: s.chapters.map((c) =>
        c.id === chapterId ? { ...c, ...patch, updatedAt: Date.now() } : c
      )
    }));
  },

  saveCurrentChapter: async () => {
    const { currentChapterId, editorApi, bookId } = get();
    if (!currentChapterId || !editorApi || !bookId) return;
    set({ saveState: 'saving' });
    try {
      const { chapterService, versionStore, summaryService, fullRagService } = getAppContext();
      const doc = editorApi.getDoc();
      await chapterService.saveContent(currentChapterId, doc);
      await versionStore.saveVersion(currentChapterId, doc);
      // 后台自动生成章节摘要（防抖，不阻塞编辑）
      summaryService.scheduleAutoSummary(currentChapterId);
      // P2：全量 RAG 章节片段向量化（防抖 8s，后台执行，失败不影响编辑）
      fullRagService?.scheduleEmbed(currentChapterId);
      // 更新章节字数
      const ch = await chapterService.get(currentChapterId);
      if (ch) {
        set((s) => ({
          chapters: s.chapters.map((c) => (c.id === ch.id ? ch : c)),
          saveState: 'saved'
        }));
      } else {
        set({ saveState: 'saved' });
      }
    } catch (e) {
      console.error('保存失败', e);
      set({ saveState: 'dirty' });
    }
  }
}));
