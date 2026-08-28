/**
 * 备份导入服务：从 .zip 包流式解压逐章写入 SQLite + 落盘
 */

import { Unzip, UnzipInflate } from 'fflate';
import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { ChapterStatus, ProseMirrorDoc } from '../../types';
import { docToPlainText } from '../../utils/pmdoc';
import { isPMDoc } from '../../utils/pmdoc';

interface BackupMeta {
  version: number;
  book: Record<string, unknown>;
  chapters: Array<{
    id: string;
    parentId: string | null;
    title: string;
    outline: string | null;
    status: string;
    sortOrder: number;
    wordCount: number;
    summary: string | null;
    createdAt: number;
    updatedAt: number;
  }>;
  characters: Array<Record<string, unknown>>;
  characterSchemas: Array<Record<string, unknown>>;
  worldbook: Array<Record<string, unknown>>;
  foreshadowings: Array<Record<string, unknown>>;
  /** P3 v2：图片资产元数据（文件本体在 zip 的 assets/ 目录；v1 无此字段） */
  images?: Array<Record<string, unknown>>;
  /** v3：P2-P5 模块（旧包无此字段，按空处理） */
  maps?: Array<Record<string, unknown>>;
  screenplays?: Array<Record<string, unknown>>;
  relationships?: Array<Record<string, unknown>>;
  timelineEvents?: Array<Record<string, unknown>>;
  settingFacts?: Array<Record<string, unknown>>;
  settingInferences?: Array<Record<string, unknown>>;
  inspirations?: Array<Record<string, unknown>>;
  writingStats?: Array<Record<string, unknown>>;
  writingGoals?: Array<Record<string, unknown>>;
  longformSessions?: Array<Record<string, unknown>>;
}

export class ImportService {
  private bridge: NativeBridge & {
    fs: {
      readBinaryFile(p: string): Promise<Uint8Array>;
      writeBinaryFile(p: string, d: Uint8Array): Promise<void>;
      ensureDir(p: string): Promise<void>;
    };
  };
  private db: Database;
  private wq: WriteQueue;

  constructor(bridge: NativeBridge, db: Database, wq: WriteQueue) {
    this.bridge = bridge as never;
    this.db = db;
    this.wq = wq;
  }

  /** 解压 .zip（流式，逐文件回调） */
  private unzip(buffer: Uint8Array): Promise<Map<string, Uint8Array>> {
    return new Promise((resolve, reject) => {
      const files = new Map<string, Uint8Array>();
      const unzip = new Unzip();
      unzip.register(UnzipInflate);
      unzip.onfile = (file) => {
        const chunks: Uint8Array[] = [];
        file.ondata = (err, data, final) => {
          if (err) {
            reject(err);
            return;
          }
          chunks.push(data);
          if (final) {
            const len = chunks.reduce((s, c) => s + c.length, 0);
            const out = new Uint8Array(len);
            let off = 0;
            for (const c of chunks) {
              out.set(c, off);
              off += c.length;
            }
            files.set(file.name, out);
          }
        };
        file.start();
      };
      try {
        unzip.push(buffer, true);
      } catch (e) {
        reject(e);
        return;
      }
      resolve(files);
    });
  }

  private decode(u8: Uint8Array): string {
    return new TextDecoder('utf-8').decode(u8);
  }

  /** 校验备份包完整性（不实际导入） */
  async validateBackup(zipPath: string): Promise<{ valid: boolean; errors: string[] }> {
    const errors: string[] = [];
    try {
      const buffer = await this.bridge.fs.readBinaryFile(zipPath);
      const files = await this.unzip(buffer);
      const metaRaw = files.get('meta.json');
      if (!metaRaw) {
        errors.push('缺少 meta.json');
        return { valid: false, errors };
      }
      const meta = JSON.parse(this.decode(metaRaw)) as BackupMeta;
      if (!meta.book?.title) errors.push('meta.json 缺少书籍标题');
      if (!Array.isArray(meta.chapters)) errors.push('meta.json 缺少章节列表');
      const chapterCount = meta.chapters?.length ?? 0;
      for (let i = 1; i <= chapterCount; i++) {
        const name = `chapters/${String(i).padStart(3, '0')}.json`;
        const docRaw = files.get(name);
        if (!docRaw) {
          errors.push(`缺少 ${name}`);
          continue;
        }
        const doc = JSON.parse(this.decode(docRaw));
        if (!isPMDoc(doc)) errors.push(`${name} 不是有效的 ProseMirror 文档`);
      }
    } catch (e) {
      errors.push(`解析失败: ${e instanceof Error ? e.message : String(e)}`);
    }
    return { valid: errors.length === 0, errors };
  }

  /** 从 .zip 备份包导入：流式解压逐章写入（新书籍 ID，避免冲突）；v2 包恢复图片资产 */
  async importBackup(zipPath: string): Promise<{ bookId: string; chapterCount: number }> {
    const buffer = await this.bridge.fs.readBinaryFile(zipPath);
    const files = await this.unzip(buffer);
    const metaRaw = files.get('meta.json');
    if (!metaRaw) throw new Error('备份包缺少 meta.json');
    const meta = JSON.parse(this.decode(metaRaw)) as BackupMeta;

    const appDataDir = await this.bridge.storage.appDataDir();
    const newBookId = crypto.randomUUID();
    const storageDir = `${appDataDir}/books/${newBookId}`.replace(/\\/g, '/');
    await this.bridge.fs.ensureDir(`${storageDir}/chapters`);

    const oldToNewChapterId = new Map<string, string>();
    // P3 v2：图片 ID 与角色 ID 均换新（避免与现有数据冲突），章节正文 imageBlock 引用同步重映射
    const oldToNewImageId = new Map<string, string>();
    for (const img of meta.images ?? []) {
      oldToNewImageId.set(String(img.id ?? ''), crypto.randomUUID());
    }
    const oldToNewCharacterId = new Map<string, string>();
    for (const c of meta.characters ?? []) {
      oldToNewCharacterId.set(String(c.id ?? ''), crypto.randomUUID());
    }
    // v3：世界书条目换新（地图 data 内 worldbookEntryId 引用需重映射）
    const oldToNewWorldbookId = new Map<string, string>();
    for (const w of meta.worldbook ?? []) {
      oldToNewWorldbookId.set(String(w.id ?? ''), crypto.randomUUID());
    }
    // v3：设定事实换新（推导链 fact_id 引用重映射）
    const oldToNewFactId = new Map<string, string>();
    for (const f of meta.settingFacts ?? []) {
      oldToNewFactId.set(String(f.id ?? ''), crypto.randomUUID());
    }
    const now = Date.now();

    // 逐章写入：章节行 + 正文文件 + FTS 索引
    const stmts: Array<{ sql: string; params: unknown[] }> = [];
    stmts.push({
      sql: `INSERT INTO books (id, title, genre, author, cover_path, storage_dir, enabled_skills, provider_config_id, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, '[]', NULL, ?, ?)`,
      params: [
        newBookId,
        String(meta.book.title ?? '导入书籍'),
        (meta.book.genre as string) ?? null,
        (meta.book.author as string) ?? null,
        (meta.book.cover_path as string) ?? null,
        storageDir,
        now,
        now
      ]
    });

    let idx = 0;
    for (const ch of meta.chapters) {
      idx++;
      const docRaw = files.get(`chapters/${String(idx).padStart(3, '0')}.json`);
      const doc: ProseMirrorDoc = docRaw && isPMDoc(JSON.parse(this.decode(docRaw)))
        ? (JSON.parse(this.decode(docRaw)) as ProseMirrorDoc)
        : { type: 'doc', content: [{ type: 'paragraph' }] };
      // P3 v2：正文 imageBlock 的 assetId 重映射到新图片 ID
      remapImageAssetIds(doc, oldToNewImageId);

      const newChapterId = crypto.randomUUID();
      oldToNewChapterId.set(ch.id, newChapterId);
      const contentPath = `${storageDir}/chapters/${newChapterId}.json`;
      await this.bridge.fs.writeFile(contentPath, JSON.stringify(doc, null, 2));

      stmts.push({
        sql: `INSERT INTO chapters (id, book_id, parent_id, title, outline, status, sort_order, word_count, content_path, summary, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          newChapterId,
          newBookId,
          null, // parentId 下一轮统一更新
          ch.title,
          ch.outline,
          ch.status as ChapterStatus,
          ch.sortOrder,
          ch.wordCount,
          contentPath,
          ch.summary,
          ch.createdAt,
          now
        ]
      });
      stmts.push({
        sql: 'INSERT INTO chapters_fts (chapter_id, book_id, title, content) VALUES (?, ?, ?, ?)',
        params: [newChapterId, newBookId, ch.title, docToPlainText(doc)]
      });
    }

    // 修正 parentId 映射
    for (const ch of meta.chapters) {
      const newId = oldToNewChapterId.get(ch.id)!;
      const mappedParent = ch.parentId ? oldToNewChapterId.get(ch.parentId) ?? null : null;
      stmts.push({
        sql: 'UPDATE chapters SET parent_id = ? WHERE id = ?',
        params: [mappedParent, newId]
      });
    }

    // 角色卡 / 模板 / 世界书 / 伏笔
    for (const c of meta.characters ?? []) {
      const newCharId = oldToNewCharacterId.get(String(c.id ?? '')) ?? crypto.randomUUID();
      stmts.push({
        sql: `INSERT INTO characters (id, book_id, name, schema_id, data, tags, created_at, updated_at)
              VALUES (?, ?, ?, NULL, ?, ?, ?, ?)`,
        params: [
          newCharId,
          newBookId,
          String(c.name ?? ''),
          String(c.data ?? '{}'),
          (c.tags as string) ?? '[]',
          now,
          now
        ]
      });
    }
    for (const s of meta.characterSchemas ?? []) {
      stmts.push({
        sql: `INSERT INTO character_schemas (id, book_id, name, schema_json, created_at)
              VALUES (?, ?, ?, ?, ?)`,
        params: [
          crypto.randomUUID(),
          newBookId,
          String(s.name ?? '模板'),
          String(s.schema_json ?? '{}'),
          now
        ]
      });
    }
    for (const w of meta.worldbook ?? []) {
      stmts.push({
        sql: `INSERT INTO worldbook_entries (id, book_id, title, category, content, tags, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          oldToNewWorldbookId.get(String(w.id ?? '')) ?? crypto.randomUUID(),
          newBookId,
          String(w.title ?? ''),
          (w.category as string) ?? null,
          String(w.content ?? ''),
          (w.tags as string) ?? '[]',
          now,
          now
        ]
      });
    }
    for (const f of meta.foreshadowings ?? []) {
      stmts.push({
        sql: `INSERT INTO foreshadowings (id, book_id, description, planted_chapter_id, resolved_chapter_id, status, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        params: [
          crypto.randomUUID(),
          newBookId,
          String(f.description ?? ''),
          (f.planted_chapter_id as string)
            ? oldToNewChapterId.get(String(f.planted_chapter_id)) ?? null
            : null,
          (f.resolved_chapter_id as string)
            ? oldToNewChapterId.get(String(f.resolved_chapter_id)) ?? null
            : null,
          (f.status as string) ?? 'planted',
          now
        ]
      });
    }

    // P3 v2：恢复图片资产（zip assets/ -> {storageDir}/assets/ + 重建 images 表记录）
    if (meta.version >= 2 && (meta.images?.length ?? 0) > 0) {
      await this.bridge.fs.ensureDir(`${storageDir}/assets`);
      for (const img of meta.images ?? []) {
        const oldId = String(img.id ?? '');
        const newId = oldToNewImageId.get(oldId) ?? crypto.randomUUID();
        const fileName = String(img.file_name ?? '').replace(/\\/g, '/');
        if (!fileName.startsWith('assets/')) continue;
        const bytes = files.get(fileName);
        if (!bytes) continue; // zip 中缺文件（导出时已缺失）：跳过该资产
        await this.bridge.fs.writeBinaryFile(`${storageDir}/${fileName}`, bytes);
        // usage='character' 时 ref_id 重映射到新角色 ID
        const refId =
          String(img.usage ?? '') === 'character' && img.ref_id
            ? oldToNewCharacterId.get(String(img.ref_id)) ?? null
            : null;
        stmts.push({
          sql: `INSERT INTO images (id, book_id, file_name, width, height, size_bytes, mime_type, source,
                prompt, negative_prompt, provider_config_id, model, usage, ref_id, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            newId,
            newBookId,
            fileName,
            Number(img.width ?? 0),
            Number(img.height ?? 0),
            Number(img.size_bytes ?? 0),
            String(img.mime_type ?? 'image/png'),
            String(img.source ?? 'upload'),
            (img.prompt as string) ?? null,
            (img.negative_prompt as string) ?? null,
            (img.provider_config_id as string) ?? null,
            (img.model as string) ?? null,
            String(img.usage ?? 'library'),
            refId,
            Number(img.created_at ?? now)
          ]
        });
      }
    }

    // ---------- v3：P2-P5 模块恢复（旧包字段缺失时全部跳过） ----------

    // 地图：新地图 ID；data JSON 内 worldbookEntryId 重映射；底图从 zip mapbg/ 恢复
    if ((meta.maps?.length ?? 0) > 0) {
      const appDir = await this.bridge.storage.appDataDir();
      await this.bridge.fs.ensureDir(`${appDir}/maps`);
      for (const m of meta.maps ?? []) {
        const oldMapId = String(m.id ?? '');
        const newMapId = crypto.randomUUID();
        let backgroundPath: string | null = null;
        const oldRel = String(m.background_path ?? '').replace(/\\/g, '/');
        if (oldRel) {
          const baseName = oldRel.split('/').pop() ?? '';
          const bytes = files.get(`mapbg/${baseName}`);
          if (bytes) {
            const newRel = `maps/${newMapId}_${baseName.replace(/^[^_]*_/, '')}`;
            await this.bridge.fs.writeBinaryFile(`${appDir}/${newRel}`, bytes);
            backgroundPath = newRel;
          }
        }
        stmts.push({
          sql: `INSERT INTO maps (id, book_id, name, width, height, background_path, data, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          params: [
            newMapId,
            newBookId,
            String(m.name ?? '地图'),
            Number(m.width ?? 1600),
            Number(m.height ?? 1000),
            backgroundPath,
            remapMapData(String(m.data ?? '{}'), oldToNewWorldbookId),
            Number(m.created_at ?? now),
            now
          ]
        });
      }
    }

    // 剧本：data JSON 内 sourceChapterId / imageAssetId 重映射
    for (const sp of meta.screenplays ?? []) {
      stmts.push({
        sql: `INSERT INTO screenplays (id, book_id, title, status, source_range, data, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          crypto.randomUUID(),
          newBookId,
          String(sp.title ?? '剧本'),
          String(sp.status ?? 'draft'),
          remapSourceRange(String(sp.source_range ?? ''), oldToNewChapterId),
          remapScreenplayData(String(sp.data ?? '{}'), oldToNewChapterId, oldToNewImageId),
          Number(sp.created_at ?? now),
          now
        ]
      });
    }

    // 角色关系（from/to 角色重映射）
    for (const r of meta.relationships ?? []) {
      const from = oldToNewCharacterId.get(String(r.from_character_id ?? ''));
      const to = oldToNewCharacterId.get(String(r.to_character_id ?? ''));
      if (!from || !to) continue;
      stmts.push({
        sql: `INSERT INTO relationships (id, book_id, from_character_id, to_character_id, type, description, bidirectional, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          crypto.randomUUID(),
          newBookId,
          from,
          to,
          String(r.type ?? '关系'),
          (r.description as string) ?? null,
          Number(r.bidirectional ?? 1),
          Number(r.created_at ?? now)
        ]
      });
    }

    // 时间线事件（chapter_id 与 character_ids 重映射）
    for (const t of meta.timelineEvents ?? []) {
      let charIds = String(t.character_ids ?? '[]');
      try {
        const ids = JSON.parse(charIds) as string[];
        charIds = JSON.stringify(ids.map((id) => oldToNewCharacterId.get(id) ?? id));
      } catch {
        /* 保留原值 */
      }
      stmts.push({
        sql: `INSERT INTO timeline_events (id, book_id, title, description, timeline, sort_order, chapter_id, character_ids, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          crypto.randomUUID(),
          newBookId,
          String(t.title ?? ''),
          (t.description as string) ?? null,
          String(t.timeline ?? 'main'),
          Number(t.sort_order ?? 0),
          (t.chapter_id as string) ? oldToNewChapterId.get(String(t.chapter_id)) ?? null : null,
          charIds,
          Number(t.created_at ?? now)
        ]
      });
    }

    // 设定事实 + 推导链（source_ref 按来源重映射；inference.fact_id 重映射）
    for (const f of meta.settingFacts ?? []) {
      const source = String(f.source ?? '');
      const refMap =
        source === 'worldbook' ? oldToNewWorldbookId : source === 'character' ? oldToNewCharacterId : oldToNewChapterId;
      stmts.push({
        sql: `INSERT INTO setting_facts (id, book_id, kind, domain, fact, basis, confidence, exempt, source, source_ref, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          oldToNewFactId.get(String(f.id ?? '')) ?? crypto.randomUUID(),
          newBookId,
          String(f.kind ?? 'other'),
          String(f.domain ?? '其他'),
          String(f.fact ?? ''),
          String(f.basis ?? ''),
          Number(f.confidence ?? 0.8),
          Number(f.exempt ?? 0),
          source,
          refMap.get(String(f.source_ref ?? '')) ?? String(f.source_ref ?? ''),
          Number(f.created_at ?? now)
        ]
      });
    }
    for (const inf of meta.settingInferences ?? []) {
      const factId = oldToNewFactId.get(String(inf.fact_id ?? ''));
      if (!factId) continue;
      stmts.push({
        sql: `INSERT INTO setting_inferences (id, fact_id, book_id, premise, conclusion, confidence, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        params: [
          crypto.randomUUID(),
          factId,
          newBookId,
          String(inf.premise ?? ''),
          String(inf.conclusion ?? ''),
          Number(inf.confidence ?? 0.7),
          Number(inf.created_at ?? now)
        ]
      });
    }

    // 按书绑定的灵感（推演报告 / 采访摘要）
    for (const ins of meta.inspirations ?? []) {
      stmts.push({
        sql: `INSERT INTO inspirations (id, book_id, type, title, content, tags, source, favorited, metadata, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          crypto.randomUUID(),
          newBookId,
          String(ins.type ?? 'whatif_report'),
          (ins.title as string) ?? null,
          String(ins.content ?? '{}'),
          (ins.tags as string) ?? '[]',
          String(ins.source ?? 'ai'),
          Number(ins.favorited ?? 0),
          (ins.metadata as string) ?? null,
          Number(ins.created_at ?? now)
        ]
      });
    }

    // 写作统计与目标
    for (const ws of meta.writingStats ?? []) {
      stmts.push({
        sql: `INSERT INTO writing_stats (id, book_id, date, words_written, chapters_worked, session_duration, created_at)
              VALUES (?, ?, ?, ?, ?, ?, ?)`,
        params: [
          crypto.randomUUID(),
          newBookId,
          String(ws.date ?? ''),
          Number(ws.words_written ?? 0),
          (ws.chapters_worked as string) ?? null,
          Number(ws.session_duration ?? 0),
          Number(ws.created_at ?? now)
        ]
      });
    }
    for (const wg of meta.writingGoals ?? []) {
      stmts.push({
        sql: `INSERT INTO writing_goals (book_id, daily_target, total_target, updated_at) VALUES (?, ?, ?, ?)`,
        params: [newBookId, Number(wg.daily_target ?? 3000), Number(wg.total_target ?? 0), now]
      });
    }

    // 长文会话（chapter_id 重映射；beats JSON 原样保留）
    for (const ls of meta.longformSessions ?? []) {
      const chapterId = oldToNewChapterId.get(String(ls.chapter_id ?? ''));
      if (!chapterId) continue;
      stmts.push({
        sql: `INSERT INTO longform_sessions (id, book_id, chapter_id, status, beats, current_beat_index, used_tokens, estimated_tokens, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        params: [
          crypto.randomUUID(),
          newBookId,
          chapterId,
          String(ls.status ?? 'paused'),
          String(ls.beats ?? '[]'),
          Number(ls.current_beat_index ?? 0),
          Number(ls.used_tokens ?? 0),
          Number(ls.estimated_tokens ?? 0),
          Number(ls.created_at ?? now),
          now
        ]
      });
    }

    // v3：项目级指令文件 + 全书大纲恢复（zip directives/ -> 新书 storageDir 根；outline.md 缺省兼容旧备份）
    const agentsRaw = files.get('directives/agents.md');
    const hookRaw = files.get('directives/hook.md');
    const outlineRaw = files.get('directives/outline.md');
    if (agentsRaw) await this.bridge.fs.writeFile(`${storageDir}/agents.md`, this.decode(agentsRaw));
    if (hookRaw) await this.bridge.fs.writeFile(`${storageDir}/hook.md`, this.decode(hookRaw));
    if (outlineRaw) await this.bridge.fs.writeFile(`${storageDir}/outline.md`, this.decode(outlineRaw));

    await this.wq.enqueue(() =>
      this.db.transaction(async (tx) => {
        for (const s of stmts) {
          await tx.exec(s.sql, s.params);
        }
      })
    );

    return { bookId: newBookId, chapterCount: meta.chapters.length };
  }
}

/** 就地重映射文档中 imageBlock 的 assetId（备份导入：图片 ID 换新） */
function remapImageAssetIds(doc: ProseMirrorDoc, mapping: Map<string, string>): void {
  if (mapping.size === 0) return;
  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const n = node as { type?: string; attrs?: Record<string, unknown>; content?: unknown[] };
    if (n.type === 'imageBlock' && n.attrs) {
      const oldId = String(n.attrs.assetId ?? '');
      const newId = oldId ? mapping.get(oldId) : undefined;
      if (newId) n.attrs.assetId = newId;
      return;
    }
    if (Array.isArray(n.content)) n.content.forEach(walk);
  };
  for (const block of (doc.content ?? []) as unknown[]) walk(block);
}

/** 地图 data JSON 重映射：节点 worldbookEntryId -> 新世界书条目 ID（解析失败原样返回） */
function remapMapData(dataJson: string, wbMap: Map<string, string>): string {
  if (wbMap.size === 0) return dataJson;
  try {
    const data = JSON.parse(dataJson) as { nodes?: Array<{ worldbookEntryId?: string }> };
    for (const n of data.nodes ?? []) {
      if (n.worldbookEntryId) {
        n.worldbookEntryId = wbMap.get(n.worldbookEntryId) ?? n.worldbookEntryId;
      }
    }
    return JSON.stringify(data);
  } catch {
    return dataJson;
  }
}

/** 剧本 data JSON 重映射：场 sourceChapterId -> 新章节 ID；镜 imageAssetId -> 新图片 ID */
function remapScreenplayData(
  dataJson: string,
  chapterMap: Map<string, string>,
  imageMap: Map<string, string>
): string {
  try {
    const data = JSON.parse(dataJson) as {
      episodes?: Array<{
        scenes?: Array<{ sourceChapterId?: string; shots?: Array<{ imageAssetId?: string }> }>;
      }>;
    };
    for (const ep of data.episodes ?? []) {
      for (const sc of ep.scenes ?? []) {
        if (sc.sourceChapterId) {
          sc.sourceChapterId = chapterMap.get(sc.sourceChapterId) ?? sc.sourceChapterId;
        }
        for (const st of sc.shots ?? []) {
          if (st.imageAssetId) {
            st.imageAssetId = imageMap.get(st.imageAssetId) ?? st.imageAssetId;
          }
        }
      }
    }
    return JSON.stringify(data);
  } catch {
    return dataJson;
  }
}

/** 剧本 source_range JSON 重映射（{fromChapterId,toChapterId}；非法原样返回 null 语义由调用方处理） */
function remapSourceRange(rangeJson: string, chapterMap: Map<string, string>): string | null {
  if (!rangeJson || rangeJson === 'null') return null;
  try {
    const sr = JSON.parse(rangeJson) as { fromChapterId?: string; toChapterId?: string };
    if (!sr.fromChapterId || !sr.toChapterId) return null;
    const from = chapterMap.get(sr.fromChapterId);
    const to = chapterMap.get(sr.toChapterId);
    if (!from || !to) return null;
    return JSON.stringify({ fromChapterId: from, toChapterId: to });
  } catch {
    return null;
  }
}
