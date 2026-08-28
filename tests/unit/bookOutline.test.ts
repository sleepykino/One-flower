import { describe, expect, it, vi } from 'vitest';
import {
  BookOutlineService,
  OUTLINE_TEMPLATE,
  effectiveOutline
} from '../../src/services/outline/BookOutlineService';
import { DEFAULT_TOKEN_BUDGET, PromptAssembler } from '../../src/services/ai/PromptAssembler';
import type { PromptContext } from '../../src/services/ai/PromptAssembler';
import type { NativeBridge } from '../../src/native/NativeBridge';

// G1 全书大纲：storage_dir/outline.md 读写 + 去注释注入文本 + PromptAssembler 注入与零变化保证

describe('effectiveOutline 注入文本解析', () => {
  it('去整行注释与标题符号，保留正文', () => {
    const raw = '# 全书大纲\n<!-- 注释不注入 -->\n## 主线三幕\n- 第一幕：起\n- 第二幕：承';
    expect(effectiveOutline(raw)).toBe('全书大纲\n主线三幕\n- 第一幕：起\n- 第二幕：承');
  });

  it('注释行不计入，标题行计入正文', () => {
    expect(effectiveOutline('# 大纲\n<!-- 注释 -->\n正文内容')).toBe('大纲\n正文内容');
    expect(effectiveOutline('# 标题\n<!-- 全是注释 -->\n')).toBe('标题');
    expect(effectiveOutline('')).toBeUndefined();
  });

  it('示例模板全部注释化，原样保存不生效（对齐 agents.md 惯例）', () => {
    expect(effectiveOutline(OUTLINE_TEMPLATE)).toBeUndefined();
  });
});

describe('BookOutlineService 读写', () => {
  function createFixture(existing?: string) {
    const writes: Array<{ path: string; content: string }> = [];
    const bridge = {
      db: {
        queryOne: vi.fn(async () => ({ storage_dir: '/books/b1' }))
      },
      fs: {
        readFile: vi.fn(async (path: string) => {
          if (path === '/books/b1/outline.md') {
            if (existing === undefined) throw new Error('not found');
            return existing;
          }
          throw new Error('not found');
        }),
        writeFile: vi.fn(async (path: string, content: string) => {
          writes.push({ path, content });
        })
      }
    } as unknown as NativeBridge;
    return { svc: new BookOutlineService(bridge), writes };
  }

  it('读取已存在的大纲原文', async () => {
    const { svc } = createFixture('# 大纲\n正文');
    expect(await svc.getOutline('b1')).toBe('# 大纲\n正文');
    expect(await svc.outlineText('b1')).toBe('大纲\n正文');
  });

  it('文件不存在返回空串 / undefined（不抛错）', async () => {
    const { svc } = createFixture();
    expect(await svc.getOutline('b1')).toBe('');
    expect(await svc.outlineText('b1')).toBeUndefined();
  });

  it('保存写入 storageDir/outline.md', async () => {
    const { svc, writes } = createFixture();
    await svc.saveOutline('b1', '# 新大纲');
    expect(writes).toEqual([{ path: '/books/b1/outline.md', content: '# 新大纲' }]);
  });
});

describe('PromptAssembler 全书大纲注入', () => {
  const baseCtx: PromptContext = {
    mode: 'continue',
    systemInstruction: '',
    enabledSkills: [],
    characters: [],
    recentChapters: [{ id: 'ch-1', title: '第一章', content: '前文内容' }],
    currentChapter: { id: 'ch-2', title: '第二章', content: '当前内容' }
  };

  it('注入大纲时 user 消息包含【全书大纲】段与前瞻约束指令', () => {
    const assembler = new PromptAssembler();
    const messages = assembler.assemble({ ...baseCtx, bookOutline: '主线三幕\n第一幕：起' });
    const user = messages.map((m) => m.content).join('\n');
    expect(user).toContain('【全书大纲');
    expect(user).toContain('第一幕：起');
    expect(user).toContain('不得提前展开后续剧情');
  });

  it('不传大纲时输出与改造前完全一致（零变化保证）', () => {
    const assembler = new PromptAssembler();
    const before = assembler.assemble(baseCtx);
    const after = assembler.assemble({ ...baseCtx, bookOutline: undefined });
    expect(after).toEqual(before);
    expect(after.some((m) => m.content.includes('全书大纲'))).toBe(false);
  });

  it('超预算截断到 bookOutline 预算', () => {
    const assembler = new PromptAssembler();
    const long = '第一幕剧情。'.repeat(2000);
    const messages = assembler.assemble({ ...baseCtx, bookOutline: long });
    const user = messages.find((m) => m.role === 'user')!.content;
    expect(user).toContain('【全书大纲');
    // 预算 800 token：截断后不至全文（约 12000 字）
    expect(user.length).toBeLessThan(long.length);
    expect(DEFAULT_TOKEN_BUDGET.bookOutline).toBeGreaterThan(0);
  });

  it('inspect 透出 bookOutline 段的 token 占用', () => {
    const assembler = new PromptAssembler();
    const breakdown = assembler.inspect({ ...baseCtx, bookOutline: '主线三幕' });
    const entry = breakdown.find((b) => b.part === 'bookOutline');
    expect(entry).toBeDefined();
    expect(entry!.tokens).toBeGreaterThan(0);
    const empty = assembler.inspect(baseCtx).find((b) => b.part === 'bookOutline');
    expect(empty!.tokens).toBe(0);
  });
});
