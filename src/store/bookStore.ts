/** 书籍状态 */

import { create } from 'zustand';
import type { Book } from '../types';
import { getAppContext } from '../context/app-context';

interface BookStore {
  books: Book[];
  loading: boolean;
  loadBooks: () => Promise<void>;
  createBook: (input: { title: string; genre?: string; author?: string }) => Promise<Book>;
  /** P6：软删除（移入回收站） */
  trashBook: (id: string) => Promise<void>;
  updateBook: (id: string, patch: { title?: string; genre?: string | null; author?: string | null }) => Promise<void>;
  /** P6：置顶切换（本地乐观更新 + 失败回滚） */
  setPinned: (id: string, pinned: boolean) => Promise<void>;
  /** P6：手动排序持久化（成功后按序重排本地数组） */
  reorderBooks: (orderedIds: string[]) => Promise<void>;
}

export const useBookStore = create<BookStore>((set, get) => ({
  books: [],
  loading: false,

  loadBooks: async () => {
    set({ loading: true });
    try {
      const books = await getAppContext().bookService.list();
      set({ books });
    } finally {
      set({ loading: false });
    }
  },

  createBook: async (input) => {
    const book = await getAppContext().bookService.create(input);
    set((s) => ({ books: [book, ...s.books] }));
    return book;
  },

  trashBook: async (id) => {
    await getAppContext().bookService.trash(id);
    set((s) => ({ books: s.books.filter((b) => b.id !== id) }));
  },

  updateBook: async (id, patch) => {
    await getAppContext().bookService.update(id, patch);
    await get().loadBooks();
  },

  setPinned: async (id, pinned) => {
    const prev = get().books;
    set((s) => ({ books: s.books.map((b) => (b.id === id ? { ...b, pinned } : b)) }));
    try {
      await getAppContext().bookService.setPinned(id, pinned);
    } catch (e) {
      set({ books: prev });
      throw e;
    }
  },

  reorderBooks: async (orderedIds) => {
    const prev = get().books;
    // 按 orderedIds 顺序重排本地数组（未出现在列表中的书保持原相对位置，追加尾部）
    const byId = new Map(prev.map((b) => [b.id, b]));
    const next: Book[] = [];
    for (const id of orderedIds) {
      const b = byId.get(id);
      if (b) {
        next.push(b);
        byId.delete(id);
      }
    }
    next.push(...byId.values());
    // 按新顺序重编 sortOrder：manual 排序（sortOrder ASC）直接用该字段渲染，
    // 不重编的话本地数组虽重排、视图仍按旧 sortOrder 归位，表现为「拖动无效」
    const renumbered = next.map((b, i) => ({ ...b, sortOrder: i }));
    set({ books: renumbered });
    try {
      await getAppContext().bookService.reorder(orderedIds);
    } catch (e) {
      set({ books: prev });
      throw e;
    }
  }
}));
