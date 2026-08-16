/**
 * ContextPanel（P1-M4）：AI 上下文可见性面板
 * 展示最近一次 AI 调用注入的 Skill / 角色卡 / 世界书（RAG）/ 摘要链 / 最近章节 + token 占用
 */

import { useCallback, useEffect, useState } from 'react';
import { getAppContext } from '../../context/app-context';
import type { ContextSnapshot } from '../../services/ai/AIOrchestrator';
import { countTokens } from '../../utils/tokens';

function Section({
  title,
  tokens,
  truncated,
  defaultOpen = true,
  children
}: {
  title: string;
  tokens: number;
  truncated?: boolean;
  defaultOpen?: boolean;
  children: React.ReactNode;
}): JSX.Element {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="mb-1 rounded border border-ink-100 bg-white">
      <button
        type="button"
        className="flex w-full items-center gap-2 px-2 py-1.5 text-left text-xs hover:bg-ink-50"
        onClick={() => setOpen((v) => !v)}
      >
        <span className={`text-ink-400 transition-transform ${open ? 'rotate-90' : ''}`}>▶</span>
        <span className="font-medium">{title}</span>
        <span className="ml-auto text-ink-400">
          {tokens} tok{truncated ? ' · 已截断' : ''}
        </span>
      </button>
      {open && <div className="border-t border-ink-100 px-3 py-2">{children}</div>}
    </div>
  );
}

function Empty({ text }: { text: string }): JSX.Element {
  return <div className="text-xs text-ink-400">{text}</div>;
}

export function ContextPanel({ bookId }: { bookId: string }): JSX.Element {
  const [snap, setSnap] = useState<ContextSnapshot | null>(null);

  const load = useCallback((): void => {
    setSnap(getAppContext().orchestrator.getLastContext(bookId));
  }, [bookId]);

  useEffect(() => {
    load();
    const t = setInterval(load, 1500);
    return () => clearInterval(t);
  }, [load]);

  const refresh = (): void => load();

  if (!snap) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 p-4 text-center text-xs text-ink-400">
        <div>尚未发起 AI 调用。</div>
        <div>在 AI 面板执行一次续写 / 改写 / 对白 / 检查后，这里会展示注入的完整上下文清单。</div>
        <button
          type="button"
          className="mt-1 rounded border border-ink-200 px-2 py-1 hover:bg-ink-100"
          onClick={refresh}
        >
          刷新
        </button>
      </div>
    );
  }

  const tokensOf = (part: string): number =>
    snap.breakdown.find((b) => b.part === part)?.tokens ?? 0;
  const truncatedOf = (part: string): boolean =>
    snap.breakdown.find((b) => b.part === part)?.truncated ?? false;
  const { ctx } = snap;

  const modeLabel: Record<string, string> = {
    continue: '续写',
    rewrite: '改写',
    dialogue: '对白',
    check: '一致性检查'
  };

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
        <span className="text-sm font-medium">AI 上下文</span>
        <div className="flex items-center gap-2 text-[11px] text-ink-400">
          <span>
            {modeLabel[snap.mode] ?? snap.mode} · 共 {snap.totalTokens} tok
          </span>
          <button type="button" className="rounded border border-ink-200 px-1.5 py-0.5 hover:bg-ink-100" onClick={refresh}>
            刷新
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 text-xs">
        {/* Skill */}
        <Section title={`文风 Skill（${ctx.enabledSkills.length}）`} tokens={tokensOf('skills')} truncated={truncatedOf('skills')}>
          {ctx.enabledSkills.length === 0 ? (
            <Empty text="未注入文风 Skill" />
          ) : (
            <ul className="space-y-1">
              {ctx.enabledSkills.map((s) => (
                <li key={s.name} className="flex items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  <span className="text-ink-400">{countTokens(s.body)} tok</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* 角色卡 */}
        <Section title={`角色卡（${ctx.characters.length}）`} tokens={tokensOf('characters')} truncated={truncatedOf('characters')}>
          {ctx.characters.length === 0 ? (
            <Empty text="未注入角色卡" />
          ) : (
            <ul className="space-y-1">
              {ctx.characters.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-violet-400" />
                  <span className="font-medium">{c.name}</span>
                  {c.tags.length > 0 && <span className="text-ink-400">{c.tags.join('、')}</span>}
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* 世界书（RAG 检索结果，可追溯） */}
        <Section
          title={`世界书 RAG（${ctx.worldbookEntries?.length ?? 0}）`}
          tokens={tokensOf('worldbook')}
          truncated={truncatedOf('worldbook')}
        >
          {(ctx.worldbookEntries ?? []).length === 0 ? (
            <Empty text="本次未检索到相关世界书条目" />
          ) : (
            <ul className="space-y-1">
              {(ctx.worldbookEntries ?? []).map((w, i) => (
                <li key={w.id} className="flex items-start gap-1">
                  <span className="rounded bg-sky-50 px-1 text-[10px] text-sky-600">#{i + 1}</span>
                  <span className="min-w-0">
                    <span className="font-medium">
                      {w.title}
                      <span className="ml-1 text-ink-400">[{w.category ?? '设定'}]</span>
                    </span>
                    <span className="mt-0.5 block line-clamp-2 text-ink-400">{w.content}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* 摘要链 */}
        <Section
          title={`前情摘要链（${ctx.summaryChain?.length ?? 0}）`}
          tokens={tokensOf('summaryChain')}
          truncated={truncatedOf('summaryChain')}
        >
          {(ctx.summaryChain ?? []).length === 0 ? (
            <Empty text="无摘要链（章节尚未生成摘要）" />
          ) : (
            <ul className="space-y-1">
              {(ctx.summaryChain ?? []).map((s) => (
                <li key={s.chapterId}>
                  <span className="font-medium">《{s.title}》</span>
                  <span className="mt-0.5 block line-clamp-2 text-ink-400">{s.summary}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* 最近章节原文 */}
        <Section
          title={`最近章节原文（${ctx.recentChapters.length}）`}
          tokens={tokensOf('recentChapters')}
          truncated={truncatedOf('recentChapters')}
        >
          {ctx.recentChapters.length === 0 ? (
            <Empty text="未注入章节原文" />
          ) : (
            <ul className="space-y-1">
              {ctx.recentChapters.map((c) => (
                <li key={c.id} className="flex items-center gap-2">
                  <span className="font-medium">《{c.title}》</span>
                  <span className="text-ink-400">{countTokens(c.content)} tok</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* 当前章节 */}
        {(ctx.mode === 'continue' || ctx.mode === 'check') && ctx.currentChapter && (
          <Section
            title="当前章节（截取）"
            tokens={tokensOf('currentChapter')}
            truncated={truncatedOf('currentChapter')}
          >
            <div className="text-ink-400">{countTokens(ctx.currentChapter.content)} tok 已注入（预算内截取）</div>
          </Section>
        )}

        <div className="mt-2 px-1 text-[11px] text-ink-400">
          快照时间：{new Date(snap.at).toLocaleTimeString()} · 生成预留 ~8000 tok 不计入
        </div>
      </div>
    </div>
  );
}
