/**
 * 地图编辑器顶部工具栏（自 MapEditor 拆出）：
 * 标题 + 地图切换下拉 + 保存状态 + 撤销/重做/缩放/自动布局/预设生成/AI/导出/插入正文/保存/关闭
 */

import type { NovelMap } from '../../services/map/types';

interface MapToolbarProps {
  maps: NovelMap[];
  currentMap: NovelMap | null;
  dirty: boolean;
  saveStatus: string;
  canUndo: boolean;
  canRedo: boolean;
  zoomPct: number;
  genOpen: boolean;
  aiOpen: boolean;
  hasAiGenerate: boolean;
  exportScale: number;
  exportTransparent: boolean;
  onSwitchMap: (id: string) => void;
  onCreateMap: () => void;
  onUndo: () => void;
  onRedo: () => void;
  /** 以画布中心为锚点缩放（factor > 1 放大） */
  onZoom: (factor: number) => void;
  onFit: () => void;
  onAutoLayout: () => void;
  onToggleGen: () => void;
  onToggleAi: () => void;
  onExportPng: () => void;
  onInsertToDoc: () => void;
  onSave: () => void;
  onClose: () => void;
}

export function MapToolbar(props: MapToolbarProps): JSX.Element {
  const { currentMap } = props;
  return (
    <div className="flex items-center justify-between gap-2 border-b border-ink-200 px-4 py-1.5">
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-sm font-semibold">地图编辑</span>
        {/* 地图切换下拉（左栏列表之外的显式入口） */}
        {currentMap && (
          <select
            value={currentMap.id}
            className="min-w-0 max-w-40 truncate rounded border border-ink-200 px-1.5 py-0.5 text-xs outline-none hover:border-violet-300"
            title="切换地图"
            onChange={(e) => {
              const v = e.target.value;
              if (v === '__new__') {
                e.target.value = currentMap.id;
                props.onCreateMap();
              } else {
                props.onSwitchMap(v);
              }
            }}
          >
            {props.maps.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
            <option value="__new__">＋ 新建地图…</option>
          </select>
        )}
        {currentMap && (
          <span className="truncate text-xs text-ink-400">
            {props.dirty ? '有未保存修改' : props.saveStatus || '就绪'}
          </span>
        )}
      </div>
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          title="撤销 (Ctrl+Z)"
          disabled={!props.canUndo}
          className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100 disabled:opacity-40"
          onClick={props.onUndo}
        >
          ↶
        </button>
        <button
          type="button"
          title="重做 (Ctrl+Y)"
          disabled={!props.canRedo}
          className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100 disabled:opacity-40"
          onClick={props.onRedo}
        >
          ↷
        </button>
        <div className="mx-1 flex items-center overflow-hidden rounded border border-ink-200">
          <button
            type="button"
            title="缩小"
            className="px-2 py-1 text-sm hover:bg-ink-100"
            onClick={() => props.onZoom(1 / 1.2)}
          >
            −
          </button>
          <span className="w-12 text-center text-xs tabular-nums text-ink-500">{props.zoomPct}%</span>
          <button
            type="button"
            title="放大"
            className="px-2 py-1 text-sm hover:bg-ink-100"
            onClick={() => props.onZoom(1.2)}
          >
            +
          </button>
          <button
            type="button"
            title="适应画布"
            className="border-l border-ink-200 px-2 py-1 text-xs hover:bg-ink-100"
            onClick={props.onFit}
          >
            适应
          </button>
        </div>
        <button
          type="button"
          className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100 disabled:opacity-40"
          disabled={!currentMap}
          title="力导向自动排布地点节点（可撤销）"
          onClick={props.onAutoLayout}
        >
          自动布局
        </button>
        <button
          type="button"
          className={`rounded border px-2 py-1 text-sm ${
            props.genOpen ? 'border-emerald-300 text-emerald-700' : 'border-ink-200 hover:bg-ink-100'
          }`}
          disabled={!currentMap}
          title="预设地形生成（环岛/群岛/大陆等，seeded 可复现）"
          onClick={props.onToggleGen}
        >
          预设生成
        </button>
        {props.hasAiGenerate && (
          <button
            type="button"
            className={`rounded border px-2 py-1 text-sm ${
              props.aiOpen ? 'border-violet-300 text-violet-700' : 'border-ink-200 hover:bg-ink-100'
            }`}
            onClick={props.onToggleAi}
          >
            AI 生成
          </button>
        )}
        <button
          type="button"
          className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100"
          onClick={props.onExportPng}
          title={`导出为 PNG 图片（${props.exportScale}x${props.exportTransparent ? '，透明背景' : ''}）`}
        >
          导出 PNG
        </button>
        <button
          type="button"
          className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100"
          onClick={props.onInsertToDoc}
          title="当前地图导出为 PNG 插入正文光标处（作为插图）"
        >
          插入正文
        </button>
        <button
          type="button"
          className="rounded border border-violet-300 px-2 py-1 text-sm text-violet-700 hover:bg-violet-50"
          onClick={props.onSave}
        >
          保存
        </button>
        <button
          type="button"
          className="rounded border border-ink-200 px-2 py-1 text-sm hover:bg-ink-100"
          onClick={props.onClose}
          title="关闭"
        >
          ×
        </button>
      </div>
    </div>
  );
}
