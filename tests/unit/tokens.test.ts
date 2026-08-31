import { describe, expect, it } from 'vitest';
import {
  countTokens,
  truncateToTokenBudget,
  computeMaxTokens,
  trimToTargetWords
} from '../../src/utils/tokens';

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

// P7.6：续写字数控制（规格 M2/M4）——目标字数换算与流式优雅停收束

describe('computeMaxTokens', () => {
  it('无值 / 非法值回退缺省 2048', () => {
    expect(computeMaxTokens()).toBe(2048);
    expect(computeMaxTokens(undefined)).toBe(2048);
    expect(computeMaxTokens(0)).toBe(2048);
    expect(computeMaxTokens(-5)).toBe(2048);
    expect(computeMaxTokens(NaN)).toBe(2048);
    expect(computeMaxTokens(Infinity)).toBe(2048);
  });

  it('小目标被 floor（512）托底', () => {
    expect(computeMaxTokens(100)).toBe(512);
    expect(computeMaxTokens(200)).toBe(512);
  });

  it('常规目标按 2.2 系数换算', () => {
    expect(computeMaxTokens(1000)).toBe(2200);
    expect(computeMaxTokens(3000)).toBe(6600);
  });

  it('大目标被 cap（8192）夹住', () => {
    expect(computeMaxTokens(5000)).toBe(8192); // 5000 * 2.2 = 11000 > 8192
  });

  it('自定义 limits 生效', () => {
    expect(computeMaxTokens(1000, { cap: 4096, floor: 1024 })).toBe(2200);
    expect(computeMaxTokens(200, { cap: 4096, floor: 1024 })).toBe(1024); // floor 托底
    expect(computeMaxTokens(5000, { cap: 4096, floor: 1024 })).toBe(4096); // cap 夹住
  });

  it('非法 limits 回退缺省 8192/512', () => {
    expect(computeMaxTokens(100, { cap: 0, floor: -1 })).toBe(512);
    expect(computeMaxTokens(100, { cap: NaN })).toBe(512);
    expect(computeMaxTokens(5000, { floor: NaN })).toBe(8192);
  });
});

describe('trimToTargetWords', () => {
  it('未超目标原样返回', () => {
    const text = '一二三四五';
    expect(trimToTargetWords(text, 100)).toEqual({ text, trimmed: false });
  });

  it('空串安全；target 非正不裁', () => {
    expect(trimToTargetWords('', 100)).toEqual({ text: '', trimmed: false });
    const text = '字'.repeat(200);
    expect(trimToTargetWords(text, 0)).toEqual({ text, trimmed: false });
  });

  it('超目标且段界在容忍带（120%）内时按段界收束', () => {
    // 段 1：600 字；段 2：700 字；总 1300 > 目标 1000，段界 600 ≤ 1200 → 在段界收束
    const text = `${'一'.repeat(600)}\n\n${'二'.repeat(700)}`;
    const r = trimToTargetWords(text, 1000);
    expect(r.trimmed).toBe(true);
    expect(r.text).toBe('一'.repeat(600));
  });

  it('段界超出容忍带时不按段界收束', () => {
    // 句界（'。'）之前的段界内容 1251 字 > 1200（目标 1000 的容忍带）→ 走句界回退
    const text = `${'一'.repeat(1250)}。\n\n${'二'.repeat(50)}`;
    const r = trimToTargetWords(text, 1000);
    expect(r.trimmed).toBe(true);
    expect(r.text).toBe(`${'一'.repeat(1250)}。`);
    expect(r.text).not.toContain('\n\n');
  });

  it('无段界时按句界收束并保留句末标点', () => {
    const text = `${'一'.repeat(1000)}。${'二'.repeat(500)}`;
    const r = trimToTargetWords(text, 1000);
    expect(r.trimmed).toBe(true);
    expect(r.text).toBe(`${'一'.repeat(1000)}。`);
  });

  it('句界取最后一个句末标点', () => {
    const text = `${'一'.repeat(300)}！${'二'.repeat(600)}？${'三'.repeat(200)}`;
    const r = trimToTargetWords(text, 500);
    expect(r.trimmed).toBe(true);
    expect(r.text.endsWith('？')).toBe(true);
  });

  it('无任何段界与句末标点时硬截且不超目标', () => {
    const text = '三'.repeat(2000);
    const r = trimToTargetWords(text, 500);
    expect(r.trimmed).toBe(true);
    expect(countTokens(r.text)).toBeLessThanOrEqual(500);
    expect(r.text).toBe('三'.repeat(500));
  });
});