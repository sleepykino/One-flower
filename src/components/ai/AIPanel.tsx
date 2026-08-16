/**
 * AI 面板：四模式 tab（续写 / 改写 / 对白 / 检查）
 * 流式输出到编辑器 AI 临时节点，中断后三选项：保留 / 丢弃 / 继续补完
 */

import { useEffect, useState } from 'react';
import { getAppContext } from '../../context/app-context';
import { alertDialog } from '../../native/dialog';
import { useEditorStore } from '../../store/editorStore';
import { useAIStore } from '../../store/aiStore';
import type { AIMode } from '../../services/skill/types';
import type { Character } from '../../types';
import { ConsistencyReportView } from './ConsistencyReport';

const MODES: Array<{ key: AIMode; label: string }> = [
  { key: 'continue', label: '续写' },
  { key: 'rewrite', label: '改写' },
  { key: 'dialogue', label: '对白' },
  { key: 'check', label: '检查' }
];

export function AIPanel({ bookId }: { bookId: string }): JSX.Element {
  const mode = useAIStore((s) => s.mode);
  const setMode = useAIStore((s) => s.setMode);
  const phase = useAIStore((s) => s.phase);
  const error = useAIStore((s) => s.error);
  const report = useAIStore((s) => s.report);
  const chapters = useEditorStore((s) => s.chapters);
  const currentChapterId = useEditorStore((s) => s.currentChapterId);
  const selectedText = useEditorStore((s) => s.selectedText);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [selectedCharIds, setSelectedCharIds] = useState<string[]>([]);
  const [instruction, setInstruction] = useState('');
  const [scene, setScene] = useState('');
  // 生成参数：单次回复 token 上限（约等于中文字数）与采样温度
  const [maxTokens, setMaxTokens] = useState(2048);
  const [temperature, setTemperature] = useState('0.8');
  const tempValue = (): number | undefined => {
    const t = parseFloat(temperature);
    return Number.isFinite(t) && t >= 0 && t <= 2 ? t : undefined;
  };
  const tokenValue = (): number | undefined =>
    Number.isFinite(maxTokens) && maxTokens > 0 ? Math.floor(maxTokens) : undefined;

  useEffect(() => {
    void getAppContext()
      .characterService.list(bookId)
      .then(setCharacters);
  }, [bookId]);

  const streaming = phase === 'streaming';
  const deciding = phase === 'deciding';
  const currentChapter = chapters.find((c) => c.id === currentChapterId);

  /** 收集前情（滑动窗口最近 3 章） */
  const gatherRecent = async () => {
    if (!currentChapterId) return [];
    return getAppContext().chapterService.recentChapters(bookId, currentChapterId, 3);
  };

  /** 统一流式执行器：临时节点承载输出 */
  const runStream = async (
    kind: 'continue' | 'rewrite' | 'dialogue',
    range: { from: number; to: number } | null
  ): Promise<void> => {
    const { orchestrator } = getAppContext();
    const api = useEditorStore.getState().editorApi;
    if (!api || !currentChapterId) {
      void alertDialog('请先选择要编辑的章节');
      return;
    }
    const controller = useAIStore.getState().startStream();
    api.startAITemp(range ?? undefined);

    try {
      const recent = await gatherRecent();
      let iterable: AsyncIterable<{ delta: string; done: boolean }>;
      if (kind === 'continue') {
        iterable = orchestrator.continueWriting({
          bookId,
          chapterId: currentChapterId,
          currentContent: api.getPlainText(),
          recentChapters: recent,
          selectedCharacterIds: selectedCharIds,
          maxTokens: tokenValue(),
          temperature: tempValue(),
          signal: controller.signal
        });
      } else if (kind === 'rewrite') {
        iterable = orchestrator.rewrite({
          bookId,
          chapterId: currentChapterId,
          selectedText: selectedText,
          instruction,
          recentChapters: recent,
          maxTokens: tokenValue(),
          temperature: tempValue(),
          signal: controller.signal
        });
      } else {
        iterable = orchestrator.generateDialogue({
          bookId,
          chapterId: currentChapterId,
          scene,
          characterIds: selectedCharIds,
          recentChapters: recent,
          signal: controller.signal
        });
      }
      for await (const chunk of iterable) {
        if (chunk.delta) {
          useAIStore.getState().appendText(chunk.delta);
          api.appendAITemp(chunk.delta);
        }
      }
      api.finishAITemp();
      useAIStore.getState().finishStream('done');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const aborted = controller.signal.aborted || msg.includes('Abort');
      if (aborted) {
        // 中断：保留临时节点，交由三选项处理
        api.finishAITemp();
        useAIStore.getState().finishStream('aborted');
      } else {
        api.discardAITemp();
        useAIStore.getState().finishStream('error', msg);
      }
    }
  };

  const stop = (): void => {
    useAIStore.getState().abortController?.abort();
  };

  const onContinue = async (): Promise<void> => {
    // 继续补完：以已生成文本为上文再次续写
    const { orchestrator } = getAppContext();
    const api = useEditorStore.getState().editorApi;
    if (!api || !currentChapterId) return;
    const controller = useAIStore.getState().startStream();
    try {
      const recent = await gatherRecent();
      const base = useAIStore.getState().generatedText;
      const iterable = orchestrator.continueWriting({
        bookId,
        chapterId: currentChapterId,
        currentContent: `${api.getPlainText()}\n\n${base}`,
        recentChapters: recent,
        selectedCharacterIds: selectedCharIds,
        signal: controller.signal
      });
      for await (const chunk of iterable) {
        if (chunk.delta) {
          useAIStore.getState().appendText(chunk.delta);
          api.appendAITemp(chunk.delta);
        }
      }
      api.finishAITemp();
      useAIStore.getState().finishStream('done');
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      api.discardAITemp();
      useAIStore.getState().finishStream('error', msg);
    }
  };

  const runCheck = async (): Promise<void> => {
    const { orchestrator } = getAppContext();
    const api = useEditorStore.getState().editorApi;
    if (!api || !currentChapterId) {
      void alertDialog('请先选择要检查的章节');
      return;
    }
    const store = useAIStore.getState();
    store.setChecking(true);
    store.setReport(null);
    try {
      const r = await orchestrator.checkConsistency({
        bookId,
        chapterId: currentChapterId,
        chapterContent: api.getPlainText()
      });
      useAIStore.getState().setReport(r);
    } catch (e) {
      void alertDialog(`检查失败：${e instanceof Error ? e.message : String(e)}`);
    } finally {
      useAIStore.getState().setChecking(false);
    }
  };

  const toggleChar = (id: string): void => {
    setSelectedCharIds((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]));
  };

  return (
    <div className="flex h-full flex-col">
      {/* 模式 tab */}
      <div className="flex border-b border-ink-200">
        {MODES.map((m) => (
          <button
            key={m.key}
            type="button"
            onClick={() => setMode(m.key)}
            className={`flex-1 px-2 py-2 text-sm ${
              mode === m.key
                ? 'border-b-2 border-violet-600 font-medium text-violet-700'
                : 'text-ink-500 hover:text-ink-800'
            }`}
          >
            {m.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto">
        {/* 续写 */}
        {mode === 'continue' && (
          <div className="p-3">
            <div className="mb-2 text-xs text-ink-500">
              当前：{currentChapter?.title ?? '未选择章节'} · 前情自动取最近 3 章
            </div>
            <CharPicker characters={characters} selected={selectedCharIds} onToggle={toggleChar} />
            <GenParams
              maxTokens={maxTokens}
              setMaxTokens={setMaxTokens}
              temperature={temperature}
              setTemperature={setTemperature}
            />
            <button
              type="button"
              disabled={streaming || !currentChapterId}
              className="mt-3 w-full rounded bg-violet-600 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
              onClick={() => void runStream('continue', null)}
            >
              {streaming ? '生成中…' : '开始续写'}
            </button>
          </div>
        )}

        {/* 改写 */}
        {mode === 'rewrite' && (
          <div className="p-3">
            <div className="mb-2 rounded bg-ink-50 p-2 text-xs text-ink-600">
              {selectedText ? `已选中（${selectedText.length}字）：${selectedText.slice(0, 60)}…` : '请先在编辑器中选中要改写的文本'}
            </div>
            <textarea
              rows={3}
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
              placeholder="改写要求，如：改为更紧张的氛围"
              className="mb-2 w-full resize-none rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
            />
            <GenParams
              maxTokens={maxTokens}
              setMaxTokens={setMaxTokens}
              temperature={temperature}
              setTemperature={setTemperature}
            />
            <button
              type="button"
              disabled={streaming || !selectedText || !instruction.trim()}
              className="mt-3 w-full rounded bg-violet-600 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
              onClick={() => {
                const api = useEditorStore.getState().editorApi;
                const range = api?.getSelectionRange() ?? null;
                void runStream('rewrite', range);
              }}
            >
              {streaming ? '生成中…' : '开始改写'}
            </button>
          </div>
        )}

        {/* 对白 */}
        {mode === 'dialogue' && (
          <div className="p-3">
            <textarea
              rows={3}
              value={scene}
              onChange={(e) => setScene(e.target.value)}
              placeholder="场景描述，如：客栈中，主角与神秘剑客对峙"
              className="mb-2 w-full resize-none rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
            />
            <CharPicker characters={characters} selected={selectedCharIds} onToggle={toggleChar} />
            <button
              type="button"
              disabled={streaming || !scene.trim() || selectedCharIds.length === 0}
              className="mt-3 w-full rounded bg-violet-600 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
              onClick={() => void runStream('dialogue', null)}
            >
              {streaming ? '生成中…' : '生成对白'}
            </button>
          </div>
        )}

        {/* 检查 */}
        {mode === 'check' && (
          <div className="p-3">
            <div className="mb-2 text-xs text-ink-500">
              对当前章节全文与角色卡 / 世界书做一致性检查（不注入文风 Skill）
            </div>
            <button
              type="button"
              disabled={phase === 'checking' || !currentChapterId}
              className="w-full rounded bg-violet-600 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
              onClick={() => void runCheck()}
            >
              {phase === 'checking' ? '检查中…' : '开始检查'}
            </button>
            {report && (
              <div className="mt-2">
                <ConsistencyReportView report={report} />
              </div>
            )}
          </div>
        )}

        {error && (
          <div className="m-3 rounded border border-red-200 bg-red-50 p-2 text-xs text-red-600">
            {error}
          </div>
        )}
      </div>

      {/* 流式中断三选项 */}
      {(streaming || deciding) && (
        <div className="border-t border-ink-200 bg-ink-50 p-2">
          {streaming && (
            <button
              type="button"
              onClick={stop}
              className="w-full rounded bg-red-500 py-1.5 text-sm text-white hover:bg-red-600"
            >
              停止
            </button>
          )}
          {deciding && (
            <>
              <div className="mb-1 text-xs text-ink-500">
                已生成 {useAIStore.getState().generatedText.length} 字，请选择：
              </div>
              <div className="flex gap-1">
                <button
                  type="button"
                  className="flex-1 rounded bg-emerald-600 py-1 text-xs text-white hover:bg-emerald-700"
                  onClick={() => {
                    useEditorStore.getState().editorApi?.acceptAITemp();
                    useAIStore.getState().reset();
                  }}
                >
                  保留
                </button>
                <button
                  type="button"
                  className="flex-1 rounded bg-red-500 py-1 text-xs text-white hover:bg-red-600"
                  onClick={() => {
                    useEditorStore.getState().editorApi?.discardAITemp();
                    useAIStore.getState().reset();
                  }}
                >
                  丢弃
                </button>
                <button
                  type="button"
                  className="flex-1 rounded bg-violet-600 py-1 text-xs text-white hover:bg-violet-700"
                  onClick={() => void onContinue()}
                >
                  继续补完
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function GenParams({
  maxTokens,
  setMaxTokens,
  temperature,
  setTemperature
}: {
  maxTokens: number;
  setMaxTokens: (v: number) => void;
  temperature: string;
  setTemperature: (v: string) => void;
}): JSX.Element {
  return (
    <div className="mt-3 flex items-center gap-2 text-xs text-ink-600">
      <label className="flex items-center gap-1">
        字数上限
        <input
          type="number"
          min={1}
          step={128}
          value={maxTokens}
          onChange={(e) => setMaxTokens(parseInt(e.target.value, 10) || 0)}
          className="w-20 rounded border border-ink-200 px-1.5 py-1 outline-none focus:border-violet-400"
        />
      </label>
      <label className="flex items-center gap-1" title="0 = 严谨确定，2 = 发散大胆">
        温度
        <input
          type="number"
          min={0}
          max={2}
          step={0.1}
          value={temperature}
          onChange={(e) => setTemperature(e.target.value)}
          className="w-16 rounded border border-ink-200 px-1.5 py-1 outline-none focus:border-violet-400"
        />
      </label>
    </div>
  );
}

function CharPicker({
  characters,
  selected,
  onToggle
}: {
  characters: Character[];
  selected: string[];
  onToggle: (id: string) => void;
}): JSX.Element {
  if (characters.length === 0) {
    return <div className="text-xs text-ink-400">本书暂无角色卡，可先在「角色」面板创建。</div>;
  }
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-ink-600">参与角色（注入角色卡）</div>
      <div className="flex flex-wrap gap-1">
        {characters.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => onToggle(c.id)}
            className={`rounded-full px-2 py-0.5 text-xs ${
              selected.includes(c.id)
                ? 'bg-violet-600 text-white'
                : 'bg-ink-100 text-ink-600 hover:bg-ink-200'
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>
    </div>
  );
}
