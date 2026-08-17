/**
 * 地图编辑器（参考「易制地图」全面升级）
 * - 顶部：撤销/重做、缩放控制（滚轮/按钮）、AI 生成、保存、导出 PNG
 * - 左侧：地图列表 / 工具 / 元件库（分类图标，点击进入连续放置模式）/ 图层显隐
 * - 画布：网格底纹、底图（上传/拖动/锁定）、滚轮锚定缩放、抓手平移、
 *   节点右键菜单（复制/置顶/置底/删除）、Esc 停止放置
 * - 右侧：MapInspector 属性面板（地图/节点/连线）
 * 历史栈快照 { nodes, connections }（地图元信息不参与撤销），上限 50 步
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { Stage, Layer, Group, Circle, Rect, Line, Arrow, Text, Image } from 'react-konva';
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { getAppContext } from '../../context/app-context';
import { alertDialog, confirmDialog } from '../../native/dialog';
import { MapEditorService } from '../../services/map/MapEditorService';
import {
  ICON_LIBRARY,
  LAYER_LABELS,
  TERRAIN_LIBRARY,
  TILE_SIZE,
  createEmptyTiles,
  iconEmoji,
  iconLabel,
  terrainDef,
  type LayerVisibility,
  type MapBackgroundTransform,
  type MapConnection,
  type MapNode,
  type MapTiles,
  type NovelMap
} from '../../services/map/types';
import { generateTerrain, scatterSettlements } from '../../services/map/terrainGen';
import { drawTileCell, renderTilesToCanvas } from '../../services/map/tileRender';
import { MapInspector } from './MapInspector';

interface MapEditorProps {
  bookId: string;
  onClose: () => void;
  /** AI 生成：入参提示词，返回 { nodes, connections } JSON 字符串 */
  aiGenerateMap?: (prompt: string) => Promise<string>;
}

/** 工具集 */
type Tool = 'select' | 'pan' | 'connect' | 'region' | 'delete' | 'brush' | 'eraser' | 'fill' | 'picker';

const TOOLS: Array<{ value: Tool; label: string; hint: string }> = [
  { value: 'select', label: '选择', hint: '选择：点击选中，拖拽移动；右键节点快捷菜单' },
  { value: 'pan', label: '抓手', hint: '抓手：拖拽平移画布（滚轮缩放随时可用）' },
  { value: 'brush', label: '笔刷', hint: '笔刷（B）：按住左键涂抹绘制地形瓦片，左侧选地形与笔刷大小' },
  { value: 'eraser', label: '橡皮', hint: '橡皮（E）：按住左键擦除地形瓦片' },
  { value: 'fill', label: '填充', hint: '填充：点击瓦片，同地形的连通区域整体替换为当前地形' },
  { value: 'picker', label: '吸管', hint: '吸管：点击瓦片取地形为当前笔刷，并自动切回笔刷' },
  { value: 'connect', label: '连线', hint: '连线：依次点击两个地点节点创建道路/航线' },
  { value: 'region', label: '区域', hint: '区域：依次点击添加顶点，双击闭合生成区域，Esc 取消' },
  { value: 'delete', label: '删除', hint: '删除：点击节点或连线删除' }
];

const TOOL_HINT: Record<Tool, string> = Object.fromEntries(TOOLS.map((t) => [t.value, t.hint])) as Record<Tool, string>;

/** 瓦片绘制类工具（笔刷/橡皮/填充/吸管）：画布元素让位，直接操作地形层 */
function isPaintTool(t: Tool): boolean {
  return t === 'brush' || t === 'eraser' || t === 'fill' || t === 'picker';
}

/** 油漆桶：从 (col,row) 把与起始格同地形的连通区域整体替换为 to */
function floodFillTiles(tiles: MapTiles, col: number, row: number, to: string): MapTiles {
  const { cols, rows, data } = tiles;
  const from = data[row * cols + col];
  if (from === to) return tiles;
  const next = [...data];
  const stack: number[] = [row * cols + col];
  while (stack.length > 0) {
    const i = stack.pop() as number;
    if (next[i] !== from) continue;
    next[i] = to;
    const c = i % cols;
    const r = (i - c) / cols;
    if (c > 0) stack.push(i - 1);
    if (c < cols - 1) stack.push(i + 1);
    if (r > 0) stack.push(i - cols);
    if (r < rows - 1) stack.push(i + cols);
  }
  return { ...tiles, data: next };
}

/** 视图变换（画布坐标 -> 屏幕坐标） */
interface ViewTransform {
  x: number;
  y: number;
  scale: number;
}

/** 默认底图变换 */
const DEFAULT_BG: MapBackgroundTransform = { x: 0, y: 0, scale: 1, locked: true };

const HISTORY_LIMIT = 50;
/** 连续编辑（属性面板输入/滑杆）在此间隔内合并为一步历史 */
const COALESCE_MS = 700;

function clamp(v: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, v));
}

function base64ToU8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * 解析 AI 返回内容（容错增强）：
 * 1. 剥 <think> 推理段 / ```json 围栏 / 首尾说明文字（截取首尾大括号）
 * 2. 首次解析失败时，移除 // 注释与尾逗号后重试（AI 常见格式瑕疵）
 * 3. nodes / connections 任一存在即视为有效（只返回其一不算失败）
 */
function parseAiContent(raw: string): { nodes: MapNode[]; connections: MapConnection[] } | null {
  try {
    let s = raw
      .replace(/<think>[\s\S]*?<\/think>/gi, '') // 剥推理模型思考段
      .trim();
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fence) s = fence[1].trim();
    const start = s.indexOf('{');
    const end = s.lastIndexOf('}');
    if (start >= 0 && end > start) s = s.slice(start, end + 1);

    let parsed: { nodes?: MapNode[]; connections?: MapConnection[] };
    try {
      parsed = JSON.parse(s) as { nodes?: MapNode[]; connections?: MapConnection[] };
    } catch {
      // 重试：去 // 行注释、/* 块注释 */ 与尾逗号
      const cleaned = s
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(^|[^:"'\\])\/\/[^\n\r]*/g, '$1')
        .replace(/,(\s*[}\]])/g, '$1');
      parsed = JSON.parse(cleaned) as { nodes?: MapNode[]; connections?: MapConnection[] };
    }

    const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
    const connections = Array.isArray(parsed.connections) ? parsed.connections : [];
    if (nodes.length === 0 && connections.length === 0) return null;
    return { nodes, connections };
  } catch {
    return null;
  }
}

/** 右键菜单状态（屏幕坐标） */
interface CtxMenu {
  x: number;
  y: number;
  nodeId: string;
}

export function MapEditor({ bookId, onClose, aiGenerateMap }: MapEditorProps): JSX.Element {
  const svc = useMemo(() => new MapEditorService(getAppContext().db, getAppContext().wq), []);

  const [maps, setMaps] = useState<NovelMap[]>([]);
  const [currentMap, setCurrentMap] = useState<NovelMap | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');

  const [tool, setTool] = useState<Tool>('select');
  /** 元件库连续放置：图标 id，null 表示未在放置 */
  const [placeIcon, setPlaceIcon] = useState<string | null>(null);
  /** 瓦片地形笔刷：地形 id 与大小档位（1/2/3 -> 半径 0/1/2 格） */
  const [terrainBrush, setTerrainBrush] = useState('grass');
  const [brushSize, setBrushSize] = useState(1);
  /** 随机地形生成参数 */
  const [genOpen, setGenOpen] = useState(false);
  const [genSea, setGenSea] = useState(0.42);
  const [genRough, setGenRough] = useState(1);
  const [genIsland, setGenIsland] = useState(true);
  const [genScatter, setGenScatter] = useState(true);
  const [genCount, setGenCount] = useState(6);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedConnId, setSelectedConnId] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  const [draftPoints, setDraftPoints] = useState<number[]>([]);

  const [view, setView] = useState<ViewTransform>({ x: 0, y: 0, scale: 1 });
  const [layers, setLayers] = useState<LayerVisibility>({ bg: true, tile: true, region: true, conn: true, node: true, marker: true });

  const [past, setPast] = useState<string[]>([]);
  const [future, setFuture] = useState<string[]>([]);
  const lastPushAt = useRef(0);

  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [entries, setEntries] = useState<Array<{ id: string; title: string }>>([]);
  const [renameDraft, setRenameDraft] = useState<string | null>(null);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const bgUrlRef = useRef<string | null>(null);

  /** 瓦片层离屏 canvas（Konva 单张 Image 引用，涂抹期间增量重绘） */
  const [tileCanvas, setTileCanvas] = useState<HTMLCanvasElement | null>(null);
  const tileCtxRef = useRef<CanvasRenderingContext2D | null>(null);
  /** 涂抹进行中：在瓦片副本上作画 + canvas 增量重绘，抬笔才写回 state（历史仅记一步） */
  const paintingRef = useRef(false);
  const strokeTilesRef = useRef<MapTiles | null>(null);
  const lastCellRef = useRef(-1);

  // 画布尺寸：容器 div offsetWidth/Height，ResizeObserver 跟随
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const stageRef = useRef<any>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // 拖拽后 Konva 仍会触发 click，用标记吞掉拖拽结束后的那次点击
  const draggedRef = useRef(false);
  // StrictMode 双执行防护：避免重复自动建图
  const bootedRef = useRef(false);
  // 每张地图首次进入自动「适应画布」一次
  const fittedForRef = useRef<string | null>(null);

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
      .db.query<{ id: string; title: string }>('SELECT id, title FROM worldbook_entries WHERE book_id = ?', [
        bookId
      ])
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

  /** 底图加载：appData 相对路径 -> objectURL -> Image；首次加载自动适配画布 */
  useEffect(() => {
    let cancelled = false;
    const mapId = currentMap?.id;
    const bgPath = currentMap?.background;
    if (!mapId || !bgPath) {
      setBgImage(null);
      return () => undefined;
    }
    void (async () => {
      try {
        const { bridge } = getAppContext();
        const appDir = await bridge.storage.appDataDir();
        const data = await bridge.fs.readBinaryFile(`${appDir}/${bgPath}`);
        const url = URL.createObjectURL(new Blob([data as unknown as BlobPart]));
        const img = new window.Image();
        img.onload = (): void => {
          if (cancelled) return;
          if (bgUrlRef.current) URL.revokeObjectURL(bgUrlRef.current);
          bgUrlRef.current = url;
          setBgImage(img);
          // 无变换记录时自动 cover 适配画布并解锁，便于立即拖动
          setCurrentMap((m) => {
            if (!m || m.id !== mapId || m.bg) return m;
            const s = Math.max(m.width / img.width, m.height / img.height);
            return {
              ...m,
              bg: {
                x: Math.round((m.width - img.width * s) / 2),
                y: Math.round((m.height - img.height * s) / 2),
                scale: Math.round(s * 100) / 100,
                locked: false
              }
            };
          });
          setDirty(true);
        };
        img.src = url;
      } catch {
        if (!cancelled) setBgImage(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [currentMap?.id, currentMap?.background]);

  /** 瓦片层 -> 离屏 canvas：tiles 引用变化时全量重绘（撤销/生成/切图后） */
  useEffect(() => {
    const tiles = currentMap?.tiles;
    if (!tiles) {
      setTileCanvas(null);
      tileCtxRef.current = null;
      return;
    }
    const canvas = renderTilesToCanvas(tiles);
    tileCtxRef.current = canvas.getContext('2d');
    setTileCanvas(canvas);
  }, [currentMap?.tiles]);

  const nodeById = useMemo(
    () => new Map<string, MapNode>((currentMap?.nodes ?? []).map((n): [string, MapNode] => [n.id, n])),
    [currentMap]
  );
  const entryTitleById = useMemo(
    () => new Map<string, string>(entries.map((e): [string, string] => [e.id, e.title])),
    [entries]
  );
  /** 按 zIndex 稳定排序（未设置按创建顺序） */
  const sortedNodes = useMemo(() => {
    if (!currentMap) return [];
    return currentMap.nodes
      .map((n, i) => ({ n, i }))
      .sort((a, b) => (a.n.zIndex ?? 0) - (b.n.zIndex ?? 0) || a.i - b.i)
      .map((x) => x.n);
  }, [currentMap]);
  const selNode = selectedNodeId ? (nodeById.get(selectedNodeId) ?? null) : null;
  const selConn =
    currentMap && selectedConnId
      ? (currentMap.connections.find((c) => c.id === selectedConnId) ?? null)
      : null;
  const bg = currentMap?.bg ?? DEFAULT_BG;

  /** 每张地图首次进入 + 尺寸就绪：适应画布 */
  useEffect(() => {
    if (!currentMap || size.width === 0 || fittedForRef.current === currentMap.id) return;
    fittedForRef.current = currentMap.id;
    fitView(currentMap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMap?.id, size.width, size.height]);

  // ---------- 视图控制 ----------

  function fitView(map: NovelMap | null): void {
    if (!map || size.width === 0 || size.height === 0) return;
    // 瓦片范围可能超过画布设定尺寸，取两者最大值适配
    const w = Math.max(map.width, map.tiles ? map.tiles.cols * map.tiles.size : 0);
    const h = Math.max(map.height, map.tiles ? map.tiles.rows * map.tiles.size : 0);
    const s = Math.min(size.width / (w + 80), size.height / (h + 80));
    setView({
      scale: s,
      x: (size.width - w * s) / 2,
      y: (size.height - h * s) / 2
    });
  }

  /** 以屏幕坐标 (sx,sy) 为锚点缩放 */
  function zoomAtPoint(sx: number, sy: number, factor: number): void {
    setView((v) => {
      const scale = clamp(v.scale * factor, 0.1, 4);
      const k = scale / v.scale;
      return { scale, x: sx - (sx - v.x) * k, y: sy - (sy - v.y) * k };
    });
  }

  const onWheel = (e: any): void => {
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    zoomAtPoint(pointer.x, pointer.y, e.evt.deltaY < 0 ? 1.1 : 1 / 1.1);
  };

  // ---------- 历史与数据变更 ----------

  const snap = (m: NovelMap): string =>
    JSON.stringify({ nodes: m.nodes, connections: m.connections, tiles: m.tiles });

  /** 结构变更入口：coalesce=true 时 700ms 内的连续变更合并为一步历史 */
  const mutate = (fn: (m: NovelMap) => NovelMap, coalesce = false): void => {
    if (!currentMap) return;
    const now = Date.now();
    if (!coalesce || now - lastPushAt.current > COALESCE_MS) {
      setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), snap(currentMap)]);
      setFuture([]);
      lastPushAt.current = now;
    }
    setCurrentMap(fn(currentMap));
    setDirty(true);
  };

  /** 地图元信息（名称/尺寸/底图等）不参与撤销 */
  const patchMap = (patch: Partial<NovelMap>): void => {
    if (!currentMap) return;
    setCurrentMap({ ...currentMap, ...patch });
    setDirty(true);
  };

  const patchNode = (id: string, patch: Partial<MapNode>, coalesce = true): void => {
    mutate((m) => ({ ...m, nodes: m.nodes.map((n) => (n.id === id ? { ...n, ...patch } : n)) }), coalesce);
  };

  const patchConn = (id: string, patch: Partial<MapConnection>, coalesce = true): void => {
    mutate(
      (m) => ({ ...m, connections: m.connections.map((c) => (c.id === id ? { ...c, ...patch } : c)) }),
      coalesce
    );
  };

  const clearSel = (): void => {
    setSelectedNodeId(null);
    setSelectedConnId(null);
    setConnectFrom(null);
    setDraftPoints([]);
    setCtxMenu(null);
  };

  const undo = (): void => {
    if (past.length === 0 || !currentMap) return;
    const prev = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [snap(currentMap), ...f].slice(0, HISTORY_LIMIT));
    const parsed = JSON.parse(prev) as { nodes?: MapNode[]; connections?: MapConnection[]; tiles?: MapTiles };
    setCurrentMap({
      ...currentMap,
      nodes: parsed.nodes ?? [],
      connections: parsed.connections ?? [],
      tiles: parsed.tiles
    });
    lastPushAt.current = 0;
    setDirty(true);
    clearSel();
  };

  const redo = (): void => {
    if (future.length === 0 || !currentMap) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), snap(currentMap)]);
    const parsed = JSON.parse(next) as { nodes?: MapNode[]; connections?: MapConnection[]; tiles?: MapTiles };
    setCurrentMap({
      ...currentMap,
      nodes: parsed.nodes ?? [],
      connections: parsed.connections ?? [],
      tiles: parsed.tiles
    });
    lastPushAt.current = 0;
    setDirty(true);
    clearSel();
  };

  const removeNode = (id: string): void => {
    mutate((m) => ({
      ...m,
      nodes: m.nodes.filter((n) => n.id !== id),
      connections: m.connections.filter((c) => c.fromNodeId !== id && c.toNodeId !== id)
    }));
    setSelectedNodeId(null);
    setCtxMenu(null);
  };

  const removeConn = (id: string): void => {
    mutate((m) => ({ ...m, connections: m.connections.filter((c) => c.id !== id) }));
    setSelectedConnId(null);
    setCtxMenu(null);
  };

  const duplicateNode = (id: string): void => {
    const src = nodeById.get(id);
    if (!src || !currentMap) return;
    const copy: MapNode = { ...src, id: crypto.randomUUID(), x: src.x + 30, y: src.y + 30 };
    mutate((m) => ({ ...m, nodes: [...m.nodes, copy] }));
    setSelectedNodeId(copy.id);
    setSelectedConnId(null);
    setCtxMenu(null);
  };

  const zIndexOp = (id: string, dir: 'top' | 'bottom'): void => {
    if (!currentMap) return;
    const zs = currentMap.nodes.map((n) => n.zIndex ?? 0);
    const target = dir === 'top' ? Math.max(...zs, 0) + 1 : Math.min(...zs, 0) - 1;
    patchNode(id, { zIndex: target }, false);
    setCtxMenu(null);
  };

  // ---------- 地图列表操作 ----------

  const syncMapInList = (map: NovelMap): void => {
    setMaps((prev) => prev.map((m) => (m.id === map.id ? { ...map } : m)));
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
    setPast([]);
    setFuture([]);
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
    setPast([]);
    setFuture([]);
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

  /** 新建节点，创建后选中便于在属性面板改名 */
  const addNode = (base: Omit<MapNode, 'id' | 'x' | 'y'>, pos: { x: number; y: number }): void => {
    const node: MapNode = { ...base, id: crypto.randomUUID(), x: Math.round(pos.x), y: Math.round(pos.y) };
    mutate((m) => ({ ...m, nodes: [...m.nodes, node] }));
    setSelectedNodeId(node.id);
    setSelectedConnId(null);
  };

  /** 屏幕坐标 -> 画布坐标 */
  const toCanvasPos = (pos: { x: number; y: number }): { x: number; y: number } => ({
    x: (pos.x - view.x) / view.scale,
    y: (pos.y - view.y) / view.scale
  });

  const handleStageClick = (e: any): void => {
    const stage = e.target.getStage();
    if (!stage || e.target !== stage || !currentMap) return;
    const pos = stage.getPointerPosition();
    if (!pos) return;
    // 连续放置模式（元件库）
    if (placeIcon) {
      addNode(
        { type: 'location', label: iconLabel(placeIcon), shape: 'icon', icon: placeIcon, radius: 24, color: '#7c3aed' },
        toCanvasPos(pos)
      );
      return;
    }
    const p = toCanvasPos(pos);
    if (tool === 'connect') {
      setConnectFrom(null);
    } else if (tool === 'region') {
      setDraftPoints((pts) => [...pts, Math.round(p.x), Math.round(p.y)]);
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
    mutate((m) => ({ ...m, nodes: [...m.nodes, node] }));
    setSelectedNodeId(node.id);
    setSelectedConnId(null);
  };

  /** 空白右键：退出放置/取消选择 */
  const handleStageContextMenu = (e: any): void => {
    e.evt.preventDefault();
    setPlaceIcon(null);
    clearSel();
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
      if (node.type !== 'location') return;
      if (!connectFrom) {
        setConnectFrom(node.id);
      } else if (connectFrom !== node.id) {
        const conn: MapConnection = {
          id: crypto.randomUUID(),
          fromNodeId: connectFrom,
          toNodeId: node.id,
          label: '道路',
          style: 'solid',
          lineType: 'curve',
          width: 2,
          arrow: false
        };
        mutate((m) => ({ ...m, connections: [...m.connections, conn] }));
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

  // ---------- 瓦片涂抹（笔刷/橡皮/填充/吸管） ----------

  const paintMode = isPaintTool(tool);

  /** 画布坐标 -> 瓦片一维索引；越界返回 -1 */
  function tileCellAt(px: number, py: number, tiles: MapTiles): number {
    const col = Math.floor(px / tiles.size);
    const row = Math.floor(py / tiles.size);
    if (col < 0 || col >= tiles.cols || row < 0 || row >= tiles.rows) return -1;
    return row * tiles.cols + col;
  }

  /** 以 (col,row) 为中心圆形盖章（brushSize 档位 1/2/3 -> 半径 0/1/2 格），同步增量重绘离屏 canvas */
  function stampBrush(tiles: MapTiles, col: number, row: number, value: string): void {
    const radius = brushSize - 1;
    const ctx = tileCtxRef.current;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius + 0.01) continue; // 圆形覆盖
        const c = col + dx;
        const r = row + dy;
        if (c < 0 || c >= tiles.cols || r < 0 || r >= tiles.rows) continue;
        const i = r * tiles.cols + c;
        if (tiles.data[i] === value) continue;
        tiles.data[i] = value;
        if (ctx) drawTileCell(ctx, tiles, c, r, value);
      }
    }
    if (ctx) stageRef.current?.batchDraw();
  }

  /** 涂抹按下：吸管取色 / 油漆桶连通填充 / 笔刷橡皮开启一笔（副本作画，抬笔写回） */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleStageMouseDownPaint = (e: any): void => {
    if (!paintMode || !currentMap) return;
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const px = (pointer.x - view.x) / view.scale;
    const py = (pointer.y - view.y) / view.scale;

    // 首笔且地图无瓦片层：创建并落下第一笔（独立历史步，可撤销回无地形状态）
    if (!currentMap.tiles) {
      const fresh = createEmptyTiles(
        Math.max(2, Math.ceil(currentMap.width / TILE_SIZE)),
        Math.max(2, Math.ceil(currentMap.height / TILE_SIZE))
      );
      const idx = tileCellAt(px, py, fresh);
      if (idx < 0) return;
      const col = idx % fresh.cols;
      const row = (idx - col) / fresh.cols;
      stampBrush(fresh, col, row, tool === 'eraser' ? '' : terrainBrush);
      mutate((m) => ({ ...m, tiles: fresh }));
      return;
    }

    const tiles = currentMap.tiles;
    const idx = tileCellAt(px, py, tiles);
    if (idx < 0) return;
    const col = idx % tiles.cols;
    const row = (idx - col) / tiles.cols;

    if (tool === 'picker') {
      const picked = tiles.data[idx];
      if (picked) setTerrainBrush(picked);
      setTool('brush');
      return;
    }
    if (tool === 'fill') {
      const next = floodFillTiles(tiles, col, row, terrainBrush);
      if (next !== tiles) mutate((m) => ({ ...m, tiles: next }));
      return;
    }
    // brush / eraser：在瓦片副本上作画，抬笔写回（历史仅记一步）
    paintingRef.current = true;
    lastCellRef.current = idx;
    const copy: MapTiles = { ...tiles, data: [...tiles.data] };
    strokeTilesRef.current = copy;
    stampBrush(copy, col, row, tool === 'eraser' ? '' : terrainBrush);
  };

  /** 涂抹拖动：按格去重后连续盖章 */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const handleStageMouseMovePaint = (e: any): void => {
    if (!paintingRef.current) return;
    e.evt.preventDefault();
    const stage = stageRef.current;
    const tiles = strokeTilesRef.current;
    if (!stage || !tiles) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const px = (pointer.x - view.x) / view.scale;
    const py = (pointer.y - view.y) / view.scale;
    const idx = tileCellAt(px, py, tiles);
    if (idx < 0 || idx === lastCellRef.current) return;
    lastCellRef.current = idx;
    const col = idx % tiles.cols;
    const row = (idx - col) / tiles.cols;
    stampBrush(tiles, col, row, tool === 'eraser' ? '' : terrainBrush);
  };

  /** 抬笔：把一笔的瓦片副本写回 state（mutate 快照为落笔前状态，恰为一笔一步） */
  const endStroke = (): void => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    const tiles = strokeTilesRef.current;
    strokeTilesRef.current = null;
    lastCellRef.current = -1;
    if (tiles) mutate((m) => ({ ...m, tiles }));
  };

  /** 抬笔兜底：无论鼠标在何处松开都结束一笔 */
  useEffect(() => {
    const up = (): void => endStroke();
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  });

  /** 随机生成：分形噪声地形 + 可选聚居点撒点（转为地点节点追加） */
  const runTerrainGen = (): void => {
    if (!currentMap) return;
    const cols = Math.max(8, Math.ceil(currentMap.width / TILE_SIZE));
    const rows = Math.max(8, Math.ceil(currentMap.height / TILE_SIZE));
    const seed = Math.floor(Math.random() * 2 ** 31);
    const tiles = generateTerrain({
      cols,
      rows,
      seed,
      seaLevel: genSea,
      roughness: genRough,
      island: genIsland
    });
    if (genScatter) {
      const sites = scatterSettlements(tiles, seed, genCount);
      if (sites.length > 0) {
        const idBase = `site_${Date.now()}`;
        const nodes: MapNode[] = sites.map((s, i) => ({
          id: `${idBase}_${i}`,
          type: 'location' as const,
          label: s.label,
          x: s.x,
          y: s.y,
          shape: 'icon' as const,
          icon: s.icon,
          color: '#d97706',
          desc: '随机生成聚居点'
        }));
        mutate((m) => ({ ...m, tiles, nodes: [...m.nodes, ...nodes] }));
        setGenOpen(false);
        return;
      }
    }
    mutate((m) => ({ ...m, tiles }));
    setGenOpen(false);
  };

  /** 清空瓦片层（保留网格规格，全部置空） */
  const clearTiles = (): void => {
    const tiles = currentMap?.tiles;
    if (!tiles) return;
    void (async () => {
      if (!(await confirmDialog('确定清空全部地形瓦片？此操作可用撤销恢复。'))) return;
      mutate((m) => ({ ...m, tiles: createEmptyTiles(tiles.cols, tiles.rows, tiles.size) }));
    })();
  };

  // ---------- 键盘快捷键 ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        return;
      }
      const ctrl = e.ctrlKey || e.metaKey;
      if (ctrl && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) redo();
        else undo();
      } else if (ctrl && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        redo();
      } else if (ctrl && e.key.toLowerCase() === 'd') {
        if (selectedNodeId) {
          e.preventDefault();
          duplicateNode(selectedNodeId);
        }
      } else if (e.key.toLowerCase() === 'b') {
        setTool('brush');
      } else if (e.key.toLowerCase() === 'e') {
        setTool('eraser');
      } else if (e.key === 'Delete' || e.key === 'Backspace') {
        if (selectedNodeId) removeNode(selectedNodeId);
        else if (selectedConnId) removeConn(selectedConnId);
      } else if (e.key === 'Escape') {
        if (placeIcon) setPlaceIcon(null);
        else if (ctxMenu) setCtxMenu(null);
        else if (draftPoints.length > 0) setDraftPoints([]);
        else if (connectFrom) setConnectFrom(null);
        else clearSel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- 底图操作 ----------

  const uploadBg = async (): Promise<void> => {
    if (!currentMap) return;
    const file = await open({
      multiple: false,
      filters: [{ name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp', 'bmp'] }]
    });
    if (!file || typeof file !== 'string') return;
    try {
      const { bridge } = getAppContext();
      const data = await bridge.fs.readBinaryFile(file);
      const appDir = await bridge.storage.appDataDir();
      const ext = (file.split('.').pop() ?? 'png').toLowerCase().replace(/[^a-z0-9]/g, '') || 'png';
      const rel = `maps/${currentMap.id}_bg.${ext}`;
      await bridge.fs.ensureDir(`${appDir}/maps`);
      await bridge.fs.writeBinaryFile(`${appDir}/${rel}`, data);
      patchMap({ background: rel, bg: undefined });
    } catch (err) {
      void alertDialog(`底图上传失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const removeBg = (): void => {
    patchMap({ background: undefined, bg: undefined });
    setBgImage(null);
  };

  /** 底图 cover 适配画布并居中 */
  const resetBg = (): void => {
    if (!currentMap || !bgImage) return;
    const s = Math.max(currentMap.width / bgImage.width, currentMap.height / bgImage.height);
    patchMap({
      bg: {
        x: Math.round((currentMap.width - bgImage.width * s) / 2),
        y: Math.round((currentMap.height - bgImage.height * s) / 2),
        scale: Math.round(s * 100) / 100,
        locked: bg.locked
      }
    });
  };

  // ---------- 导出 PNG ----------

  const exportPng = async (): Promise<void> => {
    const stage = stageRef.current;
    if (!stage || !currentMap) return;
    const prev = view;
    setSelectedNodeId(null);
    setSelectedConnId(null);
    setConnectFrom(null);
    setDraftPoints([]);
    setView({ x: 0, y: 0, scale: 1 });
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    const url = stage.toDataURL({
      x: 0,
      y: 0,
      width: currentMap.width,
      height: currentMap.height,
      pixelRatio: 2
    });
    setView(prev);
    const safeName = currentMap.name.replace(/[\\/:*?"<>|]/g, '_');
    const target = await saveDialog({
      defaultPath: `${safeName}.png`,
      filters: [{ name: 'PNG 图片', extensions: ['png'] }]
    });
    if (!target || typeof target !== 'string') return;
    try {
      const { bridge } = getAppContext();
      await bridge.fs.writeBinaryFile(target, base64ToU8(url.split(',')[1] ?? ''));
      setSaveStatus('已导出 PNG');
    } catch (err) {
      void alertDialog(`导出失败：${err instanceof Error ? err.message : String(err)}`);
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
        void alertDialog(`AI 返回内容无法解析为地图 JSON。返回内容预览：\n${raw.slice(0, 300)}`);
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
      void alertDialog(`AI 生成失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAiGenerating(false);
    }
  };

  // ---------- 渲染 ----------

  /** 网格线（100px 间隔，画布范围内） */
  const gridLines = useMemo(() => {
    const lines: Array<{ points: number[] }> = [];
    if (!currentMap) return lines;
    const { width, height } = currentMap;
    for (let x = 100; x < width; x += 100) lines.push({ points: [x, 0, x, height] });
    for (let y = 100; y < height; y += 100) lines.push({ points: [0, y, width, y] });
    return lines;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentMap?.width, currentMap?.height]);

  /** 节点 label：关联世界书条目的追加 📄 标记 */
  const nodeLabelText = (node: MapNode): string =>
    node.worldbookEntryId ? `${node.label} 📄` : node.label;

  /** 渲染单个节点 */
  const renderNode = (node: MapNode): JSX.Element => {
    const selected = selectedNodeId === node.id;
    const linking = connectFrom === node.id;
    const highlight = selected || linking;
    const linkedTitle = node.worldbookEntryId ? entryTitleById.get(node.worldbookEntryId) : undefined;
    const label = nodeLabelText(node);
    const s = node.scale ?? 1;
    const rot = node.rotation ?? 0;
    const opacity = node.opacity ?? 1;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const commonProps: Record<string, any> = {
      draggable: tool === 'select',
      onMouseDown: (): void => {
        draggedRef.current = false;
      },
      onDragStart: (): void => {
        draggedRef.current = true;
      },
      onDragEnd: (e: any): void => {
        patchNode(node.id, { x: Math.round(e.target.x()), y: Math.round(e.target.y()) }, false);
      },
      onClick: (e: any): void => {
        e.cancelBubble = true;
        handleNodeClick(node);
      },
      onDblClick: (e: any): void => {
        e.cancelBubble = true;
        setSelectedNodeId(node.id);
        setSelectedConnId(null);
      },
      onContextMenu: (e: any): void => {
        e.cancelBubble = true;
        e.evt.preventDefault();
        if (node.type === 'location' || node.type === 'marker') {
          setSelectedNodeId(node.id);
          setSelectedConnId(null);
          setCtxMenu({ x: e.evt.clientX, y: e.evt.clientY, nodeId: node.id });
        }
      }
    };

    // 区域：半透明多边形，锚点为质心
    if (node.type === 'region') {
      return (
        <Group key={node.id} x={node.x} y={node.y} opacity={opacity} {...commonProps}>
          <Line
            points={node.points ?? []}
            closed
            fill={node.color}
            opacity={0.22}
            stroke={node.color}
            strokeWidth={2}
            dash={[8, 5]}
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
        <Group key={node.id} x={node.x} y={node.y} scaleX={s} scaleY={s} opacity={opacity} {...commonProps}>
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

    // 地点节点
    const r = node.radius ?? 24;
    const w = node.width ?? 48;
    const h = node.height ?? 32;
    const ys = node.points?.filter((_, i) => i % 2 === 1) ?? [];
    const bottom = node.shape === 'rect' ? h / 2 : node.shape === 'polygon' ? Math.max(...ys, 0) : r;
    const emojiSize = node.shape === 'icon' ? Math.round(r * 1.05) : Math.round(Math.min(w, h) * 0.6);

    return (
      <Group key={node.id} x={node.x} y={node.y} scaleX={s} scaleY={s} opacity={opacity} {...commonProps}>
        {/* 选中/连线起点光环（不随形状旋转） */}
        {highlight && (
          <Circle
            radius={(node.shape === 'rect' ? Math.max(w, h) / 2 : r) + 7}
            stroke="#7c3aed"
            strokeWidth={1.5}
            dash={[5, 4]}
            listening={false}
          />
        )}
        <Group rotation={rot}>
          {node.shape === 'icon' ? (
            <Circle
              radius={r}
              fill="#ffffff"
              stroke={node.color}
              strokeWidth={2.5}
              shadowColor="#1f2937"
              shadowOpacity={0.18}
              shadowBlur={8}
              shadowOffsetY={3}
            />
          ) : node.shape === 'rect' ? (
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
              text={iconEmoji(node.icon)}
              fontSize={emojiSize}
              fill="#fff"
              align="center"
              width={node.shape === 'rect' ? w : r * 2}
              x={node.shape === 'rect' ? -w / 2 : -r}
              y={node.shape === 'rect' ? -emojiSize * 0.62 : -r * 0.62}
              listening={false}
            />
          )}
        </Group>
        {/* 标签不随旋转，保持可读 */}
        <Text text={label} fontSize={13} fontStyle="bold" fill="#23211e" offsetX={label.length * 6.5} y={bottom + 8} listening={false} />
        {linkedTitle && (
          <Text text={linkedTitle} fontSize={11} fill="#8a8070" offsetX={linkedTitle.length * 5.5} y={bottom + 24} listening={false} />
        )}
      </Group>
    );
  };

  /** 渲染单条连线：Arrow（可选弧线/箭头）+ 中点 label */
  const renderConn = (conn: MapConnection): JSX.Element | null => {
    const a = nodeById.get(conn.fromNodeId);
    const b = nodeById.get(conn.toNodeId);
    if (!a || !b) return null;
    const selected = selectedConnId === conn.id;
    const color = conn.color ?? '#8a8070';
    const width = conn.width ?? 2;
    const mx = (a.x + b.x) / 2;
    const my = (a.y + b.y) / 2;
    const curve = conn.lineType === 'curve';
    let points = [a.x, a.y, b.x, b.y];
    let labelX = mx;
    let labelY = my;
    if (curve) {
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const sag = len * 0.18;
      const cx = mx + (-dy / len) * sag;
      const cy = my + (dx / len) * sag;
      points = [a.x, a.y, cx, cy, b.x, b.y];
      labelX = 0.25 * a.x + 0.5 * cx + 0.25 * b.x;
      labelY = 0.25 * a.y + 0.5 * cy + 0.25 * b.y;
    }
    const boxW = Math.max(conn.label.length * 12 + 10, 30);
    const onClick = (e: any): void => {
      e.cancelBubble = true;
      handleConnClick(conn);
    };
    return (
      <Group key={conn.id}>
        <Arrow
          points={points}
          bezier={curve}
          stroke={selected ? '#7c3aed' : color}
          strokeWidth={selected ? width + 1.5 : width}
          lineCap="round"
          dash={conn.style === 'dashed' ? [10, 7] : undefined}
          fill={selected ? '#7c3aed' : color}
          pointerLength={conn.arrow ? 11 : 0}
          pointerWidth={conn.arrow ? 9 : 0}
          hitStrokeWidth={16}
          onClick={onClick}
        />
        <Group x={labelX} y={labelY} onClick={onClick}>
          <Rect
            x={-boxW / 2}
            y={-10}
            width={boxW}
            height={20}
            fill="#fff"
            opacity={0.92}
            cornerRadius={4}
            stroke={selected ? '#7c3aed' : '#d9d4ca'}
            strokeWidth={1}
          />
          <Text text={conn.label} x={-boxW / 2} y={-7} width={boxW} align="center" fontSize={12} fill="#524c44" />
        </Group>
      </Group>
    );
  };

  const zoomPct = Math.round(view.scale * 100);
  const hint = placeIcon
    ? `放置「${iconLabel(placeIcon)}」：点击画布放置（可连续），Esc 或右键停止`
    : TOOL_HINT[tool];
  const cursorClass =
    placeIcon || tool === 'region' || tool === 'connect' || paintMode
      ? 'cursor-crosshair'
      : tool === 'pan'
        ? 'cursor-grab'
        : tool === 'delete'
          ? 'cursor-pointer'
          : '';

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex h-[94vh] w-[min(1500px,97vw)] flex-col overflow-hidden rounded bg-white shadow-2xl">
        {/* 标题栏 + 顶部工具栏 */}
        <div className="flex items-center justify-between gap-2 border-b border-ink-200 px-4 py-1.5">
          <div className="flex min-w-0 items-center gap-3">
            <span className="text-sm font-semibold">地图编辑</span>
            {currentMap && (
              <span className="truncate text-xs text-ink-400">{dirty ? '有未保存修改' : saveStatus || '就绪'}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              title="撤销 (Ctrl+Z)"
              disabled={past.length === 0}
              className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100 disabled:opacity-40"
              onClick={undo}
            >
              ↶
            </button>
            <button
              type="button"
              title="重做 (Ctrl+Y)"
              disabled={future.length === 0}
              className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100 disabled:opacity-40"
              onClick={redo}
            >
              ↷
            </button>
            <div className="mx-1 flex items-center overflow-hidden rounded border border-ink-200">
              <button
                type="button"
                title="缩小"
                className="px-2 py-1 text-sm hover:bg-ink-100"
                onClick={() => zoomAtPoint(size.width / 2, size.height / 2, 1 / 1.2)}
              >
                −
              </button>
              <span className="w-12 text-center text-xs tabular-nums text-ink-500">{zoomPct}%</span>
              <button
                type="button"
                title="放大"
                className="px-2 py-1 text-sm hover:bg-ink-100"
                onClick={() => zoomAtPoint(size.width / 2, size.height / 2, 1.2)}
              >
                +
              </button>
              <button
                type="button"
                title="适应画布"
                className="border-l border-ink-200 px-2 py-1 text-xs hover:bg-ink-100"
                onClick={() => fitView(currentMap)}
              >
                适应
              </button>
            </div>
            <button
              type="button"
              className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100"
              onClick={() => void exportPng()}
              title="导出为 PNG 图片（2x）"
            >
              导出 PNG
            </button>
            <button
              type="button"
              className={`rounded border px-2 py-1 text-sm ${
                genOpen ? 'border-emerald-300 text-emerald-700' : 'border-ink-200 hover:bg-ink-100'
              }`}
              disabled={!currentMap}
              title="分形噪声随机生成瓦片地形（可撒聚居点）"
              onClick={() => setGenOpen((v) => !v)}
            >
              随机地形
            </button>
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
              className="rounded border border-violet-300 px-2 py-1 text-sm text-violet-700 hover:bg-violet-50"
              onClick={() => void save()}
            >
              保存
            </button>
            <button type="button" className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100" onClick={onClose} title="关闭">
              ×
            </button>
          </div>
        </div>

        {/* 主体三栏 */}
        <div className="relative flex min-h-0 flex-1">
          {/* 左侧栏 */}
          <aside className="flex w-60 shrink-0 flex-col overflow-y-auto border-r border-ink-200">
            {/* 地图列表 */}
            <div className="px-3 pb-1 pt-2.5 text-sm font-medium">地图</div>
            <div className="max-h-32 overflow-y-auto px-2">
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
              <button type="button" className="rounded border border-ink-200 px-2 py-0.5 text-xs hover:bg-ink-100" onClick={() => void handleCreate()}>
                新建
              </button>
              <button
                type="button"
                className="rounded border border-ink-200 px-2 py-0.5 text-xs hover:bg-ink-100 disabled:opacity-50"
                disabled={!currentMap}
                onClick={() => setRenameDraft(currentMap?.name ?? '')}
              >
                重命名
              </button>
              <button
                type="button"
                className="rounded border border-ink-200 px-2 py-0.5 text-xs hover:bg-ink-100 disabled:opacity-50"
                disabled={!currentMap}
                onClick={() => void handleDuplicate()}
              >
                复制
              </button>
              <button
                type="button"
                className="rounded border border-red-200 px-2 py-0.5 text-xs text-red-600 hover:bg-red-50 disabled:opacity-50"
                disabled={!currentMap}
                onClick={() => void handleDeleteMap()}
              >
                删除
              </button>
            </div>

            {/* 工具按钮组 */}
            <div className="px-3 pb-1 pt-2.5 text-sm font-medium">工具</div>
            <div className="grid grid-cols-3 gap-1 px-2">
              {TOOLS.map((t) => (
                <button
                  key={t.value}
                  type="button"
                  title={t.hint}
                  className={`rounded border px-1 py-1 text-xs ${
                    tool === t.value && !placeIcon
                      ? 'border-violet-300 bg-violet-50 text-violet-700'
                      : 'border-ink-200 hover:bg-ink-100'
                  }`}
                  onClick={() => {
                    setTool(t.value);
                    setPlaceIcon(null);
                    clearSel();
                  }}
                >
                  {t.label}
                </button>
              ))}
            </div>

            {/* 瓦片地形：笔刷大小 + 地形选择 */}
            <div className="mt-3 border-t border-ink-200 px-3 pb-1 pt-2.5 text-sm font-medium">地形</div>
            <div className="flex items-center gap-1 px-2 pb-1.5 text-xs text-ink-500">
              <span className="shrink-0">笔刷</span>
              {[1, 2, 3].map((s) => (
                <button
                  key={s}
                  type="button"
                  title={`笔刷大小 ${s}（覆盖半径 ${s - 1} 格）`}
                  className={`rounded border px-2 py-0.5 ${
                    brushSize === s ? 'border-violet-300 bg-violet-50 text-violet-700' : 'border-ink-200 hover:bg-ink-100'
                  }`}
                  onClick={() => setBrushSize(s)}
                >
                  {s}
                </button>
              ))}
              <span className="ml-auto shrink-0" title={terrainDef(terrainBrush)?.label ?? terrainBrush}>
                当前：{terrainDef(terrainBrush)?.emoji ?? '⬜'} {terrainDef(terrainBrush)?.label ?? terrainBrush}
              </span>
            </div>
            <div className="px-2 pb-2">
              <TerrainPanel selected={terrainBrush} onSelect={setTerrainBrush} />
            </div>

            {/* 元件库 */}
            <div className="mt-3 flex items-center justify-between border-t border-ink-200 px-3 pb-1 pt-2.5">
              <span className="text-sm font-medium">元件库</span>
              {placeIcon && (
                <button type="button" className="text-xs text-violet-600 hover:underline" onClick={() => setPlaceIcon(null)}>
                  停止放置
                </button>
              )}
            </div>
            <div className="px-2 pb-2">
              <IconLibraryPanel
                selected={placeIcon}
                onSelect={(id) => {
                  setPlaceIcon((prev) => (prev === id ? null : id));
                  setTool('select');
                  setSelectedNodeId(null);
                  setSelectedConnId(null);
                }}
              />
            </div>

            {/* 图层显隐 */}
            <div className="mt-auto border-t border-ink-200 px-3 pb-1 pt-2.5 text-sm font-medium">图层</div>
            <div className="grid grid-cols-2 gap-1 px-2 pb-3">
              {LAYER_LABELS.map((l) => (
                <button
                  key={l.key}
                  type="button"
                  className={`rounded border px-1 py-1 text-xs ${
                    layers[l.key] ? 'border-ink-200 text-ink-600' : 'border-ink-200 bg-ink-100 text-ink-400'
                  }`}
                  onClick={() => setLayers((v) => ({ ...v, [l.key]: !v[l.key] }))}
                >
                  {layers[l.key] ? '👁 ' : '🚫 '}
                  {l.label}
                </button>
              ))}
            </div>
          </aside>

          {/* 画布区 */}
          <div
            ref={containerRef}
            className={`relative min-w-0 flex-1 overflow-hidden bg-ink-100 ${cursorClass}`}
          >
            {currentMap && size.width > 0 && (
              <Stage
                ref={stageRef}
                width={size.width}
                height={size.height}
                scaleX={view.scale}
                scaleY={view.scale}
                x={view.x}
                y={view.y}
                draggable={tool === 'pan'}
                onDragEnd={(e: any): void => {
                  if (e.target === stageRef.current) {
                    setView((v) => ({ ...v, x: Math.round(e.target.x()), y: Math.round(e.target.y()) }));
                  }
                }}
                onWheel={onWheel}
                onMouseDown={handleStageMouseDownPaint}
                onMouseMove={handleStageMouseMovePaint}
                onClick={handleStageClick}
                onTap={handleStageClick}
                onDblClick={handleStageDblClick}
                onContextMenu={handleStageContextMenu}
              >
                <Layer>
                  {/* 画布底 + 边界 + 网格 */}
                  <Rect
                    x={0.5}
                    y={0.5}
                    width={Math.max(currentMap.width - 1, 1)}
                    height={Math.max(currentMap.height - 1, 1)}
                    fill="#fdfcf8"
                    stroke="#c9c2b4"
                    strokeWidth={1}
                    dash={[6, 6]}
                    listening={false}
                  />
                  {gridLines.map((g, i) => (
                    <Line key={i} points={g.points} stroke="#ece7dc" strokeWidth={1} listening={false} />
                  ))}
                  {/* 底图层 */}
                  {layers.bg && bgImage && (
                    <Image
                      image={bgImage}
                      x={bg.x}
                      y={bg.y}
                      scaleX={bg.scale}
                      scaleY={bg.scale}
                      opacity={0.92}
                      draggable={tool === 'select' && !bg.locked}
                      onDragEnd={(e: any): void => {
                        patchMap({
                          bg: { ...bg, x: Math.round(e.target.x()), y: Math.round(e.target.y()) }
                        });
                      }}
                    />
                  )}
                  {/* 瓦片地形层：离屏 canvas 单张 Image（绘制工具在 Stage 事件直接作画） */}
                  {layers.tile && tileCanvas && currentMap.tiles && (
                    <Image image={tileCanvas} x={0} y={0} listening={false} />
                  )}
                  {/* 连线在下、节点在上（涂抹工具时让位） */}
                  {layers.conn && <Group listening={!paintMode}>{currentMap.connections.map(renderConn)}</Group>}
                  {layers.region && (
                    <Group listening={!paintMode}>
                      {sortedNodes.filter((n) => n.type === 'region').map(renderNode)}
                    </Group>
                  )}
                  {layers.node && (
                    <Group listening={!paintMode}>
                      {sortedNodes.filter((n) => n.type === 'location').map(renderNode)}
                    </Group>
                  )}
                  {layers.marker && (
                    <Group listening={!paintMode}>
                      {sortedNodes.filter((n) => n.type === 'marker').map(renderNode)}
                    </Group>
                  )}
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
            <div className="pointer-events-none absolute bottom-2 left-2 rounded bg-white/90 px-2 py-1 text-xs text-ink-500 shadow-sm">
              {hint}
            </div>
          </div>

          {/* 右侧属性面板 */}
          {currentMap && (
            <MapInspector
              map={currentMap}
              entries={entries}
              node={selNode}
              conn={selConn}
              onPatchMap={patchMap}
              onPatchNode={(id, patch) => patchNode(id, patch, true)}
              onPatchConn={(id, patch) => patchConn(id, patch, true)}
              onRemoveNode={removeNode}
              onRemoveConn={removeConn}
              onDuplicateNode={duplicateNode}
              onZIndex={zIndexOp}
              onUploadBg={() => void uploadBg()}
              onRemoveBg={removeBg}
              onResetBg={resetBg}
            />
          )}

          {/* 节点右键菜单 */}
          {ctxMenu && (
            <div
              className="fixed z-[60] w-36 rounded border border-ink-200 bg-white py-1 text-sm shadow-lg"
              style={{ left: ctxMenu.x, top: ctxMenu.y }}
              onPointerDown={(e) => e.stopPropagation()}
            >
              {[
                { label: '复制', action: (): void => duplicateNode(ctxMenu.nodeId) },
                { label: '置顶', action: (): void => zIndexOp(ctxMenu.nodeId, 'top') },
                { label: '置底', action: (): void => zIndexOp(ctxMenu.nodeId, 'bottom') },
                { label: '删除', action: (): void => removeNode(ctxMenu.nodeId) }
              ].map((item) => (
                <button
                  key={item.label}
                  type="button"
                  className={`block w-full px-3 py-1 text-left hover:bg-ink-100 ${
                    item.label === '删除' ? 'text-red-600' : ''
                  }`}
                  onClick={item.action}
                >
                  {item.label}
                </button>
              ))}
            </div>
          )}

          {/* AI 生成浮层 */}
          {aiOpen && aiGenerateMap && (
            <div className="absolute right-64 top-4 z-10 w-96 rounded border border-ink-200 bg-white p-3 shadow-lg">
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
          {/* 随机地形生成浮层 */}
          {genOpen && currentMap && (
            <div className="absolute right-64 top-4 z-10 w-80 rounded border border-ink-200 bg-white p-3 shadow-lg">
              <div className="mb-2 text-sm font-medium">随机生成地形</div>
              <label className="block text-xs text-ink-500">
                海平面 {Math.round(genSea * 100)}%（越高水域越多）
                <input
                  type="range"
                  min={0.25}
                  max={0.6}
                  step={0.01}
                  value={genSea}
                  className="mt-0.5 w-full accent-emerald-600"
                  onChange={(e) => setGenSea(Number(e.target.value))}
                />
              </label>
              <label className="mt-2 block text-xs text-ink-500">
                起伏度 {genRough.toFixed(1)}（越大地形越破碎）
                <input
                  type="range"
                  min={0.5}
                  max={1.5}
                  step={0.1}
                  value={genRough}
                  className="mt-0.5 w-full accent-emerald-600"
                  onChange={(e) => setGenRough(Number(e.target.value))}
                />
              </label>
              <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-600">
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={genIsland}
                    onChange={(e) => setGenIsland(e.target.checked)}
                    className="accent-emerald-600"
                  />
                  岛屿（边缘为海）
                </label>
                <label className="flex items-center gap-1">
                  <input
                    type="checkbox"
                    checked={genScatter}
                    onChange={(e) => setGenScatter(e.target.checked)}
                    className="accent-emerald-600"
                  />
                  聚居点撒点
                </label>
                {genScatter && (
                  <label className="flex items-center gap-1">
                    数量
                    <input
                      type="number"
                      min={1}
                      max={20}
                      value={genCount}
                      className="w-14 rounded border border-ink-200 px-1 py-0.5 text-xs outline-none focus:border-emerald-400"
                      onChange={(e) => setGenCount(clamp(Number(e.target.value) || 1, 1, 20))}
                    />
                  </label>
                )}
              </div>
              <div className="mt-3 flex justify-between gap-2">
                <button
                  type="button"
                  className="rounded border border-red-200 px-2 py-1 text-sm text-red-600 hover:bg-red-50 disabled:opacity-50"
                  disabled={!currentMap.tiles}
                  onClick={clearTiles}
                >
                  清空地形
                </button>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100"
                    onClick={() => setGenOpen(false)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="rounded border border-emerald-300 px-2 py-1 text-sm text-emerald-700 hover:bg-emerald-50"
                    onClick={runTerrainGen}
                  >
                    生成
                  </button>
                </div>
              </div>
              <div className="mt-2 text-[11px] leading-relaxed text-ink-400">
                生成会覆盖现有瓦片地形（可撤销）；聚居点作为地点节点追加，撒点后可再手工微调。
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** 元件库面板：分类 chips + emoji 网格（点击进入/退出放置模式） */
function IconLibraryPanel(props: { selected: string | null; onSelect: (id: string) => void }): JSX.Element {
  const [cat, setCat] = useState<string>(() => {
    if (!props.selected) return 'terrain';
    return (ICON_LIBRARY.find((c) => c.icons.some((i) => i.id === props.selected)) ?? ICON_LIBRARY[0]).key;
  });
  const current = ICON_LIBRARY.find((c) => c.key === cat) ?? ICON_LIBRARY[0];
  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {ICON_LIBRARY.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`rounded px-1.5 py-0.5 text-xs ${
              c.key === cat ? 'bg-violet-50 text-violet-700' : 'text-ink-500 hover:bg-ink-100'
            }`}
            onClick={() => setCat(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-6 gap-1">
        {current.icons.map((i) => (
          <button
            key={i.id}
            type="button"
            title={`${i.label}（点击后到画布放置）`}
            className={`flex h-8 items-center justify-center rounded border text-lg leading-none ${
              props.selected === i.id
                ? 'border-violet-400 bg-violet-50 ring-1 ring-violet-300'
                : 'border-ink-200 hover:bg-ink-100'
            }`}
            onClick={() => props.onSelect(i.id)}
          >
            {i.emoji}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs leading-4 text-ink-400">
        点击图标后在画布连续放置；按住风格统一可选多个同类。Esc 停止。
      </p>
    </div>
  );
}

/** 地形面板：分类 chips + 地形色块网格（选中即设为笔刷地形） */
function TerrainPanel(props: { selected: string; onSelect: (id: string) => void }): JSX.Element {
  const [cat, setCat] = useState<string>(() => {
    const hit = TERRAIN_LIBRARY.find((c) => c.terrains.some((t) => t.id === props.selected));
    return (hit ?? TERRAIN_LIBRARY[0]).key;
  });
  const current = TERRAIN_LIBRARY.find((c) => c.key === cat) ?? TERRAIN_LIBRARY[0];
  return (
    <div>
      <div className="flex flex-wrap gap-1">
        {TERRAIN_LIBRARY.map((c) => (
          <button
            key={c.key}
            type="button"
            className={`rounded px-1.5 py-0.5 text-xs ${
              c.key === cat ? 'bg-emerald-50 text-emerald-700' : 'text-ink-500 hover:bg-ink-100'
            }`}
            onClick={() => setCat(c.key)}
          >
            {c.label}
          </button>
        ))}
      </div>
      <div className="mt-1.5 grid grid-cols-6 gap-1">
        {current.terrains.map((t) => (
          <button
            key={t.id}
            type="button"
            title={`${t.label}（设为笔刷地形）`}
            className={`flex h-8 items-center justify-center rounded border text-base leading-none ${
              props.selected === t.id ? 'border-emerald-500 ring-1 ring-emerald-300' : 'border-ink-200 hover:bg-ink-100'
            }`}
            style={{ backgroundColor: t.color }}
            onClick={() => props.onSelect(t.id)}
          >
            {t.emoji}
          </button>
        ))}
      </div>
      <p className="mt-1.5 text-xs leading-4 text-ink-400">
        选地形后用笔刷（B）涂抹；橡皮（E）擦除、油漆桶连通填充、吸管取地形。
      </p>
    </div>
  );
}
