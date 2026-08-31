import { describe, expect, it } from 'vitest';
import {
  BODY_MAX_CHARS,
  SINGLE_CALL_MAX_TOKENS,
  buildSkillMarkdown,
  chunkByParagraph,
  parseForgeResult,
  sampleByProportion,
  sampleChapters
} from '../../src/services/skill/SkillForgeService';
import { countTokens } from '../../src/utils/tokens';
import { parseKeyValues } from '../../src/utils/skillFrontmatter';
import type { AIMode } from '../../src/services/skill/types';

// P7.4 一把炼化：SkillForgeService 纯函数（采样 / 抽章 / 分片 / 契约解析 / 落盘格式）
// 全部为纯逻辑单测，不依赖模型 / 数据库 / 文件系统。

describe('sampleByProportion 三段配比采样', () => {
  it('素材 token 不超预算时原样返回（no-op）', () => {
    const text = '一段不长的小说文本，用于测试采样逻辑是否正确。'.repeat(20);
    expect(sampleByProportion(text, 100_000)).toBe(text);
  });

  it('长文本按头/中/尾三段采样：段落边界对齐、不超预算、首尾均覆盖', () => {
    const paragraphs = Array.from(
      { length: 200 },
      (_, i) => `第${i}段：这是一段用于风格采样的中文小说文本内容。`
    );
    const text = paragraphs.join('\n\n');
    const out = sampleByProportion(text, 1000);
    expect(countTokens(out)).toBeLessThanOrEqual(1000);
    // 采样结果全部由原文段落 + 「……（略）」分隔构成（段落边界对齐）
    for (const part of out.split('\n\n')) {
      if (part === '……（略）') continue;
      expect(paragraphs).toContain(part);
    }
    // 头段与尾段必然覆盖；分隔符出现
    expect(out).toContain(paragraphs[0]);
    expect(out).toContain(paragraphs[199]);
    expect(out).toContain('……（略）');
  });

  it('空文本返回空串', () => {
    expect(sampleByProportion('', 100)).toBe('');
  });
});

describe('sampleChapters 库内书籍等距抽章', () => {
  it('全书 token 不超预算时全保留', () => {
    const chapters = Array.from({ length: 3 }, (_, i) => `第${i + 1}章` + '正文内容'.repeat(10));
    expect(sampleChapters(chapters, 100_000)).toEqual(chapters);
  });

  it('长书等距抽章必含首章与末章，且不超预算', () => {
    const chapters = Array.from({ length: 100 }, (_, i) => `第${i + 1}章` + `正文${i}`.repeat(20));
    const out = sampleChapters(chapters, 500);
    expect(out.length).toBeGreaterThan(1);
    // 首章整章保留
    expect(out[0]).toBe(chapters[0]);
    // 末章以整章或段落边界截断形式出现（风格演变收尾必覆盖）
    const last = out[out.length - 1];
    expect(chapters[99].startsWith(last.replace('…（已截断）', ''))).toBe(true);
    expect(countTokens(out.join('\n\n'))).toBeLessThanOrEqual(500);
  });

  it('超长单章超剩余配额时在段落边界截断', () => {
    const big = Array.from({ length: 50 }, (_, i) => `段${i}`.repeat(30)).join('\n\n');
    const chapters = ['短章一', big];
    const out = sampleChapters(chapters, 1000);
    expect(countTokens(out.join('\n\n'))).toBeLessThanOrEqual(1000);
    // 末章（big）被截断：不再包含其末段全文
    expect(out.join('\n\n')).not.toContain(big.split('\n\n')[49]);
  });
});

describe('chunkByParagraph 分片', () => {
  it('按段落边界分片：无空片、单片不超单次上限', () => {
    const paragraphs = Array.from({ length: 300 }, (_, i) => `第${i}段` + '内容'.repeat(30));
    const text = paragraphs.join('\n\n');
    const chunks = chunkByParagraph(text);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.trim()).not.toBe('');
      expect(countTokens(c)).toBeLessThanOrEqual(SINGLE_CALL_MAX_TOKENS);
    }
    // 首片以原文首段开头（段落边界对齐）
    expect(chunks[0].split('\n\n')[0]).toBe(paragraphs[0]);
  });

  it('单片超单次上限时硬切，不产生超限片', () => {
    const giant = '超长单段内容'.repeat(20_000);
    const chunks = chunkByParagraph(giant);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(countTokens(c)).toBeLessThanOrEqual(SINGLE_CALL_MAX_TOKENS);
    }
  });

  it('空文本不产生分片', () => {
    expect(chunkByParagraph('')).toEqual([]);
  });
});

describe('parseForgeResult 契约解析', () => {
  it('合法 JSON 解析为 SkillForgeDraft（parseMode=json）', () => {
    const raw = JSON.stringify({
      name: 'keigo-style',
      description: '冷峻白描',
      applies_to: ['continue', 'rewrite'],
      priority: 7,
      body: '# 文风指令\n\n## 用词偏好\n- 短句'
    });
    const d = parseForgeResult(raw);
    expect(d).not.toBeNull();
    expect(d!.name).toBe('keigo-style');
    expect(d!.description).toBe('冷峻白描');
    expect(d!.appliesTo).toEqual(['continue', 'rewrite']);
    expect(d!.priority).toBe(7);
    expect(d!.parseMode).toBe('json');
    expect(d!.bodyOverlong).toBe(false);
  });

  it('围栏包裹 / 行内注释 / 尾逗号容错解析', () => {
    const raw = [
      '```json',
      '{',
      '  // 这是注释',
      '  "name": "my-style",',
      '  "description": "描述",',
      '  "applies_to": ["continue"],',
      '  "priority": 5,',
      '  "body": "# 文风指令",',
      '}',
      '```'
    ].join('\n');
    const d = parseForgeResult(raw);
    expect(d).not.toBeNull();
    expect(d!.name).toBe('my-style');
    expect(d!.parseMode).toBe('json');
  });

  it('name 非法字符 slug 化；缺失时用默认名与默认 applies_to', () => {
    const d = parseForgeResult(
      JSON.stringify({ name: '我的 Style!!', description: 'd', applies_to: ['continue'], priority: 5, body: 'x' })
    );
    // 非 ascii 字符（中文）被替换为分隔符并去首尾 -> 仅保留 style
    expect(d!.name).toBe('style');

    const d2 = parseForgeResult(
      JSON.stringify({ description: 'd', applies_to: [], priority: 5, body: 'x' })
    );
    expect(d2!.name).toBe('forged-style');
    expect(d2!.appliesTo).toEqual(['continue', 'rewrite', 'dialogue']);
  });

  it('priority 越界 clamp 1-99，非法取默认 5', () => {
    const high = parseForgeResult(
      JSON.stringify({ name: 'a', description: 'd', applies_to: ['continue'], priority: 150, body: 'x' })
    );
    expect(high!.priority).toBe(99);
    const low = parseForgeResult(
      JSON.stringify({ name: 'a', description: 'd', applies_to: ['continue'], priority: 0, body: 'x' })
    );
    expect(low!.priority).toBe(1);
    const bad = parseForgeResult(
      JSON.stringify({ name: 'a', description: 'd', applies_to: ['continue'], body: 'x' })
    );
    expect(bad!.priority).toBe(5);
  });

  it('body 超 1500 字标记 bodyOverlong', () => {
    const longBody = '字'.repeat(BODY_MAX_CHARS + 100);
    const d = parseForgeResult(
      JSON.stringify({ name: 'a', description: 'd', applies_to: ['continue'], priority: 5, body: longBody })
    );
    expect(d!.bodyOverlong).toBe(true);
    expect(d!.body).toBe(longBody);
  });

  it('一级 JSON 失败时二级正则抽取（parseMode=regex）', () => {
    const raw = [
      '好的，这是提炼结果：',
      '"name": "re-style"',
      '"description": "正则提取"',
      '"applies_to": ["dialogue"]',
      '"priority": 9',
      '"body": "\\u4e00\\u4e8c"'
    ].join('\n');
    const d = parseForgeResult(raw);
    expect(d).not.toBeNull();
    expect(d!.parseMode).toBe('regex');
    expect(d!.name).toBe('re-style');
    expect(d!.priority).toBe(9);
    expect(d!.appliesTo).toEqual(['dialogue']);
    // body 做了 JSON 反转义（\u4e00\u4e8c -> 一二）
    expect(d!.body).toBe('一二');
  });

  it('完全无法解析（无必填字段）返回 null', () => {
    expect(parseForgeResult('这是普通的失败文本')).toBeNull();
    expect(parseForgeResult('')).toBeNull();
    expect(
      parseForgeResult(JSON.stringify({ description: '只有描述', priority: 5 }))
    ).toBeNull(); // 缺 name 与 body -> normalize 返回 null
  });
});

describe('buildSkillMarkdown 与 SkillLoader 解析回环', () => {
  it('落盘字符串可被 frontmatter 规则还原各字段', () => {
    const draft: { name: string; description: string; appliesTo: AIMode[]; priority: number; body: string } = {
      name: 'my-style',
      description: '一句话描述',
      appliesTo: ['continue', 'rewrite'],
      priority: 7,
      body: '# 文风指令\n\n## 用词偏好\n- 短句'
    };
    const md = buildSkillMarkdown(draft);

    // 模拟 SkillLoader.parse：剥 frontmatter -> parseKeyValues -> 还原字段
    const text = md.replace(/\r\n/g, '\n');
    expect(text.trimStart().startsWith('---')).toBe(true);
    const end = text.indexOf('\n---', 3);
    expect(end).toBeGreaterThan(0);
    const fmText = text.slice(3, end).trim();
    const body = text.slice(text.indexOf('\n', end + 4)).trim();
    const fm = parseKeyValues(fmText.split('\n'));

    expect(fm.name).toBe('my-style');
    expect(fm.description).toBe('一句话描述');
    expect(fm.trigger).toBe('manual');
    const appliesTo = (fm.applies_to ?? '')
      .replace(/^\[|\]$/g, '')
      .split(',')
      .map((x) => x.trim().replace(/^['"]|['"]$/g, ''))
      .filter(Boolean);
    expect(appliesTo).toEqual(['continue', 'rewrite']);
    expect(Number(fm.priority)).toBe(7);
    expect(body).toBe(draft.body);
  });

  it('description 含换行时会被 frontmatter 单行 key 规则截断（调用方需自行防换行）', () => {
    const md = buildSkillMarkdown({
      name: 'a',
      description: '第一行\n第二行',
      appliesTo: ['continue'],
      priority: 5,
      body: 'x'
    });
    const text = md.replace(/\r\n/g, '\n');
    const end = text.indexOf('\n---', 3);
    const fmText = text.slice(3, end).trim();
    const fm = parseKeyValues(fmText.split('\n'));
    // 换行落在 description 之后一行，parseKeyValues 视为后续 key 行 -> description 保持首行
    expect(fm.description).toBe('第一行');
  });
});
