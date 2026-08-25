import { describe, expect, it } from 'vitest';
import { MAP_DATA_VERSION, migrateMapData } from '../../src/services/map/migrate';
import type { MapTiles } from '../../src/services/map/types';

// T10.5：地图 data JSON 迁移纯函数单测
// v0/v1（tiles 单层）-> v2（tileLayers 多层）；损坏数据容错降级不抛错

function tiles(cols: number, rows: number, fill: string[] | string): MapTiles {
  const data = typeof fill === 'string' ? new Array<string>(cols * rows).fill(fill) : fill;
  return { cols, rows, size: 32, data };
}

describe('migrateMapData', () => {
  it('接受 JSON 字符串或已解析对象两种入参', () => {
    const fromString = migrateMapData(JSON.stringify({ nodes: [], connections: [] }));
    const fromObject = migrateMapData({ nodes: [], connections: [] });
    expect(fromString.version).toBe(MAP_DATA_VERSION);
    expect(fromObject.version).toBe(MAP_DATA_VERSION);
  });

  it('v1 单层 tiles 迁移为第 0 个瓦片图层（名称「地形」、可见）', () => {
    const v1 = {
      desc: '旧图',
      nodes: [{ id: 'n1' }],
      connections: [{ id: 'c1' }],
      tiles: tiles(2, 2, ['grass', 'water', 'sand', 'hill'])
    };
    const out = migrateMapData(v1);
    expect(out.version).toBe(2);
    expect(out.tileLayers).toHaveLength(1);
    expect(out.tileLayers[0].name).toBe('地形');
    expect(out.tileLayers[0].visible).toBe(true);
    expect(out.tileLayers[0].tiles.data).toEqual(['grass', 'water', 'sand', 'hill']);
    expect(out.nodes).toEqual([{ id: 'n1' }]);
    expect(out.connections).toEqual([{ id: 'c1' }]);
    expect(out.desc).toBe('旧图');
    expect(out.activeTileLayer).toBe(0);
  });

  it('v2 多层数据透传保留；activeTileLayer 越界回落 0', () => {
    const v2 = {
      version: 2,
      tileLayers: [
        { id: 'l1', name: '地形', visible: true, tiles: tiles(2, 1, ['grass', 'grass']) },
        { id: 'l2', name: '装饰', visible: false, tiles: tiles(2, 1, ['', 'tree']) }
      ],
      activeTileLayer: 5,
      bg: { x: 10, y: 20, scale: 1.5, locked: false }
    };
    const out = migrateMapData(v2);
    expect(out.tileLayers).toHaveLength(2);
    expect(out.tileLayers[1].name).toBe('装饰');
    expect(out.tileLayers[1].visible).toBe(false);
    expect(out.activeTileLayer).toBe(0);
    expect(out.bg).toEqual({ x: 10, y: 20, scale: 1.5, locked: false });
  });

  it('损坏图层（cols/rows 与 data 长度不符）被丢弃，不拖垮整张地图', () => {
    const bad = {
      tileLayers: [
        { id: 'bad', name: '坏层', visible: true, tiles: { cols: 3, rows: 3, size: 32, data: ['x'] } },
        { id: 'ok', name: '好层', visible: true, tiles: tiles(1, 2, ['a', 'b']) }
      ]
    };
    const out = migrateMapData(bad);
    expect(out.tileLayers).toHaveLength(1);
    expect(out.tileLayers[0].id).toBe('ok');
  });

  it('非法输入（乱码字符串 / 数组 / null）安全降级为空白 v2 结构', () => {
    for (const garbage of ['{不是JSON', [1, 2], null, undefined]) {
      const out = migrateMapData(garbage as unknown);
      expect(out.version).toBe(2);
      expect(out.nodes).toEqual([]);
      expect(out.connections).toEqual([]);
      expect(out.tileLayers).toEqual([]);
      expect(out.desc).toBeUndefined();
    }
  });

  it('缺省字段补默认值：desc/bg 未给则 undefined，图层名缺失自动命名', () => {
    const out = migrateMapData({
      tileLayers: [{ tiles: tiles(1, 1, ['grass']) }]
    });
    expect(out.tileLayers[0].name).toBe('图层 1');
    expect(out.tileLayers[0].id).toBeTruthy();
    expect(out.desc).toBeUndefined();
    expect(out.bg).toBeUndefined();
  });

  it('bg 变换对象（x/y/scale）透传保留；非对象忽略为 undefined', () => {
    const bg = { x: 10, y: 20, scale: 1.5, locked: true };
    const out = migrateMapData({ bg });
    expect(out.bg).toEqual(bg);
    expect(migrateMapData({ bg: 'url(bg.png)' }).bg).toBeUndefined();
    expect(migrateMapData({ bg: [1, 2] }).bg).toBeUndefined();
  });
});
