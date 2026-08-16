/**
 * RelationshipService：角色关系 CRUD（relationships 表）
 */

import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { Relationship } from './types';

interface RelationshipRow {
  id: string;
  book_id: string;
  from_character_id: string;
  to_character_id: string;
  type: string;
  description: string | null;
  bidirectional: number;
  created_at: number;
}

function rowToRel(r: RelationshipRow): Relationship {
  return {
    id: r.id,
    bookId: r.book_id,
    fromCharacterId: r.from_character_id,
    toCharacterId: r.to_character_id,
    type: r.type,
    description: r.description ?? '',
    bidirectional: r.bidirectional === 1,
    createdAt: r.created_at
  };
}

export class RelationshipService {
  private db: Database;
  private wq: WriteQueue;

  constructor(db: Database, wq: WriteQueue) {
    this.db = db;
    this.wq = wq;
  }

  async create(
    data: Omit<Relationship, 'id' | 'createdAt'>
  ): Promise<Relationship> {
    const rel: Relationship = {
      ...data,
      id: crypto.randomUUID(),
      createdAt: Date.now()
    };
    await this.wq.enqueue(() =>
      this.db.exec(
        `INSERT INTO relationships (id, book_id, from_character_id, to_character_id, type, description, bidirectional, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          rel.id,
          rel.bookId,
          rel.fromCharacterId,
          rel.toCharacterId,
          rel.type,
          rel.description,
          rel.bidirectional ? 1 : 0,
          rel.createdAt
        ]
      )
    );
    return rel;
  }

  async update(id: string, data: Partial<Relationship>): Promise<void> {
    const sets: string[] = [];
    const vals: unknown[] = [];
    if (data.fromCharacterId !== undefined) {
      sets.push('from_character_id = ?');
      vals.push(data.fromCharacterId);
    }
    if (data.toCharacterId !== undefined) {
      sets.push('to_character_id = ?');
      vals.push(data.toCharacterId);
    }
    if (data.type !== undefined) {
      sets.push('type = ?');
      vals.push(data.type);
    }
    if (data.description !== undefined) {
      sets.push('description = ?');
      vals.push(data.description);
    }
    if (data.bidirectional !== undefined) {
      sets.push('bidirectional = ?');
      vals.push(data.bidirectional ? 1 : 0);
    }
    if (sets.length === 0) return;
    vals.push(id);
    await this.wq.enqueue(() =>
      this.db.exec(`UPDATE relationships SET ${sets.join(', ')} WHERE id = ?`, vals)
    );
  }

  async delete(id: string): Promise<void> {
    await this.wq.enqueue(() => this.db.exec('DELETE FROM relationships WHERE id = ?', [id]));
  }

  async listByBook(bookId: string): Promise<Relationship[]> {
    const rows = await this.db.query<RelationshipRow>(
      'SELECT * FROM relationships WHERE book_id = ? ORDER BY created_at ASC',
      [bookId]
    );
    return rows.map(rowToRel);
  }

  async listByCharacter(characterId: string): Promise<Relationship[]> {
    const rows = await this.db.query<RelationshipRow>(
      'SELECT * FROM relationships WHERE from_character_id = ? OR to_character_id = ? ORDER BY created_at ASC',
      [characterId, characterId]
    );
    return rows.map(rowToRel);
  }
}
