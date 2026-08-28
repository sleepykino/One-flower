/**
 * Home 页：书籍列表 + 新建 / 编辑 / 删除（回收站）/ 打开 + 备份导入
 * P6 M3：工具条（搜索/类型筛选/排序）+ 书卡统计 + ⋮ 菜单（编辑/置顶/导出备份/删除）+ 手动拖拽排序
 * P6 M1：删除改为软删除（移入回收站）；挂载时延迟静默清理过期回收站
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { open, save } from '@tauri-apps/plugin-dialog';
import { Pin } from 'lucide-react';
import { useBookStore } from '../store/bookStore';
import { getAppContext } from '../context/app-context';
import { confirmDialog } from '../native/dialog';
import { toast } from '../components/common/toast';
import { UpdateDialog } from '../components/update/UpdateDialog';
import { HomeSidebar } from '../components/home/HomeSidebar';
import { ImagePicker } from '../components/image/ImagePicker';
import { BookshelfToolbar, persistSortMode, readSortMode } from '../components/home/BookshelfToolbar';
import { BookCardMenu } from '../components/home/BookCardMenu';
import { EditBookDialog } from '../components/home/EditBookDialog';
import { formatWordCount } from '../components/home/TrashList';
import { resolveAssetUrl } from '../utils/assetUrl';
import type { ImageAsset } from '../services/image/types';
import type { UpdateInfo } from '../services/update/UpdateService';
import type { Book, BookSortMode } from '../types';

/** 排序比较器：任何排序下 pinned 优先 */
function compareBooks(a: Book, b: Book, mode: BookSortMode): number {
  if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
  switch (mode) {
    case 'created':
      return b.createdAt - a.createdAt;
    case 'title':
      return a.title.localeCompare(b.title, 'zh');
    case 'manual':
      return a.sortOrder - b.sortOrder;
    case 'updated':
    default:
      return b.updatedAt - a.updatedAt;
  }
}

export function Home(): JSX.Element {
  const navigate = useNavigate();
  const books = useBookStore((s) => s.books);
  const loadBooks = useBookStore((s) => s.loadBooks);
  const createBook = useBookStore((s) => s.createBook);
  const trashBook = useBookStore((s) => s.trashBook);
  const setPinned = useBookStore((s) => s.setPinned);
  const reorderBooks = useBookStore((s) => s.reorderBooks);
  const [creating, setCreating] = useState(false);
  const [title, setTitle] = useState('');
  const [genre, setGenre] = useState('');
  const [author, setAuthor] = useState('');
  const [message, setMessage] = useState('');
  // 客户端更新：自动检查（静默失败不打扰）
  const [update, setUpdate] = useState<{ info: UpdateInfo; current: string } | null>(null);
  // P6 M3：工具条状态
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [genreFilter, setGenreFilter] = useState('');
  const [sortMode, setSortMode] = useState<BookSortMode>(readSortMode);
  // P6 M3：编辑信息对话框
  const [editingBook, setEditingBook] = useState<Book | null>(null);
  // P6 M3：拖拽排序状态（仅 manual 模式）
  const [dragId, setDragId] = useState<string | null>(null);
  const [dragOverId, setDragOverId] = useState<string | null>(null);
  // 指针拖拽内部态（悬停落点镜像 + 点击抑制 + 按下来源记录）
  const dragOverRef = useRef<string | null>(null);
  // 拖拽结束后浏览器补发 click 的抑制窗口：用时间戳而非一次性 bool，
  // 避免 click 落在公共祖先（grid 无 onClick）时标志残留吞掉下一次真实点击
  const suppressClickUntil = useRef(0);
  const pointerRef = useRef<{
    pointerId: number;
    sourceId: string;
    startX: number;
    startY: number;
    active: boolean;
  } | null>(null);

  useEffect(() => {
    void loadBooks();
  }, [loadBooks]);

  // P6 M1：挂载后延迟 5s 静默清理过期回收站（不打扰启动）
  useEffect(() => {
    const timer = window.setTimeout(() => {
      void (async () => {
        const { bookService, appSettings } = getAppContext();
        const v = await appSettings.get('trash.retentionDays');
        await bookService.cleanupExpired(v != null ? Number(v) : 30);
        // 批次5建议1：一次性存量孤儿清理（幂等、只碰孤儿，杜绝孤儿事实污染一致性基线）
        try {
          await bookService.sweepOrphans();
        } catch {
          // 存量清理失败不影响启动；逐删除点级联清理已保证新增不产生孤儿
        }
      })().catch(() => undefined);
    }, 5000);
    return () => window.clearTimeout(timer);
  }, []);

  // 启动自动检查更新：开关开 && 距上次超 24h；延迟 3s 不打断启动；失败静默
  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        const { updateService } = getAppContext();
        if (!(await updateService.shouldAutoCheck())) return;
        await updateService.markChecked();
        try {
          const info = await updateService.findNewer();
          if (!cancelled && info) {
            setUpdate({ info, current: await updateService.getCurrentVersion() });
          }
        } catch {
          // 网络失败静默（可稍后在设置页手动检查）
        }
      })();
    }, 3000);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, []);

  // P6 M3：搜索防抖 200ms
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search.trim()), 200);
    return () => window.clearTimeout(timer);
  }, [search]);

  // P6 M3：排序偏好持久化
  const changeSortMode = (mode: BookSortMode): void => {
    setSortMode(mode);
    persistSortMode(mode);
  };

  /** 过滤 + 排序后的书架列表（全部客户端内存计算） */
  const visibleBooks = useMemo(() => {
    const q = debouncedSearch.toLowerCase();
    return books
      .filter((b) => {
        if (genreFilter && (b.genre ?? '') !== genreFilter) return false;
        if (!q) return true;
        return [b.title, b.genre, b.author].some((f) => f != null && f.toLowerCase().includes(q));
      })
      .sort((a, b) => compareBooks(a, b, sortMode));
  }, [books, debouncedSearch, genreFilter, sortMode]);

  /** 类型下拉选项（当前书架去重 genre） */
  const genres = useMemo(
    () => [...new Set(books.map((b) => b.genre).filter((g): g is string => !!g))].sort((a, b) => a.localeCompare(b, 'zh')),
    [books]
  );

  const filtering = debouncedSearch !== '' || genreFilter !== '';
  /** 拖拽仅 manual 模式且未过滤时启用（过滤视图下换位语义不明） */
  const dragEnabled = sortMode === 'manual' && !filtering;

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

  /** P6 M1：删除 = 移入回收站（软删除，可恢复） */
  const trashBookFlow = async (book: Book): Promise<void> => {
    const ok = await confirmDialog(`确认将《${book.title}》移入回收站？\n\n可随时在回收站恢复或彻底删除。`);
    if (!ok) return;
    try {
      await trashBook(book.id);
      toast.info(`《${book.title}》已移入回收站`);
    } catch (e) {
      toast.error(`删除失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** P6 M3：置顶切换 */
  const togglePin = async (book: Book): Promise<void> => {
    try {
      await setPinned(book.id, !book.pinned);
    } catch (e) {
      toast.error(`置顶失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** P6 M3：从书架直接导出单书备份（逻辑同设置页 BackupSection） */
  const exportBookBackup = async (book: Book): Promise<void> => {
    const path = await save({
      defaultPath: `${book.title}.zip`,
      filters: [{ name: '备份包', extensions: ['zip'] }]
    });
    if (!path) return;
    toast.info('备份中…');
    try {
      await getAppContext().exportService.exportBook(book.id, 'backup', path);
      toast.success(`备份完成：${path}`);
    } catch (e) {
      toast.error(`备份失败：${e instanceof Error ? e.message : String(e)}`);
    }
  };

  /** P6 M3：拖拽落点 -> 重排未置顶书 -> 整表持久化（置顶恒前） */
  const handleDrop = (sourceId: string, targetId: string): void => {
    setDragId(null);
    setDragOverId(null);
    dragOverRef.current = null;
    // 拖拽结束后浏览器会补发一次 click，500ms 内吞掉，避免误入编辑器
    suppressClickUntil.current = Date.now() + 500;
    if (sourceId === targetId) return;
    // 全局监听只挂一次，这里从 store 取最新列表，避免闭包过期
    const current = useBookStore.getState().books;
    const pinnedIds = current.filter((b) => b.pinned).map((b) => b.id);
    const unpinned = current.filter((b) => !b.pinned);
    const from = unpinned.findIndex((b) => b.id === sourceId);
    const to = unpinned.findIndex((b) => b.id === targetId);
    if (from < 0 || to < 0) return;
    const next = [...unpinned];
    next.splice(to, 0, next.splice(from, 1)[0]);
    void reorderBooks([...pinnedIds, ...next.map((b) => b.id)]).catch((e) => {
      toast.error(`排序保存失败：${e instanceof Error ? e.message : String(e)}`);
    });
  };

  /** P6 M3：打开书卡前吞掉拖拽结束后补发的 click（时间窗口内忽略一次） */
  const handleOpen = (book: Book): void => {
    if (Date.now() < suppressClickUntil.current) {
      suppressClickUntil.current = 0;
      return;
    }
    navigate(`/editor/${book.id}`);
  };

  /**
   * P6 M3：指针拖拽换位（不用 HTML5 DnD——WebView2 真实鼠标拖动不可靠，
   * 且书卡内含封面图会被原生图片拖拽抢占）。按下记录来源，位移超 6px 判定为拖动，
   * 拖动中高亮悬停卡片，释放后按落点重排；纯点击仍走 onClick 打开书。
   */
  const isInteractiveTarget = (t: EventTarget | null): boolean =>
    t instanceof Element && !!t.closest('button, a, input, select, textarea');

  const hoveredCardId = (x: number, y: number): string | null => {
    const el = document.elementFromPoint(x, y) as HTMLElement | null;
    return el?.closest('[data-book-id]')?.getAttribute('data-book-id') ?? null;
  };

  const onCardPointerDown = (e: React.PointerEvent<HTMLDivElement>, bookId: string): void => {
    if (!dragEnabled || isInteractiveTarget(e.target)) return;
    pointerRef.current = {
      pointerId: e.pointerId,
      sourceId: bookId,
      startX: e.clientX,
      startY: e.clientY,
      active: false
    };
  };

  // 全局监听只挂一次（处理函数只依赖 ref + 稳定 setter + store.getState，无闭包过期问题），
  // 卸载时统一移除
  useEffect(() => {
    const onMove = (e: PointerEvent): void => {
      const p = pointerRef.current;
      if (!p || e.pointerId !== p.pointerId) return;
      if (e.buttons !== 1) {
        pointerRef.current = null;
        setDragId(null);
        setDragOverId(null);
        dragOverRef.current = null;
        return;
      }
      if (!p.active) {
        if (Math.hypot(e.clientX - p.startX, e.clientY - p.startY) < 6) return;
        p.active = true;
        setDragId(p.sourceId);
      }
      const target = hoveredCardId(e.clientX, e.clientY);
      const next = target && target !== p.sourceId ? target : null;
      dragOverRef.current = next;
      setDragOverId(next);
    };

    const onUp = (e: PointerEvent): void => {
      const p = pointerRef.current;
      if (!p || e.pointerId !== p.pointerId) return;
      pointerRef.current = null;
      if (p.active) {
        handleDrop(p.sourceId, dragOverRef.current ?? p.sourceId);
      } else {
        setDragId(null);
        setDragOverId(null);
        dragOverRef.current = null;
      }
    };

    const onCancel = (): void => {
      if (!pointerRef.current) return;
      pointerRef.current = null;
      setDragId(null);
      setDragOverId(null);
      dragOverRef.current = null;
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onCancel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="flex h-full">
      <HomeSidebar />
      <div className="min-w-0 flex-1 overflow-y-auto">
        <header className="mx-auto flex max-w-5xl items-center justify-between px-6 py-6">
          <div>
            <h1 className="text-2xl font-bold">我的书架</h1>
            <p className="text-sm text-ink-500">本地优先 · 多模式 AI · Skill 文风 · 一致性检查</p>
          </div>
          <div className="flex gap-2">
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
          {books.length > 0 && (
            <BookshelfToolbar
              search={search}
              onSearch={setSearch}
              genres={genres}
              genreFilter={genreFilter}
              onGenreFilter={setGenreFilter}
              sortMode={sortMode}
              onSortMode={changeSortMode}
            />
          )}

          {books.length === 0 && !creating && (
            <div className="rounded-lg border-2 border-dashed border-ink-200 p-16 text-center text-ink-400">
              还没有书籍。点击「新建书籍」开始创作。
            </div>
          )}

          {books.length > 0 && visibleBooks.length === 0 && (
            <div className="rounded-lg border-2 border-dashed border-ink-200 p-16 text-center text-ink-400">
              没有匹配「{debouncedSearch || genreFilter}」的书籍
            </div>
          )}

          <div className={`grid grid-cols-2 gap-4 md:grid-cols-3 ${dragId ? 'select-none' : ''}`}>
            {visibleBooks.map((b) => {
              const draggable = dragEnabled && !b.pinned;
              return (
                <BookCard
                  key={b.id}
                  book={b}
                  onOpen={() => handleOpen(b)}
                  onEdit={() => setEditingBook(b)}
                  onTogglePin={() => void togglePin(b)}
                  onExportBackup={() => void exportBookBackup(b)}
                  onDelete={() => void trashBookFlow(b)}
                  isDragging={dragId === b.id}
                  isDragOver={draggable && dragOverId === b.id && dragId != null && dragId !== b.id}
                  onCardPointerDown={draggable ? (e) => onCardPointerDown(e, b.id) : undefined}
                />
              );
            })}

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

      {/* P6 M3：编辑书籍信息 */}
      {editingBook && <EditBookDialog book={editingBook} onClose={() => setEditingBook(null)} />}

      {/* 启动自动检查发现新版本：下载弹窗 */}
      {update && (
        <UpdateDialog
          info={update.info}
          currentVersion={update.current}
          onClose={() => setUpdate(null)}
        />
      )}
    </div>
  );
}

function BookCard({
  book,
  onOpen,
  onEdit,
  onTogglePin,
  onExportBackup,
  onDelete,
  onCardPointerDown,
  isDragging,
  isDragOver
}: {
  book: Book;
  onOpen: () => void;
  onEdit: () => void;
  onTogglePin: () => void;
  onExportBackup: () => void;
  onDelete: () => void;
  onCardPointerDown?: (e: React.PointerEvent<HTMLDivElement>) => void;
  isDragging: boolean;
  isDragOver: boolean;
}): JSX.Element {
  const loadBooks = useBookStore((s) => s.loadBooks);
  const [pickerOpen, setPickerOpen] = useState(false);
  // cover_path 存相对 storageDir 路径，显示时解析为 asset 协议 URL
  const coverUrl = book.coverPath
    ? resolveAssetUrl(`${book.storageDir.replace(/\\/g, '/')}/${book.coverPath.replace(/\\/g, '/')}`)
    : null;

  /** 封面落定：回写 books.cover_path（相对路径） */
  const setCover = async (asset: ImageAsset): Promise<void> => {
    await getAppContext().bookService.update(book.id, { coverPath: asset.fileName });
    await loadBooks();
  };

  const grabClass = onCardPointerDown ? 'cursor-grab active:cursor-grabbing' : '';

  return (
    <div
      data-book-id={book.id}
      className={`group cursor-pointer rounded-lg border bg-white p-4 transition hover:border-violet-400 hover:shadow ${
        isDragOver ? 'border-violet-500 ring-2 ring-violet-300' : 'border-ink-200'
      } ${isDragging ? 'opacity-40' : ''} ${grabClass}`}
      onClick={onOpen}
      onPointerDown={onCardPointerDown}
    >
      <div className="relative mb-3 h-28">
        {coverUrl ? (
          <img
            src={coverUrl}
            alt={book.title}
            draggable={false}
            className="h-full w-full rounded object-cover"
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center rounded bg-gradient-to-br from-violet-200 to-sky-200 text-3xl font-bold text-white">
            {book.title.slice(0, 2)}
          </div>
        )}
        <button
          type="button"
          className="absolute bottom-1 right-1 hidden rounded bg-black/50 px-1.5 py-0.5 text-[11px] text-white hover:bg-black/70 group-hover:block"
          title="设置封面（上传 / AI 生成 / 图库）"
          onClick={(e) => {
            e.stopPropagation();
            setPickerOpen(true);
          }}
        >
          封面
        </button>
      </div>
      <div className="flex items-center justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-1">
            {book.pinned && (
              <span title="已置顶" className="shrink-0">
                <Pin size={11} className="text-violet-500" />
              </span>
            )}
            <span className="truncate font-medium">{book.title}</span>
          </div>
          <div className="truncate text-xs text-ink-400">
            {[book.genre, book.author].filter(Boolean).join(' · ') || '未设置类型'}
          </div>
          <div className="truncate text-[11px] text-ink-300">
            {book.chapterCount != null && `${book.chapterCount} 章 · ${formatWordCount(book.totalWords)} · `}
            更新于 {new Date(book.updatedAt).toLocaleDateString()}
          </div>
        </div>
        <BookCardMenu
          book={book}
          onEdit={onEdit}
          onTogglePin={onTogglePin}
          onExportBackup={onExportBackup}
          onDelete={onDelete}
        />
      </div>

      {pickerOpen && (
        <ImagePicker
          bookId={book.id}
          scene={{ kind: 'cover', book: { title: book.title, genre: book.genre, author: book.author } }}
          usage="cover"
          title={`《${book.title}》封面`}
          onPicked={(asset) => setCover(asset)}
          onClose={() => setPickerOpen(false)}
        />
      )}
    </div>
  );
}
