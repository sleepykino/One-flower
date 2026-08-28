/**
 * 角色卡服务：CRUD + JSON Schema 模板管理（含默认模板种子）
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { Character, CharacterSchema } from '../../types';

/** 默认角色卡模板：姓名 / 外貌 / 性格 / 背景 / 关系 / 标签 */
export const DEFAULT_SCHEMA_JSON = JSON.stringify(
  {
    type: 'object',
    properties: {
      name: { type: 'string', title: '姓名' },
      appearance: { type: 'string', title: '外貌' },
      personality: { type: 'string', title: '性格' },
      background: { type: 'string', title: '背景' },
      relationships: { type: 'string', title: '关系' }
    },
    required: ['name']
  },
  null,
  2
);

export class CharacterService {
  private bridge: NativeBridge;
  private db: Database;
  private wq: WriteQueue;

  constructor(bridge: NativeBridge, db: Database, wq: WriteQueue) {
    this.bridge = bridge;
    this.db = db;
    this.wq = wq;
  }

  async list(bookId: string): Promise<Character[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM characters WHERE book_id = ? ORDER BY created_at ASC',
      [bookId]
    );
    return rows.map(rowToCharacter);
  }

  async get(id: string): Promise<Character | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM characters WHERE id = ?',
      [id]
    );
    return row ? rowToCharacter(row) : null;
  }

  async create(
    bookId: string,
    input: { name: string; data: Record<string, unknown>; tags?: string[]; schemaId?: string | null }
  ): Promise<Character> {
    const id = crypto.randomUUID();
    const now = Date.now();
    await this.wq.enqueue(() =>
      this.db.exec(
        'INSERT INTO characters (id, book_id, name, schema_id, data, tags, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
        [
          id,
          bookId,
          input.name,
          input.schemaId ?? null,
          JSON.stringify({ name: input.name, ...input.data }),
          JSON.stringify(input.tags ?? []),
          now,
          now
        ]
      )
    );
    return (await this.get(id))!;
  }

  async update(
    id: string,
    patch: { name?: string; data?: Record<string, unknown>; tags?: string[] }
  ): Promise<void> {
    const cur = await this.get(id);
    if (!cur) throw new Error('角色不存在');
    let dataJson = cur.data;
    if (patch.data) {
      const merged = { ...JSON.parse(cur.data), ...patch.data };
      if (patch.name) merged.name = patch.name;
      dataJson = JSON.stringify(merged);
    } else if (patch.name) {
      const merged = { ...JSON.parse(cur.data), name: patch.name };
      dataJson = JSON.stringify(merged);
    }
    await this.wq.enqueue(() =>
      this.db.exec(
        'UPDATE characters SET name = ?, data = ?, tags = ?, updated_at = ? WHERE id = ?',
        [
          patch.name ?? cur.name,
          dataJson,
          patch.tags ? JSON.stringify(patch.tags) : cur.tags,
          Date.now(),
          id
        ]
      )
    );
  }

  // 批次5建议1：删除角色时在事务内级联清理关联数据，避免孤儿数据累积、孤儿事实污染一致性基线。
  // - relationships：虽已由 characters(id) 的 FK ON DELETE CASCADE 兜底，这里显式删一次，防 FK 未开启/旧库残留
  // - setting_facts(source='character')：source_ref 无 FK，须显式删；其推导链 setting_inferences 由 FK 级联
  // - timeline_events.character_ids：JSON 数组引用，无 FK，从数组中摘除该角色 id（事件本身保留，防多角色事件误删）
  async remove(id: string): Promise<void> {
    await this.wq.enqueue(async () => {
      await this.db.transaction(async (tx) => {
        await tx.exec('DELETE FROM relationships WHERE from_character_id = ? OR to_character_id = ?', [
          id,
          id
        ]);
        await tx.exec('DELETE FROM setting_facts WHERE source = ? AND source_ref = ?', [
          'character',
          id
        ]);
        // 摘除角色 id：先查含该 id 的事件，再逐条把 id 从 character_ids JSON 数组中移除
        const events = await tx.query<{ id: string; character_ids: string }>(
          `SELECT id, character_ids FROM timeline_events WHERE character_ids IS NOT NULL AND EXISTS (
             SELECT 1 FROM json_each(timeline_events.character_ids) WHERE json_each.value = ?
           )`,
          [id]
        );
        for (const ev of events) {
          let ids: unknown[] = [];
          try {
            const parsed = JSON.parse(ev.character_ids) as unknown;
            if (Array.isArray(parsed)) ids = parsed.filter((v) => v !== id);
          } catch {
            continue; // 列损坏跳过，不阻塞删除
          }
          await tx.exec('UPDATE timeline_events SET character_ids = ? WHERE id = ?', [
            JSON.stringify(ids),
            ev.id
          ]);
        }
        await tx.exec('DELETE FROM characters WHERE id = ?', [id]);
      });
    });
  }

  // ============ Schema 模板 ============

  async listSchemas(bookId: string | null): Promise<CharacterSchema[]> {
    const rows = await this.db.query<Record<string, unknown>>(
      'SELECT * FROM character_schemas WHERE book_id IS ? OR book_id IS NULL ORDER BY created_at ASC',
      [bookId]
    );
    return rows.map((r) => ({
      id: String(r.id),
      bookId: (r.book_id as string) ?? null,
      name: String(r.name),
      schemaJson: String(r.schema_json),
      createdAt: Number(r.created_at)
    }));
  }

  /** 确保书籍有默认模板（无则种入） */
  async ensureDefaultSchema(bookId: string): Promise<CharacterSchema> {
    const schemas = await this.listSchemas(bookId);
    const own = schemas.find((s) => s.bookId === bookId);
    if (own) return own;
    const id = crypto.randomUUID();
    await this.wq.enqueue(() =>
      this.db.exec(
        'INSERT INTO character_schemas (id, book_id, name, schema_json, created_at) VALUES (?, ?, ?, ?, ?)',
        [id, bookId, '默认模板', DEFAULT_SCHEMA_JSON, Date.now()]
      )
    );
    return (await this.listSchemas(bookId)).find((s) => s.id === id)!;
  }

  async saveSchema(schemaId: string, schemaJson: string): Promise<void> {
    JSON.parse(schemaJson); // 校验合法性
    await this.wq.enqueue(() =>
      this.db.exec('UPDATE character_schemas SET schema_json = ? WHERE id = ?', [
        schemaJson,
        schemaId
      ])
    );
  }
}

type Row = Record<string, unknown>;

export function rowToCharacter(r: Row): Character {
  return {
    id: String(r.id),
    bookId: String(r.book_id),
    name: String(r.name),
    schemaId: (r.schema_id as string) ?? null,
    data: String(r.data ?? '{}'),
    tags: (r.tags as string) ?? '[]',
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at)
  };
}
