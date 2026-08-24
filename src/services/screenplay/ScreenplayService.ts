/**
 * ScreenplayService（P5-M1/M4）：剧本 CRUD + 结构编辑 + Fountain / 分镜表导出
 * data 存 screenplays.data JSON（行 + data 模式）；结构演化靠 data JSON，不动表
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import { docToPlainText } from '../../utils/pmdoc';
import type { ProseMirrorDoc } from '../../types';
import type { Screenplay, ScreenplayDoc, ScreenplayStatus, Scene } from './types';

interface SpRow {
  id: string;
  book_id: string;
  title: string;
  status: string;
  source_range: string | null;
  data: string;
  created_at: number;
  updated_at: number;
}

function parseDoc(raw: string): ScreenplayDoc {
  try {
    const parsed = JSON.parse(raw) as Partial<ScreenplayDoc>;
    if (parsed && Array.isArray(parsed.episodes)) return { episodes: parsed.episodes };
  } catch {
    /* 损坏按空处理 */
  }
  return { episodes: [] };
}

function rowToScreenplay(r: SpRow): Screenplay {
  let sourceRange: Screenplay['sourceRange'];
  if (r.source_range) {
    try {
      const sr = JSON.parse(r.source_range) as { fromChapterId?: string; toChapterId?: string };
      if (sr.fromChapterId && sr.toChapterId) sourceRange = { fromChapterId: sr.fromChapterId, toChapterId: sr.toChapterId };
    } catch {
      /* 忽略损坏的溯源范围 */
    }
  }
  return {
    id: String(r.id),
    bookId: String(r.book_id),
    title: String(r.title),
    status: (['draft', 'outlining', 'generating', 'review', 'done'].includes(String(r.status))
      ? String(r.status)
      : 'draft') as ScreenplayStatus,
    sourceRange,
    data: parseDoc(r.data),
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at)
  };
}

export class ScreenplayService {
  private bridge: NativeBridge;
  private db: Database;
  private wq: WriteQueue;

  constructor(bridge: NativeBridge, db: Database, wq: WriteQueue) {
    this.bridge = bridge;
    this.db = db;
    this.wq = wq;
  }

  async create(bookId: string, title: string): Promise<Screenplay> {
    const now = Date.now();
    const sp: Screenplay = {
      id: crypto.randomUUID(),
      bookId,
      title,
      status: 'draft',
      data: { episodes: [] },
      createdAt: now,
      updatedAt: now
    };
    await this.wq.enqueue(() =>
      this.db.exec(
        `INSERT INTO screenplays (id, book_id, title, status, source_range, data, created_at, updated_at)
         VALUES (?, ?, ?, ?, NULL, ?, ?, ?)`,
        [sp.id, bookId, sp.title, sp.status, JSON.stringify(sp.data), now, now]
      )
    );
    return sp;
  }

  async get(id: string): Promise<Screenplay | null> {
    const row = await this.db.queryOne<SpRow>('SELECT * FROM screenplays WHERE id = ?', [id]);
    return row ? rowToScreenplay(row) : null;
  }

  async listByBook(bookId: string): Promise<Screenplay[]> {
    const rows = await this.db.query<SpRow>(
      'SELECT * FROM screenplays WHERE book_id = ? ORDER BY updated_at DESC',
      [bookId]
    );
    return rows.map(rowToScreenplay);
  }

  async remove(id: string): Promise<void> {
    // 分镜图不级联删（图库资产归书统一管理）
    await this.wq.enqueue(() => this.db.exec('DELETE FROM screenplays WHERE id = ?', [id]));
  }

  async rename(id: string, title: string): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.exec('UPDATE screenplays SET title = ?, updated_at = ? WHERE id = ?', [
        title.trim() || '未命名剧本',
        Date.now(),
        id
      ])
    );
  }

  /** 整体保存（编辑器主路径；data/status/sourceRange 全量覆盖） */
  async save(sp: Screenplay): Promise<void> {
    const now = Date.now();
    sp.updatedAt = now;
    await this.wq.enqueue(() =>
      this.db.exec('UPDATE screenplays SET title = ?, status = ?, source_range = ?, data = ?, updated_at = ? WHERE id = ?', [
        sp.title,
        sp.status,
        sp.sourceRange ? JSON.stringify(sp.sourceRange) : null,
        JSON.stringify(sp.data),
        now,
        sp.id
      ])
    );
  }

  /** 载入 → 变更 → 保存（WriteQueue 串行，供结构编辑细粒度操作） */
  private async mutate(id: string, fn: (sp: Screenplay) => void): Promise<Screenplay | null> {
    const sp = await this.get(id);
    if (!sp) return null;
    fn(sp);
    await this.save(sp);
    return sp;
  }

  /** 整场覆盖保存 */
  async saveScene(screenplayId: string, episodeId: string, scene: Scene): Promise<Screenplay | null> {
    return this.mutate(screenplayId, (sp) => {
      const ep = sp.data.episodes.find((e) => e.id === episodeId);
      if (!ep) return;
      const i = ep.scenes.findIndex((s) => s.id === scene.id);
      if (i >= 0) ep.scenes[i] = scene;
      else ep.scenes.push(scene);
    });
  }

  /** 加场（afterSceneId 之后插入，缺省追加到末尾）；返回新场与更新后的剧本 */
  async addScene(
    screenplayId: string,
    episodeId: string,
    afterSceneId?: string
  ): Promise<{ scene: Scene; sp: Screenplay } | null> {
    const scene: Scene = {
      id: crypto.randomUUID(),
      interior: 'INT',
      location: '新地点',
      timeOfDay: '日',
      synopsis: '',
      shots: [],
      status: 'outline'
    };
    const sp = await this.mutate(screenplayId, (m) => {
      const ep = m.data.episodes.find((e) => e.id === episodeId);
      if (!ep) return;
      const i = afterSceneId ? ep.scenes.findIndex((s) => s.id === afterSceneId) : -1;
      if (i >= 0) ep.scenes.splice(i + 1, 0, scene);
      else ep.scenes.push(scene);
    });
    return sp ? { scene, sp } : null;
  }

  async removeScene(screenplayId: string, episodeId: string, sceneId: string): Promise<Screenplay | null> {
    return this.mutate(screenplayId, (sp) => {
      const ep = sp.data.episodes.find((e) => e.id === episodeId);
      if (ep) ep.scenes = ep.scenes.filter((s) => s.id !== sceneId);
    });
  }

  /** 恢复误删的场到原位置（简易 undo 用；场景已存在则原地覆盖不重复插入） */
  async restoreScene(screenplayId: string, episodeId: string, scene: Scene, index: number): Promise<Screenplay | null> {
    return this.mutate(screenplayId, (sp) => {
      const ep = sp.data.episodes.find((e) => e.id === episodeId);
      if (!ep) return;
      const i = ep.scenes.findIndex((s) => s.id === scene.id);
      if (i >= 0) ep.scenes[i] = scene;
      else ep.scenes.splice(Math.max(0, Math.min(ep.scenes.length, index)), 0, scene);
    });
  }

  async moveScene(screenplayId: string, episodeId: string, sceneId: string, targetIndex: number): Promise<Screenplay | null> {
    return this.mutate(screenplayId, (sp) => {
      const ep = sp.data.episodes.find((e) => e.id === episodeId);
      if (!ep) return;
      const i = ep.scenes.findIndex((s) => s.id === sceneId);
      if (i < 0) return;
      const [scene] = ep.scenes.splice(i, 1);
      ep.scenes.splice(Math.max(0, Math.min(ep.scenes.length, targetIndex)), 0, scene);
    });
  }

  /** 分镜图回填（按 shotId 全文查找，跨集生效）；返回更新后的剧本供调用方局部刷新 */
  async setShotImage(screenplayId: string, shotId: string, imageAssetId?: string, imagePrompt?: string): Promise<Screenplay | null> {
    return this.mutate(screenplayId, (sp) => {
      for (const ep of sp.data.episodes) {
        for (const sc of ep.scenes) {
          const shot = sc.shots.find((s) => s.id === shotId);
          if (shot) {
            shot.imageAssetId = imageAssetId;
            shot.imagePrompt = imagePrompt;
            return;
          }
        }
      }
    });
  }

  // ---------------- 导出（P5-M4） ----------------

  /** Fountain 纯文本导出（场景头大写规范 / 角色名大写 / 括注与台词缩进规范） */
  async exportFountain(screenplayId: string, outputPath: string): Promise<void> {
    const sp = await this.get(screenplayId);
    if (!sp) throw new Error('剧本不存在');
    const out: string[] = [`Title: ${sp.title}`, ''];
    let sceneNo = 0;
    for (const ep of sp.data.episodes) {
      out.push(`# 第 ${ep.number} 集${ep.title ? `：${ep.title}` : ''}`, '');
      if (ep.logline) out.push(`> ${ep.logline}`, '');
      for (const sc of ep.scenes) {
        sceneNo += 1;
        out.push(`${sc.interior}. ${sc.location} - ${sc.timeOfDay}`, '', `[[场 ${sceneNo}]] ${sc.synopsis || ''}`, '');
        for (const shot of sc.shots) {
          const head = [SHOT_TAG[shot.size], shot.camera, shot.durationSec ? `${shot.durationSec}s` : '']
            .filter(Boolean)
            .join(' / ');
          if (shot.description) out.push(`(${head}) ${shot.description}`, '');
          for (const dl of shot.dialogue) {
            out.push(dl.character.toUpperCase());
            if (dl.parenthetical) out.push(`(${dl.parenthetical})`);
            out.push(dl.line, '');
          }
        }
        out.push('');
      }
    }
    await this.bridge.fs.writeFile(outputPath, out.join('\n'));
  }

  /** Markdown 分镜表导出：每集一张表 + storyboard/ 图片目录相对引用 */
  async exportStoryboardMarkdown(screenplayId: string, outputPath: string): Promise<void> {
    const sp = await this.get(screenplayId);
    if (!sp) throw new Error('剧本不存在');
    const dir = outputPath.replace(/[\\/][^\\/]+$/, '');
    const imgDir = `${dir}/storyboard`;
    await this.bridge.fs.ensureDir(imgDir);
    const out: string[] = [`# ${sp.title} · 分镜表`, ''];
    for (const ep of sp.data.episodes) {
      out.push(`## 第 ${ep.number} 集${ep.title ? `：${ep.title}` : ''}`, '');
      if (ep.logline) out.push(`> ${ep.logline}`, '');
      out.push('| 场 | 镜 | 景别 | 运镜 | 描述 | 时长 | 对白 | 分镜图 |', '|---|---|---|---|---|---|---|---|');
      for (let si = 0; si < ep.scenes.length; si++) {
        const sc = ep.scenes[si];
        const heading = `${sc.interior}.${sc.location}·${sc.timeOfDay}`;
        for (const shot of sc.shots) {
          const dlg = shot.dialogue.map((d) => `${d.character}：${d.line}`).join('<br>');
          let imgCell = '';
          if (shot.imageAssetId) {
            try {
              const asset = await this.lookupImage(shot.imageAssetId);
              if (asset) {
                const bytes = await this.readImageBytes(asset);
                const fileName = `sp_${sp.id.slice(0, 8)}_${shot.id.slice(0, 8)}.png`;
                await this.bridge.fs.writeBinaryFile(`${imgDir}/${fileName}`, bytes);
                imgCell = `![](storyboard/${fileName})`;
              }
            } catch {
              imgCell = '（图片缺失）';
            }
          }
          out.push(
            `| ${si + 1} ${heading} | ${shot.number} | ${shot.size} | ${shot.camera ?? ''} | ${shot.description.replace(/\|/g, '/')} | ${shot.durationSec ?? ''}s | ${dlg.replace(/\|/g, '/')} | ${imgCell} |`
          );
        }
      }
      out.push('');
    }
    await this.bridge.fs.writeFile(outputPath, out.join('\n'));
  }

  private async lookupImage(imageId: string): Promise<{ bookId: string; fileName: string } | null> {
    const row = await this.db.queryOne<{ book_id: string; file_name: string }>(
      'SELECT book_id, file_name FROM images WHERE id = ?',
      [imageId]
    );
    return row ? { bookId: String(row.book_id), fileName: String(row.file_name) } : null;
  }

  private async readImageBytes(asset: { bookId: string; fileName: string }): Promise<Uint8Array> {
    const row = await this.db.queryOne<{ storage_dir: string }>(
      'SELECT storage_dir FROM books WHERE id = ?',
      [asset.bookId]
    );
    const dir = (row?.storage_dir ?? '').replace(/\\/g, '/');
    if (!dir) throw new Error('书籍目录不存在');
    return this.bridge.fs.readBinaryFile(`${dir}/${asset.fileName}`);
  }

  /** 章节正文纯文本（截断），供转化编排取材 */
  async chapterExcerpt(chapterId: string, limit = 800): Promise<string> {
    try {
      const doc = await this.loadChapterDoc(chapterId);
      const text = docToPlainText(doc);
      if (text.length <= limit) return text;
      return `${text.slice(0, Math.floor(limit * 0.4))}\n…\n${text.slice(-Math.floor(limit * 0.6))}`;
    } catch {
      return '';
    }
  }

  private async loadChapterDoc(chapterId: string): Promise<ProseMirrorDoc> {
    const row = await this.db.queryOne<{ content_path: string | null; book_id: string }>(
      'SELECT content_path, book_id FROM chapters WHERE id = ?',
      [chapterId]
    );
    if (!row) throw new Error('章节不存在');
    let path = row.content_path ?? null;
    if (!path) {
      const book = await this.db.queryOne<{ storage_dir: string }>(
        'SELECT storage_dir FROM books WHERE id = ?',
        [row.book_id]
      );
      if (!book) throw new Error('书籍不存在');
      path = `${String(book.storage_dir)}/chapters/${chapterId}.json`;
    }
    const raw = await this.bridge.fs.readFile(path);
    return JSON.parse(raw) as ProseMirrorDoc;
  }
}

const SHOT_TAG: Record<string, string> = {
  ELS: '远景',
  LS: '全景',
  MS: '中景',
  MCU: '中近景',
  CU: '近景',
  ECU: '特写'
};
