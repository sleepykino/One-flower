/**
 * SKILL.md frontmatter 简化解析（SkillLoader / SkillPackService 共用）
 * 规则：`---` 包围、单行 `key: value`、数组 `[a, b]` 按原样字符串保留（消费方自行拆分）
 * 增强：支持 YAML 块标量（`|` 字面块保留换行 / `>` 折叠块合并为空格，含 `|-|<+|>->>+` 与缩进指示符），
 *       以兼容 Claude Code 生态 SKILL.md 的多行 description
 */

/** 块标量指示符：| 或 >，后接可选 chomping（-/+/无）与缩进指示符（数字） */
const BLOCK_SCALAR_RE = /^[|>][-+]?[0-9]?$/;

/**
 * 解析 frontmatter 各行（已拆分的行数组）为 key -> value 表。
 * 块标量会吞掉后续所有缩进行（以空格/制表符开头）与块内空行，直到遇到非缩进行。
 */
export function parseKeyValues(fmLines: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  let i = 0;
  while (i < fmLines.length) {
    const line = fmLines[i];
    const m = line.match(/^([a-zA-Z_]+)\s*:\s*(.*)$/);
    if (!m) {
      i++; // frontmatter 内非 key 行（如注释）跳过
      continue;
    }
    const key = m[1];
    const val = m[2].trim();
    if (BLOCK_SCALAR_RE.test(val)) {
      const r = collectBlock(fmLines, i + 1, val.startsWith('>'));
      out[key] = r.text;
      i = r.end;
    } else {
      out[key] = val;
      i++;
    }
  }
  return out;
}

/** 收集块标量内容行：剥公共缩进后按指示符连接（字面块换行 / 折叠块空格） */
function collectBlock(
  lines: string[],
  start: number,
  fold: boolean
): { text: string; end: number } {
  const content: string[] = [];
  let minIndent = Infinity;
  let j = start;
  for (; j < lines.length; j++) {
    const raw = lines[j];
    if (raw.trim() === '') {
      if (content.length > 0) content.push(''); // 块内空行保留位置
      continue;
    }
    if (!/^[ \t]/.test(raw)) break; // 非缩进行 = 块结束
    const indent = raw.match(/^[ \t]*/)?.[0].length ?? 0;
    minIndent = Math.min(minIndent, indent);
    content.push(raw);
  }
  if (content.length === 0) return { text: '', end: start }; // 无内容：不消费
  const indent = minIndent === Infinity ? 0 : minIndent;
  const stripped = content.map((l) => (l === '' ? l : l.slice(indent)));
  const text = fold
    ? stripped.join(' ').replace(/[ \t]+/g, ' ').trim()
    : stripped.join('\n').trim();
  return { text, end: j };
}