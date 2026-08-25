import { describe, expect, it } from 'vitest';
import { autoLayoutNodes } from '../../src/services/map/autoLayout';
import type { MapConnection, MapNode } from '../../src/services/map/types';

// T10.5：节点力导向自动布局纯函数单测
// 确定性算法（无随机源）：同输入必得同输出；纯函数不改入参

function node(id: string, x: number, y: number, type: MapNode['type'] = 'location'): MapNode {
  return { id, type, label: id, x, y, shape: 'circle', radius: 16, color: '#888' };
}

function conn(id: string, from: string, to: string): MapConnection {
  return { id, fromNodeId: from, toNodeId: to, label: '', style: 'solid' };
}

function dist(a: MapNode, b: MapNode): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

describe('autoLayoutNodes', () => {
  it('无 location 节点时原样返回', () => {
    const nodes = [node('m1', 10, 10, 'marker')];
    expect(autoLayoutNodes(nodes, [], { width: 800, height: 600 })).toBe(nodes);
  });

  it('纯函数：不修改入节数组与节点对象', () => {
    const a = node('a', 100, 100);
    const b = node('b', 700, 500);
    const snapshot = JSON.parse(JSON.stringify([a, b]));
    autoLayoutNodes([a, b], [conn('c', 'a', 'b')], { width: 800, height: 600 });
    expect(JSON.parse(JSON.stringify([a, b]))).toEqual(snapshot);
  });

  it('确定性：同一输入两次运行结果逐节点一致', () => {
    const mkNodes = (): MapNode[] => [node('a', 120, 90), node('b', 640, 520), node('c', 400, 300)];
    const conns = [conn('c1', 'a', 'b'), conn('c2', 'b', 'c')];
    const r1 = autoLayoutNodes(mkNodes(), conns, { width: 800, height: 600 });
    const r2 = autoLayoutNodes(mkNodes(), conns, { width: 800, height: 600 });
    expect(r1).toEqual(r2);
  });

  it('重叠节点被斥力分开，连线弹簧使相连节点距离收敛于有限范围', () => {
    // a/b 重叠且相连；c 独立
    const nodes = [node('a', 400, 300), node('b', 401, 301), node('c', 400, 299)];
    const out = autoLayoutNodes(nodes, [conn('c', 'a', 'b')], { width: 900, height: 700 });
    const oa = out.find((n) => n.id === 'a')!;
    const ob = out.find((n) => n.id === 'b')!;
    // 原间距 ~1.4px，布局后明显分离（斥力生效）
    expect(dist(oa, ob)).toBeGreaterThan(20);
    // 但仍受弹簧牵引保持在同一量级（restLen 内外，不至于飞出画布对角）
    expect(dist(oa, ob)).toBeLessThan(900);
  });

  it('边界约束：所有 location 节点落在 [40, W-40] × [40, H-40] 内并取整', () => {
    const nodes = [
      node('a', -5000, -5000),
      node('b', 99999, 99999),
      node('c', 400, 300)
    ];
    const out = autoLayoutNodes(nodes, [], { width: 1000, height: 800 });
    for (const n of out) {
      expect(n.x).toBeGreaterThanOrEqual(40);
      expect(n.x).toBeLessThanOrEqual(960);
      expect(n.y).toBeGreaterThanOrEqual(40);
      expect(n.y).toBeLessThanOrEqual(760);
      expect(Number.isInteger(n.x)).toBe(true);
      expect(Number.isInteger(n.y)).toBe(true);
    }
  });

  it('marker/region 类型节点坐标不被改动', () => {
    const marker = node('m1', 111, 222, 'marker');
    const region = node('r1', 333, 444, 'region');
    const loc = node('l1', 555, 666);
    const out = autoLayoutNodes([marker, region, loc], [], { width: 800, height: 600 });
    expect(out.find((n) => n.id === 'm1')).toMatchObject({ x: 111, y: 222 });
    expect(out.find((n) => n.id === 'r1')).toMatchObject({ x: 333, y: 444 });
    // location 参与布局
    expect(out.find((n) => n.id === 'l1')).not.toMatchObject({ x: 555, y: 666 });
  });

  it('自环连接被忽略，不产生 NaN', () => {
    const nodes = [node('a', 100, 100)];
    const out = autoLayoutNodes(nodes, [conn('self', 'a', 'a')], { width: 800, height: 600 });
    expect(Number.isFinite(out[0].x)).toBe(true);
    expect(Number.isFinite(out[0].y)).toBe(true);
  });
});
