import { describe, expect, it } from 'vitest';
import { PromptAssembler, targetWordsSectionText } from '../../src/services/ai/PromptAssembler';
import type { PromptContext } from '../../src/services/ai/PromptAssembler';

// P7.6：续写字数控制（规格 M1）——四模式「篇幅要求」注入与 inspect 统计行

/** 最小可用上下文（四模式共用；不涉及预算截断路径） */
function baseCtx(mode: PromptContext['mode'], targetWords?: number): PromptContext {
  return {
    mode,
    systemInstruction: '',
    enabledSkills: [],
    characters: [],
    recentChapters: [],
    targetWords
  };
}

describe('PromptAssembler 篇幅要求注入', () => {
  it('continue 模式注入通用句', () => {
    const msgs = new PromptAssembler().assemble(baseCtx('continue', 800));
    expect(msgs[0].role).toBe('system');
    expect(msgs[0].content).toContain('## 篇幅要求');
    expect(msgs[0].content).toContain('本次输出约 800 字');
    expect(msgs[0].content).toContain('写到自然段落收束即止');
  });

  it('rewrite 模式首句为「改写后篇幅」', () => {
    const msgs = new PromptAssembler().assemble(baseCtx('rewrite', 800));
    expect(msgs[0].content).toContain('改写后篇幅约 800 字');
    expect(msgs[0].content).not.toContain('本次输出约');
  });

  it('dialogue 模式首句为「对白篇幅」', () => {
    const msgs = new PromptAssembler().assemble(baseCtx('dialogue', 800));
    expect(msgs[0].content).toContain('对白篇幅约 800 字');
    expect(msgs[0].content).not.toContain('本次输出约');
  });

  it('不传 targetWords 不注入', () => {
    for (const mode of ['continue', 'rewrite', 'dialogue'] as const) {
      const msgs = new PromptAssembler().assemble(baseCtx(mode));
      expect(msgs[0].content).not.toContain('篇幅要求');
    }
  });

  it('targetWords 非正数不注入', () => {
    const msgs = new PromptAssembler().assemble(baseCtx('continue', 0));
    expect(msgs[0].content).not.toContain('篇幅要求');
  });

  it('check 模式传了也不注入', () => {
    const msgs = new PromptAssembler().assemble(baseCtx('check', 800));
    expect(msgs[0].content).not.toContain('篇幅要求');
  });

  it('篇幅段位于任务指令之后（system 首小节之后）', () => {
    const msgs = new PromptAssembler().assemble(baseCtx('continue', 800));
    const content = msgs[0].content;
    const taskIdx = content.indexOf('你是一位资深小说作者');
    const twIdx = content.indexOf('## 篇幅要求');
    expect(taskIdx).toBeGreaterThanOrEqual(0);
    expect(twIdx).toBeGreaterThan(taskIdx);
  });

  it('targetWordsSectionText：非 check 返回小节文本，check 返回 null', () => {
    expect(targetWordsSectionText(800, 'continue')).toContain('本次输出约 800 字');
    expect(targetWordsSectionText(800, 'rewrite')).toContain('改写后篇幅约 800 字');
    expect(targetWordsSectionText(800, 'dialogue')).toContain('对白篇幅约 800 字');
    expect(targetWordsSectionText(800, 'check')).toBeNull();
    expect(targetWordsSectionText(undefined, 'continue')).toBeNull();
    expect(targetWordsSectionText(0, 'continue')).toBeNull();
  });
});

describe('PromptAssembler inspect 篇幅统计行', () => {
  it('注入时输出 targetWords 行且 tokens > 0', () => {
    const breakdown = new PromptAssembler().inspect(baseCtx('continue', 800));
    const row = breakdown.find((b) => b.part === 'targetWords');
    expect(row).toBeDefined();
    expect(row!.tokens).toBeGreaterThan(0);
    expect(row!.truncated).toBe(false);
  });

  it('未注入时 targetWords 行 tokens 为 0（保持调试输出完整）', () => {
    const breakdown = new PromptAssembler().inspect(baseCtx('continue'));
    const row = breakdown.find((b) => b.part === 'targetWords');
    expect(row).toBeDefined();
    expect(row!.tokens).toBe(0);
  });
});
