/**
 * 节点自动布局（P4.1-M4）：力导向排布 location 节点
 * 斥力（全对）+ 连线弹簧 + 边界约束，纯函数不改入参；结果由调用方压入撤销栈
 */

import type { MapConnection, MapNode } from './types';

export function autoLayoutNodes(
  nodes: MapNode[],
  connections: MapConnection[],
  opts?: { iterations?: number; width: number; height: number }
): MapNode[] {
  const iter = opts?.iterations ?? 60;
  const W = opts?.width;
  const H = opts?.height;
  const locs = nodes.filter((n) => n.type === 'location');
  if (locs.length === 0) return nodes;
  const idSet = new Set(locs.map((n) => n.id));

  const px = new Map<string, number>();
  const py = new Map<string, number>();
  for (const n of locs) {
    px.set(n.id, n.x);
    py.set(n.id, n.y);
  }
  // 连接度高的节点先粗略居中（初始布局质量）
  const deg = new Map<string, number>(locs.map((n) => [n.id, 0]));
  for (const c of connections) {
    if (idSet.has(c.fromNodeId)) deg.set(c.fromNodeId, (deg.get(c.fromNodeId) ?? 0) + 1);
    if (idSet.has(c.toNodeId)) deg.set(c.toNodeId, (deg.get(c.toNodeId) ?? 0) + 1);
  }
  if (W && H) {
    const cx = W / 2;
    const cy = H / 2;
    for (const n of locs) {
      const d = deg.get(n.id) ?? 0;
      const pull = Math.min(0.6, d * 0.15);
      px.set(n.id, px.get(n.id)! * (1 - pull) + cx * pull);
      py.set(n.id, py.get(n.id)! * (1 - pull) + cy * pull);
    }
  }

  const springs = connections
    .filter((c) => idSet.has(c.fromNodeId) && idSet.has(c.toNodeId) && c.fromNodeId !== c.toNodeId)
    .map((c) => ({ a: c.fromNodeId, b: c.toNodeId }));
  const restLen = Math.max(120, Math.sqrt(((W ?? 1200) * (H ?? 800)) / Math.max(locs.length, 1)) * 0.9);
  const repulse = restLen * restLen * 0.5;
  const damping = 0.85;

  for (let it = 0; it < iter; it++) {
    const fx = new Map<string, number>(locs.map((n) => [n.id, 0]));
    const fy = new Map<string, number>(locs.map((n) => [n.id, 0]));
    // 斥力（全对，O(n²)，节点量级 <300 可接受）
    for (let i = 0; i < locs.length; i++) {
      for (let j = i + 1; j < locs.length; j++) {
        const a = locs[i].id;
        const b = locs[j].id;
        let dx = px.get(a)! - px.get(b)!;
        let dy = py.get(a)! - py.get(b)!;
        let d2 = dx * dx + dy * dy;
        if (d2 < 1) {
          dx = 0.5;
          dy = 0.5;
          d2 = 0.5;
        }
        const f = repulse / d2;
        const d = Math.sqrt(d2);
        fx.set(a, fx.get(a)! + (dx / d) * f);
        fy.set(a, fy.get(a)! + (dy / d) * f);
        fx.set(b, fx.get(b)! - (dx / d) * f);
        fy.set(b, fy.get(b)! - (dy / d) * f);
      }
    }
    // 弹簧引力
    for (const s of springs) {
      const dx = px.get(s.b)! - px.get(s.a)!;
      const dy = py.get(s.b)! - py.get(s.a)!;
      const d = Math.hypot(dx, dy) || 1;
      const f = (d - restLen) * 0.06;
      fx.set(s.a, fx.get(s.a)! + (dx / d) * f);
      fy.set(s.a, fy.get(s.a)! + (dy / d) * f);
      fx.set(s.b, fx.get(s.b)! - (dx / d) * f);
      fy.set(s.b, fy.get(s.b)! - (dy / d) * f);
    }
    // 积分 + 边界约束 + 迭代衰减
    const cool = damping * (1 - it / iter) + 0.05;
    for (const n of locs) {
      const nx = px.get(n.id)! + Math.max(-40, Math.min(40, fx.get(n.id)!)) * cool;
      const ny = py.get(n.id)! + Math.max(-40, Math.min(40, fy.get(n.id)!)) * cool;
      const bx = W ? Math.min(W - 40, Math.max(40, nx)) : nx;
      const by = H ? Math.min(H - 40, Math.max(40, ny)) : ny;
      px.set(n.id, bx);
      py.set(n.id, by);
    }
  }

  return nodes.map((n) =>
    idSet.has(n.id) ? { ...n, x: Math.round(px.get(n.id)!), y: Math.round(py.get(n.id)!) } : n
  );
}
