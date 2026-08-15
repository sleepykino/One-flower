/* =========================================================
 * 沙之地图 · Map Editor  —— app.js
 * 功能：多风格地图编辑器，支持随机生成 / 自由绘制 / 图层 / 导出
 * ========================================================= */

/* ---------- Perlin 噪声 ---------- */
class PerlinNoise {
  constructor(seed = 0) {
    this.perm = this._build(seed);
  }
  _build(seed) {
    let s = (seed | 0) || 1;
    const rand = () => { s = (s * 16807) % 2147483647; return (s - 1) / 2147483646; };
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      const t = p[i]; p[i] = p[j]; p[j] = t;
    }
    const perm = new Uint8Array(512);
    for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
    return perm;
  }
  _fade(t) { return t * t * t * (t * (t * 6 - 15) + 10); }
  _lerp(a, b, t) { return a + t * (b - a); }
  _grad(h, x, y) {
    const u = (h & 1) ? -x : x;
    const v = (h & 2) ? -y : y;
    return ((h & 4) ? u + v : u - v);
  }
  noise2(x, y) {
    const X = Math.floor(x) & 255, Y = Math.floor(y) & 255;
    x -= Math.floor(x); y -= Math.floor(y);
    const u = this._fade(x), v = this._fade(y);
    const p = this.perm;
    const A = p[X] + Y, B = p[X + 1] + Y;
    return this._lerp(
      this._lerp(this._grad(p[A], x, y), this._grad(p[B], x - 1, y), u),
      this._lerp(this._grad(p[A + 1], x, y - 1), this._grad(p[B + 1], x - 1, y - 1), u),
      v
    );
  }
  // 分形布朗运动（多层叠加）
  fbm(x, y, octaves = 6, persistence = 0.5, lacunarity = 2.0) {
    let total = 0, freq = 1, amp = 1, max = 0;
    for (let i = 0; i < octaves; i++) {
      total += this.noise2(x * freq, y * freq) * amp;
      max += amp; amp *= persistence; freq *= lacunarity;
    }
    return total / max; // [-1,1] 近似
  }
}

/* ---------- 风格定义 ---------- */
const STYLES = {
  fantasy: {
    name: '奇幻世界',
    tiles: [
      { id: 0, name: '深海', color: '#1a4a7a' },
      { id: 1, name: '海洋', color: '#2d6db3' },
      { id: 2, name: '浅海', color: '#4a9fd4' },
      { id: 3, name: '沙滩', color: '#e8d9a0' },
      { id: 4, name: '草原', color: '#7cb342' },
      { id: 5, name: '森林', color: '#3f7d2e' },
      { id: 6, name: '丘陵', color: '#a8a04a' },
      { id: 7, name: '山脉', color: '#8a7a5c' },
      { id: 8, name: '雪峰', color: '#f0f0f0' },
      { id: 9, name: '沙漠', color: '#e0c080' },
      { id: 10, name: '沼泽', color: '#5a6a3a' },
    ],
    stamps: ['🏰','🏘','⛰','🌲','💧','🚢','🐉','⛺','🌋','⚓','💠','🌟'],
    bg: 0,
    gridColor: 'rgba(0,0,0,0.08)',
  },
  terrain: {
    name: '像素地形',
    tiles: [
      { id: 0, name: '深海', color: '#0d3b66' },
      { id: 1, name: '海洋', color: '#1d6fa5' },
      { id: 2, name: '浅海', color: '#5fb3d4' },
      { id: 3, name: '海滩', color: '#f4e4a1' },
      { id: 4, name: '草地', color: '#8bc34a' },
      { id: 5, name: '森林', color: '#2e7d32' },
      { id: 6, name: '针叶', color: '#4a6a4a' },
      { id: 7, name: '苔原', color: '#b0b8a8' },
      { id: 8, name: '岩石', color: '#6b6b6b' },
      { id: 9, name: '雪山', color: '#ffffff' },
      { id: 10, name: '沙漠', color: '#e8c87a' },
      { id: 11, name: '草原', color: '#c4b06a' },
    ],
    stamps: ['🌲','🌴','🏔','⛺','💧','🪨','🌸','🌾','🦌','🌋','❄','🔆'],
    bg: 0,
    gridColor: 'rgba(0,0,0,0.06)',
  },
  island: {
    name: '孤岛海域',
    tiles: [
      { id: 0, name: '深海', color: '#0a2a4a' },
      { id: 1, name: '海洋', color: '#15406e' },
      { id: 2, name: '浅海', color: '#2a6a9a' },
      { id: 3, name: '礁石', color: '#4a9ec4' },
      { id: 4, name: '海滩', color: '#f0d894' },
      { id: 5, name: '平原', color: '#6fa83f' },
      { id: 6, name: '森林', color: '#357a2e' },
      { id: 7, name: '丘陵', color: '#9a8a4a' },
      { id: 8, name: '火山岩', color: '#6b2a2a' },
      { id: 9, name: '山顶', color: '#d0d0d0' },
    ],
    stamps: ['🌴','🌲','⛰','🏝','🦜','🐚','⚓','🚤','⛺','🌋','💎','🔱'],
    bg: 0,
    gridColor: 'rgba(255,255,255,0.12)',
  },
  trpg: {
    name: '跑团地牢',
    tiles: [
      { id: 0, name: '地板', color: '#d8d4cc' },
      { id: 1, name: '墙壁', color: '#4a4a4a' },
      { id: 2, name: '门', color: '#8a5a2a' },
      { id: 3, name: '水域', color: '#2a5a8a' },
      { id: 4, name: '草地', color: '#5a8a3a' },
      { id: 5, name: '岩浆', color: '#d4401a' },
      { id: 6, name: '深坑', color: '#1a1a1a' },
      { id: 7, name: '地毯', color: '#8a2a5a' },
    ],
    stamps: ['💎','⚔','🚪','🗡','💰','🔥','💀','🌀','📜','⭐','👑','🛡'],
    bg: 1,
    gridColor: 'rgba(0,0,0,0.25)',
  },
};

/* ---------- 全局状态 ---------- */
const state = {
  mapW: 80, mapH: 80,
  tileSize: 8,
  style: 'fantasy',
  map: null,            // Uint8Array
  stamps: [],           // [{x,y,emoji}]
  labels: [],           // [{x,y,text}]
  tool: 'brush',
  brushSize: 2,
  brushShape: 'square',
  currentTile: 3,
  currentStamp: '💎',
  showGrid: true,
  showContour: false,
  layer: { terrain: true, grid: true, label: true },
  history: [],
  histIdx: -1,
  panning: false,
  spaceDown: false,
  pendingLabel: null,   // 待放置文字
  // 临时绘制（直线/矩形预览）
  preview: null,
};

const ZOOM_STEPS = [3, 4, 6, 8, 10, 12, 16, 20, 24, 32];
const BASE_TILE = 8;
const MAX_HISTORY = 60;

/* ---------- DOM ---------- */
const $ = (id) => document.getElementById(id);
const mapCanvas = $('mapCanvas');
const gridCanvas = $('gridCanvas');
const overlayCanvas = $('overlayCanvas');
const viewport = $('viewport');
const canvasWrap = $('canvasWrap');
const mapCtx = mapCanvas.getContext('2d');
const gridCtx = gridCanvas.getContext('2d');
const overlayCtx = overlayCanvas.getContext('2d');

// 低分辨率离屏画布（每 tile 1 像素），用 drawImage 缩放，性能极佳
const offCanvas = document.createElement('canvas');
const offCtx = offCanvas.getContext('2d');

/* =========================================================
 *  初始化
 * ========================================================= */
function init() {
  buildPalette();
  buildStamps();
  newMap(state.mapW, state.mapH, true);
  fitZoom();
  bindEvents();
  setStatus('就绪 — 试试随机生成');
}

/* 创建空地图 */
function newMap(w, h, fillBg = false) {
  state.mapW = w; state.mapH = h;
  state.map = new Uint8Array(w * h);
  if (fillBg) {
    const bg = STYLES[state.style].bg;
    state.map.fill(bg);
  }
  state.stamps = [];
  state.labels = [];
  setupCanvas();
  state.history = []; state.histIdx = -1;
  commitHistory();
  renderAll();
  $('statusSize').textContent = `${w} × ${h}`;
}

function setupCanvas() {
  const w = state.mapW * state.tileSize;
  const h = state.mapH * state.tileSize;
  [mapCanvas, gridCanvas, overlayCanvas].forEach(c => {
    c.width = w; c.height = h;
    c.style.width = w + 'px';
    c.style.height = h + 'px';
  });
  canvasWrap.style.width = w + 'px';
  canvasWrap.style.height = h + 'px';
  // 离屏画布同步到地图分辨率
  offCanvas.width = state.mapW;
  offCanvas.height = state.mapH;
  mapCtx.imageSmoothingEnabled = false;
}

/* =========================================================
 *  渲染
 * ========================================================= */
function renderAll() {
  renderMap();
  renderGrid();
  renderOverlay();
}

function renderMap() {
  const ctx = mapCtx, ts = state.tileSize, w = state.mapW, h = state.mapH;
  const tiles = STYLES[state.style].tiles;
  ctx.clearRect(0, 0, mapCanvas.width, mapCanvas.height);
  if (!state.layer.terrain) return;

  // 1. 低分辨率离屏：每 tile 1 像素
  const img = offCtx.createImageData(w, h);
  const data = img.data;
  for (let i = 0; i < w * h; i++) {
    const col = tileRGB(state.style, state.map[i]);
    const o = i * 4;
    data[o] = col.r; data[o+1] = col.g; data[o+2] = col.b; data[o+3] = 255;
  }
  offCtx.putImageData(img, 0, 0);
  // 2. 缩放到显示画布（GPU 加速，像素清晰）
  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(offCanvas, 0, 0, w, h, 0, 0, w * ts, h * ts);

  // 等高线 / 边缘高亮
  if (state.showContour) drawContours();
}

// 颜色查找缓存
const rgbCache = {};
function tileRGB(style, id) {
  const key = style + id;
  if (rgbCache[key]) return rgbCache[key];
  const t = STYLES[style].tiles[id];
  const c = t ? hexToRgb(t.color) : { r:0, g:0, b:0 };
  rgbCache[key] = c;
  return c;
}

// 边缘描边：相邻 tile 不同则画暗线
function drawContours() {
  const ctx = mapCtx, ts = state.tileSize, w = state.mapW, h = state.mapH;
  ctx.save();
  ctx.strokeStyle = 'rgba(0,0,0,0.28)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const id = state.map[y * w + x];
      // 右邻
      if (x + 1 < w && state.map[y * w + x + 1] !== id) {
        ctx.moveTo((x + 1) * ts, y * ts);
        ctx.lineTo((x + 1) * ts, (y + 1) * ts);
      }
      // 下邻
      if (y + 1 < h && state.map[(y + 1) * w + x] !== id) {
        ctx.moveTo(x * ts, (y + 1) * ts);
        ctx.lineTo((x + 1) * ts, (y + 1) * ts);
      }
    }
  }
  ctx.stroke();
  ctx.restore();
}

function renderGrid() {
  const ctx = gridCtx, ts = state.tileSize, w = state.mapW, h = state.mapH;
  ctx.clearRect(0, 0, gridCanvas.width, gridCanvas.height);
  if (!state.showGrid || !state.layer.grid) return;
  ctx.save();
  ctx.strokeStyle = STYLES[state.style].gridColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let x = 0; x <= w; x++) {
    ctx.moveTo(x * ts + 0.5, 0);
    ctx.lineTo(x * ts + 0.5, h * ts);
  }
  for (let y = 0; y <= h; y++) {
    ctx.moveTo(0, y * ts + 0.5);
    ctx.lineTo(w * ts, y * ts + 0.5);
  }
  ctx.stroke();
  ctx.restore();
}

function renderOverlay() {
  const ctx = overlayCtx, ts = state.tileSize;
  ctx.clearRect(0, 0, overlayCanvas.width, overlayCanvas.height);
  if (!state.layer.label) return;

  // 图章
  for (const s of state.stamps) {
    drawStamp(ctx, s.x, s.y, s.emoji, ts);
  }
  // 文字标注
  ctx.save();
  ctx.font = `${Math.max(11, ts + 3)}px ${getComputedStyle(document.body).fontFamily}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  for (const l of state.labels) {
    const cx = (l.x + 0.5) * ts, cy = (l.y + 0.5) * ts;
    const tw = ctx.measureText(l.text).width;
    ctx.fillStyle = 'rgba(255,255,255,0.85)';
    ctx.fillRect(cx - tw/2 - 4, cy - 9, tw + 8, 18);
    ctx.strokeStyle = 'rgba(0,0,0,0.3)';
    ctx.lineWidth = 1;
    ctx.strokeRect(cx - tw/2 - 4, cy - 9, tw + 8, 18);
    ctx.fillStyle = '#1f2430';
    ctx.fillText(l.text, cx, cy);
  }
  ctx.restore();

  // 预览（直线/矩形）
  if (state.preview) {
    const p = state.preview;
    ctx.save();
    ctx.globalAlpha = 0.6;
    const col = STYLES[state.style].tiles[state.currentTile].color;
    ctx.fillStyle = col;
    const pts = shapePoints(p.tool, p.x0, p.y0, p.x1, p.y1);
    for (const [px, py] of pts) {
      ctx.fillRect(px * ts, py * ts, ts, ts);
    }
    ctx.restore();
  }
}

function drawStamp(ctx, x, y, emoji, ts) {
  ctx.save();
  ctx.font = `${Math.floor(ts * 1.1)}px serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(emoji, (x + 0.5) * ts, (y + 0.5) * ts);
  ctx.restore();
}

/* =========================================================
 *  调色板 / 图章面板
 * ========================================================= */
function buildPalette() {
  const grid = $('paletteGrid');
  grid.innerHTML = '';
  const tiles = STYLES[state.style].tiles;
  tiles.forEach(t => {
    const el = document.createElement('div');
    el.className = 'swatch' + (t.id === state.currentTile ? ' active' : '');
    el.style.background = t.color;
    el.dataset.id = t.id;
    el.innerHTML = `<span class="name-tip">${t.name}</span>`;
    el.addEventListener('click', () => {
      state.currentTile = t.id;
      $('ctSwatch').style.background = t.color;
      $('ctName').textContent = t.name;
      grid.querySelectorAll('.swatch').forEach(s => s.classList.remove('active'));
      el.classList.add('active');
      // 选了调色板自动切到画笔（除非当前是取色/平移）
      if (['eraser','fill','line','rect','stamp','pan','picker'].includes(state.tool)) {
        // 保持
      } else {
        setTool('brush');
      }
    });
    grid.appendChild(el);
  });
  // 更新当前显示
  const cur = tiles[state.currentTile] || tiles[0];
  $('ctSwatch').style.background = cur.color;
  $('ctName').textContent = cur.name;
  $('paletteTitle').textContent = STYLES[state.style].name + ' · 调色板';
}

function buildStamps() {
  const grid = $('stampGrid');
  grid.innerHTML = '';
  STYLES[state.style].stamps.forEach(emoji => {
    const el = document.createElement('div');
    el.className = 'stamp' + (emoji === state.currentStamp ? ' active' : '');
    el.textContent = emoji;
    el.addEventListener('click', () => {
      state.currentStamp = emoji;
      grid.querySelectorAll('.stamp').forEach(s => s.classList.remove('active'));
      el.classList.add('active');
      setTool('stamp');
    });
    grid.appendChild(el);
  });
}

/* =========================================================
 *  工具
 * ========================================================= */
function setTool(name) {
  state.tool = name;
  document.querySelectorAll('.tool').forEach(b => {
    b.classList.toggle('active', b.dataset.tool === name);
  });
  const names = { brush:'画笔', eraser:'橡皮擦', fill:'油漆桶', line:'直线', rect:'矩形', picker:'取色器', stamp:'图章', pan:'平移' };
  $('statusTool').textContent = names[name] || name;
  canvasWrap.classList.toggle('pan-mode', name === 'pan');
  if (state.pendingLabel) { state.pendingLabel = null; setStatus('就绪'); }
}

/* 笔刷作用：在 (x,y) 画 currentTile（或 eraser 画 bg） */
function paintAt(x, y, opts = {}) {
  const size = opts.size ?? state.brushSize;
  const tileId = opts.tileId ?? (state.tool === 'eraser' ? STYLES[state.style].bg : state.currentTile);
  const half = Math.floor(size / 2);
  const start = -half;
  let changed = false;
  const r2 = (size / 2) * (size / 2);
  for (let dy = start; dy < start + size; dy++) {
    for (let dx = start; dx < start + size; dx++) {
      if (state.brushShape === 'circle') {
        // 以光标为中心
        const ddx = dx + 0.5, ddy = dy + 0.5;
        if (ddx*ddx + ddy*ddy > r2) continue;
      }
      const px = x + dx, py = y + dy;
      if (px < 0 || py < 0 || px >= state.mapW || py >= state.mapH) continue;
      const idx = py * state.mapW + px;
      if (state.map[idx] !== tileId) { state.map[idx] = tileId; changed = true; }
    }
  }
  return changed;
}

/* 洪水填充 */
function floodFill(x, y) {
  if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) return;
  const w = state.mapW, h = state.mapH;
  const target = state.map[y * w + x];
  const replace = state.currentTile;
  if (target === replace) return;
  const stack = [[x, y]];
  while (stack.length) {
    const [cx, cy] = stack.pop();
    if (cx < 0 || cy < 0 || cx >= w || cy >= h) continue;
    const i = cy * w + cx;
    if (state.map[i] !== target) continue;
    state.map[i] = replace;
    stack.push([cx+1, cy], [cx-1, cy], [cx, cy+1], [cx, cy-1]);
  }
}

/* 直线/矩形点集（Bresenham） */
function shapePoints(tool, x0, y0, x1, y1) {
  const pts = [];
  if (tool === 'rect') {
    const xa = Math.min(x0,x1), xb = Math.max(x0,x1);
    const ya = Math.min(y0,y1), yb = Math.max(y0,y1);
    for (let x = xa; x <= xb; x++) { pts.push([x,ya]); pts.push([x,yb]); }
    for (let y = ya; y <= yb; y++) { pts.push([xa,y]); pts.push([xb,y]); }
    return pts;
  }
  // line
  let dx = Math.abs(x1 - x0), dy = Math.abs(y1 - y0);
  let sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx - dy, x = x0, y = y0;
  while (true) {
    pts.push([x, y]);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 > -dy) { err -= dy; x += sx; }
    if (e2 < dx) { err += dx; y += sy; }
  }
  return pts;
}

function applyShapePoints(pts, tileId) {
  for (const [px, py] of pts) {
    if (px < 0 || py < 0 || px >= state.mapW || py >= state.mapH) continue;
    state.map[py * state.mapW + px] = tileId;
  }
}

/* =========================================================
 *  随机生成
 * ========================================================= */
function generate() {
  const seedText = $('seedInput').value.trim();
  let seed = seedText ? hashSeed(seedText) : (Math.random() * 1e9 | 0);
  $('seedInput').value = seed;

  const seaLevel = +$('seaLevel').value / 100;
  const rough = +$('roughness').value / 100;
  const octaves = +$('octaves').value;
  const rooms = +$('roomCount').value;

  const style = state.style;
  if (style === 'trpg') generateDungeon(seed, rooms);
  else generateTerrainMap(seed, seaLevel, rough, octaves, style);

  state.stamps = [];
  state.labels = [];
  commitHistory();
  renderAll();
  setStatus(`已生成 ${STYLES[style].name}（种子 ${seed}）`);
}

function hashSeed(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

/* 地形类生成（fantasy / terrain / island） */
function generateTerrainMap(seed, seaLevel, rough, octaves, style) {
  const w = state.mapW, h = state.mapH;
  const noise = new PerlinNoise(seed);
  const noise2 = new PerlinNoise(seed * 7 + 13);
  const scale = rough * 0.06 + 0.02; // 频率
  const map = state.map;

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let e = noise.fbm(x * scale, y * scale, octaves, 0.5, 2.0); // [-1,1]
      e = (e + 1) / 2; // [0,1]

      // 孤岛：径向衰减
      if (style === 'island') {
        const dx = (x / w - 0.5) * 2, dy = (y / h - 0.5) * 2;
        const d = Math.sqrt(dx*dx + dy*dy);
        const falloff = Math.max(0, 1 - Math.pow(d, 2.2));
        e = e * 0.65 + falloff * 0.55 - 0.15;
        e = Math.max(0, Math.min(1, e));
      }

      // 湿度（用于沙漠/沼泽判断）
      const m = (noise2.fbm(x * scale * 0.8 + 100, y * scale * 0.8 + 100, 4, 0.5, 2) + 1) / 2;

      map[y * w + x] = pickBiome(e, m, seaLevel, style);
    }
  }
}

function pickBiome(e, m, sea, style) {
  // e: 海拔 [0,1], m: 湿度 [0,1]
  if (style === 'fantasy') {
    if (e < sea - 0.10) return 0;       // 深海
    if (e < sea - 0.04) return 1;       // 海洋
    if (e < sea) return 2;              // 浅海
    if (e < sea + 0.02) return 3;       // 沙滩
    if (e > 0.86) return 8;             // 雪峰
    if (e > 0.78) return 7;             // 山脉
    if (e > 0.68) return 6;             // 丘陵
    if (m < 0.3 && e > sea + 0.05) return 9; // 沙漠
    if (m > 0.7 && e < sea + 0.12) return 10; // 沼泽
    if (m > 0.55) return 5;             // 森林
    return 4;                            // 草原
  }
  if (style === 'terrain') {
    if (e < sea - 0.12) return 0;
    if (e < sea - 0.05) return 1;
    if (e < sea) return 2;
    if (e < sea + 0.02) return 3;
    if (e > 0.88) return 9;
    if (e > 0.80) return 8;
    if (e > 0.70) return (m > 0.5 ? 6 : 7);
    if (m < 0.28) return 10;
    if (m < 0.45) return 11;
    if (m > 0.65) return 5;
    return 4;
  }
  if (style === 'island') {
    if (e < sea - 0.12) return 0;
    if (e < sea - 0.05) return 1;
    if (e < sea) return 2;
    if (e < sea + 0.015) return 3;
    if (e > 0.82) return 9;
    if (e > 0.72) return 8;
    if (e > 0.64) return 7;
    if (m < 0.32) return 4;
    if (m > 0.55) return 6;
    return 5;
  }
  return 0;
}

/* 跑团地牢生成：随机房间 + 连廊 */
function generateDungeon(seed, roomCount) {
  const w = state.mapW, h = state.mapH;
  state.map.fill(1); // 全墙
  const rng = mulberry32(seed);
  const rooms = [];
  let attempts = 0;
  while (rooms.length < roomCount && attempts < roomCount * 30) {
    attempts++;
    const rw = 4 + Math.floor(rng() * 9);
    const rh = 4 + Math.floor(rng() * 9);
    const rx = 1 + Math.floor(rng() * (w - rw - 2));
    const ry = 1 + Math.floor(rng() * (h - rh - 2));
    const overlap = rooms.some(r => !(rx + rw + 1 < r.x || r.x + r.w + 1 < rx || ry + rh + 1 < r.y || r.y + r.h + 1 < ry));
    if (overlap) continue;
    rooms.push({ x: rx, y: ry, w: rw, h: rh, cx: rx + (rw>>1), cy: ry + (rh>>1) });
    carveRect(rx, ry, rw, rh, 0); // 地板
  }
  // 连廊
  for (let i = 1; i < rooms.length; i++) {
    const a = rooms[i-1], b = rooms[i];
    if (rng() < 0.5) { carveH(a.cx, b.cx, a.cy); carveV(a.cy, b.cy, b.cx); }
    else { carveV(a.cy, b.cy, a.cx); carveH(a.cx, b.cx, b.cy); }
  }
  // 额外连接首尾，避免线性
  if (rooms.length > 2) {
    const a = rooms[0], b = rooms[rooms.length-1];
    carveH(a.cx, b.cx, a.cy); carveV(a.cy, b.cy, b.cx);
  }
  // 随机放门（房间边缘地板与墙交界）
  for (const r of rooms) {
    if (rng() < 0.6) {
      const side = Math.floor(rng()*4);
      let dx = 0, dy = 0;
      if (side===0){dx=r.cx;dy=r.y-1} else if(side===1){dx=r.cx;dy=r.y+r.h}
      else if(side===2){dx=r.x-1;dy=r.cy} else {dx=r.x+r.w;dy=r.cy}
      if (dx>0&&dy>0&&dx<w-1&&dy<h-1 && state.map[dy*w+dx]===1) state.map[dy*w+dx]=2;
    }
  }
}

function carveRect(x, y, w, h, val) {
  for (let yy = y; yy < y + h; yy++)
    for (let xx = x; xx < x + w; xx++)
      if (xx>=0&&yy>=0&&xx<state.mapW&&yy<state.mapH) state.map[yy*state.mapW+xx]=val;
}
function carveH(x0, x1, y) {
  const a=Math.min(x0,x1),b=Math.max(x0,x1);
  for (let x=a;x<=b;x++) if(x>=0&&x<state.mapW&&y>=0&&y<state.mapH) state.map[y*state.mapW+x]=0;
}
function carveV(y0, y1, x) {
  const a=Math.min(y0,y1),b=Math.max(y0,y1);
  for (let y=a;y<=b;y++) if(y>=0&&y<state.mapH&&x>=0&&x<state.mapW) state.map[y*state.mapW+x]=0;
}
function mulberry32(a) {
  return function() {
    a |= 0; a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* =========================================================
 *  历史记录
 * ========================================================= */
function snapshot() {
  return {
    map: new Uint8Array(state.map),
    stamps: state.stamps.slice(),
    labels: state.labels.slice(),
  };
}
function commitHistory() {
  // 截断 redo
  state.history = state.history.slice(0, state.histIdx + 1);
  state.history.push(snapshot());
  if (state.history.length > MAX_HISTORY) state.history.shift();
  state.histIdx = state.history.length - 1;
}
function restore(snap) {
  state.map = new Uint8Array(snap.map);
  state.stamps = snap.stamps.slice();
  state.labels = snap.labels.slice();
  renderAll();
}
function undo() {
  if (state.histIdx > 0) { state.histIdx--; restore(state.history[state.histIdx]); setStatus('已撤销'); }
  else setStatus('没有更多可撤销');
}
function redo() {
  if (state.histIdx < state.history.length - 1) { state.histIdx++; restore(state.history[state.histIdx]); setStatus('已重做'); }
  else setStatus('没有更多可重做');
}

/* =========================================================
 *  缩放
 * ========================================================= */
function setZoom(ts) {
  state.tileSize = ts;
  setupCanvas();
  renderAll();
  $('zoomVal').textContent = Math.round(ts / BASE_TILE * 100) + '%';
}
function zoomIn() {
  const i = ZOOM_STEPS.indexOf(state.tileSize);
  const ni = Math.min(ZOOM_STEPS.length - 1, (i < 0 ? 4 : i) + 1);
  setZoom(ZOOM_STEPS[ni]);
}
function zoomOut() {
  const i = ZOOM_STEPS.indexOf(state.tileSize);
  const ni = Math.max(0, (i < 0 ? 4 : i) - 1);
  setZoom(ZOOM_STEPS[ni]);
}
function fitZoom() {
  const vw = viewport.clientWidth - 40, vh = viewport.clientHeight - 40;
  let best = ZOOM_STEPS[0];
  for (const ts of ZOOM_STEPS) {
    if (state.mapW * ts <= vw && state.mapH * ts <= vh) best = ts;
  }
  setZoom(best);
}

/* =========================================================
 *  鼠标交互
 * ========================================================= */
let drawing = false;
let lastTile = null;
let panStart = null;

function getTile(e) {
  const rect = overlayCanvas.getBoundingClientRect();
  const x = Math.floor((e.clientX - rect.left) / state.tileSize);
  const y = Math.floor((e.clientY - rect.top) / state.tileSize);
  return [x, y];
}

function onPointerDown(e) {
  if (e.button === 1 || state.tool === 'pan' || state.spaceDown) {
    state.panning = true;
    panStart = { x: e.clientX, y: e.clientY, sx: viewport.scrollLeft, sy: viewport.scrollTop };
    canvasWrap.classList.add('panning');
    e.preventDefault();
    return;
  }
  if (e.button !== 0) return;
  const [x, y] = getTile(e);
  if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) return;

  // 待放置文字
  if (state.pendingLabel) {
    state.labels.push({ x, y, text: state.pendingLabel });
    state.pendingLabel = null;
    commitHistory();
    renderOverlay();
    setStatus('文字已放置');
    setTool('brush');
    return;
  }

  drawing = true;
  lastTile = [x, y];

  switch (state.tool) {
    case 'brush':
    case 'eraser':
      paintAt(x, y);
      renderMap(); renderOverlay();
      break;
    case 'fill':
      floodFill(x, y);
      renderMap();
      commitHistory();
      drawing = false;
      break;
    case 'picker':
      pickTile(x, y);
      drawing = false;
      break;
    case 'stamp':
      // 避免重复叠加
      if (!state.stamps.some(s => s.x===x && s.y===y)) {
        state.stamps.push({ x, y, emoji: state.currentStamp });
        renderOverlay();
        commitHistory();
      }
      drawing = false;
      break;
    case 'line':
    case 'rect':
      state.preview = { tool: state.tool, x0: x, y0: y, x1: x, y1: y };
      renderOverlay();
      break;
  }
}

function onPointerMove(e) {
  const [x, y] = getTile(e);
  if (x >= 0 && y >= 0 && x < state.mapW && y < state.mapH) {
    $('statusCoords').textContent = `坐标：${x}, ${y}`;
  }

  if (state.panning && panStart) {
    viewport.scrollLeft = panStart.sx - (e.clientX - panStart.x);
    viewport.scrollTop = panStart.sy - (e.clientY - panStart.y);
    return;
  }

  if (!drawing) return;
  const ts = state.tileSize;

  if (state.tool === 'brush' || state.tool === 'eraser') {
    // 插值连线，避免快速移动留空
    if (lastTile) {
      const pts = shapePoints('line', lastTile[0], lastTile[1], x, y);
      for (const [px, py] of pts) paintAt(px, py);
    } else {
      paintAt(x, y);
    }
    lastTile = [x, y];
    renderMap(); renderOverlay();
  } else if (state.preview) {
    state.preview.x1 = x; state.preview.y1 = y;
    renderOverlay();
  }
}

function onPointerUp(e) {
  if (state.panning) {
    state.panning = false;
    panStart = null;
    canvasWrap.classList.remove('panning');
    return;
  }
  if (!drawing) return;
  drawing = false;

  if (state.preview) {
    const p = state.preview;
    const pts = shapePoints(p.tool, p.x0, p.y0, p.x1, p.y1);
    applyShapePoints(pts, state.currentTile);
    state.preview = null;
    renderMap(); renderOverlay();
    commitHistory();
  } else if (state.tool === 'brush' || state.tool === 'eraser') {
    commitHistory();
  }
  lastTile = null;
}

function pickTile(x, y) {
  const id = state.map[y * state.mapW + x];
  state.currentTile = id;
  const t = STYLES[state.style].tiles[id];
  if (t) {
    $('ctSwatch').style.background = t.color;
    $('ctName').textContent = t.name;
    document.querySelectorAll('.swatch').forEach(s => s.classList.toggle('active', +s.dataset.id === id));
  }
  setTool('brush');
  setStatus(`取色：${t ? t.name : id}`);
}

/* 右键擦除 */
function onContextMenu(e) {
  e.preventDefault();
  const [x, y] = getTile(e);
  if (x < 0 || y < 0 || x >= state.mapW || y >= state.mapH) return;
  paintAt(x, y, { tileId: STYLES[state.style].bg });
  renderMap();
  commitHistory();
}

/* =========================================================
 *  导出 / 存档
 * ========================================================= */
function exportPNG() {
  // 合成到临时画布
  const out = document.createElement('canvas');
  out.width = mapCanvas.width; out.height = mapCanvas.height;
  const ctx = out.getContext('2d');
  ctx.drawImage(mapCanvas, 0, 0);
  if (state.showGrid && state.layer.grid) ctx.drawImage(gridCanvas, 0, 0);
  if (state.layer.label) ctx.drawImage(overlayCanvas, 0, 0);
  const link = document.createElement('a');
  link.download = `map_${state.style}_${Date.now()}.png`;
  link.href = out.toDataURL('image/png');
  link.click();
  setStatus('已导出 PNG');
}

function saveLocal() {
  const data = {
    style: state.style, mapW: state.mapW, mapH: state.mapH,
    tileSize: state.tileSize, map: Array.from(state.map),
    stamps: state.stamps, labels: state.labels,
    showGrid: state.showGrid, showContour: state.showContour,
  };
  localStorage.setItem('shazhi_map_save', JSON.stringify(data));
  setStatus('已保存到浏览器本地');
}
function loadLocal() {
  const raw = localStorage.getItem('shazhi_map_save');
  if (!raw) { setStatus('没有找到本地存档'); return; }
  try {
    const d = JSON.parse(raw);
    state.style = d.style; state.mapW = d.mapW; state.mapH = d.mapH;
    state.tileSize = d.tileSize || 8;
    state.map = Uint8Array.from(d.map);
    state.stamps = d.stamps || []; state.labels = d.labels || [];
    state.showGrid = d.showGrid; state.showContour = d.showContour;
    $('styleSelect').value = state.style;
    $('sizeSelect').value = state.mapW;
    $('gridToggle').checked = state.showGrid;
    $('contourToggle').checked = state.showContour;
    buildPalette(); buildStamps();
    setupCanvas(); commitHistory(); renderAll();
    setStatus('已读取本地存档');
  } catch (err) { setStatus('存档读取失败'); }
}

/* =========================================================
 *  事件绑定
 * ========================================================= */
function bindEvents() {
  // 工具
  document.querySelectorAll('.tool').forEach(b => {
    b.addEventListener('click', () => setTool(b.dataset.tool));
  });

  // 顶部
  $('styleSelect').addEventListener('change', (e) => {
    state.style = e.target.value;
    state.currentTile = 0;
    buildPalette(); buildStamps();
    newMap(state.mapW, state.mapH, true);
    fitZoom();
  });
  $('sizeSelect').addEventListener('change', (e) => {
    const s = +e.target.value;
    newMap(s, s, true);
    fitZoom();
  });
  $('generateBtn').addEventListener('click', () => $('genPanel').classList.toggle('show'));
  $('genPanelClose').addEventListener('click', () => $('genPanel').classList.remove('show'));
  $('doGenerate').addEventListener('click', generate);
  $('reseedBtn').addEventListener('click', () => { $('seedInput').value = ''; generate(); });
  $('clearBtn').addEventListener('click', () => {
    if (!confirm('确定清空当前地图？')) return;
    newMap(state.mapW, state.mapH, true);
    fitZoom();
    setStatus('已清空');
  });
  $('undoBtn').addEventListener('click', undo);
  $('redoBtn').addEventListener('click', redo);
  $('saveBtn').addEventListener('click', saveLocal);
  $('loadBtn').addEventListener('click', loadLocal);
  $('exportBtn').addEventListener('click', exportPNG);

  // 笔刷
  $('brushSize').addEventListener('input', (e) => {
    state.brushSize = +e.target.value;
    $('brushSizeVal').textContent = state.brushSize;
  });
  document.querySelectorAll('input[name="bshape"]').forEach(r => {
    r.addEventListener('change', () => state.brushShape = r.value);
  });

  // 视图
  $('gridToggle').addEventListener('change', (e) => { state.showGrid = e.target.checked; renderGrid(); });
  $('contourToggle').addEventListener('change', (e) => { state.showContour = e.target.checked; renderMap(); });
  $('zoomIn').addEventListener('click', zoomIn);
  $('zoomOut').addEventListener('click', zoomOut);
  $('zoomFit').addEventListener('click', fitZoom);

  // 图层
  $('layerTerrain').addEventListener('change', (e) => { state.layer.terrain = e.target.checked; renderMap(); });
  $('layerGrid').addEventListener('change', (e) => { state.layer.grid = e.target.checked; renderGrid(); });
  $('layerLabel').addEventListener('change', (e) => { state.layer.label = e.target.checked; renderOverlay(); });

  // 标注
  $('addLabelBtn').addEventListener('click', () => {
    const t = $('labelText').value.trim();
    if (!t) { setStatus('请输入文字'); return; }
    state.pendingLabel = t;
    setStatus(`点击地图放置「${t}」`);
  });

  // 生成参数滑块显示
  $('seaLevel').addEventListener('input', e => $('seaVal').textContent = (+e.target.value/100).toFixed(2));
  $('roughness').addEventListener('input', e => $('roughVal').textContent = (+e.target.value/100).toFixed(2));
  $('octaves').addEventListener('input', e => $('octVal').textContent = e.target.value);
  $('roomCount').addEventListener('input', e => $('roomVal').textContent = e.target.value);

  // 画布事件（用 pointer 统一鼠标/触控）
  overlayCanvas.addEventListener('pointerdown', onPointerDown);
  window.addEventListener('pointermove', onPointerMove);
  window.addEventListener('pointerup', onPointerUp);
  overlayCanvas.addEventListener('contextmenu', onContextMenu);

  // 离开画布取消预览
  overlayCanvas.addEventListener('pointerleave', () => { $('statusCoords').textContent = '坐标：—'; });

  // 键盘
  window.addEventListener('keydown', onKeyDown);
  window.addEventListener('keyup', onKeyUp);

  // 窗口缩放
  window.addEventListener('resize', () => { /* 保持当前 zoom */ });
}

function onKeyDown(e) {
  if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
  if (e.ctrlKey || e.metaKey) {
    if (e.key === 'z' || e.key === 'Z') { e.preventDefault(); undo(); return; }
    if (e.key === 'y' || e.key === 'Y') { e.preventDefault(); redo(); return; }
    if (e.key === 's' || e.key === 'S') { e.preventDefault(); saveLocal(); return; }
  }
  if (e.code === 'Space') { state.spaceDown = true; canvasWrap.classList.add('pan-mode'); e.preventDefault(); return; }
  const map = { b:'brush', e:'eraser', f:'fill', l:'line', r:'rect', i:'picker', s:'stamp', h:'pan', g:'generate' };
  const k = e.key.toLowerCase();
  if (k === 'g') { $('genPanel').classList.toggle('show'); return; }
  if (map[k]) setTool(map[k]);
}
function onKeyUp(e) {
  if (e.code === 'Space') { state.spaceDown = false; if (state.tool !== 'pan') canvasWrap.classList.remove('pan-mode'); }
}

/* =========================================================
 *  工具函数
 * ========================================================= */
function hexToRgb(hex) {
  const h = hex.replace('#','');
  return { r: parseInt(h.slice(0,2),16), g: parseInt(h.slice(2,4),16), b: parseInt(h.slice(4,6),16) };
}
function setStatus(msg) { $('statusMsg').textContent = msg; }

/* 启动 */
window.addEventListener('DOMContentLoaded', init);
