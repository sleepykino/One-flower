/**
 * 地图属性面板（参考「易制地图」右侧设置窗）
 * - 未选中：地图属性（名称/描述/画布尺寸/底图管理）
 * - 选中节点：名称/图标元件库/形状尺寸/缩放/旋转/透明度/颜色/层级/世界书关联/描述
 * - 选中连线：名称/线型/曲直/线宽/颜色/箭头
 */

import { useState } from 'react';
import {
  ICON_LIBRARY,
  PALETTE,
  type MapConnection,
  type MapNode,
  type NovelMap
} from '../../services/map/types';

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

/** 图标元件选择器：分类 chips + emoji 网格 */
function IconPicker(props: { value?: string; onChange: (iconId: string | undefined) => void }): JSX.Element {
  const [cat, setCat] = useState(() => {
    if (!props.value) return ICON_LIBRARY[0].key;
    return ICON_LIBRARY.find((c) => c.icons.some((i) => i.id === props.value))?.key ?? ICON_LIBRARY[0].key;
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
    </div>
  );
}

export function MapInspector(props: MapInspectorProps): JSX.Element {
  const { map, entries, node, conn } = props;

  // ---------- 连线属性 ----------
  if (conn) {
    return (
      <aside className="flex w-60 shrink-0 flex-col gap-4 overflow-y-auto border-l border-ink-200 p-3">
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
              <option value="straight">直线</option>
              <option value="curve">弧线</option>
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
    return (
      <aside className="flex w-60 shrink-0 flex-col gap-4 overflow-y-auto border-l border-ink-200 p-3">
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
          <Section title="图标元件">
            <IconPicker value={node.icon} onChange={(iconId) => props.onPatchNode(node.id, { icon: iconId, shape: iconId ? 'icon' : node.shape === 'icon' ? 'circle' : node.shape })} />
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
    <aside className="flex w-60 shrink-0 flex-col gap-4 overflow-y-auto border-l border-ink-200 p-3">
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
      <div className="mt-auto rounded bg-ink-50 p-2 text-xs leading-5 text-ink-400">
        快捷键：Ctrl+Z 撤销 / Ctrl+Y 重做 / Ctrl+D 复制 / Del 删除 / Esc 停止放置
      </div>
    </aside>
  );
}
