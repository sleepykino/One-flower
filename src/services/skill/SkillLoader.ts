/**
 * SkillLoader：扫描 ~/.novelagent/skills 下每个子目录的 SKILL.md，
 * 解析 frontmatter，建立索引（skills_cache），支持热重载。
 * Skill 是纯声明式 Markdown 指令包，只注入 Prompt，不执行代码。
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { Database } from '../../db/Database';
import type { WriteQueue } from '../../db/WriteQueue';
import type { AIMode, SkillManifest } from './types';
import { BUILTIN_SKILLS } from './builtin';

export class SkillLoader {
  private bridge: NativeBridge;
  private db: Database;
  private wq: WriteQueue;
  private skillsDir: string;
  private manifests: SkillManifest[] = [];

  constructor(bridge: NativeBridge, db: Database, wq: WriteQueue, skillsDir: string) {
    this.bridge = bridge;
    this.db = db;
    this.wq = wq;
    this.skillsDir = skillsDir.replace(/\\/g, '/');
  }

  /** 扫描目录，解析所有 SKILL.md，返回清单 */
  async loadAll(): Promise<SkillManifest[]> {
    await this.bridge.fs.ensureDir(this.skillsDir);

    // 首次（目录为空）种入内置示例 Skill
    const entries = await this.bridge.fs.listDir(this.skillsDir);
    const skillDirs = entries.filter((e) => e.isDir);
    if (skillDirs.length === 0) {
      for (const skill of BUILTIN_SKILLS) {
        await this.bridge.fs.writeFile(
          `${this.skillsDir}/${skill.name}/SKILL.md`,
          skill.content
        );
      }
    }

    const manifests: SkillManifest[] = [];
    for (const entry of await this.bridge.fs.listDir(this.skillsDir)) {
      if (!entry.isDir) continue;
      const dirPath = `${this.skillsDir}/${entry.name}`;
      const file = `${dirPath}/SKILL.md`;
      try {
        const raw = await this.bridge.fs.readFile(file);
        const manifest = this.parse(entry.name, dirPath, raw);
        if (manifest) {
          manifests.push(manifest);
        } else {
          console.warn(`Skill 解析失败（frontmatter 缺失或格式错误）：${file}`);
        }
      } catch (e) {
        console.warn(`Skill 加载失败（缺少 SKILL.md 或读取错误）：${file}`, e);
      }
    }

    this.manifests = manifests;
    await this.syncCache(manifests);
    return manifests;
  }

  /** 解析 frontmatter + 正文（简化 YAML：单行 key: value，数组 [a, b]） */
  private parse(fallbackName: string, dirPath: string, raw: string): SkillManifest | null {
    const text = raw.replace(/\r\n/g, '\n');
    if (!text.trimStart().startsWith('---')) return null;

    const end = text.indexOf('\n---', 3);
    if (end < 0) return null;

    const fmText = text.slice(3, end).trim();
    const body = text.slice(text.indexOf('\n', end + 4)).trim();

    const fm: Record<string, string> = {};
    for (const line of fmText.split('\n')) {
      const m = line.match(/^([a-zA-Z_]+)\s*:\s*(.*)$/);
      if (m) fm[m[1]] = m[2].trim();
    }

    const parseList = (s: string | undefined): string[] => {
      if (!s) return [];
      const inner = s.replace(/^\[|\]$/g, '');
      return inner
        .split(',')
        .map((x) => x.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    };

    const modes: AIMode[] = ['continue', 'rewrite', 'dialogue', 'check'];
    const appliesTo = parseList(fm.applies_to).filter((x): x is AIMode =>
      modes.includes(x as AIMode)
    );

    return {
      name: fm.name ?? fallbackName,
      description: fm.description ?? '',
      trigger: (fm.trigger as SkillManifest['trigger']) ?? 'manual',
      appliesTo: appliesTo.length > 0 ? appliesTo : ['continue', 'rewrite', 'dialogue'],
      priority: Number(fm.priority ?? 0) || 0,
      keywords: parseList(fm.keywords),
      body,
      dirPath,
      loadedAt: Date.now()
    };
  }

  /** 同步 skills_cache 索引（运行时缓存，可重建） */
  private async syncCache(manifests: SkillManifest[]): Promise<void> {
    await this.wq.enqueue(() =>
      this.db.transaction(async (tx) => {
        await tx.exec('DELETE FROM skills_cache');
        for (const m of manifests) {
          await tx.exec(
            `INSERT INTO skills_cache (name, dir_path, description, applies_to, priority, body, loaded_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              m.name,
              m.dirPath,
              m.description,
              JSON.stringify(m.appliesTo),
              m.priority,
              m.body,
              m.loadedAt
            ]
          );
        }
      })
    );
  }

  /** 获取某本书启用的、且在指定模式下生效的 Skill（按 priority 降序） */
  async getEnabledForMode(bookId: string, mode: AIMode): Promise<SkillManifest[]> {
    const row = await this.db.queryOne<{ enabled_skills: string }>(
      'SELECT enabled_skills FROM books WHERE id = ?',
      [bookId]
    );
    let enabled: string[] = [];
    try {
      enabled = JSON.parse(row?.enabled_skills ?? '[]') as string[];
    } catch {
      enabled = [];
    }
    return this.manifests
      .filter((m) => enabled.includes(m.name) && m.appliesTo.includes(mode))
      .sort((a, b) => b.priority - a.priority);
  }

  /** 重新扫描（用户添加新 Skill 后） */
  async reload(): Promise<void> {
    await this.loadAll();
  }

  /** 监听 Skill 目录变化（热重载） */
  watch(onChange: () => void): () => void {
    return this.bridge.fs.watchDir(this.skillsDir, () => {
      void this.reload().then(onChange).catch((e) => console.error('Skill 热重载失败', e));
    });
  }

  get all(): SkillManifest[] {
    return this.manifests;
  }

  /** Skill 目录路径（UI 展示用） */
  get dir(): string {
    return this.skillsDir;
  }
}
