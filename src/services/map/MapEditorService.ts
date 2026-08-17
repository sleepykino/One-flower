/**
 * MapEditorService：地图 CRUD（maps 表，003 迁移）
 * data 列存 JSON.stringify({ nodes, connections, desc, bg })，行转对象时容错解析
 * background_path 列存底图相对路径（相对 appData 目录）
 */

import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { MapBackgroundTransform, MapConnection, MapNode, MapTiles, NovelMap } from './types';

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

interface MapData {
  nodes?: MapNode[];
  connections?: MapConnection[];
  desc?: string;
  bg?: MapBackgroundTransform;
  tiles?: MapTiles;
}

/** 瓦片层数据校验：cols/rows 为正且 data 长度匹配 */
function validTiles(t: unknown): t is MapTiles {
  if (!t || typeof t !== 'object') return false;
  const tiles = t as MapTiles;
  return (
    Number.isInteger(tiles.cols) &&
    tiles.cols > 0 &&
    Number.isInteger(tiles.rows) &&
    tiles.rows > 0 &&
    Array.isArray(tiles.data) &&
    tiles.data.length === tiles.cols * tiles.rows
  );
}

/** 行 -> 对象：data JSON.parse，损坏/为空时容错为空内容 */
function rowToMap(r: MapRow): NovelMap {
  let data: MapData = {};
  try {
    data = JSON.parse(r.data) as MapData;
  } catch {
    // data 非法 JSON：按空地图处理
  }
  return {
    id: r.id,
    bookId: r.book_id,
    name: r.name,
    width: r.width,
    height: r.height,
    background: r.background_path ?? undefined,
    bg: data.bg,
    desc: data.desc,
    tiles: validTiles(data.tiles) ? data.tiles : undefined,
    nodes: Array.isArray(data.nodes) ? data.nodes : [],
    connections: Array.isArray(data.connections) ? data.connections : [],
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
          JSON.stringify({ nodes: [], connections: [] }),
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
            nodes: map.nodes,
            connections: map.connections,
            desc: map.desc,
            bg: map.bg,
            tiles: map.tiles
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
            nodes: copy.nodes,
            connections: copy.connections,
            desc: copy.desc,
            bg: copy.bg,
            tiles: copy.tiles
          }),
          copy.createdAt,
          copy.updatedAt
        ]
      )
    );
    return copy;
  }
}
