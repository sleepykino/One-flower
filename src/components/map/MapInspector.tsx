/**
 * 地图属性面板（P4.1 增强）
 * - 节点：名称 / 图标（内置图标 + 我的素材双 tab）/ 形状尺寸 / 缩放旋转透明 / HSV 调色 / 文字样式（marker）
 * - 连线：名称 / 线型 / 折线拐点编辑（waypoints）
 * - 地图：名称 / 尺寸 / 底图（上传 + AI 生成）/ 导出选项（透明背景 / 倍率）
 */

import { useEffect, useState } from 'react';
import {
  ICON_LIBRARY,
  PALETTE,
  type MapConnection,
  type MapNode,
  type NovelMap
} from '../../services/map/types';
import { MapAssetService, type MapAsset } from '../../services/map/MapAssetService';
import { getAppContext } from '../../context/app-context';

interface MapInspectorProps {
  map: NovelMap;
  entries: Array<{ id: string; title: string }>;
  node: MapNode | null;
  conn: MapConnection | null;
  onPatchMap: (patch: Partial<NovelMap>) => void;
  onPatchNode: (id: string, patch: Partial<MapNode>) => void;
  onPatchConn: (id: string, patch: Partial<MapConnection>) => void;
  onRemoveNode: (id: string) => void;
  onRemoveConn: (id: string) => void;
  onDuplicateNode: (id: string) => void;
  onZIndex: (id: string, dir: 'top' | 'bottom') => void;
  onUploadBg: () => void;
  onRemoveBg: () => void;
  onResetBg: () => void;
  /** AI 生成底图（P4.1-M5） */
  onAiBg: () => void;
  /** 导出选项（P4.1-M5） */
  exportTransparent: boolean;
  exportScale: number;
  onExportTransparent: (v: boolean) => void;
  onExportScale: (v: number) => void;
}

const TYPE_LABEL: Record<MapNode['type'], string> = {
  location: '地点',
  marker: '标注',
  region: '区域'
};

/** 小节标题 */
function Section({ title, children }: { title: string; children: React.ReactNode }): JSX.Element {
  return (
    <div className="space-y-2">
      <div className="text-xs font-medium text-ink-500">{title}</div>
      {children}
    </div>
  );
}

/** 滑杆行：label + range + 数值 */
function SliderRow(props: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  format?: (v: number) => string;
  onChange: (v: number) => void;
}): JSX.Element {
  return (
    <label className="block text-xs text-ink-500">
      <div className="flex justify-between">
        <span>{props.label}</span>
        <span className="tabular-nums text-ink-400">
          {props.format ? props.format(props.value) : props.value}
        </span>
      </div>
      <input
        type="range"
        className="mt-1 w-full accent-violet-600"
        min={props.min}
        max={props.max}
        step={props.step}
        value={props.value}
        onChange={(e) => props.onChange(Number(e.target.value))}
      />
    </label>
  );
}

/** 色板 */
function PaletteRow(props: { value: string; onChange: (c: string) => void }): JSX.Element {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PALETTE.map((c) => (
        <button
          key={c}
          type="button"
          title={c}
          className={`h-6 w-6 rounded-full border-2 ${props.value === c ? 'border-violet-600' : 'border-white'} shadow-sm`}
          style={{ backgroundColor: c }}
          onClick={() => props.onChange(c)}
        />
      ))}
    </div>
  );
}

/** 图标元件选择器：内置图标 / 我的素材双 tab（P4.1） */
function IconPicker(props: { value?: string; onChange: (iconId: string | undefined) => void }): JSX.Element {
  const isAsset = props.value?.startsWith('asset:') ?? false;
  const [tab, setTab] = useState<'builtin' | 'mine'>(isAsset ? 'mine' : 'builtin');
  const [cat, setCat] = useState(() => {
    if (!props.value || isAsset) return ICON_LIBRARY[0].key;
    return ICON_LIBRARY.find((c) => c.icons.some((i) => i.id === props.value))?.key ?? ICON_LIBRARY[0].key;
  });
  const current = ICON_LIBRARY.find((c) => c.key === cat) ?? ICON_LIBRARY[0];
  const [assets, setAssets] = useState<MapAsset[]>([]);
  const [urls, setUrls] = useState<Record<string, string>>({});

  useEffect(() => {
    if (tab !== 'mine') return;
    void (async () => {
      const svc = new MapAssetService(getAppContext().bridge);
      await svc.ensureBuiltin();
      const list = await svc.list({ usage: 'stamp' });
      setAssets(list);
      const map: Record<string, string> = {};
      for (const a of list) {
        try {
          map[a.id] = await svc.resolveUrl(a.id);
        } catch {
          map[a.id] = '';
        }
      }
      setUrls(map);
    })();
  }, [tab]);

  return (
    <div>
      <div className="mb-1 flex gap-2 text-xs">
        <button
          type="button"
          className={`rounded px-1.5 py-0.5 ${tab === 'builtin' ? 'bg-violet-50 font-medium text-violet-700' : 'text-ink-500 hover:bg-ink-100'}`}
          onClick={() => setTab('builtin')}
        >
          内置图标
        </button>
        <button
          type="button"
          className={`rounded px-1.5 py-0.5 ${tab === 'mine' ? 'bg-violet-50 font-medium text-violet-700' : 'text-ink-500 hover:bg-ink-100'}`}
          onClick={() => setTab('mine')}
        >
          我的素材
        </button>
      </div>
      {tab === 'builtin' ? (
        <>
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
            <button
              type="button"
              title="无图标"
              className={`flex h-8 items-center justify-center rounded border text-xs ${
                !props.value ? 'border-violet-300 bg-violet-50' : 'border-ink-200 hover:bg-ink-100'
              }`}
              onClick={() => props.onChange(undefined)}
            >
              无
            </button>
            {current.icons.map((i) => (
              <button
                key={i.id}
                type="button"
                title={i.label}
                className={`flex h-8 items-center justify-center rounded border text-lg leading-none ${
                  props.value === i.id ? 'border-violet-300 bg-violet-50' : 'border-ink-200 hover:bg-ink-100'
                }`}
                onClick={() => props.onChange(i.id)}
              >
                {i.emoji}
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="grid grid-cols-5 gap-1">
          <button
            type="button"
            title="清除素材图标"
            className={`flex h-10 items-center justify-center rounded border text-xs ${
              !props.value ? 'border-violet-300 bg-violet-50' : 'border-ink-200 hover:bg-ink-100'
            }`}
            onClick={() => props.onChange(undefined)}
          >
            无
          </button>
          {assets.map((a) => {
            const ref = `asset:${a.id}`;
            return (
              <button
                key={a.id}
                type="button"
                title={`${a.name}（可在左侧素材库上传）`}
                className={`flex h-10 items-center justify-center overflow-hidden rounded border ${
                  props.value === ref ? 'border-violet-300 bg-violet-50 ring-1 ring-violet-300' : 'border-ink-200 hover:bg-ink-100'
                }`}
                onClick={() => props.onChange(ref)}
              >
                {urls[a.id] ? (
                  <img src={urls[a.id]} alt={a.name} className="max-h-8 max-w-8 object-contain" draggable={false} />
                ) : (
                  <span className="text-xs text-ink-300">…</span>
                )}
              </button>
            );
          })}
          {assets.length === 0 && (
            <span className="col-span-4 self-center text-xs leading-4 text-ink-400">
              暂无素材，可在左侧「素材库」上传
            </span>
          )}
        </div>
      )}
    </div>
  );
}

export function MapInspector(props: MapInspectorProps): JSX.Element {
  const { map, entries, node, conn } = props;

  // ---------- 连线属性 ----------
  if (conn) {
    const wps = conn.waypoints ?? [];
    const midAdd = (): void => {
      // 在连线中点追加一个拐点（首尾节点的中点或已有折线中点）
      const next = [...wps];
      if (next.length === 0) next.push({ x: 0, y: -40 });
      else next.splice(Math.floor(next.length / 2), 0, { x: 0, y: -40 });
      props.onPatchConn(conn.id, { waypoints: next });
    };
    return (
      <aside className="flex h-full w-60 shrink-0 flex-col gap-4 overflow-y-auto border-l border-ink-200 p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">连线属性</span>
        </div>
        <Section title="名称">
          <input
            className="w-full rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-300"
            value={conn.label}
            onChange={(e) => props.onPatchConn(conn.id, { label: e.target.value })}
          />
        </Section>
        <Section title="线型">
          <div className="flex gap-2">
            <select
              className="flex-1 rounded border border-ink-200 px-1 py-1 text-sm"
              value={conn.style}
              onChange={(e) => props.onPatchConn(conn.id, { style: e.target.value as MapConnection['style'] })}
            >
              <option value="solid">实线</option>
              <option value="dashed">虚线</option>
            </select>
            <select
              className="flex-1 rounded border border-ink-200 px-1 py-1 text-sm"
              value={conn.lineType ?? 'straight'}
              onChange={(e) =>
                props.onPatchConn(conn.id, { lineType: e.target.value as MapConnection['lineType'] })
              }
            >
              <option value="straight">折线</option>
              <option value="curve">平滑</option>
            </select>
          </div>
        </Section>
        <SliderRow
          label="线宽"
          min={1}
          max={8}
          step={1}
          value={conn.width ?? 2}
          onChange={(v) => props.onPatchConn(conn.id, { width: v })}
        />
        <Section title="颜色">
          <PaletteRow value={conn.color ?? '#8a8070'} onChange={(c) => props.onPatchConn(conn.id, { color: c })} />
        </Section>
        <label className="flex items-center gap-2 text-xs text-ink-500">
          <input
            type="checkbox"
            className="accent-violet-600"
            checked={conn.arrow ?? false}
            onChange={(e) => props.onPatchConn(conn.id, { arrow: e.target.checked })}
          />
          显示方向箭头
        </label>

        <Section title={`折线拐点（${wps.length}）`}>
          <div className="space-y-1">
            {wps.map((w, i) => (
              <div key={i} className="flex items-center gap-1 text-xs">
                <span className="w-4 text-ink-400">{i + 1}</span>
                <input
                  type="number"
                  className="w-14 rounded border border-ink-200 px-1 py-0.5 text-xs"
                  value={w.x}
                  onChange={(e) => {
                    const next = [...wps];
                    next[i] = { ...w, x: Number(e.target.value) || 0 };
                    props.onPatchConn(conn.id, { waypoints: next });
                  }}
                />
                <input
                  type="number"
                  className="w-14 rounded border border-ink-200 px-1 py-0.5 text-xs"
                  value={w.y}
                  onChange={(e) => {
                    const next = [...wps];
                    next[i] = { ...w, y: Number(e.target.value) || 0 };
                    props.onPatchConn(conn.id, { waypoints: next });
                  }}
                />
                <button
                  type="button"
                  className="text-red-500 hover:underline"
                  onClick={() => props.onPatchConn(conn.id, { waypoints: wps.filter((_, j) => j !== i) })}
                >
                  删
                </button>
              </div>
            ))}
            <button
              type="button"
              className="w-full rounded border border-ink-200 py-0.5 text-xs text-ink-500 hover:bg-ink-100"
              onClick={midAdd}
            >
              + 中点加拐点
            </button>
          </div>
          <p className="text-[11px] leading-4 text-ink-400">
            连线工具下 Shift+点击画布也可追加拐点；画布上选中连线后可拖动拐点手柄。
          </p>
        </Section>

        <button
          type="button"
          className="rounded border border-red-200 px-2 py-1 text-sm text-red-600 hover:bg-red-50"
          onClick={() => props.onRemoveConn(conn.id)}
        >
          删除连线
        </button>
      </aside>
    );
  }

  // ---------- 节点属性 ----------
  if (node) {
    const isRegion = node.type === 'region';
    const isMarker = node.type === 'marker';
    const ts = node.textStyle;
    return (
      <aside className="flex h-full w-60 shrink-0 flex-col gap-4 overflow-y-auto border-l border-ink-200 p-3">
        <div className="flex items-center justify-between">
          <span className="text-sm font-medium">节点属性</span>
          <span className="rounded bg-ink-100 px-1.5 py-0.5 text-xs text-ink-500">{TYPE_LABEL[node.type]}</span>
        </div>
        <Section title="名称">
          <input
            className="w-full rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-300"
            value={node.label}
            onChange={(e) => props.onPatchNode(node.id, { label: e.target.value })}
          />
        </Section>
        {!isMarker && !isRegion && (
          <Section title="图标元件（内置 / 我的素材）">
            <IconPicker
              value={node.icon}
              onChange={(iconId) =>
                props.onPatchNode(node.id, {
                  icon: iconId,
                  shape: iconId ? 'icon' : node.shape === 'icon' ? 'circle' : node.shape
                })
              }
            />
          </Section>
        )}
        {!isMarker && !isRegion && (
          <Section title="形状">
            <select
              className="w-full rounded border border-ink-200 px-1 py-1 text-sm"
              value={node.shape}
              onChange={(e) => props.onPatchNode(node.id, { shape: e.target.value as MapNode['shape'] })}
            >
              <option value="icon">图标元件</option>
              <option value="circle">圆形</option>
              <option value="rect">矩形</option>
              <option value="polygon">多边形</option>
            </select>
          </Section>
        )}
        {!isMarker && !isRegion && node.shape === 'circle' && (
          <SliderRow
            label="半径"
            min={6}
            max={80}
            step={1}
            value={node.radius ?? 26}
            onChange={(v) => props.onPatchNode(node.id, { radius: v })}
          />
        )}
        {!isMarker && !isRegion && node.shape === 'rect' && (
          <div className="flex gap-2">
            <label className="flex-1 text-xs text-ink-500">
              宽
              <input
                type="number"
                min={8}
                className="mt-1 w-full rounded border border-ink-200 px-2 py-1 text-sm"
                value={node.width ?? 48}
                onChange={(e) => props.onPatchNode(node.id, { width: Number(e.target.value) || 8 })}
              />
            </label>
            <label className="flex-1 text-xs text-ink-500">
              高
              <input
                type="number"
                min={8}
                className="mt-1 w-full rounded border border-ink-200 px-2 py-1 text-sm"
                value={node.height ?? 32}
                onChange={(e) => props.onPatchNode(node.id, { height: Number(e.target.value) || 8 })}
              />
            </label>
          </div>
        )}
        {!isRegion && (
          <>
            <SliderRow
              label="大小"
              min={0.3}
              max={3}
              step={0.05}
              value={node.scale ?? 1}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => props.onPatchNode(node.id, { scale: v })}
            />
            {!isMarker && (
              <SliderRow
                label="旋转"
                min={0}
                max={359}
                step={1}
                value={node.rotation ?? 0}
                format={(v) => `${v}°`}
                onChange={(v) => props.onPatchNode(node.id, { rotation: v })}
              />
            )}
            <SliderRow
              label="不透明度"
              min={0.1}
              max={1}
              step={0.05}
              value={node.opacity ?? 1}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => props.onPatchNode(node.id, { opacity: v })}
            />
          </>
        )}
        {!isRegion && (
          <Section title="调色（素材贴图 HSV）">
            <SliderRow
              label="色相"
              min={-180}
              max={180}
              step={1}
              value={node.hueShift ?? 0}
              format={(v) => `${v}°`}
              onChange={(v) => props.onPatchNode(node.id, { hueShift: v })}
            />
            <SliderRow
              label="饱和度"
              min={0}
              max={3}
              step={0.05}
              value={node.saturation ?? 1}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => props.onPatchNode(node.id, { saturation: v })}
            />
            <SliderRow
              label="明度"
              min={0}
              max={3}
              step={0.05}
              value={node.brightness ?? 1}
              format={(v) => `${Math.round(v * 100)}%`}
              onChange={(v) => props.onPatchNode(node.id, { brightness: v })}
            />
            {(node.hueShift !== undefined || node.saturation !== undefined || node.brightness !== undefined) && (
              <button
                type="button"
                className="w-full rounded border border-ink-200 py-0.5 text-xs text-ink-500 hover:bg-ink-100"
                onClick={() => props.onPatchNode(node.id, { hueShift: undefined, saturation: undefined, brightness: undefined })}
              >
                重置调色
              </button>
            )}
          </Section>
        )}
        {isMarker && (
          <Section title="文字样式">
            <SliderRow
              label="字号"
              min={10}
              max={32}
              step={1}
              value={ts?.fontSize ?? 13}
              onChange={(v) => props.onPatchNode(node.id, { textStyle: { ...ts, fontSize: v } })}
            />
            <div className="text-xs text-ink-500">字色</div>
            <PaletteRow
              value={ts?.fontColor ?? '#23211e'}
              onChange={(c) => props.onPatchNode(node.id, { textStyle: { ...ts, fontColor: c } })}
            />
            <div className="text-xs text-ink-500">描边色</div>
            <PaletteRow
              value={ts?.strokeColor ?? '#ffffff'}
              onChange={(c) => props.onPatchNode(node.id, { textStyle: { ...ts, strokeColor: c, strokeWidth: ts?.strokeWidth ?? 3 } })}
            />
            <SliderRow
              label="描边宽"
              min={0}
              max={8}
              step={0.5}
              value={ts?.strokeWidth ?? 0}
              format={(v) => (v === 0 ? '无' : String(v))}
              onChange={(v) => props.onPatchNode(node.id, { textStyle: { ...ts, strokeWidth: v } })}
            />
            <label className="flex items-center gap-2 text-xs text-ink-500">
              <input
                type="checkbox"
                className="accent-violet-600"
                checked={ts?.vertical ?? false}
                onChange={(e) => props.onPatchNode(node.id, { textStyle: { ...ts, vertical: e.target.checked } })}
              />
              竖排文字
            </label>
          </Section>
        )}
        <Section title="颜色">
          <PaletteRow value={node.color} onChange={(c) => props.onPatchNode(node.id, { color: c })} />
        </Section>
        <Section title="描述（供检索）">
          <textarea
            className="h-16 w-full resize-none rounded border border-ink-200 p-2 text-xs outline-none focus:border-violet-300"
            placeholder="该地点的设定描述…"
            value={node.desc ?? ''}
            onChange={(e) => props.onPatchNode(node.id, { desc: e.target.value })}
          />
        </Section>
        <Section title="关联世界书条目">
          <select
            className="w-full rounded border border-ink-200 px-1 py-1 text-sm"
            value={node.worldbookEntryId ?? ''}
            onChange={(e) => props.onPatchNode(node.id, { worldbookEntryId: e.target.value || undefined })}
          >
            <option value="">不关联</option>
            {entries.map((en) => (
              <option key={en.id} value={en.id}>
                {en.title}
              </option>
            ))}
          </select>
        </Section>
        {!isRegion && (
          <div className="grid grid-cols-2 gap-1.5">
            <button
              type="button"
              className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-100"
              onClick={() => props.onDuplicateNode(node.id)}
            >
              复制节点
            </button>
            <button
              type="button"
              className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-100"
              onClick={() => props.onZIndex(node.id, 'top')}
            >
              置顶
            </button>
            <button
              type="button"
              className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-100"
              onClick={() => props.onZIndex(node.id, 'bottom')}
            >
              置底
            </button>
            <span className="rounded bg-ink-50 px-2 py-1 text-center text-xs text-ink-400">
              层级 {node.zIndex ?? 0}
            </span>
          </div>
        )}
        {isRegion && (
          <p className="text-xs leading-5 text-ink-400">
            多边形顶点 {(node.points?.length ?? 0) / 2} 个。选择工具下可整体拖拽；顶点编辑可在属性中调整数值。
          </p>
        )}
        <button
          type="button"
          className="rounded border border-red-200 px-2 py-1 text-sm text-red-600 hover:bg-red-50"
          onClick={() => props.onRemoveNode(node.id)}
        >
          删除节点
        </button>
      </aside>
    );
  }

  // ---------- 地图属性 ----------
  return (
    <aside className="flex h-full w-60 shrink-0 flex-col gap-4 overflow-y-auto border-l border-ink-200 p-3">
      <span className="text-sm font-medium">地图属性</span>
      <Section title="名称">
        <input
          className="w-full rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-300"
          value={map.name}
          onChange={(e) => props.onPatchMap({ name: e.target.value })}
        />
      </Section>
      <Section title="描述">
        <textarea
          className="h-16 w-full resize-none rounded border border-ink-200 p-2 text-xs outline-none focus:border-violet-300"
          placeholder="这张地图的用途、覆盖范围…"
          value={map.desc ?? ''}
          onChange={(e) => props.onPatchMap({ desc: e.target.value })}
        />
      </Section>
      <Section title="画布尺寸（像素）">
        <div className="flex gap-2">
          <label className="flex-1 text-xs text-ink-500">
            宽
            <input
              type="number"
              min={400}
              max={6000}
              step={50}
              className="mt-1 w-full rounded border border-ink-200 px-2 py-1 text-sm"
              value={map.width}
              onChange={(e) => props.onPatchMap({ width: Math.min(6000, Math.max(400, Number(e.target.value) || 1600)) })}
            />
          </label>
          <label className="flex-1 text-xs text-ink-500">
            高
            <input
              type="number"
              min={300}
              max={4000}
              step={50}
              className="mt-1 w-full rounded border border-ink-200 px-2 py-1 text-sm"
              value={map.height}
              onChange={(e) => props.onPatchMap({ height: Math.min(4000, Math.max(300, Number(e.target.value) || 1000)) })}
            />
          </label>
        </div>
        <div className="mt-1 flex gap-1">
          {[
            { label: '1600×1000', w: 1600, h: 1000 },
            { label: '2400×1400', w: 2400, h: 1400 },
            { label: '3200×1800', w: 3200, h: 1800 }
          ].map((p) => (
            <button
              key={p.label}
              type="button"
              className="flex-1 rounded border border-ink-200 px-1 py-0.5 text-xs text-ink-500 hover:bg-ink-100"
              onClick={() => props.onPatchMap({ width: p.w, height: p.h })}
            >
              {p.label}
            </button>
          ))}
        </div>
      </Section>
      <Section title="底图（参考图层）">
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-100"
            onClick={props.onUploadBg}
          >
            上传图片
          </button>
          <button
            type="button"
            className="rounded border border-violet-200 px-2 py-1 text-xs text-violet-600 hover:bg-violet-50"
            title="AI 生成风格化底图（走「图片生成」模型路由）"
            onClick={props.onAiBg}
          >
            AI 生成底图
          </button>
          {map.background && (
            <>
              <button
                type="button"
                className="rounded border border-ink-200 px-2 py-1 text-xs hover:bg-ink-100"
                onClick={props.onResetBg}
              >
                适配画布
              </button>
              <button
                type="button"
                className="rounded border border-red-200 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
                onClick={props.onRemoveBg}
              >
                移除底图
              </button>
            </>
          )}
        </div>
        <label className="mt-1 flex items-center gap-2 text-xs text-ink-500">
          <input
            type="checkbox"
            className="accent-violet-600"
            checked={map.bg?.locked ?? true}
            onChange={(e) =>
              props.onPatchMap({ bg: { x: map.bg?.x ?? 0, y: map.bg?.y ?? 0, scale: map.bg?.scale ?? 1, locked: e.target.checked } })
            }
          />
          锁定底图（解锁后可拖动/缩放）
        </label>
        {map.bg && (
          <SliderRow
            label="底图缩放"
            min={0.1}
            max={4}
            step={0.05}
            value={map.bg.scale}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => props.onPatchMap({ bg: { x: map.bg?.x ?? 0, y: map.bg?.y ?? 0, scale: v, locked: map.bg?.locked ?? true } })}
          />
        )}
        <p className="text-xs leading-5 text-ink-400">
          底图用于对照描绘（如截取的真实地图、手绘草稿）。上传后解锁即可拖动定位。
        </p>
      </Section>
      <Section title="导出选项">
        <label className="flex items-center gap-2 text-xs text-ink-500">
          <input
            type="checkbox"
            className="accent-violet-600"
            checked={props.exportTransparent}
            onChange={(e) => props.onExportTransparent(e.target.checked)}
          />
          透明背景（不含底图与画布底色）
        </label>
        <label className="mt-1 block text-xs text-ink-500">
          导出倍率
          <select
            className="mt-0.5 w-full rounded border border-ink-200 px-1 py-1 text-sm"
            value={String(props.exportScale)}
            onChange={(e) => props.onExportScale(Number(e.target.value))}
          >
            <option value="1">1x</option>
            <option value="2">2x</option>
            <option value="3">3x</option>
          </select>
        </label>
      </Section>
      <div className="mt-auto rounded bg-ink-50 p-2 text-xs leading-5 text-ink-400">
        快捷键：Ctrl+S 保存 / Ctrl+Z 撤销 / Ctrl+Y 重做 / Ctrl+D 复制 / Ctrl+C·V 复制粘贴 / Del 删除 / B 笔刷 / E 橡皮 / Esc 停止
      </div>
    </aside>
  );
}
