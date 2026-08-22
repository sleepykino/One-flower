/**
 * 预设地形生成向导（P4.1-M3）：预设卡片 + 参数（ParamSpec 驱动）+ seed 锁定
 * 生成走 generateTerrainPreset（seeded 可复现）+ 可选聚居撒点，结果交回编辑器落层
 */

import { useMemo, useState } from 'react';
import {
  TERRAIN_PRESETS,
  presetDefaults,
  type TerrainParamSpec,
  type TerrainPreset
} from '../../services/map/terrainPresets';
import { generateTerrainPreset, scatterSettlements, type ScatterSite } from '../../services/map/terrainGen';
import type { MapTiles } from '../../services/map/types';

export interface GenResult {
  tiles: MapTiles;
  settlements: ScatterSite[];
  seed: number;
  /** 落到新建层（true）或覆盖当前激活层（false） */
  newLayer: boolean;
}

interface Props {
  cols: number;
  rows: number;
  onClose: () => void;
  onGenerate: (result: GenResult) => void;
}

function ParamControl({
  spec,
  value,
  onChange
}: {
  spec: TerrainParamSpec;
  value: number | string;
  onChange: (v: number | string) => void;
}): JSX.Element {
  if (spec.type === 'select') {
    return (
      <label className="block text-xs text-ink-500">
        {spec.label}
        <select
          className="mt-0.5 w-full rounded border border-ink-200 px-1.5 py-1 text-xs"
          value={String(value)}
          onChange={(e) => onChange(e.target.value)}
        >
          {(spec.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      </label>
    );
  }
  const min = spec.min ?? 0;
  const max = spec.max ?? 1;
  const step = spec.step ?? 0.1;
  const fmt = step >= 1 ? String(Math.round(Number(value))) : (Number(value)).toFixed(step < 0.1 ? 2 : 1);
  return (
    <label className="block text-xs text-ink-500">
      <div className="flex justify-between">
        <span>{spec.label}</span>
        <span className="tabular-nums text-ink-400">
          {spec.key === 'settlements' && Number(value) === 0 ? '关' : fmt}
        </span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={Number(value)}
        className="mt-0.5 w-full accent-emerald-600"
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </label>
  );
}

export function MapGenDialog(props: Props): JSX.Element {
  const [presetKey, setPresetKey] = useState('archipelago');
  const preset: TerrainPreset = useMemo(
    () => TERRAIN_PRESETS.find((p) => p.key === presetKey) ?? TERRAIN_PRESETS[0],
    [presetKey]
  );
  const [values, setValues] = useState<Record<string, number | string>>(() => presetDefaults(TERRAIN_PRESETS[1]));
  const [seed, setSeed] = useState(() => Math.floor(Math.random() * 2 ** 31));
  const [lockSeed, setLockSeed] = useState(false);
  const [newLayer, setNewLayer] = useState(true);

  const pickPreset = (p: TerrainPreset): void => {
    setPresetKey(p.key);
    setValues((prev) => ({ ...presetDefaults(p), seed: prev.seed }));
  };

  const generate = (): void => {
    const nextSeed = lockSeed ? seed : Math.floor(Math.random() * 2 ** 31);
    if (!lockSeed) setSeed(nextSeed);
    const tiles = generateTerrainPreset(presetKey, values, nextSeed, props.cols, props.rows);
    const settlements = Number(values.settlements ?? 0) > 0 ? scatterSettlements(tiles, nextSeed, Number(values.settlements)) : [];
    props.onGenerate({ tiles, settlements, seed: nextSeed, newLayer });
  };

  return (
    <div className="absolute right-64 top-4 z-10 w-[380px] rounded border border-ink-200 bg-white p-3 shadow-lg">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium">预设地形生成</span>
        <button type="button" className="text-xs text-ink-400 hover:text-ink-700" onClick={props.onClose}>
          ✕
        </button>
      </div>

      {/* 预设卡片 */}
      <div className="grid grid-cols-4 gap-1">
        {TERRAIN_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            title={p.desc}
            className={`rounded border px-1 py-1.5 text-center text-[11px] leading-tight ${
              p.key === presetKey
                ? 'border-emerald-400 bg-emerald-50 text-emerald-700'
                : 'border-ink-200 text-ink-600 hover:bg-ink-100'
            }`}
            onClick={() => pickPreset(p)}
          >
            <div className="text-base">{p.badge}</div>
            {p.label}
          </button>
        ))}
      </div>
      <div className="mt-1 text-[11px] leading-4 text-ink-400">{preset.desc}</div>

      {/* 参数 */}
      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
        {preset.params
          .filter((s) => !s.showFor || s.showFor.includes(presetKey))
          .map((s) => (
            <ParamControl
              key={s.key}
              spec={s}
              value={values[s.key] ?? s.default}
              onChange={(v) => setValues((prev) => ({ ...prev, [s.key]: v }))}
            />
          ))}
      </div>

      {/* seed 与落层 */}
      <div className="mt-2 flex items-center gap-2 text-xs text-ink-500">
        <label className="flex items-center gap-1" title="锁定后同参数重新生成结果一致">
          <input type="checkbox" className="accent-emerald-600" checked={lockSeed} onChange={(e) => setLockSeed(e.target.checked)} />
          锁定 seed
        </label>
        <input
          type="number"
          className="w-24 rounded border border-ink-200 px-1.5 py-0.5 font-mono text-[11px] outline-none focus:border-emerald-400"
          value={seed}
          onChange={(e) => setSeed(Number(e.target.value) || 0)}
        />
        <label className="ml-auto flex items-center gap-1" title="不覆盖当前层，新建一层放置生成结果">
          <input type="checkbox" className="accent-emerald-600" checked={newLayer} onChange={(e) => setNewLayer(e.target.checked)} />
          新建一层
        </label>
      </div>

      <div className="mt-3 flex justify-end gap-2">
        <button
          type="button"
          className="rounded border border-emerald-300 bg-emerald-50 px-3 py-1 text-sm text-emerald-700 hover:bg-emerald-100"
          onClick={generate}
        >
          生成
        </button>
      </div>
      <div className="mt-2 text-[11px] leading-relaxed text-ink-400">
        生成结果可撤销；「新建一层」关闭时覆盖当前激活瓦片层。聚居点作为地点节点追加。
      </div>
    </div>
  );
}
