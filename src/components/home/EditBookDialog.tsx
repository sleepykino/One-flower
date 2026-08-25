/**
 * P6 M3 编辑书籍信息对话框：书名 / 类型 / 作者（无需进编辑器改名）
 * 保存走 bookStore.updateBook -> BookService.update
 */

import { useState } from 'react';
import { useBookStore } from '../../store/bookStore';
import { toast } from '../common/toast';
import type { Book } from '../../types';

export function EditBookDialog({ book, onClose }: { book: Book; onClose: () => void }): JSX.Element {
  const updateBook = useBookStore((s) => s.updateBook);
  const [title, setTitle] = useState(book.title);
  const [genre, setGenre] = useState(book.genre ?? '');
  const [author, setAuthor] = useState(book.author ?? '');
  const [saving, setSaving] = useState(false);

  const submit = async (): Promise<void> => {
    if (!title.trim()) return;
    setSaving(true);
    try {
      await updateBook(book.id, {
        title: title.trim(),
        genre: genre.trim() || null,
        author: author.trim() || null
      });
      toast.success('书籍信息已保存');
      onClose();
    } catch (e) {
      toast.error(`保存失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="w-80 rounded-lg bg-white p-4 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 text-sm font-medium">编辑书籍信息</div>
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="书名 *"
          className="mb-2 w-full rounded border border-ink-200 px-2 py-1.5 text-sm outline-none focus:border-violet-400"
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
        <input
          value={genre}
          onChange={(e) => setGenre(e.target.value)}
          placeholder="类型（武侠 / 科幻 / 悬疑…）"
          className="mb-2 w-full rounded border border-ink-200 px-2 py-1.5 text-sm outline-none focus:border-violet-400"
        />
        <input
          value={author}
          onChange={(e) => setAuthor(e.target.value)}
          placeholder="作者"
          className="mb-3 w-full rounded border border-ink-200 px-2 py-1.5 text-sm outline-none focus:border-violet-400"
        />
        <div className="flex justify-end gap-2">
          <button
            type="button"
            disabled={saving}
            className="rounded border border-ink-200 px-3 py-1 text-xs hover:bg-ink-100 disabled:opacity-40"
            onClick={onClose}
          >
            取消
          </button>
          <button
            type="button"
            disabled={saving || !title.trim()}
            className="rounded bg-violet-600 px-3 py-1 text-xs text-white hover:bg-violet-700 disabled:opacity-40"
            onClick={() => void submit()}
          >
            保存
          </button>
        </div>
      </div>
    </div>
  );
}
