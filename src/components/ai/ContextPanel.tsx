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

/** 默认两行截断，点击展开/收起（摘要等长文本查看用） */
function ClampText({ text }: { text: string }): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <span
      className={`mt-0.5 block cursor-pointer whitespace-pre-wrap text-ink-400 ${open ? '' : 'line-clamp-2'}`}
      onClick={() => setOpen((v) => !v)}
      title={open ? '点击收起' : '点击展开查看全文'}
    >
      {text}
    </span>
  );
}

export function ContextPanel({ bookId }: { bookId: string }): JSX.Element {
  const [snap, setSnap] = useState<ContextSnapshot | null>(null);
  // 全量 RAG 嵌入状态 + 批量向量化（存量章节需手动批量嵌入一次）
  const [embedStats, setEmbedStats] = useState<{ chapters: number; segments: number } | null>(null);
  const [embedding, setEmbedding] = useState(false);
  const [embedMsg, setEmbedMsg] = useState('');

  const refreshStats = useCallback((): void => {
    void getAppContext()
      .fullRagService.segmentStats(bookId)
      .then(setEmbedStats)
      .catch(() => setEmbedStats(null));
  }, [bookId]);

  useEffect(() => {
    refreshStats();
  }, [refreshStats]);

  /** 批量向量化全书（未变化段落自动跳过）—— P2.1-M4 试点接入任务中心（后台化 + 取消 + 失败重试） */
  const runEmbedAll = async (): Promise<void> => {
    const { fullRagService, tasks, chapterService } = getAppContext();
    setEmbedding(true);
    setEmbedMsg('批量向量化中…');
    const exec = (): void => {
      setEmbedding(true);
      setEmbedMsg('批量向量化中…');
      tasks.register({
        kind: 'batch-embed',
        title: '全书章节向量化',
        cancellable: true,
        run: async ({ report, signal }) => {
          let done = 0;
          const all = await chapterService.list(bookId);
          const total = all.length;
          for await (const p of fullRagService.embedAllSegments(bookId)) {
            if (signal.aborted) throw new DOMException('已取消', 'AbortError');
            done += 1;
            report(Math.round((done / Math.max(total, 1)) * 100), `第 ${done}/${total} 章`);
            if (p.status === 'error') {
              console.warn('[FullRAG] 章节向量化失败:', p.title, p.error);
              setEmbedMsg(`已完成 ${done} 章（「${p.title}」失败：${p.error ?? ''}）`);
            } else {
              setEmbedMsg(`已完成 ${done} 章`);
            }
          }
          setEmbedMsg(`批量向量化完成（共 ${done} 章）`);
        },
        retry: exec
      });
    };
    try {
      exec();
    } catch (e) {
      setEmbedMsg(`失败：${e instanceof Error ? e.message : String(e)}`);
      setEmbedding(false);
      return;
    }
    // 任务在后台运行，本地 embedding 态跟随任务列表恢复
    const unsub = tasks.subscribe((list) => {
      const mine = list
        .filter((t) => t.kind === 'batch-embed')
        .sort((a, b) => b.startedAt - a.startedAt)[0];
      if (!mine || mine.status !== 'running') {
        setEmbedding(false);
        refreshStats();
        unsub();
      }
    });
  };

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
      <div className="flex h-full flex-col">
        <div className="flex flex-1 flex-col items-center justify-center gap-2 p-4 text-center text-xs text-ink-400">
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
        {/* 全量 RAG 嵌入状态 + 存量章节批量向量化 */}
        <div className="border-t border-ink-200 p-2">
          <div className="rounded border border-ink-100 bg-white px-3 py-2">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium">全量 RAG 索引</span>
              {embedStats && (
                <span className="text-[11px] text-ink-400">
                  {embedStats.chapters} 章 / {embedStats.segments} 段已向量化
                </span>
              )}
            </div>
            <div className="mt-1 flex items-center gap-2">
              <button
                type="button"
                disabled={embedding}
                className={`rounded border px-2 py-1 text-[11px] ${
                  embedding ? 'border-ink-100 text-ink-300' : 'border-ink-200 hover:bg-ink-100'
                }`}
                onClick={() => void runEmbedAll()}
              >
                {embedding ? '向量化中…' : '批量向量化全书'}
              </button>
              {embedMsg && (
                <span className="min-w-0 truncate text-[11px] text-ink-400">{embedMsg}</span>
              )}
            </div>
          </div>
        </div>
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
          {snap.model && (
            <span className="rounded bg-violet-50 px-1.5 py-0.5 text-violet-600" title="本次调用实际使用的模型（模型分工路由结果）">
              {snap.model}
            </span>
          )}
          <span>
            {modeLabel[snap.mode] ?? snap.mode} · 共 {snap.totalTokens} tok
          </span>
          <button type="button" className="rounded border border-ink-200 px-1.5 py-0.5 hover:bg-ink-100" onClick={refresh}>
            刷新
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-2 text-xs">
        {/* P2.1-M1：全局提示词 */}
        <Section
          title={`全局提示词（${ctx.globalPrompts?.length ?? 0}）`}
          tokens={tokensOf('globalPrompts')}
          truncated={truncatedOf('globalPrompts')}
        >
          {(ctx.globalPrompts ?? []).length === 0 ? (
            <Empty text="未注入全局提示词（可在设置页配置）" />
          ) : (
            <ul className="space-y-1">
              {(ctx.globalPrompts ?? []).map((g, i) => (
                <li key={i} className="flex items-start gap-2">
                  <span className="rounded bg-amber-50 px-1 text-[10px] text-amber-600">优先</span>
                  <span className="text-ink-600">{g}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* P2.1-M2：作者指定引用（强制注入，不受检索影响） */}
        <Section
          title={`作者指定引用（${ctx.forcedRefs?.length ?? 0}）`}
          tokens={tokensOf('forcedRefs')}
          truncated={truncatedOf('forcedRefs')}
        >
          {(ctx.forcedRefs ?? []).length === 0 ? (
            <Empty text="正文中暂无 @ / [[ / ## 引用标记" />
          ) : (
            <ul className="space-y-1">
              {(ctx.forcedRefs ?? []).map((r) => (
                <li key={`${r.refType}:${r.refId}`} className="flex items-start gap-1">
                  <span
                    className={`rounded px-1 text-[10px] ${
                      r.refType === 'character'
                        ? 'bg-violet-50 text-violet-600'
                        : r.refType === 'worldbook'
                          ? 'bg-sky-50 text-sky-600'
                          : 'bg-emerald-50 text-emerald-600'
                    }`}
                  >
                    {r.refType === 'character' ? '角色' : r.refType === 'worldbook' ? '世界书' : '章节'}
                  </span>
                  <span className="min-w-0">
                    <span className="font-medium">{r.label}</span>
                    <span className="ml-1 text-ink-400">全文注入</span>
                    <ClampText text={r.content} />
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Section>

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

        {/* 原文片段（P2 全量 RAG，远期记忆召回） */}
        <Section
          title={`原文片段 RAG（${ctx.segments?.length ?? 0}）`}
          tokens={tokensOf('segments')}
          truncated={truncatedOf('segments')}
        >
          {(ctx.segments ?? []).length === 0 ? (
            <Empty text="本次未召回远期原文片段（章节保存后会自动向量化）" />
          ) : (
            <ul className="space-y-1">
              {(ctx.segments ?? []).map((s) => (
                <li key={s.segmentId}>
                  <span className="font-medium">《{s.chapterTitle}》</span>
                  <span className="ml-1 rounded bg-emerald-50 px-1 text-[10px] text-emerald-600">
                    {(s.score * 100).toFixed(0)}%
                  </span>
                  <span className="mt-0.5 block line-clamp-2 text-ink-400">{s.excerpt}</span>
                </li>
              ))}
            </ul>
          )}
        </Section>

        {/* G1：全书大纲（前瞻约束） */}
        <Section title="全书大纲" tokens={tokensOf('bookOutline')} truncated={truncatedOf('bookOutline')}>
          {!ctx.bookOutline ? (
            <Empty text="未注入全书大纲（未编写，或「大纲」弹窗中已关闭注入开关）" />
          ) : (
            <ClampText text={ctx.bookOutline} />
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
                  <ClampText text={s.summary} />
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

        {/* P7.3b：会话块轨迹（仅会话续写注入；按消息序列展示） */}
        <Section
          title={`会话块轨迹（${ctx.history?.length ?? 0} 条）`}
          tokens={tokensOf('history')}
          truncated={truncatedOf('history')}
        >
          {(ctx.history ?? []).length === 0 ? (
            <Empty text="未注入会话轨迹（未开启多轮会话，或当前无进行中的会话块）" />
          ) : (
            <ul className="space-y-1">
              {(ctx.history ?? []).map((m, i) => (
                <li key={i} className="flex items-start gap-1">
                  <span
                    className={`shrink-0 rounded px-1 text-[10px] ${
                      m.role === 'user' ? 'bg-amber-50 text-amber-600' : 'bg-violet-50 text-violet-600'
                    }`}
                  >
                    {m.role === 'user' ? '要求' : '上轮'}
                  </span>
                  <ClampText text={m.content} />
                </li>
              ))}
            </ul>
          )}
        </Section>

        <div className="mt-2 px-1 text-[11px] text-ink-400">
          快照时间：{new Date(snap.at).toLocaleTimeString()} · 生成预留 ~8000 tok 不计入
        </div>

        {/* 全量 RAG 嵌入状态 + 存量章节批量向量化 */}
        <div className="mt-1 rounded border border-ink-100 bg-white px-3 py-2">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium">全量 RAG 索引</span>
            {embedStats && (
              <span className="text-[11px] text-ink-400">
                {embedStats.chapters} 章 / {embedStats.segments} 段已向量化
              </span>
            )}
          </div>
          <div className="mt-1 flex items-center gap-2">
            <button
              type="button"
              disabled={embedding}
              className={`rounded border px-2 py-1 text-[11px] ${
                embedding
                  ? 'border-ink-100 text-ink-300'
                  : 'border-ink-200 hover:bg-ink-100'
              }`}
              onClick={() => void runEmbedAll()}
            >
              {embedding ? '向量化中…' : '批量向量化全书'}
            </button>
            {embedMsg && <span className="min-w-0 truncate text-[11px] text-ink-400">{embedMsg}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}
