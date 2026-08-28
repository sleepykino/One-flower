import { beforeEach, describe, expect, it } from 'vitest';
import { useAIStore } from '../../src/store/aiStore';

// G3 多候选：aiStore 候选状态机（beginCandidates / pushCandidate / setActiveCandidate / reset）

describe('aiStore 多候选状态机', () => {
  beforeEach(() => {
    useAIStore.getState().reset();
  });

  it('默认单候选：candidateTotal=1、candidates 为空', () => {
    const s = useAIStore.getState();
    expect(s.candidateTotal).toBe(1);
    expect(s.candidates).toEqual([]);
    expect(s.activeCandidate).toBe(0);
  });

  it('beginCandidates 重置候选集合并记录总数', () => {
    useAIStore.setState({ candidates: ['旧的'] });
    useAIStore.getState().beginCandidates(3);
    const s = useAIStore.getState();
    expect(s.candidateTotal).toBe(3);
    expect(s.candidates).toEqual([]);
    expect(s.activeCandidate).toBe(0);
  });

  it('pushCandidate 按序累积 generatedText 并指向最新一条', () => {
    useAIStore.getState().beginCandidates(3);
    useAIStore.getState().startStream();
    useAIStore.getState().appendText('候选一');
    useAIStore.getState().pushCandidate();
    expect(useAIStore.getState().candidates).toEqual(['候选一']);
    expect(useAIStore.getState().activeCandidate).toBe(0);

    // 第二条：startStream 清空 generatedText（模拟下一条流式），完成后入列
    useAIStore.getState().startStream();
    useAIStore.getState().appendText('候选二');
    useAIStore.getState().pushCandidate();
    expect(useAIStore.getState().candidates).toEqual(['候选一', '候选二']);
    expect(useAIStore.getState().activeCandidate).toBe(1);
  });

  it('setActiveCandidate 切换展示下标（多候选挑选）', () => {
    useAIStore.getState().beginCandidates(2);
    useAIStore.setState({ candidates: ['甲', '乙'], activeCandidate: 1 });
    useAIStore.getState().setActiveCandidate(0);
    expect(useAIStore.getState().activeCandidate).toBe(0);
  });

  it('reset 清空全部候选状态（采纳/丢弃后回到单候选默认）', () => {
    useAIStore.getState().beginCandidates(3);
    useAIStore.setState({ candidates: ['a', 'b'], activeCandidate: 1, generatedText: 'x' });
    useAIStore.getState().reset();
    const s = useAIStore.getState();
    expect(s.candidateTotal).toBe(1);
    expect(s.candidates).toEqual([]);
    expect(s.activeCandidate).toBe(0);
    expect(s.generatedText).toBe('');
    expect(s.phase).toBe('idle');
  });

  it('startStream 不清空候选集合（多候选逐条生成期间保持累积）', () => {
    useAIStore.getState().beginCandidates(2);
    useAIStore.setState({ candidates: ['第一条'] });
    useAIStore.getState().startStream();
    expect(useAIStore.getState().candidates).toEqual(['第一条']);
    expect(useAIStore.getState().generatedText).toBe('');
  });
});
