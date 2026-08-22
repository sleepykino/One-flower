/**
 * StoryboardService（P5-M3）：分镜 prompt 组装与生成
 * 一致性卖点：对白出场角色的角色卡外貌字段注入 prompt（「设定即资产」）
 * 批量生成走任务中心 kind 'storyboard'（逐镜顺序，单镜失败跳过标记，可取消）
 */

import type { NativeBridge } from '../../native/NativeBridge';
import { resolveImageProvider } from '../ai/providers/ImageProvider';
import type { GeneratedImage } from '../ai/providers/ImageProvider';
import type { ImageAssetService } from '../image/ImageAssetService';
import type { TaskCenterService } from '../task/TaskCenterService';
import type { ScreenplayService } from './ScreenplayService';
import type { Scene, Shot, ShotSize } from './types';

/** 景别 -> 英文构图词（英文生图模型友好） */
const SHOT_SIZE_EN: Record<ShotSize, string> = {
  ELS: 'extreme wide shot',
  LS: 'wide shot',
  MS: 'medium shot',
  MCU: 'medium close-up shot',
  CU: 'close-up shot',
  ECU: 'extreme close-up shot'
};

const CAMERA_EN: Record<string, string> = {
  推: 'push-in camera',
  拉: 'pull-back camera',
  摇: 'pan shot',
  移: 'tracking shot',
  跟: 'follow shot',
  固定: 'static camera'
};

interface CharacterBrief {
  name: string;
  brief: string;
}

export class StoryboardService {
  private bridge: NativeBridge;
  private imageAssets: ImageAssetService;
  private screenplays: ScreenplayService;
  private tasks: TaskCenterService;

  constructor(
    bridge: NativeBridge,
    imageAssets: ImageAssetService,
    screenplays: ScreenplayService,
    tasks: TaskCenterService
  ) {
    this.bridge = bridge;
    this.imageAssets = imageAssets;
    this.screenplays = screenplays;
    this.tasks = tasks;
  }

  /** 组装分镜 prompt：镜头描述 + 场景头 + 出场角色外貌（角色卡一致性）+ 景别/运镜构图词 */
  async buildShotPrompt(bookId: string, scene: Scene, shot: Shot): Promise<string> {
    const chars = await this.loadCharacterBriefs(bookId, scene, shot);
    const parts: string[] = [];
    parts.push(
      `${scene.interior === 'INT' ? 'interior' : 'exterior'}, ${scene.location}, ${scene.timeOfDay}, cinematic film still`
    );
    if (shot.description) parts.push(shot.description);
    if (shot.camera && CAMERA_EN[shot.camera]) parts.push(CAMERA_EN[shot.camera]);
    parts.push(SHOT_SIZE_EN[shot.size] ?? 'medium shot');
    for (const c of chars) {
      parts.push(`${c.name}: ${c.brief}`);
    }
    return parts.filter(Boolean).join(', ');
  }

  /** 单镜生成 2 候选（走 image 功能路由；调用方处理挑选后入库） */
  async generateCandidates(
    bookId: string,
    scene: Scene,
    shot: Shot,
    signal?: AbortSignal
  ): Promise<{ images: GeneratedImage[]; prompt: string }> {
    const prompt = await this.buildShotPrompt(bookId, scene, shot);
    const { provider } = await resolveImageProvider(this.bridge, bookId);
    const images = await provider.generate({
      prompt,
      size: '1536x1024',
      count: 2,
      seed: undefined
    });
    if (images.length === 0) throw new Error('生图返回为空');
    return { images, prompt };
  }

  /** 入库并回填 shot.imageAssetId（usage='storyboard', refId=shot.id） */
  async saveShotImage(
    bookId: string,
    screenplayId: string,
    shot: Shot,
    image: GeneratedImage,
    prompt: string
  ): Promise<string> {
    const asset = await this.imageAssets.saveGenerated(bookId, image, {
      usage: 'storyboard',
      refId: shot.id,
      prompt
    });
    await this.screenplays.setShotImage(screenplayId, shot.id, asset.id, prompt);
    return asset.id;
  }

  /** 批量生成缺失分镜图（任务中心 kind 'storyboard'，逐镜顺序，单镜失败跳过，可取消） */
  generateMissing(bookId: string, screenplayId: string, onProgress?: () => void): void {
    const exec = (): void => {
      this.tasks.register({
        kind: 'storyboard',
        title: '批量生成分镜图',
        cancellable: true,
        run: async ({ report, signal }) => {
          const sp = await this.screenplays.get(screenplayId);
          if (!sp) throw new Error('剧本不存在');
          const flat: Array<{ scene: Scene; shot: Shot; label: string }> = [];
          for (const ep of sp.data.episodes) {
            for (const sc of ep.scenes) {
              for (const st of sc.shots) {
                if (!st.imageAssetId) flat.push({ scene: sc, shot: st, label: `第 ${ep.number} 集 · 镜 ${st.number}` });
              }
            }
          }
          if (flat.length === 0) return;
          let done = 0;
          let failed = 0;
          for (const item of flat) {
            if (signal.aborted) throw new DOMException('已取消', 'AbortError');
            report(Math.round((done / flat.length) * 100), `${item.label}${failed > 0 ? `（失败 ${failed}）` : ''}`);
            try {
              const { images, prompt } = await this.generateCandidates(bookId, item.scene, item.shot, signal);
              await this.saveShotImage(bookId, screenplayId, item.shot, images[0], prompt);
            } catch (e) {
              if (signal.aborted) throw e;
              failed += 1;
              console.warn('[Storyboard] 单镜生成失败，跳过:', item.label, e);
            }
            done += 1;
            onProgress?.();
          }
          report(100, `完成${failed > 0 ? `（失败 ${failed} 镜）` : ''}`);
        },
        retry: exec
      });
    };
    exec();
  }

  /** 出场角色外貌概要（名字出现在描述/对白中的本书角色卡；无匹配返回空） */
  private async loadCharacterBriefs(bookId: string, scene: Scene, shot: Shot): Promise<CharacterBrief[]> {
    const hay = [scene.synopsis, shot.description, ...shot.dialogue.map((d) => `${d.character} ${d.line}`)].join(' ');
    const rows = await this.bridge.db
      .query<Record<string, unknown>>('SELECT * FROM characters WHERE book_id = ?', [bookId])
      .catch(() => []);
    const out: CharacterBrief[] = [];
    for (const r of rows) {
      const name = String(r.name ?? '');
      if (!name || !hay.includes(name)) continue;
      let data: Record<string, unknown> = {};
      try {
        data = JSON.parse(String(r.data ?? '{}')) as Record<string, unknown>;
      } catch {
        data = {};
      }
      const brief = Object.entries(data)
        .filter(([k, v]) => /外貌|appearance|性别|gender|年龄|age|服饰|发型|身形/i.test(k) && v)
        .map(([k, v]) => `${k} ${String(v).slice(0, 60)}`)
        .join(', ');
      if (brief) out.push({ name, brief });
      if (out.length >= 4) break;
    }
    return out;
  }
}
