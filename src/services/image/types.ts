/**
 * P3 图片模块共享类型
 * 图片文件本体存 {storageDir}/assets/，SQLite 只存元数据（images 表）
 */

export type ImageUsage = 'cover' | 'character' | 'illustration' | 'library' | 'storyboard';
export type ImageSource = 'upload' | 'ai';

export interface ImageAsset {
  id: string;
  bookId: string;
  /** 相对 storageDir：'assets/xxx.png' */
  fileName: string;
  width: number;
  height: number;
  sizeBytes: number;
  mimeType: string;
  source: ImageSource;
  /** AI 来源时的最终 prompt 留档 */
  prompt: string | null;
  negativePrompt: string | null;
  providerConfigId: string | null;
  model: string | null;
  usage: ImageUsage;
  /** usage='character' 时为 characterId，其余 null */
  refId: string | null;
  createdAt: number;
}

/** 图片引用位置（删除前引用检查） */
export interface ImageReference {
  type: 'chapter' | 'cover' | 'character';
  id: string;
  title: string;
}

/** 删除被引用图片时抛出（UI 捕获后展示引用列表并二次确认） */
export class ImageReferenceError extends Error {
  readonly refs: ImageReference[];

  constructor(refs: ImageReference[]) {
    super(`该图片正被 ${refs.length} 处引用，删除后相关位置将显示占位文字`);
    this.name = 'ImageReferenceError';
    this.refs = refs;
  }
}

/** 两段式提示词的场景描述 */
export type ImageScene =
  | { kind: 'cover'; book: { title: string; genre: string | null; author: string | null } }
  | { kind: 'character'; name: string; cardData: Record<string, unknown> }
  | { kind: 'illustration'; chapterTitle: string; selectedText: string };

export const USAGE_LABELS: Record<ImageUsage, string> = {
  cover: '封面',
  character: '角色',
  illustration: '插图',
  library: '图库',
  storyboard: '分镜'
};
