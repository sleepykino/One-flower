import { describe, expect, it, beforeEach } from 'vitest';
import { DEFAULT_TOKEN_BUDGET, PromptAssembler, truncateHistoryLatestFirst } from '../../src/services/ai/PromptAssembler';
import type { PromptContext } from '../../src/services/ai/PromptAssembler';
import type { ChatMessage } from '../../src/services/ai/providers/LLMProvider';
import { useAIStore } from '../../src/store/aiStore';

// P7.3：AI 会话上下文——Phase 0 消息组装改造；P7.3b：会话块状态机（原地微调 + 按需对比择优）

const baseCtx: PromptContext = {
  mode: 'continue',
  systemInstruction: '',
  enabledSkills: [],
  characters: [],
  recentChapters: [{ id: 'ch-1', title: '第一章', content: '前文内容' }],
  currentChapter: { id: 'ch-2', title: '第二章', content: '当前内容' }
};

describe('PromptAssembler 历史注入（Phase 0）', () => {
  it('不传 history 时输出与改造前完全一致（零变化保证）', () => {
    const assembler = new PromptAssembler();
    const messages = assembler.assemble(baseCtx);
    expect(messages).toHaveLength(2);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages[1].content.endsWith('请开始输出。')).toBe(true);
  });

  it('带 history 时序列为 [system, user, ...history]，保持相对顺序', () => {
    const assembler = new PromptAssembler();
    const history: ChatMessage[] = [
      { role: 'user', content: '写得再压抑一点' },
      { role: 'assistant', content: '雨落在铁皮屋顶上……' },
      { role: 'user', content: '更简洁' },
      { role: 'assistant', content: '雨敲着铁皮屋顶。' }
    ];
    const messages = assembler.assemble({ ...baseCtx, history });
    expect(messages).toHaveLength(2 + history.length);
    expect(messages[0].role).toBe('system');
    expect(messages[1].role).toBe('user');
    expect(messages.slice(2)).toEqual(history);
  });

  it('historyBudget 截断去旧保新：超预算丢弃最旧，最后一条一定在内', () => {
    const assembler = new PromptAssembler({ ...DEFAULT_TOKEN_BUDGET, history: 20 });
    const history: ChatMessage[] = [
      { role: 'user', content: '第一轮要求' }, // 5 token
      { role: 'assistant', content: '第一轮生成的内容很长很长很长' }, // 14 token
      { role: 'user', content: '第二轮要求' }, // 5 token
      { role: 'assistant', content: '第二轮生成' } // 5 token
    ];
    const messages = assembler.assemble({ ...baseCtx, history });
    const historyPart = messages.slice(2);
    // 最后一条保留
    expect(historyPart[historyPart.length - 1].content).toBe('第二轮生成');
    // 预算内（20 token：只装得下最近两轮）
    const total = historyPart.reduce((sum, m) => sum + m.content.length, 0);
    expect(total).toBeLessThanOrEqual(20);
    // 旧消息被丢弃（不在输出中）
    const joined = historyPart.map((m) => m.content).join('\n');
    expect(joined).not.toContain('第一轮要求');
  });

  it('inspect 透出 history 段：未传时 tokens=0，传入后统计截断后占用', () => {
    const assembler = new PromptAssembler();
    const empty = assembler.inspect(baseCtx).find((b) => b.part === 'history');
    expect(empty).toBeDefined();
    expect(empty!.tokens).toBe(0);

    const breakdown = assembler
      .inspect({ ...baseCtx, history: [{ role: 'user', content: '再压抑一点' }] })
      .find((b) => b.part === 'history');
    expect(breakdown!.tokens).toBeGreaterThan(0);
    expect(breakdown!.truncated).toBe(false);
  });
});

describe('truncateHistoryLatestFirst 后进优先截断', () => {
  it('预算内全部保留，顺序不变', () => {
    const history: ChatMessage[] = [
      { role: 'user', content: '甲' },
      { role: 'assistant', content: '乙' }
    ];
    expect(truncateHistoryLatestFirst(history, 100)).toEqual(history);
  });

  it('最后一条自身超预算：截断其内容而不是丢弃', () => {
    const long = '雨'.repeat(50);
    const kept = truncateHistoryLatestFirst([{ role: 'assistant', content: long }], 10);
    expect(kept).toHaveLength(1);
    expect(kept[0].content.length).toBeLessThan(long.length);
    expect(kept[0].content).toContain('…（已截断）');
  });

  it('预算为 0 或负数返回空数组', () => {
    expect(truncateHistoryLatestFirst([{ role: 'user', content: 'x' }], 0)).toEqual([]);
    expect(truncateHistoryLatestFirst([{ role: 'user', content: 'x' }], -1)).toEqual([]);
  });
});

describe('aiStore 会话块状态机（P7.3b）', () => {
  const KEY = 'book-1:ch-1';

  beforeEach(() => {
    useAIStore.getState().reset();
    useAIStore.getState().endBlock();
  });

  it('beginBlock 创建块（round=1、无 prevCandidate）；已有块时幂等', () => {
    useAIStore.getState().beginBlock(KEY);
    const b = useAIStore.getState().sessionBlock!;
    expect(b.sessionKey).toBe(KEY);
    expect(b.round).toBe(1);
    expect(b.history).toEqual([]);
    expect(b.prevCandidate).toBeNull();
    useAIStore.getState().beginBlock('book-1:ch-2');
    expect(useAIStore.getState().sessionBlock!.sessionKey).toBe(KEY);
  });

  it('completeRound 原子对落史（指令 + 当前 generatedText），round 为当前轮次', () => {
    useAIStore.getState().beginBlock(KEY);
    useAIStore.setState({ generatedText: '第一轮输出' });
    useAIStore.getState().completeRound('第一轮要求');
    const b = useAIStore.getState().sessionBlock!;
    expect(b.history).toEqual([
      { role: 'user', content: '第一轮要求' },
      { role: 'assistant', content: '第一轮输出' }
    ]);
    expect(b.round).toBe(1);
  });

  it('completeRound 无块/空输出 no-op；显式 output 优先于 generatedText', () => {
    useAIStore.getState().completeRound('x');
    expect(useAIStore.getState().sessionBlock).toBeNull();
    useAIStore.getState().beginBlock(KEY);
    useAIStore.setState({ generatedText: '被忽略的流式残留' });
    useAIStore.getState().completeRound('要求', '显式输出');
    expect(useAIStore.getState().sessionBlock!.history).toEqual([
      { role: 'user', content: '要求' },
      { role: 'assistant', content: '显式输出' }
    ]);
  });

  it('微调轮 beginRewriteRound：完整候选存为 prevCandidate 并 round+1', () => {
    useAIStore.getState().beginBlock(KEY);
    useAIStore.getState().completeRound('要求1', '版本A');
    useAIStore.getState().beginRewriteRound('版本A');
    const b = useAIStore.getState().sessionBlock!;
    expect(b.round).toBe(2);
    expect(b.prevCandidate).toBe('版本A');
  });

  it('beginRewriteRound：中断半截（≠ 末条 assistant）不覆盖 prevCandidate', () => {
    useAIStore.getState().beginBlock(KEY);
    useAIStore.getState().completeRound('要求1', '版本A');
    useAIStore.getState().beginRewriteRound('版本A');
    useAIStore.getState().completeRound('要求2', '版本B');
    // 模拟中断半截：节点=半截，历史末条仍是版本B → 半截不配做"上一版"
    useAIStore.getState().beginRewriteRound('版本B的半截');
    const b = useAIStore.getState().sessionBlock!;
    expect(b.round).toBe(3);
    expect(b.prevCandidate).toBe('版本A');
  });

  it('补完轮 completeRound 不推进 round（当前轮的延续）', () => {
    useAIStore.getState().beginBlock(KEY);
    useAIStore.getState().completeRound('要求1', '版本A');
    useAIStore.getState().beginRewriteRound('版本A');
    useAIStore.getState().completeRound('继续补完：从上次中断处接着写', '版本A+补');
    const b = useAIStore.getState().sessionBlock!;
    expect(b.round).toBe(2);
    expect(b.history).toHaveLength(4);
  });

  it('revertToPrevCandidate：回滚到上一版所在轮（含补完对），round 回退、prevCandidate 清空', () => {
    useAIStore.getState().beginBlock(KEY);
    useAIStore.getState().completeRound('要求1', '版本A');
    useAIStore.getState().beginRewriteRound('版本A');
    useAIStore.getState().completeRound('要求2', '版本B');
    useAIStore.getState().completeRound('继续补完', '版本B+补');
    const prev = useAIStore.getState().revertToPrevCandidate();
    expect(prev).toBe('版本A');
    const b = useAIStore.getState().sessionBlock!;
    expect(b.history).toEqual([
      { role: 'user', content: '要求1' },
      { role: 'assistant', content: '版本A' }
    ]);
    expect(b.round).toBe(1);
    expect(b.prevCandidate).toBeNull();
  });

  it('revertToPrevCandidate 无 prev 时返回 null 且不动块', () => {
    useAIStore.getState().beginBlock(KEY);
    useAIStore.getState().completeRound('要求1', '版本A');
    expect(useAIStore.getState().revertToPrevCandidate()).toBeNull();
    expect(useAIStore.getState().sessionBlock!.history).toHaveLength(2);
  });

  it('轨迹超预算去旧保新（最旧轮次对被丢弃，末对保留）', () => {
    useAIStore.getState().beginBlock(KEY);
    useAIStore.getState().completeRound('要求1', '字'.repeat(2500));
    useAIStore.getState().completeRound('要求2', '字'.repeat(2500));
    const h = useAIStore.getState().sessionBlock!.history;
    expect(h).toHaveLength(2);
    expect(h[0]).toEqual({ role: 'user', content: '要求2' });
    expect(h[1]).toEqual({ role: 'assistant', content: '字'.repeat(2500) });
  });

  it('finishStream 不再感知会话（历史写入仅由 completeRound 显式触发）', () => {
    useAIStore.getState().beginBlock(KEY);
    useAIStore.getState().startStream();
    useAIStore.getState().appendText('X');
    useAIStore.getState().finishStream('done');
    expect(useAIStore.getState().sessionBlock!.history).toEqual([]);
  });

  it('reset 不清 sessionBlock；endBlock 清空（块生命周期显式控制）', () => {
    useAIStore.getState().beginBlock(KEY);
    useAIStore.getState().reset();
    expect(useAIStore.getState().sessionBlock).not.toBeNull();
    useAIStore.getState().endBlock();
    expect(useAIStore.getState().sessionBlock).toBeNull();
  });
});
