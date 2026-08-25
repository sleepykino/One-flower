/**
 * skillFrontmatter 单测：单行 key: value / YAML 块标量（| 字面块、> 折叠块、变体）/ 边界
 */

import { describe, expect, it } from 'vitest';
import { parseKeyValues } from '../../src/utils/skillFrontmatter';

describe('parseKeyValues 单行字段', () => {
  it('常规 key: value', () => {
    const fm = parseKeyValues(['name: wuxia', 'description: 武侠文风', 'priority: 10']);
    expect(fm).toEqual({ name: 'wuxia', description: '武侠文风', priority: '10' });
  });
  it('数组按原样字符串保留', () => {
    const fm = parseKeyValues(['applies_to: [continue, rewrite]']);
    expect(fm.applies_to).toBe('[continue, rewrite]');
  });
  it('注释与未知行跳过', () => {
    const fm = parseKeyValues(['# 注释', 'name: a', '', 'extra: 1']);
    expect(fm).toEqual({ name: 'a', extra: '1' });
  });
});

describe('parseKeyValues 块标量', () => {
  it('| 字面块保留换行并剥公共缩进', () => {
    const lines = [
      'name: multi',
      'description: |',
      '  当用户需要续写武侠小说时使用。',
      '  侧重古白话对白与招式描写。',
      'trigger: manual'
    ];
    const fm = parseKeyValues(lines);
    expect(fm.description).toBe('当用户需要续写武侠小说时使用。\n侧重古白话对白与招式描写。');
    expect(fm.trigger).toBe('manual');
  });
  it('| 块内空行保留位置', () => {
    const lines = ['description: |', '  第一段。', '  ', '  第二段。', 'other: x'];
    const fm = parseKeyValues(lines);
    expect(fm.description).toBe('第一段。\n\n第二段。');
  });
  it('> 折叠块合并为空格', () => {
    const lines = ['description: >', '  用于检查时', '  注入一致性基线', 'name: fold'];
    const fm = parseKeyValues(lines);
    expect(fm.description).toBe('用于检查时 注入一致性基线');
    expect(fm.name).toBe('fold');
  });
  it('|- 字面块尾剪（trim 收敛）', () => {
    const lines = ['description: |-', '  改写时提供', '  三种视角。', 'x: 1'];
    expect(parseKeyValues(lines).description).toBe('改写时提供\n三种视角。');
  });
  it('|+ 字面块同理', () => {
    const lines = ['description: |+', '  续写时保持', '  前文节奏。', 'x: 1'];
    expect(parseKeyValues(lines).description).toBe('续写时保持\n前文节奏。');
  });
  it('空块（无缩进内容）返回空串且不吞下行', () => {
    const lines = ['description: |', 'name: next'];
    const fm = parseKeyValues(lines);
    expect(fm.description).toBe('');
    expect(fm.name).toBe('next');
  });
  it('块后紧跟下一 key 正常解析', () => {
    const lines = [
      'description: >',
      '  一句话说明',
      'priority: 5',
      'applies_to: [continue]'
    ];
    const fm = parseKeyValues(lines);
    expect(fm).toEqual({
      description: '一句话说明',
      priority: '5',
      applies_to: '[continue]'
    });
  });
});