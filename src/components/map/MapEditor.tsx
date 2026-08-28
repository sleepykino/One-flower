/**
 * 地图编辑器（P4.1 重设计，参考「易制地图」）
 * - 顶部：撤销/重做、缩放、自动布局、预设生成、AI 生成、导出 PNG（透明/倍率）、插入正文、保存
 * - 左侧：地图列表 / 工具 / 地形（笔刷目标层 + 仅覆盖已有地形 + 自定义纹理）/ 元件库 / 素材库 / 瓦片图层管理
 * - 画布：多层瓦片（离屏 canvas 按层堆叠）、贴图素材节点（imageCache + HSV）、
 *   连线折线拐点（Shift 追加 + 手柄拖动）、marker 文字样式（描边/竖排）、节点 Ctrl+C/V
 * - 右侧：MapInspector 属性面板
 * 历史栈快照 { nodes, connections, tileLayers }（地图元信息不参与撤销），上限 50 步
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import Konva from 'konva';
import { Stage, Layer, Group, Circle, Rect, Line, Arrow, Text, Image } from 'react-konva';
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { getAppContext } from '../../context/app-context';
import { confirmDialog } from '../../native/dialog';
import { toast } from '../common/toast';
import { useEditorStore } from '../../store/editorStore';
import { MapEditorService } from '../../services/map/MapEditorService';
import { MapAssetService, type MapAsset } from '../../services/map/MapAssetService';
import {
  ICON_LIBRARY,
  TERRAIN_LIBRARY,
  TILE_SIZE,
  createEmptyTiles,
  iconEmoji,
  iconLabel,
  type LayerVisibility,
  type MapBackgroundTransform,
  type MapConnection,
  type MapNode,
  type MapTileLayer,
  type MapTiles,
  type NovelMap
} from '../../services/map/types';
import type { ScatterSite } from '../../services/map/terrainGen';
import { floodFillTiles } from '../../services/map/floodFill';
import { drawTileCell, renderTilesToCanvas } from '../../services/map/tileRender';
import { autoLayoutNodes } from '../../services/map/autoLayout';
import { getCachedImage, loadAssetImage } from './imageCache';
import { parseLooseJson } from '../../utils/looseJson';
import { MapInspector } from './MapInspector';
import { MapAssetPanel } from './MapAssetPanel';
import { MapToolbar } from './MapToolbar';
import { MapLayerPanel } from './MapLayerPanel';
import { MapGenDialog, type GenResult } from './MapGenDialog';
import { resolveImageProvider } from '../../services/ai/providers/ImageProvider';

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
  { value: 'brush', label: '笔刷', hint: '笔刷（B）：涂抹地形瓦片到当前激活层，左侧选地形与笔刷大小' },
  { value: 'eraser', label: '橡皮', hint: '橡皮（E）：擦除当前激活层的地形瓦片' },
  { value: 'fill', label: '填充', hint: '填充：同地形的连通区域整体替换为当前地形（激活层）' },
  { value: 'picker', label: '吸管', hint: '吸管：取可见最顶层瓦片地形为当前笔刷，并自动切回笔刷' },
  { value: 'connect', label: '连线', hint: '连线：依次点击两个地点节点；Shift+点击画布追加折线拐点' },
  { value: 'region', label: '区域', hint: '区域：依次点击添加顶点，双击闭合生成区域，Esc 取消' },
  { value: 'delete', label: '删除', hint: '删除：点击节点或连线删除' }
];

const TOOL_HINT: Record<Tool, string> = Object.fromEntries(TOOLS.map((t) => [t.value, t.hint])) as Record<Tool, string>;

/** 瓦片绘制类工具（笔刷/橡皮/填充/吸管）：画布元素让位，直接操作地形层 */
function isPaintTool(t: Tool): boolean {
  return t === 'brush' || t === 'eraser' || t === 'fill' || t === 'picker';
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
 * 解析 AI 返回内容（容错：公共实现 parseLooseJson，剥 think 段/围栏/杂文/注释）：
 * nodes / connections 任一存在即视为有效（只返回其一不算失败）
 */
function parseAiContent(raw: string): { nodes: MapNode[]; connections: MapConnection[] } | null {
  const parsed = parseLooseJson<{ nodes?: MapNode[]; connections?: MapConnection[] }>(raw);
  if (!parsed) return null;
  const nodes = Array.isArray(parsed.nodes) ? parsed.nodes : [];
  const connections = Array.isArray(parsed.connections) ? parsed.connections : [];
  if (nodes.length === 0 && connections.length === 0) return null;
  return { nodes, connections };
}

/** 右键菜单状态（屏幕坐标） */
interface CtxMenu {
  x: number;
  y: number;
  nodeId: string;
}

/** 贴图素材的 HSV 滤镜判定（全部默认值时不启用滤镜，省 cache 开销） */
function hasHsv(node: MapNode): boolean {
  return (
    (node.hueShift !== undefined && node.hueShift !== 0) ||
    (node.saturation !== undefined && node.saturation !== 1) ||
    (node.brightness !== undefined && node.brightness !== 1)
  );
}

export function MapEditor({ bookId, onClose, aiGenerateMap }: MapEditorProps): JSX.Element {
  const svc = useMemo(() => new MapEditorService(getAppContext().db, getAppContext().wq), []);
  const assetSvc = useMemo(() => new MapAssetService(getAppContext().bridge), []);

  const [maps, setMaps] = useState<NovelMap[]>([]);
  const [currentMap, setCurrentMap] = useState<NovelMap | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saveStatus, setSaveStatus] = useState('');
  /** 最新地图/脏标记引用：供关闭/卸载/快捷键等异步路径读取，避免闭包捕获过期状态 */
  const currentMapRef = useRef<NovelMap | null>(currentMap);
  currentMapRef.current = currentMap;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;
  /** 保存进行中标记：防止工具栏「保存」/Ctrl+S/关闭 flush 并发重复写 */
  const savingRef = useRef(false);

  const [tool, setTool] = useState<Tool>('select');
  /** 连续放置：内置图标 id 或 'asset:{素材id}'，null 表示未在放置 */
  const [placeIcon, setPlaceIcon] = useState<string | null>(null);
  /** 瓦片地形笔刷：地形 id（内置或 'asset:tile:{id}'）与大小档位（1/2/3 -> 半径 0/1/2 格） */
  const [terrainBrush, setTerrainBrush] = useState('grass');
  const [brushSize, setBrushSize] = useState(1);
  /** P4.1：仅覆盖已有地形（笔刷限制在已有瓦片范围内，用于陆地刷植被等覆盖纹理） */
  const [brushMask, setBrushMask] = useState(false);
  /** 预设生成向导（P4.1-M3） */
  const [genOpen, setGenOpen] = useState(false);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [selectedConnId, setSelectedConnId] = useState<string | null>(null);
  const [connectFrom, setConnectFrom] = useState<string | null>(null);
  /** 连线绘制中的拐点（Shift+点击追加，创建连线时附着） */
  const [connectWaypoints, setConnectWaypoints] = useState<Array<{ x: number; y: number }>>([]);
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
  /** AI 生成底图（P4.1-M5） */
  const [aiBgOpen, setAiBgOpen] = useState(false);
  const [aiBgPrompt, setAiBgPrompt] = useState('');
  const [aiBgBusy, setAiBgBusy] = useState(false);
  /** 左右工具面板折叠（画布顶部按钮切换） */
  const [leftOpen, setLeftOpen] = useState(true);
  const [rightOpen, setRightOpen] = useState(true);
  const [aiPrompt, setAiPrompt] = useState('');
  const [aiGenerating, setAiGenerating] = useState(false);
  const [bgImage, setBgImage] = useState<HTMLImageElement | null>(null);
  const bgUrlRef = useRef<string | null>(null);

  /** 各瓦片层离屏 canvas（数组序 = 层序；涂抹期间增量重绘对应层） */
  const [tileCanvases, setTileCanvases] = useState<HTMLCanvasElement[]>([]);
  const tileCtxsRef = useRef<Array<CanvasRenderingContext2D | null>>([]);
  /** 涂抹进行中：在激活层瓦片副本上作画 + canvas 增量重绘，抬笔才写回 state（历史仅记一步） */
  const paintingRef = useRef(false);
  const strokeLayerIdxRef = useRef(0);
  const strokeTilesRef = useRef<MapTiles | null>(null);
  const strokeMaskRef = useRef<Uint8Array | null>(null);
  const lastCellRef = useRef(-1);

  /** 素材库（贴图 + 瓦片纹理）与加载状态 */
  const [assetsById, setAssetsById] = useState<Map<string, MapAsset>>(new Map());
  const [imgTick, setImgTick] = useState(0);
  /** 节点剪贴板（Ctrl+C/V） */
  const clipboardRef = useRef<MapNode | null>(null);
  /** 导出选项 */
  const [exportTransparent, setExportTransparent] = useState(false);
  const [exportScale, setExportScale] = useState(2);
  /** 导出/插入进行中：临时隐藏选区装饰 */
  const [capturing, setCapturing] = useState(false);

  // 画布尺寸：容器 div offsetWidth/Height，ResizeObserver 跟随
  const containerRef = useRef<HTMLDivElement>(null);
  const stageRef = useRef<any>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  // 拖拽后 Konva 仍会触发 click，用标记吞掉拖拽结束后的那次点击
  const draggedRef = useRef(false);
  // StrictMode 双执行防护：避免重复自动建图
  const bootedRef = useRef(false);
  // 每张地图首次进入自动「适应画布」一次
  const fittedForRef = useRef<string | null>(null);

  /** 激活瓦片层索引（容错 clamp 到有效范围） */
  const activeLayerIdx = currentMap
    ? clamp(currentMap.activeTileLayer ?? 0, 0, Math.max(0, currentMap.tileLayers.length - 1))
    : 0;

  /** 初始化：拉取地图列表（为空则自动建一张）+ 素材库（含内置包 + 预载贴图） */
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
      try {
        await reloadAssets();
      } catch (e) {
        // 素材库初始化失败不阻塞编辑器（如迁移缺失时仅记录）
        console.warn('[Map] 素材库加载失败:', e);
      }
    })();
  }, [bookId, svc]);

  /** 素材加载：入库内置包 + 解析 URL + 预载进 imageCache（完成后 bump tick 触发重渲染） */
  const reloadAssets = async (): Promise<void> => {
    await assetSvc.ensureBuiltin();
    const list = await assetSvc.list();
    const map = new Map<string, MapAsset>(list.map((a): [string, MapAsset] => [a.id, a]));
    setAssetsById(map);
    let changed = false;
    for (const a of list) {
      if (getCachedImage(a.id)) continue;
      try {
        const url = await assetSvc.resolveUrl(a.id);
        if (url) {
          void loadAssetImage(a.id, url).then((img) => {
            if (img) setImgTick((t) => t + 1);
          });
          changed = true;
        }
      } catch {
        /* 单个素材失败跳过 */
      }
    }
    if (changed) setImgTick((t) => t + 1);
  };

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

  /** 瓦片层 -> 离屏 canvas 数组：tileLayers 引用或贴图加载完成时全量重绘 */
  useEffect(() => {
    const tls = currentMap?.tileLayers ?? [];
    if (tls.length === 0) {
      setTileCanvases([]);
      tileCtxsRef.current = [];
      return;
    }
    const canvases = tls.map((l) => renderTilesToCanvas(l.tiles));
    tileCtxsRef.current = canvases.map((c) => c.getContext('2d'));
    setTileCanvases(canvases);
  }, [currentMap?.tileLayers, imgTick]);

  /** 瓦片层最大范围（适应画布用） */
  const tileExtent = useMemo(() => {
    const tls = currentMap?.tileLayers ?? [];
    let w = 0;
    let h = 0;
    for (const l of tls) {
      w = Math.max(w, l.tiles.cols * l.tiles.size);
      h = Math.max(h, l.tiles.rows * l.tiles.size);
    }
    return { w, h };
  }, [currentMap?.tileLayers]);

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
    const w = Math.max(map.width, tileExtent.w);
    const h = Math.max(map.height, tileExtent.h);
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
    JSON.stringify({ nodes: m.nodes, connections: m.connections, tileLayers: m.tileLayers });

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

  /** 地图元信息（名称/尺寸/底图/图层显隐/激活层等）不参与撤销 */
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
    setConnectWaypoints([]);
    setDraftPoints([]);
    setCtxMenu(null);
  };

  const applySnap = (raw: string): void => {
    if (!currentMap) return;
    const parsed = JSON.parse(raw) as {
      nodes?: MapNode[];
      connections?: MapConnection[];
      tileLayers?: MapTileLayer[];
    };
    setCurrentMap({
      ...currentMap,
      nodes: parsed.nodes ?? [],
      connections: parsed.connections ?? [],
      tileLayers: parsed.tileLayers ?? []
    });
  };

  const undo = (): void => {
    if (past.length === 0 || !currentMap) return;
    const prev = past[past.length - 1];
    setPast((p) => p.slice(0, -1));
    setFuture((f) => [snap(currentMap), ...f].slice(0, HISTORY_LIMIT));
    applySnap(prev);
    lastPushAt.current = 0;
    setDirty(true);
    clearSel();
  };

  const redo = (): void => {
    if (future.length === 0 || !currentMap) return;
    const next = future[0];
    setFuture((f) => f.slice(1));
    setPast((p) => [...p.slice(-(HISTORY_LIMIT - 1)), snap(currentMap)]);
    applySnap(next);
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

  // ---------- 瓦片图层操作（P4.1-M2） ----------

  const layerDims = (): { cols: number; rows: number } => {
    if (!currentMap) return { cols: 50, rows: 32 };
    return {
      cols: Math.max(8, Math.ceil(currentMap.width / TILE_SIZE)),
      rows: Math.max(8, Math.ceil(currentMap.height / TILE_SIZE))
    };
  };

  const addTileLayer = (): void => {
    if (!currentMap) return;
    const { cols, rows } = layerDims();
    const layer: MapTileLayer = {
      id: crypto.randomUUID(),
      name: `图层 ${currentMap.tileLayers.length + 1}`,
      visible: true,
      tiles: createEmptyTiles(cols, rows)
    };
    mutate((m) => ({
      ...m,
      tileLayers: [...m.tileLayers, layer],
      activeTileLayer: m.tileLayers.length
    }));
  };

  const removeTileLayer = (idx: number): void => {
    if (!currentMap) return;
    void (async () => {
      if (currentMap.tileLayers.length <= 1) {
        if (!(await confirmDialog('删除唯一的瓦片图层？'))) return;
      }
      mutate((m) => {
        const next = m.tileLayers.filter((_, i) => i !== idx);
        return { ...m, tileLayers: next, activeTileLayer: clamp(m.activeTileLayer, 0, Math.max(0, next.length - 1)) };
      });
    })();
  };

  const moveTileLayer = (idx: number, dir: -1 | 1): void => {
    if (!currentMap) return;
    const to = idx + dir;
    if (to < 0 || to >= currentMap.tileLayers.length) return;
    mutate((m) => {
      const next = [...m.tileLayers];
      [next[idx], next[to]] = [next[to], next[idx]];
      return { ...m, tileLayers: next, activeTileLayer: to };
    });
  };

  const renameTileLayer = (idx: number, name: string): void => {
    if (!currentMap) return;
    mutate((m) => ({
      ...m,
      tileLayers: m.tileLayers.map((l, i) => (i === idx ? { ...l, name } : l))
    }));
  };

  const toggleTileLayerVisible = (idx: number): void => {
    if (!currentMap) return;
    patchMap({
      tileLayers: currentMap.tileLayers.map((l, i) => (i === idx ? { ...l, visible: !l.visible } : l))
    });
  };

  const setActiveTileLayer = (idx: number): void => {
    patchMap({ activeTileLayer: idx });
  };

  // ---------- 地图列表操作 ----------

  const syncMapInList = (map: NovelMap): void => {
    setMaps((prev) => prev.map((m) => (m.id === map.id ? { ...map } : m)));
  };

  /** 保存当前地图：读 ref 最新值（工具栏「保存」/Ctrl+S/关闭 flush 共用，savingRef 防并发） */
  const save = async (): Promise<void> => {
    const m = currentMapRef.current;
    if (!m || savingRef.current) return;
    savingRef.current = true;
    try {
      await svc.saveMap(m);
      syncMapInList(m);
      dirtyRef.current = false;
      setDirty(false);
      setSaveStatus(`已保存 ${new Date().toLocaleTimeString('zh-CN', { hour12: false })}`);
    } finally {
      savingRef.current = false;
    }
  };

  /** 有未保存修改时先保存（关闭/卸载 flush，读 ref 避免闭包过期） */
  const flushIfDirty = async (): Promise<void> => {
    if (dirtyRef.current && currentMapRef.current) await save();
  };

  /** 关闭入口：先 flush 未保存修改再关闭，保存失败不关闭（防静默丢数据） */
  const handleClose = async (): Promise<void> => {
    try {
      await flushIfDirty();
    } catch (e) {
      void toast.error(`保存失败，未关闭：${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    onClose();
  };

  const switchMap = async (id: string): Promise<void> => {
    if (!currentMap || currentMap.id === id) return;
    try {
      if (dirty) {
        await svc.saveMap(currentMap);
        syncMapInList(currentMap);
      }
      const next = await svc.getMap(id);
      if (!next) throw new Error('地图不存在');
      setCurrentMap(next);
      setDirty(false);
      setRenameDraft(null);
      setPast([]);
      setFuture([]);
      clearSel();
    } catch (e) {
      void toast.error(`切换地图失败：${e instanceof Error ? e.message : String(e)}`);
    }
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

  /** 放置目标名称（内置图标或素材名） */
  const placeLabel = (icon: string): string => {
    if (icon.startsWith('asset:')) {
      return assetsById.get(icon.slice('asset:'.length))?.name ?? '素材';
    }
    return iconLabel(icon);
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
    // 连续放置模式（元件库/素材库）
    if (placeIcon) {
      addNode(
        {
          type: 'location',
          label: placeLabel(placeIcon),
          shape: 'icon',
          icon: placeIcon,
          radius: placeIcon.startsWith('asset:') ? 30 : 24,
          color: '#7c3aed'
        },
        toCanvasPos(pos)
      );
      return;
    }
    const p = toCanvasPos(pos);
    if (tool === 'connect') {
      // Shift+点击：追加折线拐点；普通点击空白：取消本次连线
      if (e.evt?.shiftKey && connectFrom) {
        setConnectWaypoints((wps) => [...wps, { x: Math.round(p.x), y: Math.round(p.y) }]);
      } else {
        setConnectFrom(null);
        setConnectWaypoints([]);
      }
    } else if (tool === 'region') {
      setDraftPoints((pts) => [...pts, Math.round(p.x), Math.round(p.y)]);
    } else if (tool === 'select' || tool === 'delete') {
      setSelectedNodeId(null);
      setSelectedConnId(null);
      setConnectFrom(null);
      setConnectWaypoints([]);
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
        setConnectWaypoints([]);
      } else if (connectFrom !== node.id) {
        const conn: MapConnection = {
          id: crypto.randomUUID(),
          fromNodeId: connectFrom,
          toNodeId: node.id,
          label: '道路',
          style: 'solid',
          lineType: 'curve',
          width: 2,
          arrow: false,
          waypoints: connectWaypoints.length > 0 ? connectWaypoints : undefined
        };
        mutate((m) => ({ ...m, connections: [...m.connections, conn] }));
        setConnectFrom(null);
        setConnectWaypoints([]);
        setSelectedConnId(conn.id);
        setSelectedNodeId(null);
      } else {
        setConnectFrom(null);
        setConnectWaypoints([]);
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

  // ---------- 瓦片涂抹（笔刷/橡皮/填充/吸管，目标 = 激活层） ----------

  const paintMode = isPaintTool(tool);

  /** 画布坐标 -> 瓦片一维索引；越界返回 -1 */
  function tileCellAt(px: number, py: number, tiles: MapTiles): number {
    const col = Math.floor(px / tiles.size);
    const row = Math.floor(py / tiles.size);
    if (col < 0 || col >= tiles.cols || row < 0 || row >= tiles.rows) return -1;
    return row * tiles.cols + col;
  }

  /** 构造「仅覆盖已有地形」掩码：激活层自身或其下任意层非空的格 */
  function buildMask(layerIdx: number, tiles: MapTiles): Uint8Array | null {
    if (!currentMap) return null;
    const mask = new Uint8Array(tiles.cols * tiles.rows);
    let any = 0;
    for (let i = 0; i <= layerIdx && i < currentMap.tileLayers.length; i++) {
      const src = currentMap.tileLayers[i].tiles;
      if (src.cols !== tiles.cols || src.rows !== tiles.rows) continue;
      for (let j = 0; j < mask.length; j++) {
        if (src.data[j] !== '') {
          mask[j] = 1;
          any = 1;
        }
      }
    }
    return any ? mask : mask.fill(1); // 全空层不限制（否则刷不出第一笔）
  }

  /** 以 (col,row) 为中心圆形盖章（brushSize 档位 1/2/3 -> 半径 0/1/2 格），同步增量重绘离屏 canvas */
  function stampBrush(tiles: MapTiles, col: number, row: number, value: string, ctx: CanvasRenderingContext2D | null, mask: Uint8Array | null): void {
    const radius = brushSize - 1;
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (dx * dx + dy * dy > radius * radius + 0.01) continue; // 圆形覆盖
        const c = col + dx;
        const r = row + dy;
        if (c < 0 || c >= tiles.cols || r < 0 || r >= tiles.rows) continue;
        const i = r * tiles.cols + c;
        if (mask && mask[i] === 0) continue; // 仅覆盖已有地形
        if (tiles.data[i] === value) continue;
        tiles.data[i] = value;
        if (ctx) drawTileCell(ctx, tiles, c, r, value);
      }
    }
    if (ctx) stageRef.current?.batchDraw();
  }

  /** 涂抹按下：吸管取色（可见最顶层）/ 油漆桶连通填充 / 笔刷橡皮开启一笔（副本作画，抬笔写回） */
  const handleStageMouseDownPaint = (e: any): void => {
    if (!paintMode || !currentMap) return;
    e.evt.preventDefault();
    const stage = stageRef.current;
    if (!stage) return;
    const pointer = stage.getPointerPosition();
    if (!pointer) return;
    const px = (pointer.x - view.x) / view.scale;
    const py = (pointer.y - view.y) / view.scale;

    // 激活层不存在：创建并落下第一笔（独立历史步，可撤销回无地形状态）
    if (currentMap.tileLayers.length === 0) {
      const { cols, rows } = layerDims();
      const fresh = createEmptyTiles(cols, rows);
      const idx = tileCellAt(px, py, fresh);
      if (idx < 0) return;
      const col = idx % fresh.cols;
      const row = (idx - col) / fresh.cols;
      stampBrush(fresh, col, row, tool === 'eraser' ? '' : terrainBrush, null, null);
      const layer: MapTileLayer = { id: crypto.randomUUID(), name: '地形', visible: true, tiles: fresh };
      mutate((m) => ({ ...m, tileLayers: [layer], activeTileLayer: 0 }));
      return;
    }

    const layerIdx = activeLayerIdx;

    // 吸管：从可见最顶层取地形
    if (tool === 'picker') {
      for (let i = currentMap.tileLayers.length - 1; i >= 0; i--) {
        const l = currentMap.tileLayers[i];
        if (!l.visible) continue;
        const idx = tileCellAt(px, py, l.tiles);
        if (idx >= 0 && l.tiles.data[idx] !== '') {
          setTerrainBrush(l.tiles.data[idx]);
          break;
        }
      }
      setTool('brush');
      return;
    }

    const tiles = currentMap.tileLayers[layerIdx].tiles;
    const idx = tileCellAt(px, py, tiles);
    if (idx < 0) return;
    const col = idx % tiles.cols;
    const row = (idx - col) / tiles.cols;

    if (tool === 'fill') {
      const next = floodFillTiles(tiles, col, row, terrainBrush);
      if (next !== tiles) mutate((m) => ({ ...m, tileLayers: m.tileLayers.map((l, i) => (i === layerIdx ? { ...l, tiles: next } : l)) }));
      return;
    }
    // brush / eraser：在激活层瓦片副本上作画，抬笔写回（历史仅记一步）
    paintingRef.current = true;
    strokeLayerIdxRef.current = layerIdx;
    lastCellRef.current = idx;
    const copy: MapTiles = { ...tiles, data: [...tiles.data] };
    strokeTilesRef.current = copy;
    strokeMaskRef.current = brushMask && tool === 'brush' ? buildMask(layerIdx, tiles) : null;
    stampBrush(copy, col, row, tool === 'eraser' ? '' : terrainBrush, tileCtxsRef.current[layerIdx] ?? null, strokeMaskRef.current);
  };

  /** 涂抹拖动：按格去重后连续盖章 */
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
    stampBrush(tiles, col, row, tool === 'eraser' ? '' : terrainBrush, tileCtxsRef.current[strokeLayerIdxRef.current] ?? null, strokeMaskRef.current);
  };

  /** 抬笔：把一笔的瓦片副本写回激活层（mutate 快照为落笔前状态，恰为一笔一步） */
  const endStroke = (): void => {
    if (!paintingRef.current) return;
    paintingRef.current = false;
    const tiles = strokeTilesRef.current;
    const layerIdx = strokeLayerIdxRef.current;
    strokeTilesRef.current = null;
    strokeMaskRef.current = null;
    lastCellRef.current = -1;
    if (tiles) {
      mutate((m) => ({
        ...m,
        tileLayers: m.tileLayers.map((l, i) => (i === layerIdx ? { ...l, tiles } : l))
      }));
    }
  };

  /** 抬笔兜底：无论鼠标在何处松开都结束一笔 */
  useEffect(() => {
    const up = (): void => endStroke();
    window.addEventListener('mouseup', up);
    return () => window.removeEventListener('mouseup', up);
  });

  /** 预设生成结果落地（P4.1-M3）：新建层或覆盖激活层 + 聚居点节点追加 */
  const applyGenResult = (result: GenResult): void => {
    if (!currentMap) return;
    const layerName = `生成 ${new Date().toLocaleTimeString('zh-CN', { hour12: false, hour: '2-digit', minute: '2-digit' })}`;
    const apply = (m: NovelMap): NovelMap => {
      let tileLayers: MapTileLayer[];
      let active: number;
      if (result.newLayer || m.tileLayers.length === 0) {
        tileLayers = [...m.tileLayers, { id: crypto.randomUUID(), name: layerName, visible: true, tiles: result.tiles }];
        active = tileLayers.length - 1;
      } else {
        tileLayers = m.tileLayers.map((l, i) => (i === activeLayerIdx ? { ...l, tiles: result.tiles } : l));
        active = activeLayerIdx;
      }
      return { ...m, tileLayers, activeTileLayer: active };
    };
    if (result.settlements.length > 0) {
      const idBase = `site_${Date.now()}`;
      const nodes: MapNode[] = result.settlements.map((s: ScatterSite, i) => ({
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
      mutate((m) => ({ ...apply(m), nodes: [...m.nodes, ...nodes] }));
    } else {
      mutate(apply);
    }
    setGenOpen(false);
  };

  /** 清空激活层瓦片（保留网格规格，全部置空） */
  const clearTiles = (): void => {
    if (!currentMap || currentMap.tileLayers.length === 0) return;
    const layerIdx = activeLayerIdx;
    const tiles = currentMap.tileLayers[layerIdx].tiles;
    void (async () => {
      if (!(await confirmDialog('确定清空当前激活图层的全部地形瓦片？此操作可用撤销恢复。'))) return;
      mutate((m) => ({
        ...m,
        tileLayers: m.tileLayers.map((l, i) =>
          i === layerIdx ? { ...l, tiles: createEmptyTiles(tiles.cols, tiles.rows, tiles.size) } : l
        )
      }));
    })();
  };

  /** 自动布局（P4.1-M4）：力导向重排地点节点，结果压撤销栈 */
  const runAutoLayout = (): void => {
    if (!currentMap) return;
    const next = autoLayoutNodes(currentMap.nodes, currentMap.connections, {
      width: currentMap.width,
      height: currentMap.height
    });
    if (next === currentMap.nodes) return;
    mutate((m) => ({ ...m, nodes: next }));
  };

  // ---------- 键盘快捷键 ----------

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const ctrl = e.ctrlKey || e.metaKey;
      // Ctrl+S 保存为全局快捷键：优先于输入框拦截（输入框聚焦时也要可保存）
      if (ctrl && e.key.toLowerCase() === 's') {
        e.preventDefault();
        void save();
        return;
      }
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) {
        return;
      }
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
      } else if (ctrl && e.key.toLowerCase() === 'c') {
        if (selNode) clipboardRef.current = selNode;
      } else if (ctrl && e.key.toLowerCase() === 'v') {
        const src = clipboardRef.current;
        if (src && currentMap) {
          const p = toCanvasPos({ x: size.width / 2 + 20, y: size.height / 2 + 20 });
          const copy: MapNode = { ...src, id: crypto.randomUUID(), x: Math.round(p.x), y: Math.round(p.y) };
          mutate((m) => ({ ...m, nodes: [...m.nodes, copy] }));
          setSelectedNodeId(copy.id);
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
        else if (connectFrom) {
          setConnectFrom(null);
          setConnectWaypoints([]);
        } else clearSel();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // ---------- 关闭/卸载保护 ----------

  /** 卸载时 flush 未保存修改（覆盖路由切换/错误边界关闭等未走 handleClose 的路径） */
  useEffect(() => {
    return () => {
      const m = currentMapRef.current;
      if (m && dirtyRef.current && !savingRef.current) {
        void svc.saveMap(m).catch((e) => console.error('地图卸载保存失败', e));
      }
    };
  }, [svc]);

  /** 应用/窗口关闭守卫：有未保存修改时提示，防直接退出静默丢数据 */
  useEffect(() => {
    const onBeforeUnload = (e: BeforeUnloadEvent): void => {
      if (!dirtyRef.current) return;
      e.preventDefault();
      // 兼容旧约定：部分 WebView/浏览器需 returnValue 才弹确认框
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, []);

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
      void toast.error(`底图上传失败：${err instanceof Error ? err.message : String(err)}`);
    }
  };

  /** AI 生成底图（P4.1-M5）：走 image 功能路由，写 maps/{id}_bg.png（复用底图显示/锁定/备份机制） */
  const runAiBg = async (): Promise<void> => {
    if (!currentMap || !aiBgPrompt.trim()) return;
    setAiBgBusy(true);
    try {
      const { bridge } = getAppContext();
      const { provider } = await resolveImageProvider(bridge, bookId);
      const images = await provider.generate({
        prompt: `${aiBgPrompt.trim()}，俯视图，地图，奇幻风格，top-down fantasy map view, illustrated`,
        size: '1536x1024',
        count: 1
      });
      if (images.length === 0) throw new Error('生图返回为空');
      const appDir = await bridge.storage.appDataDir();
      const rel = `maps/${currentMap.id}_bg.png`;
      await bridge.fs.ensureDir(`${appDir}/maps`);
      await bridge.fs.writeBinaryFile(`${appDir}/${rel}`, images[0].bytes);
      patchMap({ background: rel, bg: undefined });
      setAiBgOpen(false);
      setAiBgPrompt('');
      setSaveStatus('AI 底图已生成');
    } catch (err) {
      void toast.error(`AI 底图生成失败：${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setAiBgBusy(false);
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

  // ---------- 导出 PNG / 插入正文（P4.1-M5） ----------

  /** 临时切换到捕获态（隐藏选区装饰/按透明选项隐藏底图与底色），双 rAF 后回调再还原 */
  const withCapture = async (fn: () => void): Promise<void> => {
    setSelectedNodeId(null);
    setSelectedConnId(null);
    setConnectFrom(null);
    setConnectWaypoints([]);
    setDraftPoints([]);
    setCapturing(true);
    await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
    fn();
    setCapturing(false);
  };

  const exportPng = async (): Promise<void> => {
    const stage = stageRef.current;
    if (!stage || !currentMap) return;
    const prev = view;
    setView({ x: 0, y: 0, scale: 1 });
    await withCapture(() => {
      const url = stage.toDataURL({
        x: 0,
        y: 0,
        width: currentMap.width,
        height: currentMap.height,
        pixelRatio: exportScale
      });
      void (async () => {
        const safeName = currentMap.name.replace(/[\\/:*?"<>|]/g, '_');
        const target = await saveDialog({
          defaultPath: `${safeName}.png`,
          filters: [{ name: 'PNG 图片', extensions: ['png'] }]
        });
        if (!target || typeof target !== 'string') return;
        try {
          const { bridge } = getAppContext();
          await bridge.fs.writeBinaryFile(target, base64ToU8(url.split(',')[1] ?? ''));
          setSaveStatus(`已导出 PNG（${exportScale}x）`);
        } catch (err) {
          void toast.error(`导出失败：${err instanceof Error ? err.message : String(err)}`);
        }
      })();
    });
    setView(prev);
  };

  /** 插入正文（P4.1-M5）：当前地图导出 PNG 入图片资产并插入编辑器光标处 */
  const insertToDoc = async (): Promise<void> => {
    const stage = stageRef.current;
    if (!stage || !currentMap) return;
    const prev = view;
    setView({ x: 0, y: 0, scale: 1 });
    await withCapture(() => {
      const url = stage.toDataURL({
        x: 0,
        y: 0,
        width: currentMap.width,
        height: currentMap.height,
        pixelRatio: 2
      });
      void (async () => {
        try {
          const { imageAssetService } = getAppContext();
          const bytes = base64ToU8(url.split(',')[1] ?? '');
          const asset = await imageAssetService.importFromBytes(
            bookId,
            bytes,
            'image/png',
            'illustration',
            null
          );
          const ok = useEditorStore.getState().editorApi?.insertIllustration?.({
            id: asset.id,
            fileName: asset.fileName,
            caption: currentMap.name
          });
          if (!ok) throw new Error('插入失败：请先在编辑器中选择章节与光标位置');
          setSaveStatus('已插入正文');
          await handleClose();
        } catch (err) {
          void toast.error(`插入正文失败：${err instanceof Error ? err.message : String(err)}`);
        }
      })();
    });
    setView(prev);
  };

  // ---------- AI 生成（节点 JSON） ----------

  const runAiGenerate = async (): Promise<void> => {
    if (!aiGenerateMap || !aiPrompt.trim()) return;
    setAiGenerating(true);
    try {
      const raw = await aiGenerateMap(aiPrompt.trim());
      const parsed = parseAiContent(raw);
      if (!parsed) {
        void toast.error(`AI 返回内容无法解析为地图 JSON。返回内容预览：\n${raw.slice(0, 300)}`);
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
      void toast.error(`AI 生成失败：${err instanceof Error ? err.message : String(err)}`);
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

  /** 贴图素材节点渲染（imageCache + HSV 滤镜；未加载完成显示占位框） */
  const renderAssetStamp = (node: MapNode, boxSize: number): JSX.Element => {
    const assetId = node.icon!.slice('asset:'.length);
    const img = getCachedImage(assetId);
    const useFilter = hasHsv(node);
    if (!img) {
      // 占位虚线框（素材加载完成或缺失均短暂可见）
      return (
        <Rect
          width={boxSize}
          height={boxSize}
          offsetX={boxSize / 2}
          offsetY={boxSize / 2}
          stroke="#b8a8d8"
          dash={[4, 3]}
          strokeWidth={1.5}
          listening={false}
        />
      );
    }
    return (
      <Image
        image={img}
        width={boxSize}
        height={boxSize}
        offsetX={boxSize / 2}
        offsetY={boxSize / 2}
        filters={useFilter ? [Konva.Filters.HSV] : undefined}
        hue={node.hueShift ?? 0}
        saturation={node.saturation ?? 1}
        value={node.brightness ?? 1}
        ref={(n: any): void => {
          if (!n) return;
          if (useFilter) n.cache();
          else n.clearCache();
        }}
        listening={false}
      />
    );
  };

  /** marker 文字（样式增强：字号/字色/描边/竖排） */
  const renderMarkerText = (label: string, node: MapNode): JSX.Element => {
    const ts = node.textStyle;
    const fontSize = ts?.fontSize ?? 13;
    const fill = ts?.fontColor ?? '#23211e';
    const stroke = ts?.strokeColor;
    const strokeWidth = ts?.strokeWidth ?? 0;
    if (ts?.vertical) {
      return (
        <Group x={12} y={-6} listening={false}>
          {label.split('').map((ch, i) => (
            <Text
              key={i}
              text={ch}
              y={i * fontSize}
              fontSize={fontSize}
              fill={fill}
              stroke={stroke}
              strokeWidth={strokeWidth > 0 ? strokeWidth : undefined}
            />
          ))}
        </Group>
      );
    }
    return (
      <Text
        text={label}
        x={12}
        y={-8}
        fontSize={fontSize}
        fill={fill}
        stroke={stroke}
        strokeWidth={strokeWidth > 0 ? strokeWidth : undefined}
        listening={false}
      />
    );
  };

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
    void imgTick; // 贴图加载完成后触发重渲染

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

    // 文字标注：小圆点 + 右侧文字（样式增强）
    if (node.type === 'marker') {
      return (
        <Group key={node.id} x={node.x} y={node.y} scaleX={s} scaleY={s} opacity={opacity} {...commonProps}>
          <Circle
            radius={node.radius ?? 6}
            fill={node.color}
            stroke={highlight ? '#7c3aed' : '#fff'}
            strokeWidth={highlight ? 3 : 1.5}
          />
          {renderMarkerText(label, node)}
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
    const isAssetIcon = node.shape === 'icon' && node.icon?.startsWith('asset:') === true;

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
          {isAssetIcon ? (
            renderAssetStamp(node, Math.round(r * 1.6))
          ) : (
            node.icon && (
              <Text
                text={iconEmoji(node.icon)}
                fontSize={Math.round(r * 1.05)}
                fill="#fff"
                align="center"
                width={r * 2}
                x={-r}
                y={-r * 0.62}
                listening={false}
              />
            )
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

  /** 折线/平滑连线全长中点（label 定位用） */
  const polylineMid = (pts: number[]): { x: number; y: number } => {
    let total = 0;
    const segs: number[] = [];
    for (let i = 2; i < pts.length; i += 2) {
      const len = Math.hypot(pts[i] - pts[i - 2], pts[i + 1] - pts[i - 1]);
      segs.push(len);
      total += len;
    }
    let remain = total / 2;
    for (let i = 0; i < segs.length; i++) {
      if (remain <= segs[i] || i === segs.length - 1) {
        const t = segs[i] === 0 ? 0 : remain / segs[i];
        const j = (i + 1) * 2;
        return {
          x: pts[j - 2] + (pts[j] - pts[j - 2]) * t,
          y: pts[j - 1] + (pts[j + 1] - pts[j - 1]) * t
        };
      }
      remain -= segs[i];
    }
    return { x: pts[0], y: pts[1] };
  };

  /** 渲染单条连线：折线/平滑（含 waypoints 拐点）+ 全长中点 label + 选中态拐点手柄 */
  const renderConn = (conn: MapConnection): JSX.Element | null => {
    const a = nodeById.get(conn.fromNodeId);
    const b = nodeById.get(conn.toNodeId);
    if (!a || !b) return null;
    const selected = selectedConnId === conn.id;
    const color = conn.color ?? '#8a8070';
    const width = conn.width ?? 2;
    const wps = conn.waypoints ?? [];
    const smooth = conn.lineType === 'curve';
    let points: number[];
    let labelPos: { x: number; y: number };
    if (wps.length === 0 && smooth) {
      // 原弧线语义：中点垂向偏移的控制点
      const mx = (a.x + b.x) / 2;
      const my = (a.y + b.y) / 2;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len = Math.hypot(dx, dy) || 1;
      const sag = len * 0.18;
      const cx = mx + (-dy / len) * sag;
      const cy = my + (dx / len) * sag;
      points = [a.x, a.y, cx, cy, b.x, b.y];
      labelPos = { x: 0.25 * a.x + 0.5 * cx + 0.25 * b.x, y: 0.25 * a.y + 0.5 * cy + 0.25 * b.y };
    } else {
      points = [a.x, a.y, ...wps.flatMap((w) => [w.x, w.y]), b.x, b.y];
      labelPos = polylineMid(points);
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
          tension={wps.length > 0 && smooth ? 0.4 : 0}
          bezier={wps.length === 0 && smooth}
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
        {/* 连线绘制中的临时拐点预览 */}
        {selectedNodeId === null && connectFrom === a.id && connectWaypoints.length > 0 && (
          <Line
            points={[a.x, a.y, ...connectWaypoints.flatMap((w) => [w.x, w.y])]}
            stroke="#7c3aed"
            strokeWidth={1.5}
            dash={[6, 4]}
            listening={false}
          />
        )}
        <Group x={labelPos.x} y={labelPos.y} onClick={onClick}>
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
        {/* 选中态拐点手柄：拖动改位置，双击删除 */}
        {selected &&
          !capturing &&
          wps.map((wp, i) => (
            <Circle
              key={i}
              x={wp.x}
              y={wp.y}
              radius={6}
              fill="#fff"
              stroke="#7c3aed"
              strokeWidth={2}
              draggable
              onDragEnd={(e: any): void => {
                const next = [...wps];
                next[i] = { x: Math.round(e.target.x()), y: Math.round(e.target.y()) };
                patchConn(conn.id, { waypoints: next }, false);
              }}
              onDblClick={(e: any): void => {
                e.cancelBubble = true;
                patchConn(conn.id, { waypoints: wps.filter((_, j) => j !== i) }, false);
              }}
            />
          ))}
      </Group>
    );
  };

  const zoomPct = Math.round(view.scale * 100);
  const hint = placeIcon
    ? `放置「${placeLabel(placeIcon)}」：点击画布放置（可连续），Esc 或右键停止`
    : tool === 'connect' && connectFrom
      ? '连线中：点击目标地点完成；Shift+点击画布追加拐点；Esc 取消'
      : TOOL_HINT[tool];
  const cursorClass =
    placeIcon || tool === 'region' || tool === 'connect' || paintMode
      ? 'cursor-crosshair'
      : tool === 'pan'
        ? 'cursor-grab'
        : tool === 'delete'
          ? 'cursor-pointer'
          : '';

  const activeLayer = currentMap?.tileLayers[activeLayerIdx] ?? null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="flex h-[94vh] w-[min(1500px,97vw)] flex-col overflow-hidden rounded bg-white shadow-2xl">
        {/* 标题栏 + 顶部工具栏（子组件） */}
        <MapToolbar
          maps={maps}
          currentMap={currentMap}
          dirty={dirty}
          saveStatus={saveStatus}
          canUndo={past.length > 0}
          canRedo={future.length > 0}
          zoomPct={zoomPct}
          genOpen={genOpen}
          aiOpen={aiOpen}
          hasAiGenerate={!!aiGenerateMap}
          exportScale={exportScale}
          exportTransparent={exportTransparent}
          onSwitchMap={(id) => void switchMap(id)}
          onCreateMap={() => void handleCreate()}
          onUndo={undo}
          onRedo={redo}
          onZoom={(factor) => zoomAtPoint(size.width / 2, size.height / 2, factor)}
          onFit={() => fitView(currentMap)}
          onAutoLayout={runAutoLayout}
          onToggleGen={() => setGenOpen((v) => !v)}
          onToggleAi={() => setAiOpen((v) => !v)}
          onExportPng={() => void exportPng()}
          onInsertToDoc={() => void insertToDoc()}
          onSave={() => void save()}
          onClose={() => void handleClose()}
        />

        {/* 主体三栏 */}
        <div className="relative flex min-h-0 flex-1">
          {/* 左侧栏（宽度动画收起） */}
          <aside
            className={`shrink-0 overflow-hidden border-r border-ink-200 transition-[width] duration-200 ${
              leftOpen ? 'w-60' : 'w-0 border-r-0'
            }`}
          >
            <div className="flex h-full w-60 flex-col overflow-y-auto">
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

            {/* 瓦片地形：目标层 + 笔刷大小 + 仅覆盖已有 + 地形选择 */}
            <div className="mt-3 border-t border-ink-200 px-3 pb-1 pt-2.5 text-sm font-medium">地形</div>
            <div className="flex items-center gap-1 px-2 pb-1 text-xs text-ink-500">
              <span className="shrink-0">目标层</span>
              <select
                className="min-w-0 flex-1 rounded border border-ink-200 px-1 py-0.5 text-xs"
                value={String(activeLayerIdx)}
                disabled={(currentMap?.tileLayers.length ?? 0) === 0}
                onChange={(e) => setActiveTileLayer(Number(e.target.value))}
              >
                {(currentMap?.tileLayers ?? []).map((l, i) => (
                  <option key={l.id} value={String(i)}>
                    {i + 1}. {l.name}
                  </option>
                ))}
                {(currentMap?.tileLayers.length ?? 0) === 0 && <option value="0">（无图层）</option>}
              </select>
            </div>
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
              <label className="ml-auto flex shrink-0 items-center gap-1" title="笔刷限制在已有地形范围内（陆地刷植被等覆盖纹理）">
                <input
                  type="checkbox"
                  className="accent-violet-600"
                  checked={brushMask}
                  onChange={(e) => setBrushMask(e.target.checked)}
                />
                仅覆盖已有
              </label>
            </div>
            <div className="px-2 pb-2">
              <TerrainPanel selected={terrainBrush} onSelect={setTerrainBrush} tileAssets={assetsById} />
            </div>

            {/* 元件库 */}
            <div className="mt-3 flex items-center justify-between border-t border-ink-200 px-3 pb-1 pt-2.5">
              <span className="text-sm font-medium">元件库</span>
              {placeIcon && !placeIcon.startsWith('asset:') && (
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

            {/* 素材库（P4.1） */}
            <div className="mt-3 flex items-center justify-between border-t border-ink-200 px-3 pb-1 pt-2.5">
              <span className="text-sm font-medium">素材库</span>
              {placeIcon?.startsWith('asset:') && (
                <button type="button" className="text-xs text-violet-600 hover:underline" onClick={() => setPlaceIcon(null)}>
                  停止放置
                </button>
              )}
            </div>
            <div className="px-2 pb-2">
              <MapAssetPanel
                selected={placeIcon}
                onSelect={(ref) => {
                  setPlaceIcon(ref);
                  setTool('select');
                  setSelectedNodeId(null);
                  setSelectedConnId(null);
                }}
                selectedTile={terrainBrush.startsWith('asset:tile:') ? terrainBrush : null}
                onSelectTile={(terrainId) => {
                  if (terrainId) {
                    setTerrainBrush(terrainId);
                    setTool('brush');
                  }
                }}
                onChanged={() => void reloadAssets()}
              />
            </div>

            {/* 瓦片图层管理 + 图层显隐（子组件） */}
            <MapLayerPanel
              tileLayers={currentMap?.tileLayers ?? []}
              activeLayerIdx={activeLayerIdx}
              visibility={layers}
              onAddLayer={addTileLayer}
              onRemoveLayer={removeTileLayer}
              onMoveLayer={moveTileLayer}
              onRenameLayer={renameTileLayer}
              onToggleLayerVisible={toggleTileLayerVisible}
              onToggleVisibility={(key) => setLayers((v) => ({ ...v, [key]: !v[key] }))}
            />
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
                  {/* 画布底 + 边界 + 网格（透明导出时底色省略） */}
                  <Rect
                    x={0.5}
                    y={0.5}
                    width={Math.max(currentMap.width - 1, 1)}
                    height={Math.max(currentMap.height - 1, 1)}
                    fill={exportTransparent && capturing ? undefined : '#fdfcf8'}
                    stroke="#c9c2b4"
                    strokeWidth={1}
                    dash={[6, 6]}
                    listening={false}
                  />
                  {!(exportTransparent && capturing) &&
                    gridLines.map((g, i) => (
                      <Line key={i} points={g.points} stroke="#ece7dc" strokeWidth={1} listening={false} />
                    ))}
                  {/* 底图层（透明导出时省略） */}
                  {layers.bg && bgImage && !(exportTransparent && capturing) && (
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
                  {/* 多层瓦片（数组序 = 渲染顺序底->顶，每层一张离屏 canvas Image；
                      以 tileLayers 为准遍历，canvas 未就绪/失效的层跳过，避免切换地图时的暂态越界） */}
                  {layers.tile &&
                    currentMap.tileLayers.map((l, i) =>
                      l.visible !== false && tileCanvases[i] ? (
                        <Image key={l.id} image={tileCanvases[i]} x={0} y={0} listening={false} />
                      ) : null
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
              {activeLayer && paintMode && ` · 当前层：${activeLayerIdx + 1}. ${activeLayer.name}`}
            </div>
            {/* 左右面板折叠按钮 */}
            <button
              type="button"
              title={leftOpen ? '收起左侧工具面板' : '展开左侧工具面板'}
              className="absolute left-2 top-2 z-10 rounded border border-ink-200 bg-white/90 px-2 py-1 text-xs text-ink-500 shadow-sm hover:bg-ink-100"
              onClick={() => setLeftOpen((v) => !v)}
            >
              {leftOpen ? '◀' : '▶'}
            </button>
            <button
              type="button"
              title={rightOpen ? '收起右侧属性面板' : '展开右侧属性面板'}
              className="absolute right-2 top-2 z-10 rounded border border-ink-200 bg-white/90 px-2 py-1 text-xs text-ink-500 shadow-sm hover:bg-ink-100"
              onClick={() => setRightOpen((v) => !v)}
            >
              {rightOpen ? '▶' : '◀'}
            </button>
          </div>

          {/* 右侧属性面板（宽度动画收起） */}
          {currentMap && (
            <div
              className={`shrink-0 overflow-hidden transition-[width] duration-200 ${
                rightOpen ? 'w-60' : 'w-0'
              }`}
            >
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
                onAiBg={() => setAiBgOpen(true)}
                exportTransparent={exportTransparent}
                exportScale={exportScale}
                onExportTransparent={setExportTransparent}
                onExportScale={setExportScale}
              />
            </div>
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

          {/* AI 底图浮层（P4.1-M5） */}
          {aiBgOpen && currentMap && (
            <div className="absolute right-64 top-4 z-10 w-80 rounded border border-ink-200 bg-white p-3 shadow-lg">
              <div className="mb-1 text-sm font-medium">AI 生成底图</div>
              <div className="mb-2 text-[11px] leading-4 text-ink-400">
                走「模型分工 → 视觉生成 → 图片生成」路由，生成 1536×1024 风格化底图，写入本图底图层（可拖动/锁定）。
              </div>
              <textarea
                className="h-16 w-full resize-none rounded border border-ink-200 p-2 text-sm outline-none focus:border-violet-300"
                placeholder="描述底图风格，如：古风手绘大陆，泛黄羊皮纸质感"
                value={aiBgPrompt}
                onChange={(e) => setAiBgPrompt(e.target.value)}
              />
              <div className="mt-2 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100"
                  onClick={() => setAiBgOpen(false)}
                >
                  取消
                </button>
                <button
                  type="button"
                  disabled={aiBgBusy || !aiBgPrompt.trim()}
                  className="rounded border border-violet-300 px-2 py-1 text-sm text-violet-700 hover:bg-violet-50 disabled:opacity-50"
                  onClick={() => void runAiBg()}
                >
                  {aiBgBusy ? '生成中…' : '生成底图'}
                </button>
              </div>
            </div>
          )}

          {/* 预设地形生成向导（P4.1-M3） */}
          {genOpen && currentMap && (
            <MapGenDialog
              cols={Math.max(8, Math.ceil(currentMap.width / TILE_SIZE))}
              rows={Math.max(8, Math.ceil(currentMap.height / TILE_SIZE))}
              onClose={() => setGenOpen(false)}
              onGenerate={applyGenResult}
            />
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
        点击图标后在画布连续放置；Esc 停止。需要自定义贴图请在下方「素材库」上传。
      </p>
    </div>
  );
}

/** 地形面板：分类 chips + 地形色块网格（选中即设为笔刷地形）；自定义瓦片纹理追加为额外分组 */
function TerrainPanel(props: {
  selected: string;
  onSelect: (id: string) => void;
  tileAssets: Map<string, MapAsset>;
}): JSX.Element {
  const customTiles = Array.from(props.tileAssets.values()).filter((a) => a.usage === 'tile');
  const isCustom = props.selected.startsWith('asset:tile:');
  const [cat, setCat] = useState<string>(() => {
    if (isCustom) return '__custom__';
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
        {customTiles.length > 0 && (
          <button
            type="button"
            className={`rounded px-1.5 py-0.5 text-xs ${
              '__custom__' === cat ? 'bg-emerald-50 text-emerald-700' : 'text-ink-500 hover:bg-ink-100'
            }`}
            onClick={() => setCat('__custom__')}
          >
            自定义纹理
          </button>
        )}
      </div>
      {cat === '__custom__' ? (
        <div className="mt-1.5 grid grid-cols-3 gap-1">
          {customTiles.map((a) => {
            const terrainId = `asset:tile:${a.id}`;
            return (
              <button
                key={a.id}
                type="button"
                title={`${a.name}（设为笔刷地形）`}
                className={`truncate rounded border px-1 py-1 text-[11px] ${
                  props.selected === terrainId
                    ? 'border-emerald-500 bg-emerald-50 ring-1 ring-emerald-300'
                    : 'border-ink-200 hover:bg-ink-100'
                }`}
                onClick={() => props.onSelect(terrainId)}
              >
                {a.name}
              </button>
            );
          })}
        </div>
      ) : (
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
      )}
      <p className="mt-1.5 text-xs leading-4 text-ink-400">
        选地形后用笔刷（B）涂抹到目标层；橡皮（E）擦除、油漆桶连通填充、吸管取地形。自定义纹理在「素材库 → 瓦片纹理」上传。
      </p>
    </div>
  );
}
