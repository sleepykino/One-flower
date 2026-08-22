/**
 * MapAssetService（P4.1-M1）：全局地图素材库
 * 文件存 {appData}/map-assets/{id}.{ext}，元数据入 map_assets 表（008 迁移）
 * 跨书共享；内置素材 builtin=1 不可删除；删除自定义素材带跨书引用检查
 */

import type { NativeBridge } from '../../native/NativeBridge';
import { resolveAssetUrl } from '../../utils/assetUrl';
import { BUILTIN_STAMPS } from './builtinStamps';

export type MapAssetUsage = 'stamp' | 'tile';

export interface MapAsset {
  id: string;
  name: string;
  category: string;
  tags: string[];
  fileName: string;
  width: number;
  height: number;
  mime: string;
  usage: MapAssetUsage;
  builtin: boolean;
  createdAt: number;
}

/** 素材引用（删除检查用） */
export interface MapAssetRef {
  bookId: string;
  bookTitle: string;
  mapId: string;
  mapName: string;
}

export class MapAssetReferenceError extends Error {
  refs: MapAssetRef[];
  constructor(refs: MapAssetRef[]) {
    super(`素材仍被 ${refs.length} 张地图引用`);
    this.refs = refs;
  }
}

interface AssetRow {
  id: string;
  name: string;
  category: string;
  tags: string | null;
  file_name: string;
  width: number | null;
  height: number | null;
  mime: string;
  usage: string;
  builtin: number | null;
  created_at: number;
}

function rowToAsset(r: AssetRow): MapAsset {
  let tags: string[] = [];
  try {
    tags = JSON.parse(r.tags ?? '[]') as string[];
  } catch {
    tags = [];
  }
  return {
    id: String(r.id),
    name: String(r.name),
    category: String(r.category),
    tags,
    fileName: String(r.file_name),
    width: Number(r.width ?? 0),
    height: Number(r.height ?? 0),
    mime: String(r.mime),
    usage: r.usage === 'tile' ? 'tile' : 'stamp',
    builtin: Number(r.builtin ?? 0) === 1,
    createdAt: Number(r.created_at)
  };
}

function extOfMime(mime: string): string {
  if (mime === 'image/svg+xml') return 'svg';
  if (mime === 'image/png') return 'png';
  if (mime === 'image/jpeg') return 'jpg';
  if (mime === 'image/webp') return 'webp';
  if (mime === 'image/gif') return 'gif';
  if (mime === 'image/bmp') return 'bmp';
  return 'png';
}

function sniffMime(bytes: Uint8Array, filePath: string): string | null {
  if (bytes.length >= 4) {
    const b = bytes;
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
    if (b[0] === 0xff && b[1] === 0xd8) return 'image/jpeg';
    if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
    // SVG（文本）
    const head = new TextDecoder().decode(bytes.slice(0, 256)).trimStart().toLowerCase();
    if (head.startsWith('<?xml') || head.startsWith('<svg')) return 'image/svg+xml';
    // RIFF....WEBP
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[8] === 0x57) return 'image/webp';
  }
  const ext = filePath.split('.').pop()?.toLowerCase();
  if (ext === 'svg') return 'image/svg+xml';
  if (ext === 'png') return 'image/png';
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'bmp') return 'image/bmp';
  return null;
}

export class MapAssetService {
  private bridge: NativeBridge;
  private dirCache: string | null = null;

  constructor(bridge: NativeBridge) {
    this.bridge = bridge;
  }

  /** 素材目录 {appData}/map-assets */
  private async dir(): Promise<string> {
    if (this.dirCache) return this.dirCache;
    const appDir = (await this.bridge.storage.appDataDir()).replace(/\\/g, '/');
    this.dirCache = `${appDir}/map-assets`;
    return this.dirCache;
  }

  /** 首次启动：写入内置素材包（缺多少补多少，幂等） */
  async ensureBuiltin(): Promise<void> {
    const rows = await this.bridge.db.query<{ id: string }>(
      "SELECT id FROM map_assets WHERE builtin = 1"
    );
    const have = new Set(rows.map((r) => String(r.id)));
    const missing = BUILTIN_STAMPS.filter((s) => !have.has(s.id));
    if (missing.length === 0) return;
    const dir = await this.dir();
    await this.bridge.fs.ensureDir(dir);
    for (const s of missing) {
      const bytes = new TextEncoder().encode(s.svg);
      const fileName = `${s.id}.svg`;
      await this.bridge.fs.writeBinaryFile(`${dir}/${fileName}`, bytes);
      await this.bridge.db.exec(
        `INSERT OR IGNORE INTO map_assets (id, name, category, tags, file_name, width, height, mime, usage, builtin, created_at)
         VALUES (?, ?, ?, '[]', ?, 64, 64, 'image/svg+xml', 'stamp', 1, ?)`,
        [s.id, s.name, s.category, fileName, Date.now()]
      );
    }
  }

  /** 上传导入（读取文件字节 -> 写目录 -> 元数据入库）；不支持的格式抛错 */
  async import(filePaths: string[], category = '自定义', usage: MapAssetUsage = 'stamp'): Promise<MapAsset[]> {
    const dir = await this.dir();
    await this.bridge.fs.ensureDir(dir);
    const out: MapAsset[] = [];
    for (const p of filePaths) {
      const bytes = await this.bridge.fs.readBinaryFile(p);
      const mime = sniffMime(bytes, p);
      if (!mime) throw new Error(`不支持的图片格式：${p}`);
      const id = crypto.randomUUID();
      const fileName = `${id}.${extOfMime(mime)}`;
      await this.bridge.fs.writeBinaryFile(`${dir}/${fileName}`, bytes);
      const base = (p.replace(/\\/g, '/').split('/').pop() ?? '素材').replace(/\.[^.]+$/, '');
      await this.bridge.db.exec(
        `INSERT INTO map_assets (id, name, category, tags, file_name, width, height, mime, usage, builtin, created_at)
         VALUES (?, ?, ?, '[]', ?, 0, 0, ?, ?, 0, ?)`,
        [id, base, category, fileName, mime, usage, Date.now()]
      );
      const row = await this.bridge.db.queryOne<AssetRow>('SELECT * FROM map_assets WHERE id = ?', [id]);
      if (row) out.push(rowToAsset(row));
    }
    return out;
  }

  async list(filter?: { category?: string; usage?: MapAssetUsage; keyword?: string }): Promise<MapAsset[]> {
    const rows = await this.bridge.db.query<AssetRow>(
      'SELECT * FROM map_assets ORDER BY builtin DESC, created_at ASC'
    );
    let assets = rows.map(rowToAsset);
    if (filter?.usage) assets = assets.filter((a) => a.usage === filter.usage);
    if (filter?.category) assets = assets.filter((a) => a.category === filter.category);
    if (filter?.keyword) {
      const kw = filter.keyword.trim().toLowerCase();
      if (kw !== '') {
        assets = assets.filter(
          (a) => a.name.toLowerCase().includes(kw) || a.category.toLowerCase().includes(kw) || a.tags.some((t) => t.toLowerCase().includes(kw))
        );
      }
    }
    return assets;
  }

  async rename(id: string, name: string): Promise<void> {
    await this.bridge.db.exec('UPDATE map_assets SET name = ? WHERE id = ?', [name.trim() || '未命名素材', id]);
  }

  async setCategory(id: string, category: string): Promise<void> {
    await this.bridge.db.exec('UPDATE map_assets SET category = ? WHERE id = ?', [category.trim() || '自定义', id]);
  }

  /** 绝对路径 */
  async absolutePath(id: string): Promise<string | null> {
    const row = await this.bridge.db.queryOne<{ file_name: string }>(
      'SELECT file_name FROM map_assets WHERE id = ?',
      [id]
    );
    if (!row) return null;
    return `${await this.dir()}/${String(row.file_name)}`;
  }

  /** WebView 可显示 URL（assetProtocol） */
  async resolveUrl(id: string): Promise<string> {
    return resolveAssetUrl(await this.absolutePath(id)) ?? '';
  }

  /** 读取素材字节（canvas 绘制用） */
  async readBytes(id: string): Promise<Uint8Array | null> {
    const path = await this.absolutePath(id);
    if (!path) return null;
    try {
      return await this.bridge.fs.readBinaryFile(path);
    } catch {
      return null;
    }
  }

  /** 全库扫描 'asset:{id}' 引用（SQL LIKE 预筛 + JSON 精确校验，含瓦片纹理 asset:tile:{id}） */
  async findReferences(id: string): Promise<MapAssetRef[]> {
    const rows = await this.bridge.db.query<{ id: string; name: string; book_id: string; data: string; title: string | null }>(
      `SELECT m.id, m.name, m.book_id, m.data, b.title FROM maps m JOIN books b ON b.id = m.book_id WHERE m.data LIKE ?`,
      [`%asset:${id}%`]
    );
    const stampRef = `asset:${id}`;
    const tileRef = `asset:tile:${id}`;
    const out: MapAssetRef[] = [];
    for (const r of rows) {
      try {
        const data = JSON.parse(r.data) as {
          nodes?: Array<{ icon?: string }>;
          tileLayers?: Array<{ tiles?: { data?: string[] } }>;
        };
        const used =
          (data.nodes ?? []).some((n) => n.icon === stampRef) ||
          (data.tileLayers ?? []).some((l) => (l.tiles?.data ?? []).some((t) => t === tileRef));
        if (used) {
          out.push({
            bookId: String(r.book_id),
            bookTitle: String(r.title ?? '未知书籍'),
            mapId: String(r.id),
            mapName: String(r.name)
          });
        }
      } catch {
        /* data 损坏的行跳过 */
      }
    }
    return out;
  }

  /** 删除素材（builtin 不可删；非 force 时存在引用抛 MapAssetReferenceError） */
  async remove(id: string, force = false): Promise<void> {
    const row = await this.bridge.db.queryOne<{ builtin: number }>(
      'SELECT builtin FROM map_assets WHERE id = ?',
      [id]
    );
    if (!row) return;
    if (Number(row.builtin ?? 0) === 1) throw new Error('内置素材不可删除');
    if (!force) {
      const refs = await this.findReferences(id);
      if (refs.length > 0) throw new MapAssetReferenceError(refs);
    }
    await this.bridge.db.exec('DELETE FROM map_assets WHERE id = ?', [id]);
    // 文件本体保留（fs 适配器暂无删除命令，孤儿文件不影响功能；重装/备份不会引用）
  }
}
