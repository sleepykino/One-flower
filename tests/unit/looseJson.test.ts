import { describe, expect, it } from 'vitest';
import { extractJsonText, parseLooseJson } from '../../src/utils/looseJson';

// T10.5：容错 JSON 解析（AI 输出专用）纯函数单测
// 处理链：剥 <think> -> 剥 markdown 围栏 -> 截取首尾 {} / [] -> 注释/尾逗号清理后重试

describe('extractJsonText', () => {
  it('纯 JSON 原样截取', () => {
    expect(extractJsonText('{"a":1}')).toBe('{"a":1}');
    expect(extractJsonText('[1,2]')).toBe('[1,2]');
  });

  it('剥离 <think> 推理段', () => {
    const raw = '<think>让我想想…</think>\n{"a":1}';
    expect(extractJsonText(raw)).toBe('{"a":1}');
  });

  it('剥离 markdown 围栏（含 json 标记）', () => {
    const raw = '```json\n{"a":1}\n```';
    expect(extractJsonText(raw)).toBe('{"a":1}');
  });

  it('前后夹杂说明文字时按首个 { 与末个 } 截取', () => {
    const raw = '好的，结果如下：{"a":{"b":2}} 请查收';
    expect(extractJsonText(raw)).toBe('{"a":{"b":2}}');
  });

  it('对象与数组并存时以更靠前的结构为准', () => {
    expect(extractJsonText('[1] {"a":1}')).toBe('[1]');
    expect(extractJsonText('{"a":1} [1]')).toBe('{"a":1}');
  });

  it('无结构返回 null', () => {
    expect(extractJsonText('没有结构')).toBeNull();
    // 只有开括号无闭括号
    expect(extractJsonText('{oops')).toBeNull();
  });
});

describe('parseLooseJson', () => {
  it('标准 JSON 直接解析', () => {
    expect(parseLooseJson<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it('容忍尾逗号', () => {
    expect(parseLooseJson<{ a: number[] }>('{"a":[1,2,],}')).toEqual({ a: [1, 2] });
  });

  it('容忍 // 行注释与 /* 块注释 */', () => {
    const raw = `{
      // 名称
      "name": "测试", /* 尾注 */
      "n": 1
    }`;
    expect(parseLooseJson<{ name: string; n: number }>(raw)).toEqual({ name: '测试', n: 1 });
  });

  it('字符串内的 URL 不被行注释规则破坏', () => {
    const raw = '{"url":"https://example.com/a","x":1}';
    expect(parseLooseJson<{ url: string; x: number }>(raw)).toEqual({
      url: 'https://example.com/a',
      x: 1
    });
  });

  it('围栏 + think + 尾逗号组合瑕疵一次通过', () => {
    const raw = '<think>推理…</think>```json\n[{"k":"v"},]\n```';
    expect(parseLooseJson<Array<{ k: string }>>(raw)).toEqual([{ k: 'v' }]);
  });

  it('完全非法输入返回 null 而非抛错', () => {
    expect(parseLooseJson('不是 JSON')).toBeNull();
    expect(parseLooseJson('{broken:')).toBeNull();
    expect(parseLooseJson('')).toBeNull();
  });
});
