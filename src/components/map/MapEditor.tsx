/**
 * 地图编辑器（P2）：全屏 overlay 组件
 * - 左侧栏：地图列表（切换/新建/重命名/复制/删除）+ 工具按钮组 + 图例说明
 * - 画布区：react-konva Stage（尺寸随容器 offsetWidth/Height + ResizeObserver 自适应）
 *   location=圆（内绘 icon 字符）、marker=小圆点、region=半透明多边形；
 *   连线 = 两节点中心 Line + 中点 label
 * - 右侧属性面板：label/颜色/图标/形状尺寸/关联世界书条目
 * - 顶部工具栏：保存 + AI 生成（aiGenerateMap 返回 { nodes, connections } JSON）
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Group, Circle, Rect, Line, Text } from 'react-konva';
import { getAppContext } from '../../context/app-context';
import { confirmDialog } from '../../native/dialog';
import { MapEditorService } from '../../services/map/MapEditorService';
import { ICON_OPTIONS, type MapConnection, type MapIcon, type MapNode, type NovelMap } from '../../services/map/types';

interface MapEditorProps {
  bookId: string;
  onClose: () => void;
  /** AI 生成：入参提示词，返回 { nodes, connections } JSON 字符串 */
  aiGenerateMap?: (prompt: string) => Promise<string>;
}

/** 工具集 */
type Tool = 'select' | 'location' | 'region' | 'connect' | 'text' | 'delete';

const TOOLS: Array<{ value: Tool; label: string }> = [
  { value: 'select', label: '选择' },
  { value: 'location', label: '地点' },
  { value: 'region', label: '区域' },
  { value: 'connect', label: '连线' },
  { value: 'text', label: '文字' },
  { value: 'delete', label: '删除' }
];

const TOOL_HINT: Record<Tool, string> = {
  select: '选择：拖拽移动节点，双击节点打开属性面板',
  location: '地点：点击画布空白处新建地点节点',
  region: '区域：依次点击添加顶点，双击闭合生成区域',
  connect: '连线：依次点击两个节点创建连线',
  text: '文字：点击画布新建文字标注',
  delete: '删除：点击节点或连线删除'
};

/** 图标 unicode 字符（Konva Text 渲染，简洁实现） */
const ICON_CHAR: Record<MapIcon, string> = {
  city: '城',
  castle: '堡',
  mountain: '⛰',
  forest: '🌲',
  river: '≈',
  lake: '◉',
  port: '⚓',
  ruins: '⌂',
  cave: '◑',
  tower: '♖',
  bridge: '⌒',
  camp: '⛺',
  shrine: '⛩',
  village: '乡',
  battle: '⚔'
};

/** 预设色板（6 色） */
const PALETTE = ['#7c3aed', '#2563eb', '#16a34a', '#ea580c', '#dc2626', '#524c44'];

const TYPE_LABEL: Record<MapNode['type'], string> = {
  location: '地点',
  marker: '标注',
  region: '区域'
};

/** 解析 AI 返回内容：剥 ```json 围栏，截取首尾大括号，失败返回 null */
function parseAiContent(raw: string): { nodes: MapNode[]; connections: MapConnection[] } | null {
  try {
    let s = raw.trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) s = fence[1].trim();
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) s = s.slice(start, end + 1);
    const parsed = JSON.parse(s) as { nodes?: MapNode[]; connections?: MapConnection[] };
    if (!Array.isArray(parsed.nodes) || !Array.isArray(parsed.connections)) return null;
    return { nodes: parsed.nodes, connections: parsed.connections };
  } catch {
    return null;
  }
}

export function MapEditor({ bookId, onClose, aiGenerateMap }: MapEditorProps): JSX.Element {
  const svc = useMemo(() => new MapEditorService(getAppContext().db, getAppContext().wq), []);

  const [maps, setMaps] = useState<NovelMap[]>([]);
  const [currentMap, setCurrentMap] = useState<NovelMap | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  const [tool, setTool] = useState<Tool>('select');
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedConnId, setSelectedConnId] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [draftPoints, setDraftPoints] = useState<number[]>([]);

  const [entries, setEntries] = useState<Array<{ id: string; title: string }>>([]);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);

  // 画布尺寸：容器 div offsetWidth/Height，ResizeObserver 跟随
  const containerRef = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // 拖拽后 Konva 仍会触发 click，用标记吞掉拖拽结束后的那次点击
  const draggedRef = useRef(false);
  // StrictMode 双执行防护：避免重复自动建图
  const bootedRef = useRef(false);

  /** 初始化：拉取地图列表（为空则自动建一张） */
  useEffect(() => {
    if (bootedRef.current) return;
    bootedRef.current = true;
    void (async () => {
      let list = await svc.listMaps(bookId);
      if (list.length === 0) {
        list = [await svc.createMap(bookId, '新地图')];
      }
      setMaps(list);
      setCurrentMap(list[0] ?? null);
    })();
  }, [bookId, svc]);

  /** 世界书条目（关联下拉用） */
  useEffect(() => {
    void getAppContext()
      .db.query<{ id: string; title: string }>(
        'SELECT id, title FROM worldbook_entries WHERE book_id = ?',
        [bookId]
      )
      .then(setEntries)
      .catch(() => setEntries([]));
  }, [bookId]);

  /** 画布尺寸测量 */
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = (): void => setSize({ width: el.offsetWidth, height: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const nodeById = useMemo(
    () => new Map<string, MapNode>((currentMap?.nodes ?? []).map((n): [string, MapNode] => [n.id, n])),
    [currentMap]
  );
  const entryTitleById = useMemo(
    () => new Map<string, string>(entries.map((e): [string, string] => [e.id, e.title])),
    [entries]
  );
  const selNode = selectedNodeId ? (nodeById.get(selectedNodeId) ?? null) : null;
  const selConn =
    currentMap && selectedConnId
      ? (currentMap.connections.find((c) => c.id === selectedConnId) ?? null)
      : null;

  // ---------- 数据变更 ----------

  const patchDirty = (): void => setDirty(true);

  const updateNode = (id: string, patch: Partial<MapNode>): void => {
    setCurrentMap((m) =>
      m ? { ...m, nodes: m.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) } : m
    );
    patchDirty();
  };

  const updateConn = (id: string, patch: Partial<MapConnection>): void => {
    setCurrentMap((m) =>
      m ? { ...m, connections: m.connections.map((c) => (c.id === id ? { ...c, ...patch } : c)) } : m
    );
    patchDirty();
  };

  const removeNode = (id: string): void => {
    setCurrentMap((m) =>
      m
        ? {
            ...m,
            nodes: m.nodes.filter((n) => n.id !== id),
            connections: m.connections.filter((c) => c.fromNodeId !== id && c.toNodeId !== id)
          }
        : m
    );
    patchDirty();
    setSelectedNodeId(null);
  };

  const removeConn = (id: string): void => {
    setCurrentMap((m) => (m ? { ...m, connections: m.connections.filter((c) => c.id !== id) } : m));
    patchDirty();
    setSelectedConnId(null);
  };

  // ---------- 地图列表操作 ----------

  const syncMapInList = (map: NovelMap): void => {
    setMaps((prev) => prev.map((m) => (m.id === map.id ? { ...map } : m)));
  };

  const clearSel = (): void => {
    setSelectedNodeId(null);
    setSelectedConnId(null);
    setConnectFrom(null);
    setDraftPoints([]);
  };

  const save = async (): Promise<void> => {
    if (!currentMap) return;
    await svc.saveMap(currentMap);
    syncMapInList(currentMap);
    setDirty(false);
    setSaveStatus(`已保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
  };

  const switchMap = async (id: string): Promise<void> => {
    if (!currentMap || currentMap.id === id) return;
    if (dirty) {
      await svc.saveMap(currentMap);
      syncMapInList(currentMap);
    }
    setCurrentMap(await svc.getMap(id));
    setDirty(false);
    setRenameDraft(null);
    clearSel();
  };

  const handleCreate = async (): Promise<void> => {
    if (currentMap && dirty) {
      await svc.saveMap(currentMap);
      syncMapInList(currentMap);
    }
    const created = await svc.createMap(bookId, `地图 ${maps.length + 1}`);
    setMaps((prev) => [...prev, created]);
    setCurrentMap(created);
    setDirty(false);
    setRenameDraft(null);
    clearSel();
  };

  const handleDuplicate = async (): Promise<void> => {
    if (!currentMap) return;
    const copy = await svc.duplicateMap(currentMap.id);
    if (!copy) return;
    setMaps((prev) => [...prev, copy]);
    setCurrentMap(copy);
    setDirty(false);
    clearSel();
  };

  const handleDeleteMap = async (): Promise<void> => {
    if (!currentMap) return;
    if (!(await confirmDialog(`确认删除地图「${currentMap.name}」？删除后不可恢复。`))) return;
    await svc.deleteMap(currentMap.id);
    const rest = maps.filter((m) => m.id !== currentMap.id);
    setMaps(rest);
    setCurrentMap(rest[0] ?? null);
    setDirty(false);
    clearSel();
  };

  const commitRename = async (): Promise<void> => {
    if (!currentMap || renameDraft === null) return;
    const name = renameDraft.trim() || currentMap.name;
    const updated: NovelMap = { ...currentMap, name };
    setCurrentMap(updated);
    await svc.saveMap(updated);
    syncMapInList(updated);
    setRenameDraft(null);
  };

  // ---------- 画布交互 ----------

  /** 新建节点（地点 / 文字标注），创建后选中便于在属性面板改名 */
  const addNode = (base: Omit<MapNode, 'id' | 'x' | 'y'>, pos: { x: number; y: number }): void => {
    const node: MapNode = {
      ...base,
      id: crypto.randomUUID(),
      x: Math.round(pos.x),
      y: Math.round(pos.y)
    };
    setCurrentMap((m) => (m ? { ...m, nodes: [...m.nodes, node] } : m));
    patchDirty();
    setSelectedNodeId(node.id);
    setSelectedConnId(null);
  };

  /** 画布空白点击：按工具分派 */
  const handleStageClick = (e: any): void => {
    const stage = e.target.getStage();
    if (!stage || e.target !== stage || !currentMap) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    if (tool === 'location') {
      addNode({ type: 'location', label: '新地点', shape: 'circle', radius: 26, color: '#7c3aed' }, pos);
    } else if (tool === 'text') {
      addNode({ type: 'marker', label: '文字标注', shape: 'circle', radius: 6, color: '#524c44' }, pos);
    } else if (tool === 'region') {
      setDraftPoints((p) => [...p, pos.x, pos.y]);
    } else if (tool === 'select' || tool === 'delete') {
      setSelectedNodeId(null);
      setSelectedConnId(null);
      setConnectFrom(null);
    }
  };

  /** 画布双击：区域工具闭合多边形 */
  const handleStageDblClick = (e: any): void => {
    if (tool !== 'region') return;
    const stage = e.target.getStage();
    if (!stage || e.target !== stage) return;
    // dblclick 前已触发两次 click 各加了一个重复点，先去掉
    const cleaned = draftPoints.slice(0, -2);
    setDraftPoints([]);
    if (cleaned.length < 6) return;
    let cx = 0;
    let cy = 0;
    for (let i = 0; i < cleaned.length; i += 2) {
      cx += cleaned[i];
      cy += cleaned[i + 1];
    }
    const count = cleaned.length / 2;
    cx = Math.round(cx / count);
    cy = Math.round(cy / count);
    // points 存相对质心坐标，x/y 为质心（选择工具下可整体拖拽）
    const points = cleaned.map((v, i) => Math.round(i % 2 === 0 ? v - cx : v - cy));
    const node: MapNode = {
      id: crypto.randomUUID(),
      type: 'region',
      label: '新区域',
      x: cx,
      y: cy,
      shape: 'polygon',
      points,
      color: '#2563eb'
    };
    setCurrentMap((m) => (m ? { ...m, nodes: [...m.nodes, node] } : m));
    patchDirty();
    setSelectedNodeId(node.id);
    setSelectedConnId(null);
  };

  /** 节点点击：按工具分派（选择/连线起点终点/删除） */
  const handleNodeClick = (node: MapNode): void => {
    if (draggedRef.current) {
      draggedRef.current = false;
      return;
    }
    if (tool === 'select') {
      setSelectedNodeId(node.id);
      setSelectedConnId(null);
    } else if (tool === 'connect') {
      if (!connectFrom) {
        setConnectFrom(node.id);
      } else if (connectFrom !== node.id) {
        const conn: MapConnection = {
          id: crypto.randomUUID(),
          fromNodeId: connectFrom,
          toNodeId: node.id,
          label: '道路',
          style: 'solid'
        };
        setCurrentMap((m) => (m ? { ...m, connections: [...m.connections, conn] } : m));
        patchDirty();
        setConnectFrom(null);
        setSelectedConnId(conn.id);
        setSelectedNodeId(null);
      } else {
        setConnectFrom(null);
      }
    } else if (tool === 'delete') {
      removeNode(node.id);
    }
  };

  const handleConnClick = (conn: MapConnection): void => {
    if (tool === 'delete') {
      removeConn(conn.id);
    } else {
      setSelectedConnId(conn.id);
      setSelectedNodeId(null);
    }
  };

  // ---------- AI 生成 ----------

  const runAiGenerate = async (): Promise<void> => {
    if (!aiGenerateMap || !aiPrompt.trim()) return;
    setAiGenerating(true);
    try {
      const raw = await aiGenerateMap(aiPrompt.trim());
      const parsed = parseAiContent(raw);
      if (!parsed) {
        alert('AI 返回内容无法解析为地图 JSON');
        return;
      }
      // 新建一张「AI 生成地图」并应用生成内容
      const created = await svc.createMap(bookId, 'AI 生成地图');
      const map: NovelMap = { ...created, nodes: parsed.nodes, connections: parsed.connections };
      await svc.saveMap(map);
      setMaps((prev) => [...prev, map]);
      setCurrentMap(map);
      setDirty(false);
      setSaveStatus('AI 生成完成');
      clearSel();
      setAiOpen(false);
      setAiPrompt('');
    } catch (err) {
      alert(`AI 生成失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAiGenerating(false);
    }
  };

  // ---------- 渲染 ----------

  /** 节点 label：关联世界书条目的追加 📄 标记 */
  const nodeLabelText = (node: MapNode): string =>
    node.worldbookEntryId ? `${node.label} 📄` : node.label;

  /** 渲染单个节点 */
  const renderNode = (node: MapNode): JSX.Element => {
    const selected = selectedNodeId === node.id;
    const linking = connectFrom === node.id;
    const highlight = selected || linking;
    const linkedTitle = node.worldbookEntryId
      ? entryTitleById.get(node.worldbookEntryId)
      : undefined;
    const label = nodeLabelText(node);

    const commonProps = {
      draggable: tool === 'select',
      onMouseDown: (): void => {
        draggedRef.current = false;
      },
      onDragStart: (): void => {
        draggedRef.current = true;
      },
      onDragEnd: (e: any): void => {
        updateNode(node.id, { x: Math.round(e.target.x()), y: Math.round(e.target.y()) });
      },
      onClick: (e: any): void => {
        e.cancelBubble = true;
        handleNodeClick(node);
      },
      onDblClick: (e: any): void => {
        e.cancelBubble = true;
        // 双击节点：保持选中以打开右侧属性面板
        setSelectedNodeId(node.id);
        setSelectedConnId(null);
      }
    };

    // 区域：半透明多边形，锚点为质心
    if (node.type === 'region') {
      return (
        <Group key={node.id} x={node.x} y={node.y} {...commonProps}>
          <Line
            points={node.points ?? []}
            closed
            fill={node.color}
            opacity={0.25}
            stroke={node.color}
            strokeWidth={2}
          />
          {highlight && (
            <Line points={node.points ?? []} closed stroke="#7c3aed" strokeWidth={1.5} dash={[6, 4]} listening={false} />
          )}
          <Text text={label} fontSize={13} fontStyle="bold" fill="#38342f" offsetX={label.length * 6.5} y={-9} listening={false} />
          {linkedTitle && (
            <Text text={linkedTitle} fontSize={11} fill="#8a8070" offsetX={linkedTitle.length * 5.5} y={9} listening={false} />
          )}
        </Group>
      );
    }

    // 文字标注：小圆点 + 右侧文字
    if (node.type === 'marker') {
      return (
        <Group key={node.id} x={node.x} y={node.y} {...commonProps}>
          <Circle
            radius={node.radius ?? 6}
            fill={node.color}
            stroke={highlight ? '#7c3aed' : '#fff'}
            strokeWidth={highlight ? 3 : 1.5}
          />
          <Text text={label} x={12} y={-8} fontSize={13} fill="#23211e" listening={false} />
          {linkedTitle && <Text text={linkedTitle} x={12} y={8} fontSize={11} fill="#8a8070" listening={false} />}
        </Group>
      );
    }

    // 地点：circle / rect / polygon，中心为 x/y，内部绘制 icon 字符
    const r = node.radius ?? 26;
    const w = node.width ?? 48;
    const h = node.height ?? 32;
    const ys = node.points?.filter((_, i) => i % 2 === 1) ?? [];
    const bottom = node.shape === 'rect' ? h / 2 : node.shape === 'polygon' ? Math.max(...ys, 0) : r;
    const iconSize = node.shape === 'rect' ? Math.round(h * 0.7) : Math.round(r * 0.9);

    return (
      <Group key={node.id} x={node.x} y={node.y} {...commonProps}>
        {node.shape === 'rect' ? (
          <Rect
            width={w}
            height={h}
            offsetX={w / 2}
            offsetY={h / 2}
            fill={node.color}
            cornerRadius={4}
            stroke={highlight ? '#7c3aed' : '#fff'}
            strokeWidth={highlight ? 3 : 2}
          />
        ) : node.shape === 'polygon' ? (
          <Line
            points={node.points ?? []}
            closed
            fill={node.color}
            opacity={0.85}
            stroke={highlight ? '#7c3aed' : '#fff'}
            strokeWidth={2}
          />
        ) : (
          <Circle radius={r} fill={node.color} stroke={highlight ? '#7c3aed' : '#fff'} strokeWidth={highlight ? 3 : 2} />
        )}
        {node.icon && (
          <Text
            text={ICON_CHAR[node.icon]}
            fontSize={iconSize}
            fill="#fff"
            align="center"
            width={node.shape === 'rect' ? w : r * 2}
            x={node.shape === 'rect' ? -w / 2 : -r}
            y={-iconSize * 0.62}
            listening={false}
          />
        )}
        <Text text={label} fontSize={13} fill="#23211e" offsetX={label.length * 6.5} y={bottom + 6} listening={false} />
        {linkedTitle && (
          <Text text={linkedTitle} fontSize={11} fill="#8a8070" offsetX={linkedTitle.length * 5.5} y={bottom + 22} listening={false} />
        )}
      </Group>
    );
  };

  /** 渲染单条连线：两节点中心 Line + 中点 label */
  const renderConn = (conn: MapConnection): JSX.Element | null => {
    const a = nodeById.get(conn.fromNodeId);
    const b = nodeById.get(conn.toNodeId);
    if (!a || !b) return null;
    const selected = selectedConnId === conn.id;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const boxW = Math.max(conn.label.length * 12 + 10, 30);
    const onClick = (e: any): void => {
      e.cancelBubble = true;
      handleConnClick(conn);
    };
    return (
      <Group key={conn.id}>
        <Line
          points={[a.x, a.y, b.x, b.y]}
          stroke={selected ? '#7c3aed' : '#8a8070'}
          strokeWidth={selected ? 3 : 2}
          dash={conn.style === 'dashed' ? [8, 6] : undefined}
          hitStrokeWidth={14}
          onClick={onClick}
        />
        <Group x={mx} y={my} onClick={onClick}>
          <Rect
            x={-boxW / 2}
            y={-10}
            width={boxW}
            height={20}
            fill="#fff"
            opacity={0.9}
            cornerRadius={4}
            stroke={selected ? '#7c3aed' : '#d9d4ca'}
            strokeWidth={1}
          />
          <Text text={conn.label} x={-boxW / 2} y={-7} width={boxW} align="center" fontSize={12} fill="#524c44" />
        </Group>
      </Group>
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex h-[92vh] w-[min(1200px,96vw)] flex-col overflow-hidden rounded bg-white shadow-2xl">
        {/* 标题栏 + 顶部工具栏 */}
        <div className="flex items-center justify-between border-b border-ink-200 px-4 py-2">
          <div className="flex items-center gap-3">
            <span className="text-sm font-semibold">地图编辑</span>
            {currentMap && (
              <span className="text-xs text-ink-400">{dirty ? '有未保存修改' : saveStatus || '就绪'}</span>
            )}
          </div>
          <div className="flex items-center gap-2">
            {aiGenerateMap && (
              <button
                type="button"
                className={`rounded border px-2 py-1 text-sm ${aiOpen ? 'border-violet-300 text-violet-700' : 'border-ink-200 hover:bg-ink-100'}`}
                onClick={() => setAiOpen((v) => !v)}
              >
                AI 生成
              </button>
            )}
            <button
              type="button"
              className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100"
              onClick={() => void save()}
            >
              保存
            </button>
            <button
              type="button"
              className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100"
              onClick={onClose}
              title="关闭"
            >
              ×
            </button>
          </div>
        </div>

        {/* 主体三栏 */}
        <div className="relative flex min-h-0 flex-1">
          {/* 左侧栏 */}
          <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-r border-ink-200">
            <div className="px-3 pb-1 pt-3 text-sm font-medium">地图列表</div>
            <div className="max-h-44 overflow-y-auto px-2">
              {maps.map((m) => {
                const active = currentMap?.id === m.id;
                return (
                  <div key={m.id} className="mb-1">
                    {active && renameDraft !== null ? (
                      <input
                        autoFocus
                        className="w-full rounded border border-violet-300 px-2 py-1 text-sm outline-none"
                        value={renameDraft}
                        onChange={(e) => setRenameDraft(e.target.value)}
                        onBlur={() => void commitRename()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') void commitRename();
                          if (e.key === 'Escape') setRenameDraft(null);
                        }}
                      />
                    ) : (
                      <button
                        type="button"
                        title={m.name}
                        className={`block w-full truncate rounded px-2 py-1 text-left text-sm ${
                          active ? 'bg-violet-50 font-medium text-violet-700' : 'hover:bg-ink-100'
                        }`}
                        onClick={() => void switchMap(m.id)}
                      >
                        {m.name}
                      </button>
                    )}
                  </div>
                );
              })}
              {maps.length === 0 && <div className="px-2 py-2 text-xs text-ink-400">暂无地图</div>}
            </div>
            <div className="flex flex-wrap gap-1 border-b border-ink-200 px-2 py-2">
              <button
                type="button"
                className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100"
                onClick={() => void handleCreate()}
              >
                新建
              </button>
              <button
                type="button"
                className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100 disabled:opacity-50"
                disabled={!currentMap}
                onClick={() => setRenameDraft(currentMap?.name ?? '')}
              >
                重命名
              </button>
              <button
                type="button"
                className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100 disabled:opacity-50"
                disabled={!currentMap}
                onClick={() => void handleDuplicate()}
              >
                复制
              </button>
              <button
                type="button"
                className="rounded border border-red-200 px-2 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                disabled={!currentMap}
                onClick={() => void handleDeleteMap()}
              >
                删除
              </button>
            </div>

            {/* 工具按钮组 */}
            <div className="px-3 pb-1 pt-3 text-sm font-medium">工具</div>
            <div className="grid grid-cols-3 gap-1 px-2">
              {TOOLS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  className={`rounded border px-1 py-1 text-sm ${
                    tool === t.value
                      ? 'border-violet-300 bg-violet-50 text-violet-700'
                      : 'border-ink-200 hover:bg-ink-100'
                  }`}
                  onClick={() => {
                    setTool(t.value);
                    clearSel();
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* 图例说明 */}
            <div className="px-3 pb-1 pt-3 text-sm font-medium">图例</div>
            <ul className="space-y-1 px-3 pb-4 text-xs leading-5 text-ink-500">
              <li>● 地点节点（可关联世界书条目）</li>
              <li>· 文字标注（小圆点）</li>
              <li>⬡ 区域（多边形半透明）</li>
              <li>— 连线：中点文字为名称，虚线为未定路线</li>
              <li>📄 已关联世界书条目</li>
              <li>虚线边框为地图边界（{currentMap?.width ?? 1200}×{currentMap?.height ?? 800}）</li>
            </ul>
          </aside>

          {/* 画布区 */}
          <div
            ref={containerRef}
            className={`relative min-w-0 flex-1 overflow-hidden bg-ink-50 ${
              tool === 'select' ? '' : tool === 'delete' ? 'cursor-pointer' : 'cursor-crosshair'
            }`}
          >
            {currentMap && size.width > 0 && (
              <Stage width={size.width} height={size.height} onClick={handleStageClick} onDblClick={handleStageDblClick}>
                <Layer>
                  {/* 地图边界（虚拟画布尺寸） */}
                  <Rect
                    x={0.5}
                    y={0.5}
                    width={Math.max(currentMap.width - 1, 1)}
                    height={Math.max(currentMap.height - 1, 1)}
                    stroke="#d9d4ca"
                    dash={[6, 6]}
                    listening={false}
                  />
                  {/* 连线在下、节点在上 */}
                  {currentMap.connections.map(renderConn)}
                  {currentMap.nodes.map(renderNode)}
                  {/* 区域工具草稿预览 */}
                  {tool === 'region' && draftPoints.length >= 4 && (
                    <Group listening={false}>
                      <Line points={draftPoints} stroke="#7c3aed" strokeWidth={1.5} dash={[6, 4]} />
                      {Array.from({ length: draftPoints.length / 2 }, (_, i) => (
                        <Circle key={i} x={draftPoints[i * 2]} y={draftPoints[i * 2 + 1]} radius={3.5} fill="#7c3aed" />
                      ))}
                    </Group>
                  )}
                </Layer>
              </Stage>
            )}
            <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/85 px-2 py-1 text-xs text-ink-500 shadow-sm">
              {TOOL_HINT[tool]}
            </div>
          </div>

          {/* 右侧属性面板 */}
          {(selNode || selConn) && (
            <aside className="flex w-56 shrink-0 flex-col overflow-y-auto border-l border-ink-200 p-3">
              {selNode && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm font-medium">节点属性</span>
                    <span className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-500">{TYPE_LABEL[selNode.type]}</span>
                  </div>
                  <label className="block text-xs text-ink-500">
                    名称
                    <input
                      className="mt-1 w-full rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-300"
                      value={selNode.label}
                      onChange={(e) => updateNode(selNode.id, { label: e.target.value })}
                    />
                  </label>
                  <div className="text-xs text-ink-500">
                    颜色
                    <div className="mt-1 flex gap-1.5">
                      {PALETTE.map((c) => (
                        <button
                          key={c}
                          type="button"
                          title={c}
                          className={`h-6 w-6 rounded-full border-2 ${selNode.color === c ? 'border-violet-600' : 'border-white'}`}
                          style={{ backgroundColor: c }}
                          onClick={() => updateNode(selNode.id, { color: c })}
                        />
                      ))}
                    </div>
                  </div>
                  {selNode.type !== 'region' && (
                    <label className="block text-xs text-ink-500">
                      图标
                      <select
                        className="mt-1 w-full rounded border border-ink-200 px-1 py-1 text-sm"
                        value={selNode.icon ?? ''}
                        onChange={(e) =>
                          updateNode(selNode.id, { icon: (e.target.value || undefined) as MapIcon | undefined })
                        }
                      >
                        <option value="">无</option>
                        {ICON_OPTIONS.map((o) => (
                          <option key={o.value} value={o.value}>
                            {o.label}
                          </option>
                        ))}
                      </select>
                    </label>
                  )}
                  {selNode.type !== 'region' && (
                    <label className="block text-xs text-ink-500">
                      形状
                      <select
                        className="mt-1 w-full rounded border border-ink-200 px-1 py-1 text-sm"
                        value={selNode.shape}
                        onChange={(e) => updateNode(selNode.id, { shape: e.target.value as MapNode['shape'] })}
                      >
                        <option value="circle">圆形</option>
                        <option value="rect">矩形</option>
                        <option value="polygon">多边形</option>
                      </select>
                    </label>
                  )}
                  {selNode.type !== 'region' && selNode.shape === 'circle' && (
                    <label className="block text-xs text-ink-500">
                      半径
                      <input
                        type="number"
                        min={4}
                        className="mt-1 w-full rounded border border-ink-200 px-2 py-1 text-sm"
                        value={selNode.radius ?? 26}
                        onChange={(e) => updateNode(selNode.id, { radius: Number(e.target.value) || 4 })}
                      />
                    </label>
                  )}
                  {selNode.shape === 'rect' && (
                    <div className="flex gap-2">
                      <label className="flex-1 text-xs text-ink-500">
                        宽
                        <input
                          type="number"
                          min={8}
                          className="mt-1 w-full rounded border border-ink-200 px-2 py-1 text-sm"
                          value={selNode.width ?? 48}
                          onChange={(e) => updateNode(selNode.id, { width: Number(e.target.value) || 8 })}
                        />
                      </label>
                      <label className="flex-1 text-xs text-ink-500">
                        高
                        <input
                          type="number"
                          min={8}
                          className="mt-1 w-full rounded border border-ink-200 px-2 py-1 text-sm"
                          value={selNode.height ?? 32}
                          onChange={(e) => updateNode(selNode.id, { height: Number(e.target.value) || 8 })}
                        />
                      </label>
                    </div>
                  )}
                  {selNode.shape === 'polygon' && (
                    <p className="text-xs text-ink-400">
                      多边形顶点 {(selNode.points?.length ?? 0) / 2} 个（选择工具下可整体拖拽）
                    </p>
                  )}
                  <label className="block text-xs text-ink-500">
                    关联世界书条目
                    <select
                      className="mt-1 w-full rounded border border-ink-200 px-1 py-1 text-sm"
                      value={selNode.worldbookEntryId ?? ''}
                      onChange={(e) => updateNode(selNode.id, { worldbookEntryId: e.target.value || undefined })}
                    >
                      <option value="">不关联</option>
                      {entries.map((en) => (
                        <option key={en.id} value={en.id}>
                          {en.title}
                        </option>
                      ))}
                    </select>
                  </label>
                  <button
                    type="button"
                    className="rounded border border-red-200 px-2 py-1 text-sm text-red-600 hover:bg-red-50"
                    onClick={() => removeNode(selNode.id)}
                  >
                    删除节点
                  </button>
                </div>
              )}
              {!selNode && selConn && (
                <div className="space-y-3">
                  <span className="text-sm font-medium">连线属性</span>
                  <label className="block text-xs text-ink-500">
                    名称
                    <input
                      className="mt-1 w-full rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-300"
                      value={selConn.label}
                      onChange={(e) => updateConn(selConn.id, { label: e.target.value })}
                    />
                  </label>
                  <label className="block text-xs text-ink-500">
                    线型
                    <select
                      className="mt-1 w-full rounded border border-ink-200 px-1 py-1 text-sm"
                      value={selConn.style}
                      onChange={(e) => updateConn(selConn.id, { style: e.target.value as MapConnection['style'] })}
                    >
                      <option value="solid">实线</option>
                      <option value="dashed">虚线</option>
                    </select>
                  </label>
                  <button
                    type="button"
                    className="rounded border border-red-200 px-2 py-1 text-sm text-red-600 hover:bg-red-50"
                    onClick={() => removeConn(selConn.id)}
                  >
                    删除连线
                  </button>
                </div>
              )}
            </aside>
          )}

          {/* AI 生成浮层 */}
          {aiOpen && aiGenerateMap && (
            <div className="absolute right-4 top-4 z-10 w-96 rounded border border-ink-200 bg-white p-3 shadow-lg">
              <div className="mb-2 text-sm font-medium">AI 生成地图</div>
              <textarea
                className="h-24 w-full resize-none rounded border border-ink-200 p-2 text-sm outline-none focus:border-violet-300"
                placeholder="描述要生成的地图，例如：一座海滨王国，包含王都、港口、北境山脉、森林村庄与主要道路"
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
              />
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100"
                  onClick={() => setAiOpen(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={aiGenerating || !aiPrompt.trim()}
                  className="rounded border border-violet-300 px-2 py-1 text-sm text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                  onClick={() => void runAiGenerate()}
                >
                  {aiGenerating ? '生成中…' : '生成'}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
