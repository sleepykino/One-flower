/**
 * SettingFactsView（P2.1-M6）：世界书面板"设定事实"标签页
 * domain 分组折叠 / kind 徽标 / 置信度 / 豁免 / 删除 / 推导链展开 / 抽取与推导（任务中心后台）
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { getAppContext } from '../../context/app-context';
import { confirmDialog } from '../../native/dialog';
import { useTaskStore } from '../../store/taskStore';
import type { InferenceChainItem, SettingFact } from '../../services/consistency/types';

const KIND_LABEL: Record<SettingFact['kind'], string> = {
  object: '物件',
  technology: '技术',
  social: '社会',
  magic: '魔法',
  geography: '地理',
  other: '其他'
};

const SOURCE_LABEL: Record<SettingFact['source'], string> = {
  worldbook: '世界书',
  character: '角色卡',
  chapter: '章节'
};

export function SettingFactsView({ bookId }: { bookId: string }): JSX.Element {
  const [facts, setFacts] = useState<SettingFact[]>([]);
  const [chains, setChains] = useState<InferenceChainItem[]>([]);
  const [openDomains, setOpenDomains] = useState<Set<string>>(new Set());
  const [expandedFacts, setExpandedFacts] = useState<Set<string>>(new Set());
  const [notice, setNotice] = useState('');
  const tasks = useTaskStore((s) => s.tasks);

  const load = useCallback((): void => {
    const { inferenceService } = getAppContext();
    void inferenceService.listFacts(bookId).then(setFacts);
    void inferenceService.listChains(bookId).then(setChains);
  }, [bookId]);

  useEffect(() => {
    load();
  }, [load]);

  // 任务中心：相关任务结束后自动刷新结果
  const busy = tasks.some(
    (t) => (t.kind === 'fact-extract' || t.kind === 'inference') && t.status === 'running'
  );
  useEffect(() => {
    if (!busy) load();
  }, [busy, load]);

  const byDomain = useMemo(() => {
    const map = new Map<string, SettingFact[]>();
    for (const f of facts) {
      const list = map.get(f.domain) ?? [];
      list.push(f);
      map.set(f.domain, list);
    }
    return [...map.entries()];
  }, [facts]);

  const chainsOf = (factId: string): InferenceChainItem[] =>
    chains.filter((c) => c.factId === factId);

  /** 抽取事实：先弹范围与预计调用数确认 */
  const startExtract = async (): Promise<void> => {
    const { inferenceService } = getAppContext();
    const scope = await inferenceService.extractionScope(bookId);
    const ok = await confirmDialog(
      `抽取范围：世界书 ${scope.worldbookEntries} 条 / 角色卡 ${scope.characters} 张 / 章节 ${scope.chapters} 章。\n预计 LLM 调用约 ${scope.extractCalls} 次，将后台运行（可在任务中心取消）。确认开始？`
    );
    if (!ok) return;
    inferenceService.extractFacts(bookId);
    setNotice('事实抽取已开始（任务中心可查看进度）');
  };

  /** 推导前提链：确认非豁免领域数与调用数 */
  const startInfer = async (): Promise<void> => {
    const { inferenceService } = getAppContext();
    const scope = await inferenceService.extractionScope(bookId);
    if (scope.domains === 0) {
      setNotice('暂无可推导的非豁免事实，请先抽取事实');
      return;
    }
    const ok = await confirmDialog(
      `将对 ${scope.domains} 个领域逐个推导前提链，预计 LLM 调用 ${scope.domains} 次（重新推导会替换现有推导链）。确认开始？`
    );
    if (!ok) return;
    inferenceService.inferChains(bookId);
    setNotice('前提链推导已开始（任务中心可查看进度）');
  };

  const toggleExempt = (f: SettingFact): void => {
    void getAppContext()
      .inferenceService.setExempt(f.id, !f.exempt)
      .then(load);
  };

  const removeFact = (f: SettingFact): void => {
    void confirmDialog(`删除事实「${f.fact}」及其推导链？`).then((ok) => {
      if (ok) void getAppContext().inferenceService.deleteFact(f.id).then(load);
    });
  };

  const toggleDomain = (d: string): void => {
    setOpenDomains((s) => {
      const next = new Set(s);
      if (next.has(d)) next.delete(d);
      else next.add(d);
      return next;
    });
  };

  return (
    <div className="flex h-full flex-col">
      {/* 顶部操作 */}
      <div className="border-b border-ink-200 px-2 py-2">
        <div className="flex items-center gap-2">
          <span className="text-xs font-medium">设定事实（{facts.length}）</span>
          <span className="text-[10px] text-ink-400">推导链 {chains.length}</span>
        </div>
        <div className="mt-1 flex gap-1">
          <button
            type="button"
            disabled={busy}
            className="rounded bg-violet-600 px-2 py-1 text-[11px] text-white hover:bg-violet-700 disabled:opacity-40"
            onClick={() => void startExtract()}
          >
            抽取事实
          </button>
          <button
            type="button"
            disabled={busy || facts.length === 0}
            className="rounded border border-ink-200 px-2 py-1 text-[11px] hover:bg-ink-100 disabled:opacity-40"
            onClick={() => void startInfer()}
          >
            推导前提链
          </button>
          {busy && <span className="self-center text-[10px] text-violet-600">后台运行中…</span>}
        </div>
        {notice && <div className="mt-1 text-[10px] text-ink-400">{notice}</div>}
      </div>

      {/* domain 分组列表 */}
      <div className="flex-1 overflow-y-auto p-2 text-xs">
        {byDomain.length === 0 && (
          <div className="px-2 py-6 text-center leading-6 text-ink-400">
            暂无设定事实。点击「抽取事实」从世界书 / 角色卡 / 章节中
            <br />
            抽取可核验事实，作为一致性检查的"时代感基线"。
          </div>
        )}
        {byDomain.map(([domain, list]) => (
          <div key={domain} className="mb-1 rounded border border-ink-100 bg-white">
            <button
              type="button"
              className="flex w-full items-center gap-2 px-2 py-1.5 text-left hover:bg-ink-50"
              onClick={() => toggleDomain(domain)}
            >
              <span className={`text-ink-400 transition-transform ${openDomains.has(domain) ? 'rotate-90' : ''}`}>▶</span>
              <span className="font-medium">{domain}</span>
              <span className="text-ink-400">{list.length} 条</span>
              {list.some((f) => f.exempt) && (
                <span className="rounded bg-amber-50 px-1 text-[10px] text-amber-600">
                  含豁免 {list.filter((f) => f.exempt).length}
                </span>
              )}
            </button>
            {openDomains.has(domain) && (
              <div className="border-t border-ink-100 px-2 py-1.5">
                {list.map((f) => {
                  const fc = chainsOf(f.id);
                  return (
                    <div key={f.id} className="mb-1.5 rounded bg-ink-50/60 px-2 py-1.5">
                      <div className="flex items-center gap-1.5">
                        <span className="rounded bg-sky-50 px-1 text-[10px] text-sky-600">
                          {KIND_LABEL[f.kind]}
                        </span>
                        <span className={`min-w-0 flex-1 font-medium ${f.exempt ? 'text-ink-400 line-through' : ''}`}>
                          {f.fact}
                        </span>
                        {/* 置信度条 */}
                        <span
                          className="h-1.5 w-10 overflow-hidden rounded bg-ink-200"
                          title={`置信度 ${(f.confidence * 100).toFixed(0)}%`}
                        >
                          <span
                            className="block h-full rounded bg-emerald-500"
                            style={{ width: `${Math.round(f.confidence * 100)}%` }}
                          />
                        </span>
                      </div>
                      <div className="mt-0.5 flex items-start gap-1.5 text-[10px] text-ink-400">
                        <span>{SOURCE_LABEL[f.source]}</span>
                        <span className="min-w-0 flex-1 break-all">依据：{f.basis}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <label className="flex cursor-pointer items-center gap-1 text-[10px] text-amber-700" title="架空豁免：不计入基线，并级联豁免其推导链">
                          <input
                            type="checkbox"
                            checked={f.exempt}
                            onChange={() => toggleExempt(f)}
                          />
                          架空豁免
                        </label>
                        {fc.length > 0 && (
                          <button
                            type="button"
                            className="text-[10px] text-violet-600 hover:underline"
                            onClick={() =>
                              setExpandedFacts((s) => {
                                const next = new Set(s);
                                if (next.has(f.id)) next.delete(f.id);
                                else next.add(f.id);
                                return next;
                              })
                            }
                          >
                            {expandedFacts.has(f.id) ? '收起推导链' : `推导链（${fc.length}）`}
                          </button>
                        )}
                        <button
                          type="button"
                          className="ml-auto text-[10px] text-ink-400 hover:text-red-600"
                          onClick={() => removeFact(f)}
                        >
                          删除
                        </button>
                      </div>
                      {expandedFacts.has(f.id) &&
                        fc.map((c) => (
                          <div key={c.id} className="mt-1 rounded border border-violet-100 bg-violet-50/40 px-2 py-1 text-[10px] leading-5">
                            <span className="font-medium text-violet-700">{c.premise}</span>
                            <span className="mx-1 text-ink-400">-&gt;</span>
                            <span>{c.conclusion}</span>
                            <span className="ml-1 text-ink-400">（{(c.confidence * 100).toFixed(0)}%）</span>
                          </div>
                        ))}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="border-t border-ink-200 px-2 py-1.5 text-[10px] leading-5 text-ink-400">
        基线说明：非豁免事实与推导链会注入「检查」模式，报告正文中的越级技术/社会矛盾。
      </div>
    </div>
  );
}
