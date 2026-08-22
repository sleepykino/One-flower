/**
 * 地形预设定义（P4.1-M3）：预设注册制 + 参数规格（ParamSpec 驱动向导 UI）
 * 算法思想参考 Azgaar FantasyMapGenerator 的高度图模板（MIT）：
 * 多中心径向衰减场 + 值噪声扰动 + 海平面按陆地占比分位切割，全部 seeded 可复现
 */

export type TerrainParamKey =
  | 'landRatio'
  | 'roughness'
  | 'islandCount'
  | 'symmetry'
  | 'palette'
  | 'settlements';

export interface TerrainParamSpec {
  key: TerrainParamKey;
  label: string;
  type: 'slider' | 'select';
  min?: number;
  max?: number;
  step?: number;
  options?: Array<{ value: string; label: string }>;
  default: number | string;
  /** 仅这些预设显示（缺省全显示） */
  showFor?: string[];
}

export interface TerrainPreset {
  key: string;
  label: string;
  desc: string;
  /** 卡片示意图（emoji 拼贴，无需图片资源） */
  badge: string;
  params: TerrainParamSpec[];
}

/** 通用参数（各预设共享定义，default 可被覆盖） */
const P_LAND: TerrainParamSpec = {
  key: 'landRatio',
  label: '陆地占比',
  type: 'slider',
  min: 0.1,
  max: 0.6,
  step: 0.05,
  default: 0.32
};
const P_ROUGH: TerrainParamSpec = {
  key: 'roughness',
  label: '海岸粗糙度',
  type: 'slider',
  min: 0.3,
  max: 1.2,
  step: 0.1,
  default: 0.7
};
const P_ISLANDS: TerrainParamSpec = {
  key: 'islandCount',
  label: '岛屿数量',
  type: 'slider',
  min: 3,
  max: 30,
  step: 1,
  default: 10,
  showFor: ['archipelago']
};
const P_SYM: TerrainParamSpec = {
  key: 'symmetry',
  label: '对称',
  type: 'select',
  options: [
    { value: 'none', label: '不对称' },
    { value: 'x', label: '左右对称' },
    { value: 'y', label: '上下对称' }
  ],
  default: 'none'
};
const P_PALETTE: TerrainParamSpec = {
  key: 'palette',
  label: '气候色系',
  type: 'select',
  options: [
    { value: 'temperate', label: '温带（默认）' },
    { value: 'arid', label: '干旱（沙漠偏多）' },
    { value: 'tropical', label: '湿热（丛林偏多）' }
  ],
  default: 'temperate'
};
const P_SETTLE: TerrainParamSpec = {
  key: 'settlements',
  label: '聚居点撒点',
  type: 'slider',
  min: 0,
  max: 20,
  step: 1,
  default: 6
};

function preset(
  key: string,
  label: string,
  desc: string,
  badge: string,
  overrides: Partial<Record<TerrainParamKey, number | string>>,
  hideKeys: TerrainParamKey[] = []
): TerrainPreset {
  const all: TerrainParamSpec[] = [P_LAND, P_ROUGH, P_ISLANDS, P_SYM, P_PALETTE, P_SETTLE];
  const params = all
    .filter((p) => !hideKeys.includes(p.key))
    .map((p) => (overrides[p.key] !== undefined ? { ...p, default: overrides[p.key] as number | string } : p));
  return { key, label, desc, badge, params };
}

export const TERRAIN_PRESETS: TerrainPreset[] = [
  preset('atoll', '环岛', '环状礁屿围中心潟湖，海上桃源', '🏝️', { landRatio: 0.18, islandCount: 1 }, []),
  preset('archipelago', '群岛', '多中心散布的岛链，适合航海文明', '🗺️', { landRatio: 0.3, islandCount: 10 }, []),
  preset('continent', '大块陆地', '单一大陆 + 破碎海岸与边缘岛屿', '⛰️', { landRatio: 0.45 }, ['islandCount']),
  preset('highIsland', '大岛屿', '以山地为主的大岛，中央高地', '🌄', { landRatio: 0.32 }, ['islandCount']),
  preset('lowIsland', '小岛屿', '平坦沿海的小岛，沙滩与平原', '🏖️', { landRatio: 0.2 }, ['islandCount']),
  preset('pangaea', '泛大陆', '近乎全陆的巨大陆块，内陆海点缀', '🌏', { landRatio: 0.62 }, ['islandCount']),
  preset('peninsula', '半岛', '自一侧伸入海洋的狭长陆地', '⚓', { landRatio: 0.28 }, ['islandCount'])
];

/** 预设默认参数表（向导初始值） */
export function presetDefaults(p: TerrainPreset): Record<string, number | string> {
  const out: Record<string, number | string> = {};
  for (const param of p.params) out[param.key] = param.default;
  return out;
}
