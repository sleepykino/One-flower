/** 书籍状态 */

import { create } from 'zustand';
import type { Book } from '../types';
import { getAppContext } from '../context/app-context';

interface BookStore {
  books: Book[];
  loading: boolean;
  loadBooks: () => Promise<void>;
  createBook: (input: { title: string; genre?: string; author?: string }) => Promise<Book>;
  removeBook: (id: string) => Promise<void>;
  updateBook: (id: string, patch: { title?: string; genre?: string | null; author?: string | null }) => Promise<void>;
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

  removeBook: async (id) => {
    await getAppContext().bookService.remove(id);
    set((s) => ({ books: s.books.filter((b) => b.id !== id) }));
  },

  updateBook: async (id, patch) => {
    await getAppContext().bookService.update(id, patch);
    await get().loadBooks();
  }
}));
