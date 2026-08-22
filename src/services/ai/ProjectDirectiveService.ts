/**
 * ProjectDirectiveService：项目级指令文件（agents.md / hook.md）
 * 存储在本书 storage_dir 下，与章节文件同一落盘机制：
 * - agents.md：项目级全局指令书，注入所有 AI 模式 system 段最高优先级处
 * - hook.md：AI 输出后处理规则（replace 替换 / warn 提醒 / block 阻断重试）
 */

import type { NativeBridge } from '../../native/NativeBridge';

/** hook.md 规则条目 */
export interface HookRule {
  action: 'replace' | 'warn' | 'block';
  source: string; // 原始匹配模式文本（展示用）
  regex: RegExp; // 编译后的正则（literal 模式为转义后的全量匹配）
  value: string; // replace 替换文本 / warn、block 的提示原因
}

/** 单条规则的命中结果 */
export interface HookHit {
  rule: HookRule;
  count: number; // 命中次数（replace 为替换次数）
}

/** hook 应用结果 */
export interface HookApplyResult {
  text: string; // 处理后的文本（replace 已生效）
  hits: HookHit[]; // 全部命中（含 replace/warn/block）
  replaced: boolean; // 文本是否被替换修改
  blocked: HookHit[]; // block 命中（需要重试）
}

/** 示例条目一律注释化：原样保存不会注入任何示例指令，改写并去掉注释后才生效 */
export const AGENTS_TEMPLATE = `# 本书全局指令（agents.md）
<!-- 注入所有 AI 生成模式的系统提示词最高优先级处，优先级高于 Skill 与全局提示词 -->
<!-- 以下示例仅供参照写法：改写成你这本书的规则，去掉行首注释后保存才会生效 -->

## 世界观铁律
<!-- - （例）本世界为古代武侠，不存在热兵器与电力 -->

## 称谓规范
<!-- - （例）主角陆沉，旁人称「陆公子」，不直呼其名 -->

## 写作禁令
<!-- - （例）避免滥用「仿佛」「恍若」类比喻词 -->
`;

/** 示例规则全部注释化（# 前缀）：parseHookRules 跳过注释行，原样保存不会有任何规则生效 */
export const HOOK_TEMPLATE = `# AI 输出规则（hook.md）
<!-- 每行一条规则，# 开头为注释。生成完成后按顺序执行 -->
<!-- 语法：replace /正则/flags => 替换文本 -->
<!--       warn   /正则/flags => 提醒内容 -->
<!--       block  /正则/flags => 原因（命中则丢弃本次输出并自动重试一次） -->
<!-- 匹配部分也可直接写关键词（按字面匹配） -->
<!-- 以下示例规则已注释、不会生效：改写并去掉行首 # 后保存才会执行 -->

# replace /老头子/g => 老者
# warn /突然|忽然/g => 过渡词密集，注意节奏
# block /手枪|步枪|炸弹/g => 世界观为古代武侠，不允许热兵器
`;

/** UI 状态查询结果：agents/hook 是否已创建、是否实际生效 */
export interface DirectiveStatus {
  agentsCreated: boolean;
  agentsActive: boolean; // 有实质正文，会注入所有 AI 生成
  hookCreated: boolean;
  hookRuleCount: number; // 生效规则数（注释行不计入）
}

export class ProjectDirectiveService {
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

  private async readFileSafe(path: string): Promise<string> {
    try {
      return await this.bridge.fs.readFile(path);
    } catch {
      return '';
    }
  }

  /** 读取本书 agents.md 原文（未创建返回空串，由 UI 决定空态与示例展示） */
  async getAgentsMd(bookId: string): Promise<string> {
    const dir = await this.storageDirOf(bookId);
    if (!dir) return '';
    return this.readFileSafe(`${dir}/agents.md`);
  }

  async saveAgentsMd(bookId: string, content: string): Promise<void> {
    const dir = await this.storageDirOf(bookId);
    if (!dir) throw new Error('书籍不存在，无法保存 agents.md');
    await this.bridge.fs.writeFile(`${dir}/agents.md`, content);
  }

  /** 读取本书 hook.md 原文（未创建返回空串） */
  async getHookMd(bookId: string): Promise<string> {
    const dir = await this.storageDirOf(bookId);
    if (!dir) return '';
    return this.readFileSafe(`${dir}/hook.md`);
  }

  async saveHookMd(bookId: string, content: string): Promise<void> {
    const dir = await this.storageDirOf(bookId);
    if (!dir) throw new Error('书籍不存在，无法保存 hook.md');
    await this.bridge.fs.writeFile(`${dir}/hook.md`, content);
  }

  /** UI 状态查询：两文件是否已创建、agents 是否有实质正文、hook 生效规则数 */
  async getStatus(bookId: string): Promise<DirectiveStatus> {
    const dir = await this.storageDirOf(bookId);
    if (!dir) return { agentsCreated: false, agentsActive: false, hookCreated: false, hookRuleCount: 0 };
    const [agentsRaw, hookRaw] = await Promise.all([
      this.readFileSafe(`${dir}/agents.md`),
      this.readFileSafe(`${dir}/hook.md`)
    ]);
    return {
      agentsCreated: agentsRaw !== '',
      agentsActive: this.effectiveAgents(agentsRaw) !== undefined,
      hookCreated: hookRaw !== '',
      hookRuleCount: parseHookRules(hookRaw).length
    };
  }

  /** 注入用：本书 agents.md 有效正文（文件不存在或实质为空返回 undefined） */
  async agentsText(bookId: string): Promise<string | undefined> {
    const raw = await this.readAgentsRaw(bookId);
    return this.effectiveAgents(raw);
  }

  /** 读取 agents.md 原始内容（未创建返回空串） */
  private async readAgentsRaw(bookId: string): Promise<string> {
    const dir = await this.storageDirOf(bookId);
    if (!dir) return '';
    return this.readFileSafe(`${dir}/agents.md`);
  }

  /** 解析本书 hook.md 为规则列表（文件不存在或无有效规则返回 []；不回退模板） */
  async hookRules(bookId: string): Promise<HookRule[]> {
    const dir = await this.storageDirOf(bookId);
    if (!dir) return [];
    const raw = await this.readFileSafe(`${dir}/hook.md`);
    return parseHookRules(raw);
  }

  /** 去注释/标题符号后判断 agents.md 是否有实质内容 */
  private effectiveAgents(raw: string): string | undefined {
    const body = raw
      .split('\n')
      .filter((l) => !/^\s*<!--.*-->\s*$/.test(l))
      .join('\n')
      .replace(/^#\+\s*/gm, '')
      .trim();
    return body !== '' ? body : undefined;
  }
}

/** 解析 hook.md 规则：每行 "action pattern => value"，# 与 <!-- 开头为注释 */
export function parseHookRules(md: string): HookRule[] {
  const rules: HookRule[] = [];
  for (const rawLine of md.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line === '' || line.startsWith('#') || line.startsWith('<!--')) continue;
    const m = line.match(/^(replace|warn|block)\s+(.+?)\s*=>\s*(.*)$/);
    if (!m) continue;
    const [, action, pattern, value] = m;
    const regex = compilePattern(pattern);
    if (!regex) continue;
    rules.push({ action: action as HookRule['action'], source: pattern, regex, value: value.trim() });
  }
  return rules;
}

/** /pat/flags 解析为 RegExp；否则按字面匹配（转义后全局） */
function compilePattern(pattern: string): RegExp | null {
  const m = pattern.match(/^\/(.+)\/([gimsuy]*)$/);
  try {
    if (m) {
      const flags = m[2].includes('g') ? m[2] : m[2] + 'g';
      return new RegExp(m[1], flags);
    }
    return new RegExp(escapeRegExp(pattern), 'g');
  } catch {
    return null; // 非法正则：跳过该条
  }
}

/** 编辑器用：匹配模式是否合法（非法正则返回 false） */
export function isValidHookPattern(pattern: string): boolean {
  return pattern.trim() !== '' && compilePattern(pattern) !== null;
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** 按顺序应用规则：replace 直接改写文本；warn/block 只收集命中 */
export function applyHookRules(rules: HookRule[], text: string): HookApplyResult {
  let out = text;
  const hits: HookHit[] = [];
  for (const rule of rules) {
    if (rule.action === 'replace') {
      const before = out;
      // value 原生支持 $1/$2 反向引用（String.replace 语义）
      out = out.replace(rule.regex, rule.value);
      const count = countMatches(rule.regex, before);
      if (count > 0) hits.push({ rule, count });
    } else {
      const count = countMatches(rule.regex, out);
      if (count > 0) hits.push({ rule, count });
    }
  }
  return {
    text: out,
    hits,
    replaced: out !== text,
    blocked: hits.filter((h) => h.rule.action === 'block')
  };
}

function countMatches(re: RegExp, text: string): number {
  const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
  let count = 0;
  while (g.exec(text) !== null) count += 1;
  return count;
}
