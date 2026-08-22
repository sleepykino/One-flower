/**
 * 剧本工作台类型（P5）：剧本 → 集（episode）→ 场（scene）→ 镜（shot）→ 对白行
 * 存 screenplays.data JSON（行 + data 模式，同 maps 表）；分镜图入 images 表 usage='storyboard'
 */

export type ShotSize = 'ELS' | 'LS' | 'MS' | 'MCU' | 'CU' | 'ECU';

export const SHOT_SIZE_LABEL: Record<ShotSize, string> = {
  ELS: '远景',
  LS: '全景',
  MS: '中景',
  MCU: '中近景',
  CU: '近景',
  ECU: '特写'
};

export const SHOT_SIZES: ShotSize[] = ['ELS', 'LS', 'MS', 'MCU', 'CU', 'ECU'];

export interface DialogueLine {
  character: string;
  parenthetical?: string;
  line: string;
}

export interface Shot {
  id: string;
  /** 集内连续编号（生成时分配） */
  number: number;
  size: ShotSize;
  /** 运镜：推/拉/摇/移/跟/固定 */
  camera?: string;
  description: string;
  durationSec?: number;
  dialogue: DialogueLine[];
  /** 分镜图（images 表 id） */
  imageAssetId?: string;
  /** 生成分镜图时实际使用的英文 prompt（留档复用） */
  imagePrompt?: string;
}

export interface Scene {
  id: string;
  interior: 'INT' | 'EXT';
  location: string;
  timeOfDay: string;
  /** 一句话概要（大纲阶段产出，可编辑） */
  synopsis: string;
  /** 溯源章节 */
  sourceChapterId?: string;
  shots: Shot[];
  /** 逐场生成的恢复粒度：done 跳过 */
  status: 'outline' | 'done';
}

export interface ScreenplayEpisode {
  id: string;
  number: number;
  title: string;
  logline?: string;
  scenes: Scene[];
}

export interface ScreenplayDoc {
  episodes: ScreenplayEpisode[];
}

export type ScreenplayStatus = 'draft' | 'outlining' | 'generating' | 'review' | 'done';

export interface Screenplay {
  id: string;
  bookId: string;
  title: string;
  status: ScreenplayStatus;
  sourceRange?: { fromChapterId: string; toChapterId: string };
  data: ScreenplayDoc;
  createdAt: number;
  updatedAt: number;
}

/** 统计：集数 / 总场数 / 已完成场数 */
export function screenplayStats(sp: Screenplay): {
  episodes: number;
  scenes: number;
  doneScenes: number;
  shots: number;
  shotsWithImage: number;
} {
  let scenes = 0;
  let doneScenes = 0;
  let shots = 0;
  let shotsWithImage = 0;
  for (const ep of sp.data.episodes) {
    for (const sc of ep.scenes) {
      scenes += 1;
      if (sc.status === 'done') doneScenes += 1;
      shots += sc.shots.length;
      shotsWithImage += sc.shots.filter((s) => s.imageAssetId).length;
    }
  }
  return { episodes: sp.data.episodes.length, scenes, doneScenes, shots, shotsWithImage };
}
