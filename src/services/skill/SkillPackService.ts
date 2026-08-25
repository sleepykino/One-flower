/**
 * SkillPackService：Skill 导入/导出包（.zip / .skillpack，标准 zip 结构）
 * 导出：递归收集 skillsDir/<name>/ 全部文件（SKILL.md + 附属资源），zipSync 打包后二进制落盘
 * 导入：readBinaryFile 读取 -> unzipSync 解压 -> 解析 SKILL.md frontmatter 预览 / 落盘
 * 包结构约定：SKILL.md 位于包根；兼容「压缩时带单层目录」的包（自动剥离前缀）
 */

import { strFromU8, unzipSync, zipSync } from 'fflate';
import type { NativeBridge } from '../../native/NativeBridge';
import type { NativeBridgeWithBinary } from '../../native/types';
import { parseKeyValues } from '../../utils/skillFrontmatter';

export interface SkillPreview {
  name: string;
  description: string;
  appliesTo: string[];
  priority: number;
  resourceCount: number;
  alreadyExists: boolean;
}

export interface ImportOptions {
  overwrite?: boolean;
  renameTo?: string;
}

/** 合法 Skill 目录名（拒绝路径分隔符与 Windows 保留字符） */
function isSafeName(name: string): boolean {
  return name !== '' && name !== '.' && name !== '..' && !/[\\/:*?"<>|]/.test(name);
}

export class SkillPackService {
  private bridge: NativeBridgeWithBinary;
  private skillsDir: string;

  constructor(bridge: NativeBridge, skillsDir: string) {
    // 运行时 bridge（tauri-bridge）带二进制读写，接口层用断言收窄（同 ImportService/ExportService）
    this.bridge = bridge as NativeBridgeWithBinary;
    this.skillsDir = skillsDir.replace(/\\/g, '/');
  }

  /** 导出 Skill 为包文件（zip 二进制落盘），返回打包的文件数 */
  async exportPack(skillName: string, outputPath: string): Promise<number> {
    const files: Record<string, Uint8Array> = {};
    await this.collectDir(`${this.skillsDir}/${skillName}`, '', files);
    if (!('SKILL.md' in files)) {
      throw new Error(`Skill「${skillName}」目录缺少 SKILL.md，无法导出`);
    }
    await this.bridge.fs.writeBinaryFile(outputPath, zipSync(files));
    return Object.keys(files).length;
  }

  /** 预览包内容（不落盘）：解析 frontmatter + 同名冲突检测 */
  async previewPack(packPath: string): Promise<SkillPreview> {
    const { files, dirName } = await this.readPack(packPath);
    const fm = this.parseFrontmatter(strFromU8(files['SKILL.md']));
    if (!fm) throw new Error('SKILL.md frontmatter 缺失或格式错误');
    const name = fm.name || dirName || this.packBaseName(packPath);
    return {
      name,
      description: fm.description,
      appliesTo: fm.appliesTo,
      priority: fm.priority,
      resourceCount: Math.max(0, Object.keys(files).length - 1),
      alreadyExists: await this.exists(name)
    };
  }

  /** 导入包：按需重命名/覆盖后逐文件写入 Skill 目录 */
  async importPack(
    packPath: string,
    options?: ImportOptions
  ): Promise<{ name: string; overwritten: boolean }> {
    const { files, dirName } = await this.readPack(packPath);
    const fm = this.parseFrontmatter(strFromU8(files['SKILL.md']));
    if (!fm) throw new Error('SKILL.md frontmatter 缺失或格式错误');
    const name = options?.renameTo?.trim() || fm.name || dirName || this.packBaseName(packPath);
    if (!isSafeName(name)) throw new Error(`非法的 Skill 名称：${name}`);

    // 目录安全：拒绝路径逃逸条目（.. / 绝对路径 / 盘符）
    for (const p of Object.keys(files)) {
      if (p.includes('..') || p.startsWith('/') || /^[a-zA-Z]:/.test(p)) {
        throw new Error(`包内包含不安全的路径：${p}`);
      }
    }

    const existed = await this.exists(name);
    if (existed && !options?.overwrite) {
      throw new Error('已存在同名 Skill，请选择覆盖或重命名');
    }

    const targetDir = `${this.skillsDir}/${name}`;
    await this.bridge.fs.ensureDir(targetDir);
    for (const [rel, data] of Object.entries(files)) {
      if (rel.includes('/')) {
        await this.bridge.fs.ensureDir(`${targetDir}/${rel.slice(0, rel.lastIndexOf('/'))}`);
      }
      await this.bridge.fs.writeBinaryFile(`${targetDir}/${rel}`, data);
    }
    return { name, overwritten: existed };
  }

  /** 递归收集目录下全部文件（相对路径 -> 二进制；读失败的文件跳过并告警） */
  private async collectDir(
    absDir: string,
    relDir: string,
    out: Record<string, Uint8Array>
  ): Promise<void> {
    let entries;
    try {
      entries = await this.bridge.fs.listDir(absDir);
    } catch (e) {
      console.warn(`Skill 导出：目录读取失败，跳过 ${absDir}`, e);
      return;
    }
    for (const entry of entries) {
      const rel = relDir ? `${relDir}/${entry.name}` : entry.name;
      if (entry.isDir) {
        await this.collectDir(`${absDir}/${entry.name}`, rel, out);
      } else {
        try {
          out[rel] = await this.bridge.fs.readBinaryFile(`${absDir}/${entry.name}`);
        } catch (e) {
          console.warn(`Skill 导出：文件读取失败，跳过 ${rel}`, e);
        }
      }
    }
  }

  /** 读包解压：返回文件表与包内目录名（带单层前缀时剥离） */
  private async readPack(
    packPath: string
  ): Promise<{ files: Record<string, Uint8Array>; dirName: string }> {
    const unzipped = unzipSync(await this.bridge.fs.readBinaryFile(packPath));
    const files: Record<string, Uint8Array> = {};
    for (const [path, data] of Object.entries(unzipped)) {
      const p = path.replace(/\\/g, '/');
      if (!p || p.endsWith('/')) continue; // 跳过目录占位条目
      files[p] = data;
    }
    if (files['SKILL.md']) return { files, dirName: '' };

    // 兼容压缩时带一层目录的包：全部条目共享唯一前缀且其下有 SKILL.md
    const dirs = new Set(
      Object.keys(files)
        .filter((p) => p.includes('/'))
        .map((p) => p.slice(0, p.indexOf('/')))
    );
    if (dirs.size === 1) {
      const dirName = [...dirs][0];
      const prefix = `${dirName}/`;
      if (files[`${prefix}SKILL.md`]) {
        const stripped: Record<string, Uint8Array> = {};
        for (const [p, d] of Object.entries(files)) {
          stripped[p.slice(prefix.length)] = d;
        }
        return { files: stripped, dirName };
      }
    }
    throw new Error('包内未找到 SKILL.md，不是有效的 Skill 包');
  }

  /** 解析 SKILL.md frontmatter（与 SkillLoader 同规则：--- 包围、单行 key: value、数组 [a, b]，支持多行块标量） */
  private parseFrontmatter(raw: string): {
    name: string;
    description: string;
    appliesTo: string[];
    priority: number;
  } | null {
    const text = raw.replace(/\r\n/g, '\n');
    if (!text.trimStart().startsWith('---')) return null;
    const end = text.indexOf('\n---', 3);
    if (end < 0) return null;

    const fmText = text.slice(3, end).trim();
    const fm = parseKeyValues(fmText.split('\n'));

    const parseList = (s: string | undefined): string[] => {
      if (!s) return [];
      const inner = s.replace(/^\[|\]$/g, '');
      return inner
        .split(',')
        .map((x) => x.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
    };

    return {
      name: fm.name ?? '',
      description: fm.description ?? '',
      appliesTo: parseList(fm.applies_to),
      priority: Number(fm.priority ?? 0) || 0
    };
  }

  /** skillsDir 下是否已存在同名 Skill 目录 */
  private async exists(name: string): Promise<boolean> {
    try {
      const entries = await this.bridge.fs.listDir(this.skillsDir);
      return entries.some((e) => e.isDir && e.name === name);
    } catch {
      return false;
    }
  }

  /** 包文件名去掉扩展名（frontmatter 与包内目录都无名称时的兜底） */
  private packBaseName(packPath: string): string {
    const p = packPath.replace(/\\/g, '/');
    return p.slice(p.lastIndexOf('/') + 1).replace(/\.(zip|skillpack)$/i, '');
  }
}
