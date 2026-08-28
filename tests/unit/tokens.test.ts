import { describe, expect, it } from 'vitest';
import { countTokens, truncateToTokenBudget } from '../../src/utils/tokens';

// 优化建议记录 批次3 建议2（2026-08-28）：
// truncateToTokenBudget 原按「1 token≈1.4 字符」换算，中文 1 字≈1 token 导致实际超预算 ~40%。
// 现改为以 countTokens 为估算器做迭代拟合，保证截断结果（含截断标记）的估算 token 不超过预算。

/** 校验截断结果 token 不超过预算；fitBudget 内放不下截断标记时应至少给出标记 */
function expectFit(out: { text: string; truncated: boolean }, budget: number) {
  expect(countTokens(out.text)).toBeLessThanOrEqual(budget);
  return out;
}

describe('truncateToTokenBudget', () => {
  it('未超预算时不截断', () => {
    const text = '你好今天天气不错';
    const r = expectFit(truncateToTokenBudget(text, 100), 100);
    expect(r.truncated).toBe(false);
    expect(r.text).toBe(text);
  });

  it('中文超预算时按 token 拟合而不超（原 1.4 换算在中文下会超 ~40%）', () => {
    // 预算 20 token：中文 1 字≈1 token，截断后还应保留截断标记
    const text = '一'.repeat(60);
    const r = expectFit(truncateToTokenBudget(text, 20), 20);
    expect(r.truncated).toBe(true);
    // 原实现按 20*1.4=28 字截断 → 28 token 超预算；新实现应显著小于 20 字正文
    expect(r.text.startsWith('一'.repeat(14))).toBe(true);
  });

  it('纯英文按词折算也能拟合进预算', () => {
    const text = Array.from({ length: 50 }, (_, i) => `word${i}`).join(' ');
    const budget = 30;
    const r = expectFit(truncateToTokenBudget(text, budget), budget);
    expect(r.truncated).toBe(true);
  });

  it('预算极小时仍返回标记并告警截断', () => {
    const r = truncateToTokenBudget('hello world', 1);
    expect(r.truncated).toBe(true);
    expect(r.text).toContain('已截断');
  });

  it('空串不截断', () => {
    expect(truncateToTokenBudget('', 10)).toEqual({ text: '', truncated: false });
  });
});