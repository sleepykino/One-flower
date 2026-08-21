/**
 * ImageAssetService：图片资产管理（P3）
 * - 文件存 {storageDir}/assets/，元数据入 images 表（文件不入 SQLite blob）
 * - 引用检查（章节 content 含 assetId / books.cover_path / 角色关联）
 * - 删除清理（存在引用且未 force 时抛 ImageReferenceError，UI 负责二次确认）
 * - WebView 显示 URL 统一走 assetProtocol 封装（resolveAssetUrl）
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { GeneratedImage } from '../ai/providers/ImageProvider';
import { resolveAssetUrl } from '../../utils/assetUrl';
import { extOfMime, mimeOfExt, parseImageSize, sniffImageMime } from '../../utils/imageMeta';
import type { ImageAsset, ImageReference, ImageSource, ImageUsage } from './types';
import { ImageReferenceError } from './types';

export type { ImageSource, ImageUsage };

/** 上传/生成入库的附加元信息 */
export interface ImageSaveMeta {
  usage: ImageUsage;
  refId?: string | null;
  prompt?: string | null;
  negativePrompt?: string | null;
  providerConfigId?: string | null;
  model?: string | null;
}

export class ImageAssetService {
  private bridge: NativeBridge & {
    fs: {
      readBinaryFile(p: string): Promise<Uint8Array>;
      writeBinaryFile(p: string, data: Uint8Array): Promise<void>;
      readFile(p: string): Promise<string>;
      deletePath(p: string): Promise<void>;
      ensureDir(p: string): Promise<void>;
    };
  };
  private db: Database;
  private wq: WriteQueue;
  /** bookId -> storageDir 缓存 */
  private dirCache = new Map<string, string>();

  constructor(bridge: NativeBridge, db: Database, wq: WriteQueue) {
    // 断言二进制能力（tauriBridge 实现齐全；类型层收窄以使用二进制接口）
    this.bridge = bridge as ImageAssetService['bridge'];
    this.db = db;
    this.wq = wq;
  }

  /** 书籍 storageDir（DB 为权威，兜底 appDataDir/books/{id}；带缓存） */
  private async storageDirOf(bookId: string): Promise<string> {
    const cached = this.dirCache.get(bookId);
    if (cached) return cached;
    const row = await this.db.queryOne<{ storage_dir: string }>(
      'SELECT storage_dir FROM books WHERE id = ?',
      [bookId]
    );
    const dir = (row?.storage_dir ?? `${await this.bridge.storage.appDataDir()}/books/${bookId}`).replace(/\\/g, '/');
    this.dirCache.set(bookId, dir);
    return dir;
  }

  /** 图片文件绝对路径 */
  async absolutePath(asset: ImageAsset): Promise<string> {
    const dir = await this.storageDirOf(asset.bookId);
    return `${dir}/${asset.fileName}`;
  }

  /** WebView 可显示 URL（assetProtocol + convertFileSrc 封装） */
  async resolveUrl(asset: ImageAsset): Promise<string> {
    return resolveAssetUrl(await this.absolutePath(asset)) ?? '';
  }

  /** 按书内相对路径（assets/xxx.png）解析显示 URL（编辑器 ImageNode 渲染用） */
  async resolveFileUrl(bookId: string, fileName: string): Promise<string | null> {
    const dir = await this.storageDirOf(bookId);
    return resolveAssetUrl(`${dir}/${fileName.replace(/\\/g, '/')}`);
  }

  /** AI 生成结果入库（含宽高解析；文件名用资产 id 保证唯一） */
  async saveGenerated(bookId: string, image: GeneratedImage, meta: ImageSaveMeta): Promise<ImageAsset> {
    const dir = await this.storageDirOf(bookId);
    const id = crypto.randomUUID();
    const ext = extOfMime(image.mimeType);
    const fileName = `assets/${id}.${ext}`;
    await this.bridge.fs.ensureDir(`${dir}/assets`);
    await this.bridge.fs.writeBinaryFile(`${dir}/${fileName}`, image.bytes);
    const size = parseImageSize(image.bytes) ?? { width: 0, height: 0 };
    const asset: ImageAsset = {
      id,
      bookId,
      fileName,
      width: size.width,
      height: size.height,
      sizeBytes: image.bytes.length,
      mimeType: image.mimeType,
      source: 'ai',
      prompt: meta.prompt ?? image.revisedPrompt ?? null,
      negativePrompt: meta.negativePrompt ?? null,
      providerConfigId: meta.providerConfigId ?? null,
      model: meta.model ?? null,
      usage: meta.usage,
      refId: meta.refId ?? null,
      createdAt: Date.now()
    };
    await this.insertRow(asset);
    return asset;
  }

  /** 上传：复制外部文件进 {storageDir}/assets/ 并登记（读取一次用于宽高/MIME 解析） */
  async importFromFile(
    bookId: string,
    srcPath: string,
    usage: ImageUsage,
    refId?: string | null
  ): Promise<ImageAsset> {
    const dir = await this.storageDirOf(bookId);
    const bytes = await this.bridge.fs.readBinaryFile(srcPath);
    const sniffed = sniffImageMime(bytes);
    const mimeType = sniffed !== 'application/octet-stream' ? sniffed : mimeOfExt(srcPath);
    if (!mimeType) {
      throw new Error('不支持的图片格式（仅支持 PNG / JPG / WebP / GIF / BMP）');
    }
    const id = crypto.randomUUID();
    const ext = extOfMime(mimeType);
    const fileName = `assets/${id}.${ext}`;
    await this.bridge.fs.ensureDir(`${dir}/assets`);
    await this.bridge.fs.writeBinaryFile(`${dir}/${fileName}`, bytes);
    const size = parseImageSize(bytes) ?? { width: 0, height: 0 };
    const asset: ImageAsset = {
      id,
      bookId,
      fileName,
      width: size.width,
      height: size.height,
      sizeBytes: bytes.length,
      mimeType,
      source: 'upload',
      prompt: null,
      negativePrompt: null,
      providerConfigId: null,
      model: null,
      usage,
      refId: refId ?? null,
      createdAt: Date.now()
    };
    await this.insertRow(asset);
    return asset;
  }

  /** 从字节数据入库（编辑器粘贴/拖入图片用） */
  async importFromBytes(
    bookId: string,
    bytes: Uint8Array,
    mimeType: string,
    usage: ImageUsage,
    refId?: string | null
  ): Promise<ImageAsset> {
    const dir = await this.storageDirOf(bookId);
    const id = crypto.randomUUID();
    const fileName = `assets/${id}.${extOfMime(mimeType)}`;
    await this.bridge.fs.ensureDir(`${dir}/assets`);
    await this.bridge.fs.writeBinaryFile(`${dir}/${fileName}`, bytes);
    const size = parseImageSize(bytes) ?? { width: 0, height: 0 };
    const asset: ImageAsset = {
      id,
      bookId,
      fileName,
      width: size.width,
      height: size.height,
      sizeBytes: bytes.length,
      mimeType,
      source: 'upload',
      prompt: null,
      negativePrompt: null,
      providerConfigId: null,
      model: null,
      usage,
      refId: refId ?? null,
      createdAt: Date.now()
    };
    await this.insertRow(asset);
    return asset;
  }

  async get(id: string): Promise<ImageAsset | null> {
    const row = await this.db.queryOne<Record<string, unknown>>('SELECT * FROM images WHERE id = ?', [id]);
    return row ? rowToAsset(row) : null;
  }

  async listByBook(bookId: string, usage?: ImageUsage): Promise<ImageAsset[]> {
    const rows = usage
      ? await this.db.query<Record<string, unknown>>(
          'SELECT * FROM images WHERE book_id = ? AND usage = ? ORDER BY created_at DESC',
          [bookId, usage]
        )
      : await this.db.query<Record<string, unknown>>(
          'SELECT * FROM images WHERE book_id = ? ORDER BY created_at DESC',
          [bookId]
        );
    return rows.map(rowToAsset);
  }

  async findByRef(bookId: string, usage: ImageUsage, refId: string): Promise<ImageAsset | null> {
    const row = await this.db.queryOne<Record<string, unknown>>(
      'SELECT * FROM images WHERE book_id = ? AND usage = ? AND ref_id = ? ORDER BY created_at DESC LIMIT 1',
      [bookId, usage, refId]
    );
    return row ? rowToAsset(row) : null;
  }

  /** 删除前引用检查：章节 content 含 assetId / books.cover_path / 角色关联 */
  async listReferences(assetId: string): Promise<ImageReference[]> {
    const asset = await this.get(assetId);
    if (!asset) return [];
    const refs: ImageReference[] = [];

    // 1) 封面引用
    const book = await this.db.queryOne<{ cover_path: string | null; title: string }>(
      'SELECT cover_path, title FROM books WHERE id = ?',
      [asset.bookId]
    );
    if (book && book.cover_path && book.cover_path.replace(/\\/g, '/') === asset.fileName) {
      refs.push({ type: 'cover', id: asset.bookId, title: book.title });
    }

    // 2) 角色引用（usage=character 时 ref_id 指向角色）
    if (asset.usage === 'character' && asset.refId) {
      const ch = await this.db.queryOne<{ name: string }>(
        'SELECT name FROM characters WHERE id = ?',
        [asset.refId]
      );
      if (ch) refs.push({ type: 'character', id: asset.refId, title: ch.name });
    }

    // 3) 正文引用：扫描章节 JSON 文件是否包含 assetId（ImageNode attrs）
    const chapters = await this.db.query<{ id: string; title: string; content_path: string | null }>(
      'SELECT id, title, content_path FROM chapters WHERE book_id = ? ORDER BY sort_order',
      [asset.bookId]
    );
    const dir = await this.storageDirOf(asset.bookId);
    for (const ch of chapters) {
      const path = ch.content_path ?? `${dir}/chapters/${ch.id}.json`;
      try {
        const raw = await this.bridge.fs.readFile(path);
        if (raw.includes(assetId)) refs.push({ type: 'chapter', id: ch.id, title: ch.title });
      } catch {
        /* 章节文件缺失则跳过 */
      }
    }
    return refs;
  }

  /** 删除资产（存在引用且未 force 时抛 ImageReferenceError，UI 负责二次确认） */
  async remove(id: string, force = false): Promise<void> {
    const asset = await this.get(id);
    if (!asset) return;
    if (!force) {
      const refs = await this.listReferences(id);
      if (refs.length > 0) throw new ImageReferenceError(refs);
    }
    const dir = await this.storageDirOf(asset.bookId);
    // force 删除时清掉指向该文件的 books.cover_path，避免悬空指向（图库图片也可能被选为封面）
    await this.wq.enqueue(() =>
      this.db.exec('UPDATE books SET cover_path = NULL WHERE id = ? AND cover_path = ?', [
        asset.bookId,
        asset.fileName
      ])
    );
    await this.wq.enqueue(() => this.db.exec('DELETE FROM images WHERE id = ?', [id]));
    await this.bridge.fs.deletePath(`${dir}/${asset.fileName}`).catch(() => undefined);
  }

  /** 更新用途关联（图库图片被选为封面/角色图时复用记录） */
  async setUsage(id: string, usage: ImageUsage, refId?: string | null): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.exec('UPDATE images SET usage = ?, ref_id = ? WHERE id = ?', [usage, refId ?? null, id])
    );
  }

  /** 设置角色图片（保证同一角色至多一张关联，旧图转回图库） */
  async setCharacterImage(bookId: string, characterId: string, assetId: string): Promise<void> {
    const current = await this.findByRef(bookId, 'character', characterId);
    await this.wq.enqueue(async () => {
      if (current && current.id !== assetId) {
        await this.db.exec('UPDATE images SET usage = ?, ref_id = NULL WHERE id = ?', ['library', current.id]);
      }
      await this.db.exec('UPDATE images SET usage = ?, ref_id = ? WHERE id = ?', [
        'character',
        characterId,
        assetId
      ]);
    });
  }

  /** 清除角色图片（解除关联，图片保留在图库） */
  async clearCharacterImage(bookId: string, characterId: string): Promise<void> {
    const current = await this.findByRef(bookId, 'character', characterId);
    if (!current) return;
    await this.setUsage(current.id, 'library', null);
  }

  /** 读取图片字节（导出内嵌用） */
  async readBytes(asset: ImageAsset): Promise<Uint8Array | null> {
    try {
      return await this.bridge.fs.readBinaryFile(await this.absolutePath(asset));
    } catch {
      return null; // 文件缺失（被手动删除等），导出侧降级占位
    }
  }

  private async insertRow(asset: ImageAsset): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.exec(
        `INSERT INTO images (id, book_id, file_name, width, height, size_bytes, mime_type, source,
          prompt, negative_prompt, provider_config_id, model, usage, ref_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          asset.id,
          asset.bookId,
          asset.fileName,
          asset.width,
          asset.height,
          asset.sizeBytes,
          asset.mimeType,
          asset.source,
          asset.prompt,
          asset.negativePrompt,
          asset.providerConfigId,
          asset.model,
          asset.usage,
          asset.refId,
          asset.createdAt
        ]
      )
    );
  }
}

export function rowToAsset(r: Record<string, unknown>): ImageAsset {
  return {
    id: String(r.id),
    bookId: String(r.book_id),
    fileName: String(r.file_name),
    width: Number(r.width),
    height: Number(r.height),
    sizeBytes: Number(r.size_bytes),
    mimeType: String(r.mime_type),
    source: String(r.source) as ImageAsset['source'],
    prompt: (r.prompt as string) ?? null,
    negativePrompt: (r.negative_prompt as string) ?? null,
    providerConfigId: (r.provider_config_id as string) ?? null,
    model: (r.model as string) ?? null,
    usage: String(r.usage) as ImageAsset['usage'],
    refId: (r.ref_id as string) ?? null,
    createdAt: Number(r.created_at)
  };
}
