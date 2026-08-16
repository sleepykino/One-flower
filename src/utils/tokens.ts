/**
 * token 近似估算（中文按字计，英文按词计，混合估算）
 * 仅用于 Prompt 预算控制，不需要精确分词器
 */

export function countTokens(text: string): number {
  if (!text) return 0;
  // CJK 字符数
  const cjk = (text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g) ?? []).length;
  // 非 CJK 部分按空白切词，英文约 1 词 ≈ 1.3 token
  const nonCjk = text.replace(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g, ' ');
  const words = nonCjk.split(/\s+/).filter(Boolean).length;
  return Math.ceil(cjk + words * 1.3);
}

/** 按预算截断文本（保守换算：1 token ≈ 1.4 字符） */
export function truncateToTokenBudget(text: string, budget: number): { text: string; truncated: boolean } {
  const maxChars = Math.floor(budget * 1.4);
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(0, maxChars) + '…（已截断）', truncated: true };
}
