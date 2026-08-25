import { describe, expect, it } from 'vitest';
import {
  applyHookRules,
  isValidHookPattern,
  parseHookRules
} from '../../src/services/ai/ProjectDirectiveService';

// T10.5：hook.md 规则解析与应用纯函数单测
// 语法：每行 "action pattern => value"；# 与 <!-- 开头为注释；
// pattern 支持 /regex/flags 与字面关键词两种写法

describe('parseHookRules', () => {
  it('解析三类动作与正则模式', () => {
    const md = [
      'replace /老头子/g => 老者',
      'warn /突然|忽然/g => 过渡词密集',
      'block /手枪|炸弹/gi => 古代世界不允许热兵器'
    ].join('\n');
    const rules = parseHookRules(md);
    expect(rules).toHaveLength(3);
    expect(rules[0].action).toBe('replace');
    expect(rules[0].value).toBe('老者');
    expect(rules[1].action).toBe('warn');
    expect(rules[2].action).toBe('block');
    // 正则可用：老头子 命中
    expect(rules[0].regex.test('一个老头子')).toBe(true);
  });

  it('字面关键词按转义后的字面匹配（正则元字符不生效）', () => {
    const rules = parseHookRules('replace (例) => 示例');
    expect(rules).toHaveLength(1);
    expect(rules[0].regex.test('正文 (例) 片段')).toBe(true);
    expect(rules[0].regex.test('正文 例 片段')).toBe(false);
  });

  it('# 行与 <!-- 行为注释，空行跳过', () => {
    const md = [
      '# replace /a/g => b',
      '<!-- warn /c/g => d -->',
      '',
      'replace /e/g => f'
    ].join('\n');
    const rules = parseHookRules(md);
    expect(rules).toHaveLength(1);
    expect(rules[0].value).toBe('f');
  });

  it('非法正则与非规定动作的行被跳过，不抛错', () => {
    const md = ['replace /[unclosed/ => x', 'delete /a/ => b'].join('\n');
    expect(parseHookRules(md)).toHaveLength(0);
  });

  it('value 首尾空白被修剪；空文件返回空数组', () => {
    expect(parseHookRules('warn /x/ =>   提示信息  ')[0].value).toBe('提示信息');
    expect(parseHookRules('')).toEqual([]);
  });
});

describe('applyHookRules', () => {
  it('replace 改写文本并统计替换次数', () => {
    const rules = parseHookRules('replace /老头子/g => 老者');
    const res = applyHookRules(rules, '老头子和老头子的马');
    expect(res.text).toBe('老者和老者的马');
    expect(res.replaced).toBe(true);
    expect(res.hits).toHaveLength(1);
    expect(res.hits[0].count).toBe(2);
    expect(res.blocked).toHaveLength(0);
  });

  it('replace 的 value 支持 $1 反向引用', () => {
    const rules = parseHookRules('replace /(突然)间/g => $1');
    const res = applyHookRules(rules, '突然间天黑了');
    expect(res.text).toBe('突然天黑了');
  });

  it('warn 只收集命中不改文本；block 归入 blocked 列表', () => {
    const rules = parseHookRules(
      ['warn /忽然/g => 节奏提示', 'block /手枪/g => 热兵器禁用'].join('\n')
    );
    const res = applyHookRules(rules, '他忽然拔出手枪');
    expect(res.text).toBe('他忽然拔出手枪'); // 未改写
    expect(res.replaced).toBe(false);
    expect(res.hits).toHaveLength(2);
    expect(res.blocked).toHaveLength(1);
    expect(res.blocked[0].rule.value).toBe('热兵器禁用');
  });

  it('规则按声明顺序依次执行（后序 replace 作用于已改写文本）', () => {
    const rules = parseHookRules(
      ['replace /甲/g => 乙', 'replace /乙乙/g => 丙'].join('\n')
    );
    const res = applyHookRules(rules, '甲甲');
    expect(res.text).toBe('丙');
  });

  it('无命中时 hits 为空、replaced 为 false', () => {
    const rules = parseHookRules('replace /不存在词/g => x');
    const res = applyHookRules(rules, '普通文本');
    expect(res.hits).toHaveLength(0);
    expect(res.replaced).toBe(false);
    expect(res.blocked).toHaveLength(0);
  });
});

describe('isValidHookPattern', () => {
  it('合法正则与字面串均有效；空白与非法正则无效', () => {
    expect(isValidHookPattern('/abc/gi')).toBe(true);
    expect(isValidHookPattern('普通关键词')).toBe(true);
    expect(isValidHookPattern('')).toBe(false);
    expect(isValidHookPattern('   ')).toBe(false);
    expect(isValidHookPattern('/[unclosed/')).toBe(false);
  });
});
