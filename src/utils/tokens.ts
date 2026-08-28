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

/** 截断标记文本（预留其 token 数，避免拼上后超预算） */
const TRUNC_MARK = '…（已截断）';

/**
 * 按预算截断文本：以 countTokens（中文 1 字≈1 token、英文按词折算）为估算器，
 * 二分求出「最长前缀」，使截断结果（含截断标记）的估算 token 不超过预算。
 * 修复：原实现按 1 token≈1.4 字符换算，中文 1 字≈1 token，导致中文内容实际超预算 ~40%，
 * 小上下文模型可能 context exceeded。现改为与 countTokens 自洽的迭代拟合。
 */
export function truncateToTokenBudget(text: string, budget: number): { text: string; truncated: boolean } {
  if (!text) return { text: '', truncated: false };
  const markTokens = countTokens(TRUNC_MARK);
  const fitBudget = Math.max(0, budget - markTokens);
  if (countTokens(text) <= fitBudget) return { text, truncated: false };
  if (fitBudget <= 0) return { text: TRUNC_MARK, truncated: true };
  // 二分查找最长前缀，使 countTokens(前缀) <= fitBudget（token 数为前缀长的单调不减函数）
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (countTokens(text.slice(0, mid)) <= fitBudget) lo = mid;
    else hi = mid - 1;
  }
  return { text: text.slice(0, lo) + TRUNC_MARK, truncated: true };
}
