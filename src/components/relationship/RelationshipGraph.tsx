/**
 * 角色关系图（P1-M3）：React Flow 可视化
 * - 圆形布局 + 节点拖拽
 * - 连线模式：依次点两个节点创建关系
 * - 点击边编辑关系（类型预设 / 描述 / 方向）/ 删除
 * - 双击节点跳转角色卡
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ReactFlow,
  Background,
  Controls,
  MiniMap,
  Handle,
  Position,
  useEdgesState,
  useNodesState,
  type Edge,
  type Node,
  type NodeProps,
  MarkerType
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { getAppContext } from '../../context/app-context';
import { RELATIONSHIP_TYPES, type Relationship } from '../../services/relationship/types';
import type { Character } from '../../types';

/** 角色节点 */
function CharNode({ data }: NodeProps): JSX.Element {
  const d = data as { label: string; highlight?: boolean };
  return (
    <div
      className={`flex h-16 w-16 items-center justify-center rounded-full border-2 px-1 text-center text-xs font-medium shadow-sm transition-colors ${
        d.highlight
          ? 'border-violet-500 bg-violet-100 text-violet-800'
          : 'border-violet-300 bg-white text-ink-700'
      }`}
      title={d.label}
    >
      <Handle type="target" position={Position.Top} className="!h-1.5 !w-1.5 !border-0 !bg-violet-300" />
      <span className="line-clamp-2">{d.label}</span>
      <Handle type="source" position={Position.Bottom} className="!h-1.5 !w-1.5 !border-0 !bg-violet-300" />
    </div>
  );
}

const nodeTypes = { char: CharNode };

export function RelationshipGraph({
  bookId,
  onOpenCharacter
}: {
  bookId: string;
  onOpenCharacter: (characterId: string) => void;
}): JSX.Element {
  const [characters, setCharacters] = useState<Character[]>([]);
  const [rels, setRels] = useState<Relationship[]>([]);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [editingRel, setEditingRel] = useState<Relationship | null>(null);
  const [relDraft, setRelDraft] = useState<{ type: string; description: string; bidirectional: boolean }>({
    type: '其他',
    description: '',
    bidirectional: true
  });
  const charById = useRef(new Map<string, Character>());

  /** 圆形布局 */
  const layoutCircle = useCallback(
    (chars: Character[], keep: Map<string, { x: number; y: number }>): Node[] => {
      const R = Math.max(180, chars.length * 28);
      return chars.map((c, i) => {
        const angle = (2 * Math.PI * i) / Math.max(chars.length, 1) - Math.PI / 2;
        const prev = keep.get(c.id);
        return {
          id: c.id,
          type: 'char',
          position: prev ?? { x: Math.cos(angle) * R + R + 40, y: Math.sin(angle) * R + R + 40 },
          data: { label: c.name }
        };
      });
    },
    []
  );

  const load = useCallback(async (): Promise<void> => {
    const ctx = getAppContext();
    await ctx.characterService.ensureDefaultSchema(bookId);
    const [chars, relations] = await Promise.all([
      ctx.characterService.list(bookId),
      ctx.relationshipService.listByBook(bookId)
    ]);
    charById.current = new Map(chars.map((c) => [c.id, c]));
    setCharacters(chars);
    setRels(relations);
    setNodes((prev) => {
      const keep = new Map(prev.map((n) => [n.id, n.position]));
      return layoutCircle(chars, keep);
    });
  }, [bookId, layoutCircle, setNodes]);

  useEffect(() => {
    void load();
  }, [load]);

  /** 关系 -> 边 */
  useEffect(() => {
    const es: Edge[] = rels
      .filter((r) => charById.current.has(r.fromCharacterId) && charById.current.has(r.toCharacterId))
      .map((r) => ({
        id: r.id,
        source: r.fromCharacterId,
        target: r.toCharacterId,
        label: r.type,
        animated: !r.bidirectional,
        markerEnd: r.bidirectional
          ? undefined
          : { type: MarkerType.ArrowClosed, color: '#7c3aed' },
        style: { stroke: '#a78bfa', strokeWidth: 1.5 }
      }));
    setEdges(es);
  }, [rels, setEdges]);

  /** 节点点击：连线模式（选起点 -> 选终点）/ 单击开角色卡 */
  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node): void => {
      if (linkFrom === 'pending') {
        setLinkFrom(node.id);
        return;
      }
      if (linkFrom) {
        if (linkFrom === node.id) {
          setLinkFrom(null);
          return;
        }
        const from = linkFrom;
        setLinkFrom(null);
        void getAppContext()
          .relationshipService.create({
            bookId,
            fromCharacterId: from,
            toCharacterId: node.id,
            type: '其他',
            description: '',
            bidirectional: true
          })
          .then(() => load());
        return;
      }
      onOpenCharacter(node.id);
    },
    [linkFrom, bookId, load, onOpenCharacter]
  );

  const onEdgeClick = useCallback(
    (e: React.MouseEvent, edge: Edge): void => {
      e.stopPropagation();
      const rel = rels.find((r) => r.id === edge.id);
      if (rel) {
        setEditingRel(rel);
        setRelDraft({
          type: rel.type,
          description: rel.description,
          bidirectional: rel.bidirectional
        });
      }
    },
    [rels]
  );

  const saveRel = async (): Promise<void> => {
    if (!editingRel) return;
    await getAppContext().relationshipService.update(editingRel.id, relDraft);
    setEditingRel(null);
    await load();
  };

  const deleteRel = async (): Promise<void> => {
    if (!editingRel) return;
    await getAppContext().relationshipService.delete(editingRel.id);
    setEditingRel(null);
    await load();
  };

  const nameOf = (id: string): string => charById.current.get(id)?.name ?? '?';

  return (
    <div className="flex h-full w-full">
      <div className="relative flex-1">
        <ReactFlow
          nodes={nodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onNodeClick={onNodeClick}
          onEdgeClick={onEdgeClick}
          fitView
          minZoom={0.2}
          proOptions={{ hideAttribution: true }}
        >
          <Background gap={20} size={1} />
          <Controls showInteractive={false} />
          <MiniMap pannable zoomable className="!bg-ink-50" />
        </ReactFlow>

        {/* 工具条 */}
        <div className="absolute left-2 top-2 flex items-center gap-2 rounded-md border border-ink-200 bg-white/90 px-2 py-1.5 text-xs shadow-sm">
          <button
            type="button"
            className={`rounded px-2 py-1 ${
              linkFrom ? 'bg-violet-600 text-white' : 'border border-ink-200 hover:bg-ink-100'
            }`}
            onClick={() => setLinkFrom(linkFrom ? null : 'pending')}
          >
            {linkFrom === 'pending' ? '取消连线' : linkFrom ? '点第二个角色…' : '＋ 连线'}
          </button>
          <button
            type="button"
            className="rounded border border-ink-200 px-2 py-1 hover:bg-ink-100"
            onClick={() => setNodes((prev) => layoutCircle(characters, new Map()))}
          >
            重排
          </button>
          <span className="text-ink-400">
            {linkFrom === 'pending' ? '点击第一个角色' : linkFrom ? `从「${nameOf(linkFrom)}」连到…` : '单击节点开角色卡 / 点边编辑'}
          </span>
        </div>

        {characters.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-sm text-ink-400">
            暂无角色，请先在角色面板新建
          </div>
        )}
      </div>

      {/* 右侧：边编辑面板 */}
      {editingRel && (
        <div className="w-64 shrink-0 border-l border-ink-200 bg-white p-3">
          <div className="mb-2 text-sm font-medium">
            {nameOf(editingRel.fromCharacterId)} → {nameOf(editingRel.toCharacterId)}
          </div>
          <label className="mb-1 block text-xs text-ink-500">关系类型</label>
          <select
            value={relDraft.type}
            onChange={(e) => setRelDraft({ ...relDraft, type: e.target.value })}
            className="mb-2 w-full rounded border border-ink-200 px-2 py-1 text-sm"
          >
            {RELATIONSHIP_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          <label className="mb-1 block text-xs text-ink-500">描述</label>
          <textarea
            rows={4}
            value={relDraft.description}
            onChange={(e) => setRelDraft({ ...relDraft, description: e.target.value })}
            placeholder="如：表面师徒，实则仇敌"
            className="mb-2 w-full resize-none rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
          />
          <label className="mb-3 flex items-center gap-2 text-xs text-ink-600">
            <input
              type="checkbox"
              checked={relDraft.bidirectional}
              onChange={(e) => setRelDraft({ ...relDraft, bidirectional: e.target.checked })}
            />
            双向关系（无箭头）
          </label>
          <div className="flex gap-2">
            <button
              type="button"
              className="rounded bg-violet-600 px-3 py-1 text-sm text-white hover:bg-violet-700"
              onClick={() => void saveRel()}
            >
              保存
            </button>
            <button
              type="button"
              className="rounded border border-ink-200 px-3 py-1 text-sm hover:bg-ink-100"
              onClick={() => setEditingRel(null)}
            >
              取消
            </button>
            <button
              type="button"
              className="ml-auto rounded px-2 py-1 text-xs text-ink-400 hover:text-red-600"
              onClick={() => void deleteRel()}
            >
              删除关系
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
