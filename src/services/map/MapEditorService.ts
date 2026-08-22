/**
 * MapEditorService：地图 CRUD（maps 表，003 迁移）
 * data 列存 JSON.stringify(MapData)（P4-M3 起恒带 version，读取统一经 migrateMapData 升级）
 * background_path 列存底图相对路径（相对 appData 目录）
 */

import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { NovelMap } from './types';
import { MAP_DATA_VERSION, migrateMapData } from './migrate';

interface MapRow {
  id: string;
  book_id: string;
  name: string;
  width: number;
  height: number;
  background_path: string | null;
  data: string;
  created_at: number;
  updated_at: number;
}

/** 行 -> 对象：data 经 migrateMapData 容错升级（损坏/为空按空地图处理），保存后恒为当前版本 */
function rowToMap(r: MapRow): NovelMap {
  const data = migrateMapData(r.data);
  return {
    id: r.id,
    bookId: r.book_id,
    name: r.name,
    width: r.width,
    height: r.height,
    background: r.background_path ?? undefined,
    bg: data.bg,
    desc: data.desc,
    tileLayers: data.tileLayers ?? [],
    activeTileLayer: data.activeTileLayer ?? 0,
    nodes: data.nodes,
    connections: data.connections,
    createdAt: r.created_at,
    updatedAt: r.updated_at
  };
}

export class MapEditorService {
  private db: Database;
  private wq: WriteQueue;

  constructor(db: Database, wq: WriteQueue) {
    this.db = db;
    this.wq = wq;
  }

  /** 新建地图：默认 1600x1000，data 存空节点/连线 */
  async createMap(bookId: string, name: string): Promise<NovelMap> {
    const now = Date.now();
    const map: NovelMap = {
      id: crypto.randomUUID(),
      bookId,
      name,
      width: 1600,
      height: 1000,
      tileLayers: [],
      activeTileLayer: 0,
      nodes: [],
      connections: [],
      createdAt: now,
      updatedAt: now
    };
    await this.wq.enqueue(() =>
      this.db.exec(
        `INSERT INTO maps (id, book_id, name, width, height, background_path, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, NULL, ?, ?, ?)`,
        [
          map.id,
          map.bookId,
          map.name,
          map.width,
          map.height,
          JSON.stringify({ version: MAP_DATA_VERSION, nodes: [], connections: [], tileLayers: [] }),
          map.createdAt,
          map.updatedAt
        ]
      )
    );
    return map;
  }

  /** 保存地图：整体覆盖 name/width/height/background_path/data/updated_at */
  async saveMap(map: NovelMap): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.exec(
        `UPDATE maps SET name = ?, width = ?, height = ?, background_path = ?, data = ?, updated_at = ? WHERE id = ?`,
        [
          map.name,
          map.width,
          map.height,
          map.background ?? null,
          JSON.stringify({
            version: MAP_DATA_VERSION,
            nodes: map.nodes,
            connections: map.connections,
            desc: map.desc,
            bg: map.bg,
            tileLayers: map.tileLayers,
            activeTileLayer: map.activeTileLayer
          }),
          Date.now(),
          map.id
        ]
      )
    );
  }

  async getMap(id: string): Promise<NovelMap | null> {
    const row = await this.db.queryOne<MapRow>('SELECT * FROM maps WHERE id = ?', [id]);
    return row ? rowToMap(row) : null;
  }

  async listMaps(bookId: string): Promise<NovelMap[]> {
    const rows = await this.db.query<MapRow>(
      'SELECT * FROM maps WHERE book_id = ? ORDER BY created_at ASC',
      [bookId]
    );
    return rows.map(rowToMap);
  }

  async deleteMap(id: string): Promise<void> {
    await this.wq.enqueue(() => this.db.exec('DELETE FROM maps WHERE id = ?', [id]));
  }

  /** 复制地图（含节点/连线/底图引用），命名为 "xx 副本" */
  async duplicateMap(id: string): Promise<NovelMap | null> {
    const source = await this.getMap(id);
    if (!source) return null;
    const now = Date.now();
    const copy: NovelMap = {
      ...source,
      id: crypto.randomUUID(),
      name: `${source.name} 副本`,
      createdAt: now,
      updatedAt: now
    };
    await this.wq.enqueue(() =>
      this.db.exec(
        `INSERT INTO maps (id, book_id, name, width, height, background_path, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          copy.id,
          copy.bookId,
          copy.name,
          copy.width,
          copy.height,
          copy.background ?? null,
          JSON.stringify({
            version: MAP_DATA_VERSION,
            nodes: copy.nodes,
            connections: copy.connections,
            desc: copy.desc,
            bg: copy.bg,
            tileLayers: copy.tileLayers,
            activeTileLayer: copy.activeTileLayer
          }),
          copy.createdAt,
          copy.updatedAt
        ]
      )
    );
    return copy;
  }
}
