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

/** P7.6：目标字数 → 单次回复 maxTokens 兜底（与长文模式公式一致；cap/floor 可配置，非法回退 8192/512） */
export function computeMaxTokens(
  targetWords?: number,
  limits?: { cap?: number; floor?: number }
): number {
  const cap = limits?.cap && limits.cap > 0 ? Math.floor(limits.cap) : 8192;
  const floor = limits?.floor && limits.floor > 0 ? Math.floor(limits.floor) : 512;
  if (!targetWords || !Number.isFinite(targetWords) || targetWords <= 0) return 2048;
  return Math.min(cap, Math.max(floor, Math.round(targetWords * 2.2)));
}

/**
 * P7.6：按 targetWords 收束文本：段界 → 句界 → 硬截 三级回退；未超目标原样返回。
 * 容忍带 20%（2026-09-01 决策）：目标 120% 内的段界优先；句界集合（。！？…）以方案 §4.3 为准。
 */
export function trimToTargetWords(
  text: string,
  target: number
): { text: string; trimmed: boolean } {
  if (!text || target <= 0 || countTokens(text) <= target) return { text, trimmed: false };
  const tol = Math.round(target * 1.2); // 容忍带：目标 120% 内的段界优先
  const para = text.lastIndexOf('\n\n');
  if (para > 0 && countTokens(text.slice(0, para)) <= tol) {
    return { text: text.slice(0, para), trimmed: true };
  }
  const sent = Math.max(
    text.lastIndexOf('。'),
    text.lastIndexOf('！'),
    text.lastIndexOf('？'),
    text.lastIndexOf('…')
  );
  if (sent > 0) return { text: text.slice(0, sent + 1), trimmed: true };
  // 硬截：二分求不超目标的最长前缀（复用 countTokens 单调性）
  let lo = 0;
  let hi = text.length;
  while (lo < hi) {
    const mid = Math.floor((lo + hi + 1) / 2);
    if (countTokens(text.slice(0, mid)) <= target) lo = mid;
    else hi = mid - 1;
  }
  return { text: text.slice(0, lo), trimmed: true };
}
