/**
 * 地图编辑器左侧「图层」面板（自 MapEditor 拆出）：
 * 瓦片图层管理（新建/显隐/重命名/上下移/删除）+ 六类画布元素显隐
 */

import { LAYER_LABELS, type LayerVisibility, type MapTileLayer } from '../../services/map/types';

interface MapLayerPanelProps {
  tileLayers: MapTileLayer[];
  activeLayerIdx: number;
  visibility: LayerVisibility;
  onAddLayer: () => void;
  onRemoveLayer: (idx: number) => void;
  onMoveLayer: (idx: number, dir: -1 | 1) => void;
  onRenameLayer: (idx: number, name: string) => void;
  onToggleLayerVisible: (idx: number) => void;
  onToggleVisibility: (key: keyof LayerVisibility) => void;
}

export function MapLayerPanel(props: MapLayerPanelProps): JSX.Element {
  return (
    <>
      <div
        className="mt-auto border-t border-ink-200 px-3 pb-1 pt-2.5 text-sm font-medium"
        data-tour="map-layers"
      >
        图层
      </div>
      <div className="px-2 pb-2">
        <div className="mb-1 flex items-center justify-between text-xs text-ink-500">
          <span>瓦片图层（{props.tileLayers.length}）</span>
          <button
            type="button"
            className="rounded border border-ink-200 px-1.5 py-0.5 text-[11px] hover:bg-ink-100"
            onClick={props.onAddLayer}
          >
            + 新建层
          </button>
        </div>
        <div className="mb-2 space-y-0.5">
          {props.tileLayers.map((l, i) => (
            <div
              key={l.id}
              className={`flex items-center gap-1 rounded border px-1.5 py-0.5 text-xs ${
                i === props.activeLayerIdx ? 'border-violet-300 bg-violet-50' : 'border-ink-100'
              }`}
            >
              <button type="button" title={l.visible ? '隐藏该层' : '显示该层'} className="shrink-0" onClick={() => props.onToggleLayerVisible(i)}>
                {l.visible ? '👁' : '🚫'}
              </button>
              <input
                className="min-w-0 flex-1 bg-transparent text-xs outline-none"
                value={l.name}
                onChange={(e) => props.onRenameLayer(i, e.target.value)}
                title="图层名（直接编辑）"
              />
              <button
                type="button"
                title="上移（渲染更靠上）"
                className="shrink-0 text-ink-400 hover:text-ink-700"
                onClick={() => props.onMoveLayer(i, -1)}
              >
                ↑
              </button>
              <button
                type="button"
                title="下移"
                className="shrink-0 text-ink-400 hover:text-ink-700"
                onClick={() => props.onMoveLayer(i, 1)}
              >
                ↓
              </button>
              <button
                type="button"
                title="删除该层"
                className="shrink-0 text-red-400 hover:text-red-600"
                onClick={() => props.onRemoveLayer(i)}
              >
                ✕
              </button>
            </div>
          ))}
          {props.tileLayers.length === 0 && (
            <div className="rounded border border-dashed border-ink-200 px-2 py-1.5 text-[11px] text-ink-400">
              无瓦片图层。笔刷落下第一笔会自动创建，或点「+ 新建层」/「预设生成」。
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-1">
          {LAYER_LABELS.map((l) => (
            <button
              key={l.key}
              type="button"
              className={`rounded border px-1 py-1 text-xs ${
                props.visibility[l.key] ? 'border-ink-200 text-ink-600' : 'border-ink-200 bg-ink-100 text-ink-400'
              }`}
              onClick={() => props.onToggleVisibility(l.key)}
            >
              {props.visibility[l.key] ? '👁 ' : '🚫 '}
              {l.label}
            </button>
          ))}
        </div>
      </div>
    </>
  );
}
