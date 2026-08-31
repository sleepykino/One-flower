/**
 * NotesService：随手记 / 备忘录（全局，跨书共享）
 * - 文本速记（markdown，链接可直接贴 URL），图片附件（粘贴 / 拖拽 / 选择）
 * - 附件文件本体存 {appDataDir}/notes/{note_id}/{file_name}，元数据入 note_attachments
 */

import type { NativeBridge } from '../../native/NativeBridge';
import { ZipWriter } from '../../utils/zipbuilder';
import { decodeUtf8, unzipToMap } from '../../utils/zipreader';

export interface Note {
  id: string;
  content: string;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface NoteAttachment {
  id: string;
  noteId: string;
  fileName: string; // 相对 notes 根：{note_id}/{file_name}
  mimeType: string;
  createdAt: number;
}

/** 备忘录备份包 meta.json（version 1）：全部备忘录 + 附件元数据；附件二进制在 zip 的 files/ 目录 */
export interface NotesBackupMeta {
  version: number;
  notes: Note[];
  attachments: NoteAttachment[];
}

export interface NotesImportResult {
  noteCount: number;
  attachmentCount: number;
}

interface BridgeFs {
  readBinaryFile(p: string): Promise<Uint8Array>;
  writeBinaryFile(p: string, data: Uint8Array): Promise<void>;
  deletePath(p: string): Promise<void>;
  ensureDir(p: string): Promise<void>;
}

type NotesBridge = NativeBridge & { fs: BridgeFs };

export class NotesService {
  private bridge: NotesBridge;

  constructor(bridge: NativeBridge) {
    // 断言二进制/删除能力（tauriBridge 实现齐全；类型层收窄以使用二进制接口）
    this.bridge = bridge as NotesService['bridge'];
  }

  /** 备忘录根目录：{appDataDir}/notes（不存在则创建） */
  private async notesRoot(): Promise<string> {
    const dir = (await this.bridge.storage.appDataDir()).replace(/\\/g, '/');
    const root = `${dir}/notes`;
    await this.bridge.fs.ensureDir(root);
    return root;
  }

  /** 全部备忘录：置顶优先，其次最近编辑 */
  async list(): Promise<Note[]> {
    const rows = await this.bridge.db.query<Record<string, unknown>>(
      'SELECT id, content, pinned, created_at, updated_at FROM notes ORDER BY pinned DESC, updated_at DESC'
    );
    return rows.map((r) => ({
      id: String(r.id),
      content: String(r.content ?? ''),
      pinned: Number(r.pinned) !== 0,
      createdAt: Number(r.created_at),
      updatedAt: Number(r.updated_at)
    }));
  }

  async create(content: string): Promise<Note> {
    const now = Date.now();
    const id = crypto.randomUUID();
    await this.bridge.db.exec(
      'INSERT INTO notes (id, content, pinned, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
      [id, content, now, now]
    );
    return { id, content, pinned: false, createdAt: now, updatedAt: now };
  }

  async updateContent(id: string, content: string): Promise<void> {
    await this.bridge.db.exec('UPDATE notes SET content = ?, updated_at = ? WHERE id = ?', [
      content,
      Date.now(),
      id
    ]);
  }

  async setPinned(id: string, pinned: boolean): Promise<void> {
    await this.bridge.db.exec('UPDATE notes SET pinned = ?, updated_at = ? WHERE id = ?', [
      pinned ? 1 : 0,
      Date.now(),
      id
    ]);
  }

  /** 删除备忘录（连同附件文件与元数据；文件删除失败不阻断，仅记录） */
  async remove(id: string): Promise<void> {
    const atts = await this.attachmentsOf(id);
    for (const a of atts) {
      await this.bridge.fs.deletePath(`${await this.notesRoot()}/${a.fileName}`).catch(() => undefined);
    }
    await this.bridge.db.exec('DELETE FROM note_attachments WHERE note_id = ?', [id]);
    await this.bridge.db.exec('DELETE FROM notes WHERE id = ?', [id]);
  }

  async attachmentsOf(noteId: string): Promise<NoteAttachment[]> {
    const rows = await this.bridge.db.query<Record<string, unknown>>(
      'SELECT id, note_id, file_name, mime_type, created_at FROM note_attachments WHERE note_id = ? ORDER BY created_at ASC',
      [noteId]
    );
    return rows.map((r) => ({
      id: String(r.id),
      noteId: String(r.note_id),
      fileName: String(r.file_name),
      mimeType: String(r.mime_type),
      createdAt: Number(r.created_at)
    }));
  }

  /** 添加图片附件：bytes 落盘 notes/{noteId}/{随机名}，返回元数据 */
  async addAttachment(
    noteId: string,
    file: { name: string; mime: string; bytes: Uint8Array }
  ): Promise<NoteAttachment> {
    const root = await this.notesRoot();
    const dir = `${root}/${noteId}`;
    await this.bridge.fs.ensureDir(dir);
    const ext = (file.name.match(/\.([a-zA-Z0-9]+)$/)?.[1] ?? 'png').toLowerCase();
    const fileName = `${crypto.randomUUID()}.${ext}`;
    await this.bridge.fs.writeBinaryFile(`${dir}/${fileName}`, file.bytes);
    const att: NoteAttachment = {
      id: crypto.randomUUID(),
      noteId,
      fileName: `${noteId}/${fileName}`,
      mimeType: file.mime || 'image/png',
      createdAt: Date.now()
    };
    await this.bridge.db.exec(
      'INSERT INTO note_attachments (id, note_id, file_name, mime_type, created_at) VALUES (?, ?, ?, ?, ?)',
      [att.id, att.noteId, att.fileName, att.mimeType, att.createdAt]
    );
    return att;
  }

  /** 删除附件（文件 + 元数据；文件删除失败不阻断） */
  async removeAttachment(att: NoteAttachment): Promise<void> {
    await this.bridge.fs.deletePath(`${await this.notesRoot()}/${att.fileName}`).catch(() => undefined);
    await this.bridge.db.exec('DELETE FROM note_attachments WHERE id = ?', [att.id]);
  }

  /** 附件图片转为可展示的 blob URL（调用方负责 revokeObjectURL） */
  async attachmentUrl(att: NoteAttachment): Promise<string> {
    const data = await this.bridge.fs.readBinaryFile(`${await this.notesRoot()}/${att.fileName}`);
    return URL.createObjectURL(new Blob([data as unknown as BlobPart], { type: att.mimeType }));
  }

  /**
   * 导出全部备忘录为单独备份包（跨书全局数据，与单书备份 zip 分开）：
   * meta.json（version 1，notes + attachments 元数据）+ files/{fileName}（附件二进制，缺失跳过）
   */
  async exportBackup(outputPath: string): Promise<void> {
    const notes = await this.list();
    const attachments: NoteAttachment[] = [];
    for (const n of notes) {
      attachments.push(...(await this.attachmentsOf(n.id)));
    }
    const root = await this.notesRoot();
    const zip = new ZipWriter();
    zip.addText(
      'meta.json',
      JSON.stringify({ version: 1, notes, attachments } satisfies NotesBackupMeta, null, 2)
    );
    for (const att of attachments) {
      try {
        const bytes = await this.bridge.fs.readBinaryFile(`${root}/${att.fileName}`);
        zip.addBinary(`files/${att.fileName}`, bytes);
      } catch {
        /* 附件文件缺失（已手动删除等）：跳过，不中断备份 */
      }
    }
    const out = await zip.finish();
    await this.bridge.fs.writeBinaryFile(outputPath, out);
  }

  /**
   * 从备忘录备份包导入：全部按新 ID 重建（不覆盖现有备忘录，重复导入会生成副本）；
   * 附件二进制从 zip files/ 恢复到 {appData}/notes/{新note_id}/{file}，元数据 note_id/file_name 同步重映射
   */
  async importBackup(zipPath: string): Promise<NotesImportResult> {
    const buffer = await this.bridge.fs.readBinaryFile(zipPath);
    const files = await unzipToMap(buffer);
    const metaRaw = files.get('meta.json');
    if (!metaRaw) throw new Error('备忘录备份包缺少 meta.json');
    let meta: NotesBackupMeta;
    try {
      meta = JSON.parse(decodeUtf8(metaRaw)) as NotesBackupMeta;
    } catch {
      throw new Error('备忘录备份包 meta.json 解析失败');
    }

    const root = await this.notesRoot();
    const noteIdMap = new Map<string, string>();
    const result: NotesImportResult = { noteCount: 0, attachmentCount: 0 };
    const stmts: Array<{ sql: string; params: unknown[] }> = [];

    for (const n of meta.notes ?? []) {
      const newId = crypto.randomUUID();
      noteIdMap.set(n.id, newId);
      stmts.push({
        sql: 'INSERT INTO notes (id, content, pinned, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
        params: [newId, n.content ?? '', n.pinned ? 1 : 0, n.createdAt, n.updatedAt]
      });
      result.noteCount += 1;
    }

    for (const att of meta.attachments ?? []) {
      const newNoteId = noteIdMap.get(att.noteId);
      if (!newNoteId) continue;
      const fileName = String(att.fileName ?? '').replace(/\\/g, '/');
      const base = fileName.split('/').pop() ?? fileName;
      const newFileName = `${newNoteId}/${base}`;
      const bytes = files.get(`files/${fileName}`);
      if (bytes) {
        await this.bridge.fs.ensureDir(`${root}/${newNoteId}`);
        await this.bridge.fs.writeBinaryFile(`${root}/${newFileName}`, bytes);
      }
      stmts.push({
        sql: 'INSERT INTO note_attachments (id, note_id, file_name, mime_type, created_at) VALUES (?, ?, ?, ?, ?)',
        params: [crypto.randomUUID(), newNoteId, newFileName, att.mimeType ?? 'image/png', att.createdAt]
      });
      result.attachmentCount += 1;
    }

    for (const s of stmts) {
      await this.bridge.db.exec(s.sql, s.params);
    }
    return result;
  }
}