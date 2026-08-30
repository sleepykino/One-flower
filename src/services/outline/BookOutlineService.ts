/**
 * BookOutlineService：全书大纲（storage_dir/outline.md）
 * - 作者在编辑器「大纲」弹窗编写，随书落盘（与 agents.md 同机制）
 * - 注入四模式生成（applyCtxExtras）与长文节拍规划的前瞻上下文：AI 知道"本章在全书计划中的定位"
 * - 注入受随书开关控制（books.outline_inject_enabled，默认开启）：关闭后大纲仅保留在本书，不再注入
 * - 随书备份：v3 格式兼容扩展（入包 directives/outline.md，旧备份缺省视为无大纲）
 */

import type { NativeBridge } from '../../native/NativeBridge';

/** 示例模板：全部注释化（与 agents.md 示例同惯例），原样保存不会注入任何内容，改写并去掉注释后生效 */
export const OUTLINE_TEMPLATE = `<!-- # 全书大纲 -->
<!-- 本文档注入续写 / 改写 / 对白 / 检查 / 长文节拍规划的 AI 上下文：让 AI 知道本章在全书计划中的定位，约束剧情走向 -->
<!-- 以下结构仅为写法参照：改写成你这本书的大纲，去掉行首注释后保存才会生效 -->

<!-- ## 一句话故事 -->
<!-- （例）落魄剑客为查灭门真相，卷入王朝夺嫡，最终放弃复仇选择守护 -->

<!-- ## 主线三幕 -->
<!-- - 第一幕（第 1-30 章）： -->
<!-- - 第二幕（第 31-80 章）： -->
<!-- - 第三幕（第 81-120 章）： -->

<!-- ## 各卷要点（卷名与章节树对应，按需增删） -->
<!-- - 第一卷： -->
<!-- - 第二卷： -->

<!-- ## 关键伏笔 -->
<!-- （例）第 5 章埋下母亲遗物玉佩，第 40 章揭示身世 -->

<!-- ## 结局方向 -->
`;

export class BookOutlineService {
  private bridge: NativeBridge;

  constructor(bridge: NativeBridge) {
    this.bridge = bridge;
  }

  /** 本书 storage_dir（books 表），不存在返回 null */
  private async storageDirOf(bookId: string): Promise<string | null> {
    const row = await this.bridge.db.queryOne<{ storage_dir: string }>(
      'SELECT storage_dir FROM books WHERE id = ?',
      [bookId]
    );
    return row ? String(row.storage_dir) : null;
  }

  /** 读取本书大纲原文（未创建返回空串，由 UI 决定空态与模板展示） */
  async getOutline(bookId: string): Promise<string> {
    const dir = await this.storageDirOf(bookId);
    if (!dir) return '';
    try {
      return await this.bridge.fs.readFile(`${dir}/outline.md`);
    } catch {
      return '';
    }
  }

  /** 保存本书大纲（原样落盘；空文本照常写入，注入侧判定有效正文） */
  async saveOutline(bookId: string, content: string): Promise<void> {
    const dir = await this.storageDirOf(bookId);
    if (!dir) throw new Error('书籍不存在，无法保存大纲');
    await this.bridge.fs.writeFile(`${dir}/outline.md`, content);
  }

  /** 注入用：本书大纲有效正文（去注释行与标题符号；实质为空返回 undefined） */
  async outlineText(bookId: string): Promise<string | undefined> {
    const raw = await this.getOutline(bookId);
    return effectiveOutline(raw);
  }

  /** 注入开关：本书全书大纲是否注入 AI 生成（默认开启；关闭后四模式与长文均不注入） */
  async isInjectionEnabled(bookId: string): Promise<boolean> {
    const row = await this.bridge.db.queryOne<{ outline_inject_enabled: number }>(
      'SELECT outline_inject_enabled FROM books WHERE id = ?',
      [bookId]
    );
    return row ? Number(row.outline_inject_enabled) !== 0 : true;
  }

  /** 设置注入开关（随书持久化） */
  async setInjectionEnabled(bookId: string, enabled: boolean): Promise<void> {
    await this.bridge.db.exec('UPDATE books SET outline_inject_enabled = ? WHERE id = ?', [
      enabled ? 1 : 0,
      bookId
    ]);
  }
}

/** 去注释行（<!-- --> 整行）与标题符号后判断大纲是否有实质内容 */
export function effectiveOutline(raw: string): string | undefined {
  const body = raw
    .split('\n')
    .filter((l) => !/^\s*<!--.*-->\s*$/.test(l))
    .join('\n')
    .replace(/^#+\s*/gm, '')
    .trim();
  return body !== '' ? body : undefined;
}
