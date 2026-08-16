/**
 * 角色卡列表 + 新建入口
 */

import { useEffect, useState } from 'react';
import { getAppContext } from '../../context/app-context';
import { confirmDialog } from '../../native/dialog';
import type { Character } from '../../types';
import { CharacterForm } from './CharacterForm';
import { RelationshipGraph } from '../relationship/RelationshipGraph';

export function CharacterList({ bookId }: { bookId: string }): JSX.Element {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [editing, setEditing] = useState<Character | 'new' | null>(null);
  const [showGraph, setShowGraph] = useState(false);

  const load = async (): Promise<void> => {
    const ctx = getAppContext();
    await ctx.characterService.ensureDefaultSchema(bookId);
    setCharacters(await ctx.characterService.list(bookId));
    window.dispatchEvent(new Event('novel-mentions-refresh'));
  };

  useEffect(() => {
    void load();
    void bookId;
  }, [bookId]);

  const remove = async (id: string): Promise<void> => {
    if (!(await confirmDialog('确认删除该角色卡？'))) return;
    await getAppContext().characterService.remove(id);
    await load();
  };

  if (editing) {
    return (
      <CharacterForm
        bookId={bookId}
        character={editing === 'new' ? null : editing}
        onDone={() => {
          setEditing(null);
          void load();
        }}
      />
    );
  }

  return (
    <div className="flex h-full flex-col">
      {showGraph && (
        <div className="fixed inset-0 z-50 flex flex-col bg-white">
          <div className="flex items-center justify-between border-b border-ink-200 px-4 py-2">
            <span className="text-sm font-medium">角色关系图</span>
            <div className="flex items-center gap-2">
              <span className="text-xs text-ink-400">单击节点打开角色卡 · ＋连线后依次点两个角色 · 点边编辑</span>
              <button
                type="button"
                className="rounded border border-ink-200 px-3 py-1 text-sm hover:bg-ink-100"
                onClick={() => setShowGraph(false)}
              >
                关闭
              </button>
            </div>
          </div>
          <div className="flex-1">
            <RelationshipGraph
              bookId={bookId}
              onOpenCharacter={(cid) => {
                const c = characters.find((x) => x.id === cid);
                if (c) {
                  setShowGraph(false);
                  setEditing(c);
                }
              }}
            />
          </div>
        </div>
      )}
      <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
        <span className="text-sm font-medium">角色卡（{characters.length}）</span>
        <div className="flex items-center gap-2">
          <button
            type="button"
            className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-100"
            onClick={() => setShowGraph(true)}
          >
            关系图
          </button>
          <button
            type="button"
            className="rounded bg-violet-600 px-2 py-1 text-xs text-white hover:bg-violet-700"
            onClick={() => setEditing('new')}
          >
            新建
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {characters.length === 0 && (
          <div className="px-2 py-4 text-center text-xs text-ink-400">
            暂无角色。AI 续写 / 对白生成时可选择参与角色注入上下文。
          </div>
        )}
        {characters.map((c) => (
          <div
            key={c.id}
            className="group mb-1 flex cursor-pointer items-center gap-2 rounded border border-ink-100 bg-white px-2 py-1.5 hover:border-violet-300"
            onClick={() => setEditing(c)}
          >
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-violet-100 text-sm font-medium text-violet-700">
              {c.name.slice(0, 1)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-medium">{c.name}</div>
              <div className="truncate text-xs text-ink-400">
                {summarizeData(c.data) || '暂无描述'}
              </div>
            </div>
            <button
              type="button"
              className="hidden text-xs text-ink-400 hover:text-red-600 group-hover:block"
              onClick={(e) => {
                e.stopPropagation();
                void remove(c.id);
              }}
            >
              删除
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}

function summarizeData(dataJson: string): string {
  try {
    const data = JSON.parse(dataJson) as Record<string, unknown>;
    const personality = data.personality ?? data.background ?? '';
    return String(personality).slice(0, 40);
  } catch {
    return '';
  }
}
