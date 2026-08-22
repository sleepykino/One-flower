/**
 * 剧本编辑视图（P5，工作台 overlay 内）：左场次树 / 中结构化编辑 / 右属性与溯源
 * 编辑经 debounced 提交到 ScreenplayService（WriteQueue 串行即时保存）
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { getAppContext } from '../../context/app-context';
import {
  SHOT_SIZES,
  SHOT_SIZE_LABEL,
  screenplayStats,
  type Screenplay,
  type Scene
} from '../../services/screenplay/types';

interface Props {
  bookId: string;
  screenplay: Screenplay;
  /** 外部数据变更后由父级重建 screenplay 对象触发刷新 */
  onChanged: () => void;
  /** 溯源跳转：关闭 overlay 回编辑器对应章节 */
  onJumpChapter: (chapterId: string) => void;
  /** 逐场生成控制 */
  onGeneratePending: () => void;
}

export function ScreenplayEditor({ screenplay, onChanged, onJumpChapter, onGeneratePending }: Props): JSX.Element {
  const [selectedSceneId, setSelectedSceneId] = useState<string | null>(null);
  const [draft, setDraft] = useState<Scene | null>(null);
  const dirtyRef = useRef(false);
  const timerRef = useRef<number | null>(null);

  const flat = useMemo(
    () => screenplay.data.episodes.flatMap((ep) => ep.scenes.map((sc) => ({ ep, sc }))),
    [screenplay]
  );
  const selected = flat.find((x) => x.sc.id === selectedSceneId) ?? null;
  const stats = screenplayStats(screenplay);

  /** 选中场变化（或外部刷新且本地无未提交修改）时重置草稿 */
  useEffect(() => {
    const target = selected?.sc ?? null;
    if (!dirtyRef.current || !target || target.id !== draft?.id) {
      setDraft(target ? { ...target, shots: target.shots.map((s) => ({ ...s })) } : null);
      dirtyRef.current = false;
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedSceneId, selected?.sc]);

  /** debounced 提交（500ms） */
  const commit = (next: Scene): void => {
    dirtyRef.current = true;
    setDraft(next);
    if (timerRef.current) window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => {
      dirtyRef.current = false;
      void getAppContext()
        .screenplayService.saveScene(screenplay.id, selected!.ep.id, next)
        .then(() => onChanged())
        .catch((e) => console.warn('[Screenplay] 场保存失败:', e));
    }, 500);
  };

  const patchScene = (patch: Partial<Scene>): void => {
    if (!draft) return;
    commit({ ...draft, ...patch });
  };
  const patchShot = (shotId: string, patch: Partial<Scene['shots'][number]>): void => {
    if (!draft) return;
    commit({ ...draft, shots: draft.shots.map((s) => (s.id === shotId ? { ...s, ...patch } : s)) });
  };
  const addShot = (): void => {
    if (!draft) return;
    commit({
      ...draft,
      shots: [
        ...draft.shots,
        { id: crypto.randomUUID(), number: draft.shots.length + 1, size: 'MS', description: '', dialogue: [] }
      ]
    });
  };
  const removeShot = (shotId: string): void => {
    if (!draft) return;
    commit({
      ...draft,
      shots: draft.shots.filter((s) => s.id !== shotId).map((s, i) => ({ ...s, number: i + 1 }))
    });
  };
  const patchDialogue = (shotId: string, dlIdx: number, patch: Partial<Scene['shots'][number]['dialogue'][number]>): void => {
    if (!draft) return;
    commit({
      ...draft,
      shots: draft.shots.map((s) =>
        s.id === shotId
          ? { ...s, dialogue: s.dialogue.map((d, i) => (i === dlIdx ? { ...d, ...patch } : d)) }
          : s
      )
    });
  };
  const addDialogue = (shotId: string): void => {
    if (!draft) return;
    commit({
      ...draft,
      shots: draft.shots.map((s) =>
        s.id === shotId ? { ...s, dialogue: [...s.dialogue, { character: '', line: '' }] } : s
      )
    });
  };
  const removeDialogue = (shotId: string, dlIdx: number): void => {
    if (!draft) return;
    commit({
      ...draft,
      shots: draft.shots.map((s) => (s.id === shotId ? { ...s, dialogue: s.dialogue.filter((_, i) => i !== dlIdx) } : s))
    });
  };

  const addScene = (episodeId: string, afterSceneId?: string): void => {
    void getAppContext()
      .screenplayService.addScene(screenplay.id, episodeId, afterSceneId)
      .then((sc) => {
        if (sc) setSelectedSceneId(sc.id);
        onChanged();
      });
  };
  const removeScene = (episodeId: string, sceneId: string): void => {
    void getAppContext()
      .screenplayService.removeScene(screenplay.id, episodeId, sceneId)
      .then(() => {
        if (selectedSceneId === sceneId) setSelectedSceneId(null);
        onChanged();
      });
  };
  const moveScene = (episodeId: string, sceneId: string, delta: number): void => {
    const ep = screenplay.data.episodes.find((e) => e.id === episodeId);
    const idx = ep?.scenes.findIndex((s) => s.id === sceneId) ?? -1;
    if (idx < 0) return;
    void getAppContext()
      .screenplayService.moveScene(screenplay.id, episodeId, sceneId, idx + delta)
      .then(onChanged);
  };

  const pendingScenes = stats.scenes - stats.doneScenes;

  return (
    <div className="flex min-h-0 flex-1">
      {/* 左：场次树 */}
      <div className="w-64 shrink-0 overflow-y-auto border-r border-ink-100 bg-ink-50/40 p-2">
        {screenplay.data.episodes.map((ep) => (
          <div key={ep.id} className="mb-3">
            <div className="flex items-center gap-1.5 px-1 py-1">
              <span className="rounded bg-violet-100 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">
                第 {ep.number} 集
              </span>
              <span className="min-w-0 flex-1 truncate text-xs font-medium text-ink-700" title={ep.title}>
                {ep.title}
              </span>
              <button
                type="button"
                title="本集加一场"
                className="text-xs text-ink-400 hover:text-violet-600"
                onClick={() => addScene(ep.id, ep.scenes[ep.scenes.length - 1]?.id)}
              >
                +
              </button>
            </div>
            {ep.scenes.map((sc, i) => (
              <button
                key={sc.id}
                type="button"
                className={`mb-0.5 flex w-full items-center gap-1.5 rounded px-1.5 py-1 text-left text-xs ${
                  selectedSceneId === sc.id ? 'bg-violet-100 text-violet-800' : 'text-ink-600 hover:bg-ink-100'
                }`}
                onClick={() => setSelectedSceneId(sc.id)}
              >
                <span className="w-4 shrink-0 text-right text-[10px] text-ink-400">{i + 1}</span>
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${sc.status === 'done' ? 'bg-emerald-500' : 'bg-ink-300'}`} />
                <span className="min-w-0 flex-1 truncate">
                  <span className="text-[10px] text-ink-400">{sc.interior}·</span>
                  {sc.location}
                </span>
                <span className="shrink-0 text-[10px] text-ink-400">{sc.shots.length}镜</span>
              </button>
            ))}
            {ep.scenes.length === 0 && (
              <button
                type="button"
                className="w-full rounded border border-dashed border-ink-200 py-1 text-[11px] text-ink-400 hover:text-violet-600"
                onClick={() => addScene(ep.id)}
              >
                + 加一场
              </button>
            )}
          </div>
        ))}
        {screenplay.data.episodes.length === 0 && (
          <div className="rounded border border-dashed border-ink-200 p-3 text-center text-xs leading-5 text-ink-400">
            暂无内容。从「转化向导」生成大纲，或上方「从章节转化」。
          </div>
        )}
      </div>

      {/* 中：结构化编辑 */}
      <div className="min-w-0 flex-1 overflow-y-auto p-3">
        {!draft && (
          <div className="flex h-full items-center justify-center text-sm text-ink-400">
            {screenplay.data.episodes.length > 0 ? '左侧选择一场开始编辑' : '先通过转化向导生成大纲'}
          </div>
        )}
        {draft && selected && (
          <div className="space-y-3">
            {/* 场景头 */}
            <div className="rounded border border-ink-100 bg-white p-2.5">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded bg-ink-100 px-1.5 py-0.5 text-[11px] text-ink-500">
                  场 {selected.ep.scenes.findIndex((s) => s.id === draft.id) + 1}
                </span>
                <select
                  className="rounded border border-ink-200 px-1.5 py-1 text-sm"
                  value={draft.interior}
                  onChange={(e) => patchScene({ interior: e.target.value as 'INT' | 'EXT' })}
                >
                  <option value="INT">INT 内景</option>
                  <option value="EXT">EXT 外景</option>
                </select>
                <input
                  className="w-40 rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-300"
                  value={draft.location}
                  placeholder="地点"
                  onChange={(e) => patchScene({ location: e.target.value })}
                />
                <input
                  className="w-20 rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-300"
                  value={draft.timeOfDay}
                  placeholder="时间"
                  onChange={(e) => patchScene({ timeOfDay: e.target.value })}
                />
                <span
                  className={`ml-auto rounded px-1.5 py-0.5 text-[11px] ${
                    draft.status === 'done' ? 'bg-emerald-100 text-emerald-700' : 'bg-amber-100 text-amber-700'
                  }`}
                >
                  {draft.status === 'done' ? '已生成' : '待生成'}
                </span>
              </div>
              <textarea
                rows={2}
                className="mt-2 w-full resize-none rounded border border-ink-200 p-2 text-sm outline-none focus:border-violet-300"
                placeholder="本场概要（转化大纲产出，可修改；重生成只影响未完成场）"
                value={draft.synopsis}
                onChange={(e) => patchScene({ synopsis: e.target.value })}
              />
            </div>

            {/* 镜头列表 */}
            {draft.shots.map((shot, i) => (
              <div key={shot.id} className="rounded border border-ink-100 bg-white p-2.5">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-violet-50 px-1.5 py-0.5 text-[11px] font-medium text-violet-700">
                    镜 {i + 1}
                  </span>
                  <select
                    className="rounded border border-ink-200 px-1.5 py-1 text-xs"
                    value={shot.size}
                    onChange={(e) => patchShot(shot.id, { size: e.target.value as Scene['shots'][number]['size'] })}
                  >
                    {SHOT_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s} {SHOT_SIZE_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  <input
                    className="w-16 rounded border border-ink-200 px-1.5 py-1 text-xs outline-none focus:border-violet-300"
                    value={shot.camera ?? ''}
                    placeholder="运镜"
                    onChange={(e) => patchShot(shot.id, { camera: e.target.value })}
                  />
                  <input
                    type="number"
                    min={1}
                    className="w-16 rounded border border-ink-200 px-1.5 py-1 text-xs outline-none focus:border-violet-300"
                    value={shot.durationSec ?? ''}
                    placeholder="秒"
                    onChange={(e) =>
                      patchShot(shot.id, { durationSec: Number(e.target.value) > 0 ? Number(e.target.value) : undefined })
                    }
                  />
                  <button
                    type="button"
                    className="ml-auto text-xs text-ink-300 hover:text-red-600"
                    onClick={() => removeShot(shot.id)}
                  >
                    删镜头
                  </button>
                </div>
                <textarea
                  rows={2}
                  className="mt-1.5 w-full resize-none rounded border border-ink-200 p-2 text-sm outline-none focus:border-violet-300"
                  placeholder="画面描述（视觉化：人物动作、空间、氛围）"
                  value={shot.description}
                  onChange={(e) => patchShot(shot.id, { description: e.target.value })}
                />
                {/* 对白行 */}
                <div className="mt-1.5 space-y-1">
                  {shot.dialogue.map((dl, dlIdx) => (
                    <div key={dlIdx} className="flex items-start gap-1.5">
                      <input
                        className="w-24 shrink-0 rounded border border-ink-200 px-1.5 py-1 text-xs outline-none focus:border-violet-300"
                        placeholder="角色"
                        value={dl.character}
                        onChange={(e) => patchDialogue(shot.id, dlIdx, { character: e.target.value })}
                      />
                      <input
                        className="w-20 shrink-0 rounded border border-ink-200 px-1.5 py-1 text-xs text-ink-500 outline-none focus:border-violet-300"
                        placeholder="（语气）"
                        value={dl.parenthetical ?? ''}
                        onChange={(e) => patchDialogue(shot.id, dlIdx, { parenthetical: e.target.value })}
                      />
                      <textarea
                        rows={1}
                        className="min-w-0 flex-1 resize-none rounded border border-ink-200 px-1.5 py-1 text-xs outline-none focus:border-violet-300"
                        placeholder="台词"
                        value={dl.line}
                        onChange={(e) => patchDialogue(shot.id, dlIdx, { line: e.target.value })}
                      />
                      <button
                        type="button"
                        className="shrink-0 pt-1 text-xs text-ink-300 hover:text-red-600"
                        onClick={() => removeDialogue(shot.id, dlIdx)}
                      >
                        ✕
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    className="text-xs text-violet-600 hover:underline"
                    onClick={() => addDialogue(shot.id)}
                  >
                    + 对白
                  </button>
                </div>
              </div>
            ))}
            {draft.shots.length === 0 && (
              <div className="rounded border border-dashed border-ink-200 p-3 text-center text-xs text-ink-400">
                本场暂无镜头（待逐场生成，或手动添加）
              </div>
            )}
            <button
              type="button"
              className="w-full rounded border border-dashed border-ink-200 py-1.5 text-xs text-ink-500 hover:border-violet-300 hover:text-violet-600"
              onClick={addShot}
            >
              + 加镜头
            </button>
          </div>
        )}
      </div>

      {/* 右：属性与溯源 */}
      <div className="w-52 shrink-0 space-y-3 overflow-y-auto border-l border-ink-100 bg-ink-50/40 p-2.5">
        <div className="text-xs font-medium text-ink-500">本场属性</div>
        {selected && draft ? (
          <>
            <div className="rounded border border-ink-100 bg-white p-2 text-xs leading-5 text-ink-500">
              所属：第 {selected.ep.number} 集 · {selected.ep.title}
              <br />
              状态：{draft.status === 'done' ? '已生成' : '待生成'}
              <br />
              镜头：{draft.shots.length} · 对白：{draft.shots.reduce((n, s) => n + s.dialogue.length, 0)} 句
            </div>
            <div className="flex flex-col gap-1">
              <button
                type="button"
                className="rounded border border-ink-200 bg-white py-1 text-xs text-ink-600 hover:bg-ink-100"
                onClick={() => moveScene(selected.ep.id, draft.id, -1)}
              >
                上移
              </button>
              <button
                type="button"
                className="rounded border border-ink-200 bg-white py-1 text-xs text-ink-600 hover:bg-ink-100"
                onClick={() => moveScene(selected.ep.id, draft.id, 1)}
              >
                下移
              </button>
              <button
                type="button"
                className="rounded border border-red-200 bg-white py-1 text-xs text-red-600 hover:bg-red-50"
                onClick={() => removeScene(selected.ep.id, draft.id)}
              >
                删除本场
              </button>
            </div>
            <div className="text-xs font-medium text-ink-500">溯源章节</div>
            {draft.sourceChapterId ? (
              <button
                type="button"
                className="w-full rounded border border-violet-200 bg-white px-2 py-1.5 text-left text-xs text-violet-700 hover:bg-violet-50"
                onClick={() => onJumpChapter(draft.sourceChapterId!)}
                title="关闭工作台并跳回编辑器对应章节"
              >
                打开来源章节 ↗
              </button>
            ) : (
              <div className="text-xs text-ink-400">无溯源（AI 大纲未关联或手工创建）</div>
            )}
          </>
        ) : (
          <div className="text-xs text-ink-400">选择一场后显示属性与溯源。</div>
        )}

        <div className="border-t border-ink-200 pt-2">
          <div className="text-xs font-medium text-ink-500">转化进度</div>
          <div className="mt-1 text-xs leading-5 text-ink-500">
            {stats.doneScenes}/{stats.scenes} 场已完成
            {pendingScenes > 0 && (
              <>
                <br />
                <button
                  type="button"
                  className="mt-1 w-full rounded bg-violet-600 py-1 text-xs text-white hover:bg-violet-700"
                  onClick={onGeneratePending}
                >
                  {screenplay.status === 'generating' ? '生成中…（点按无重复）' : `生成剩余 ${pendingScenes} 场`}
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
