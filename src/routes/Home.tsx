/**
 * Home 页：书籍列表 + 新建 / 编辑 / 删除 / 打开 + 备份导入
 */

import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { open } from '@tauri-apps/plugin-dialog';
import { useBookStore } from '../store/bookStore';
import { getAppContext } from '../context/app-context';
import type { Book } from '../types';

export function Home(): JSX.Element {
  const navigate = useNavigate();
  const books = useBookStore((s) => s.books);
  const loadBooks = useBookStore((s) => s.loadBooks);
  const createBook = useBookStore((s) => s.createBook);
  const removeBook = useBookStore((s) => s.removeBook);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [author, setAuthor] = useState('');
  const [message, setMessage] = useState('');

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  const submit = async (): Promise<void> => {
    if (!title.trim()) return;
    await createBook({ title: title.trim(), genre: genre.trim() || undefined, author: author.trim() || undefined });
    setTitle('');
    setGenre('');
    setAuthor('');
    setCreating(false);
  };

  const importBackup = async (): Promise<void> => {
    const path = await open({
      multiple: false,
      filters: [{ name: '备份包', extensions: ['zip'] }]
    });
    if (typeof path !== 'string') return;
    setMessage('导入中…');
    try {
      const check = await getAppContext().importService.validateBackup(path);
      if (!check.valid) {
        setMessage(`备份包校验失败：${check.errors.join('；')}`);
        return;
      }
      const r = await getAppContext().importService.importBackup(path);
      setMessage(`导入成功：${r.chapterCount} 章`);
      await loadBooks();
    } catch (e) {
      setMessage(`导入失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  return (
    <div className="h-full overflow-y-auto">
      <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
        <div>
          <h1 className="text-2xl font-bold">One Flower</h1>
          <p className="text-sm text-ink-500">本地优先 · 多模式 AI · Skill 文风 · 一致性检查</p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            className="rounded border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
            onClick={() => navigate('/settings')}
          >
            设置
          </button>
          <button
            type="button"
            className="rounded border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
            onClick={() => void importBackup()}
          >
            导入备份
          </button>
          <button
            type="button"
            className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700"
            onClick={() => setCreating(true)}
          >
            新建书籍
          </button>
        </div>
      </header>

      {message && (
        <div className="mx-auto mb-2 max-w-5xl px-6 text-sm text-violet-700">{message}</div>
      )}

      <main className="mx-auto max-w-5xl px-6 pb-10">
        {books.length === 0 && !creating && (
          <div className="rounded-lg border-2 border-dashed border-ink-200 p-16 text-center text-ink-400">
            还没有书籍。点击「新建书籍」开始创作。
          </div>
        )}

        <div className="grid grid-cols-2 gap-4 md:grid-cols-3">
          {books.map((b) => (
            <BookCard key={b.id} book={b} onOpen={() => navigate(`/editor/${b.id}`)} onDelete={() => void removeBook(b.id)} />
          ))}

          {creating && (
            <div className="rounded-lg border border-violet-200 bg-white p-3">
              <input
                autoFocus
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="书名 *"
                className="mb-2 w-full rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
              />
              <input
                value={genre}
                onChange={(e) => setGenre(e.target.value)}
                placeholder="类型（武侠 / 科幻 / 悬疑…）"
                className="mb-2 w-full rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
              />
              <input
                value={author}
                onChange={(e) => setAuthor(e.target.value)}
                placeholder="作者"
                className="mb-2 w-full rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  className="rounded bg-violet-600 px-2 py-1 text-xs text-white hover:bg-violet-700"
                  onClick={() => void submit()}
                >
                  创建
                </button>
                <button
                  type="button"
                  className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-100"
                  onClick={() => setCreating(false)}
                >
                  取消
                </button>
              </div>
            </div>
          )}
        </div>
      </main>
    </div>
  );
}

function BookCard({
  book,
  onOpen,
  onDelete
}: {
  book: Book;
  onOpen: () => void;
  onDelete: () => void;
}): JSX.Element {
  return (
    <div className="group cursor-pointer rounded-lg border border-ink-200 bg-white p-4 transition hover:border-violet-400 hover:shadow" onClick={onOpen}>
      <div className="mb-3 flex h-28 items-center justify-center rounded bg-gradient-to-br from-violet-200 to-sky-200 text-3xl font-bold text-white">
        {book.title.slice(0, 2)}
      </div>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="truncate font-medium">{book.title}</div>
          <div className="text-xs text-ink-400">
            {[book.genre, book.author].filter(Boolean).join(' · ') || '未设置类型'}
          </div>
          <div className="text-[11px] text-ink-300">
            更新于 {new Date(book.updatedAt).toLocaleDateString()}
          </div>
        </div>
        <button
          type="button"
          className="hidden text-xs text-ink-400 hover:text-red-600 group-hover:block"
          onClick={(e) => {
            e.stopPropagation();
            if (window.confirm(`确认删除《${book.title}》？本地文件将一并删除。`)) {
              void onDelete();
            }
          }}
        >
          删除
        </button>
      </div>
    </div>
  );
}
