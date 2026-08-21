/**
 * 通用生图对话框（P3）
 * 两段式提示词：中文场景描述 -> 对话模型（image-prompt 路由）转写专业图片 prompt；
 * 高级模式可手写覆盖；多候选（1-4 张）挑选后才入库，未选中的不落盘
 */

import { useEffect, useRef, useState } from 'react';
import { getAppContext } from '../../context/app-context';
import { resolveImageProvider } from '../../services/ai/providers/ImageProvider';
import type { ImageSize } from '../../services/ai/providers/ImageProvider';
import { IMAGE_SIZES, MAX_IMAGE_CANDIDATES } from '../../services/ai/providers/ImageProvider';
import { sceneDescription } from '../../services/image/ImagePromptService';
import type { ImageAsset, ImageScene, ImageUsage } from '../../services/image/types';

interface Candidate {
  url: string; // object URL（预览用，未入库）
  mimeType: string;
  bytes: Uint8Array;
  revisedPrompt?: string;
}

interface Props {
  bookId: string;
  scene: ImageScene;
  usage: ImageUsage;
  /** usage='character' 时为角色 id */
  refId?: string | null;
  title?: string;
  onConfirm: (assets: ImageAsset[]) => void | Promise<void>;
  onClose: () => void;
}

export function ImageGenDialog({ bookId, scene, usage, refId, title, onConfirm, onClose }: Props): JSX.Element {
  const { imagePromptService, imageAssetService, bridge } = getAppContext();
  const [sceneText, setSceneText] = useState(() => sceneDescription(scene));
  const [hint, setHint] = useState('');
  const [advanced, setAdvanced] = useState(false);
  const [manualPrompt, setManualPrompt] = useState('');
  const [manualNegative, setManualNegative] = useState('');
  const [size, setSize] = useState<ImageSize>('1024x1024');
  const [count, setCount] = useState(2);
  const [phase, setPhase] = useState<'config' | 'working' | 'pick'>('config');
  const [status, setStatus] = useState('');
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [finalPrompt, setFinalPrompt] = useState<{ prompt: string; negativePrompt: string } | null>(null);
  const [warning, setWarning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const objUrlsRef = useRef<string[]>([]);

  useEffect(() => {
    return () => {
      // 卸载时释放未入库候选的 object URL
      for (const u of objUrlsRef.current) URL.revokeObjectURL(u);
    };
  }, []);

  const toggleSelect = (i: number): void => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(i)) next.delete(i);
      else next.add(i);
      return next;
    });
  };

  const run = async (): Promise<void> => {
    setError(null);
    setWarning(null);
    setPhase('working');
    try {
      // 第一步：提示词（高级模式手写覆盖；转写失败降级为直接使用场景描述）
      let prompt: string;
      let negativePrompt: string;
      if (advanced) {
        prompt = manualPrompt.trim();
        negativePrompt = manualNegative.trim();
        if (!prompt) throw new Error('请填写图片 prompt');
      } else {
        setStatus('正在转写提示词…');
        try {
          const r = await imagePromptService.buildPrompt(bookId, scene, hint, sceneText);
          prompt = r.prompt;
          negativePrompt = r.negativePrompt;
        } catch (e) {
          setWarning(`提示词转写失败（${e instanceof Error ? e.message : String(e)}），已直接使用场景描述生成`);
          prompt = sceneText.trim();
          negativePrompt = '';
        }
      }
      setFinalPrompt({ prompt, negativePrompt });

      // 第二步：生图（'image' 路由）
      setStatus(`正在生成 ${count} 张候选（${size}）…`);
      const { provider, model, configId } = await resolveImageProvider(bridge, bookId);
      const images = await provider.generate({ prompt, negativePrompt: negativePrompt || undefined, size, count });
      if (images.length === 0) throw new Error('生图返回为空，请重试或更换模型');

      // 释放上一轮候选
      for (const u of objUrlsRef.current) URL.revokeObjectURL(u);
      objUrlsRef.current = images.map((img) =>
        URL.createObjectURL(new Blob([img.bytes as unknown as BlobPart], { type: img.mimeType }))
      );
      setCandidates(
        images.map((img, i) => ({
          url: objUrlsRef.current[i],
          mimeType: img.mimeType,
          bytes: img.bytes,
          revisedPrompt: img.revisedPrompt
        }))
      );
      setSelected(new Set());
      setPhase('pick');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setPhase('config');
    }
  };

  const confirm = async (): Promise<void> => {
    if (selected.size === 0 || !finalPrompt) return;
    setSaving(true);
    try {
      const { configId, model } = await resolveImageProvider(bridge, bookId).catch(() => ({
        configId: null,
        model: null
      }));
      const assets: ImageAsset[] = [];
      for (const i of selected) {
        const c = candidates[i];
        if (!c) continue;
        assets.push(
          await imageAssetService.saveGenerated(bookId, c, {
            usage,
            refId: refId ?? null,
            prompt: finalPrompt.prompt,
            negativePrompt: finalPrompt.negativePrompt || null,
            providerConfigId: configId,
            model
          })
        );
      }
      await onConfirm(assets);
      // 已入库的 URL 交给 <img> 正常显示路径，此处仅释放预览 object URL
      for (const u of objUrlsRef.current) URL.revokeObjectURL(u);
      objUrlsRef.current = [];
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={phase === 'working' ? undefined : onClose}>
      <div
        className="flex max-h-[86vh] w-[560px] flex-col rounded-lg bg-white p-4 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 text-base font-medium">{title ?? 'AI 生成图片'}</div>

        {phase === 'config' && (
          <>
            <div className="mb-3 min-h-0 flex-1 overflow-y-auto">
              <div className="mb-1 text-xs font-medium text-ink-600">场景描述（中文）</div>
              <textarea
                className="mb-2 w-full rounded border border-ink-200 px-2 py-1.5 text-sm focus:border-violet-300 focus:outline-none"
                rows={4}
                value={sceneText}
                onChange={(e) => setSceneText(e.target.value)}
                placeholder="描述想要的画面：人物、场景、氛围…"
              />
              <div className="mb-1 text-xs font-medium text-ink-600">补充要求（可选）</div>
              <input
                className="mb-2 w-full rounded border border-ink-200 px-2 py-1 text-sm focus:border-violet-300 focus:outline-none"
                value={hint}
                onChange={(e) => setHint(e.target.value)}
                placeholder="风格 / 构图 / 光影等额外要求，如：水墨风格，横幅构图"
              />

              <div className="mb-2 flex items-center gap-3">
                <div>
                  <div className="mb-1 text-xs font-medium text-ink-600">尺寸</div>
                  <select
                    className="rounded border border-ink-200 px-2 py-1 text-sm"
                    value={size}
                    onChange={(e) => setSize(e.target.value as ImageSize)}
                  >
                    {IMAGE_SIZES.map((s) => (
                      <option key={s} value={s}>
                        {s}
                        {s === '1024x1536' || s === '1536x1024' ? '（横/竖版大图）' : ''}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <div className="mb-1 text-xs font-medium text-ink-600">候选数量</div>
                  <select
                    className="rounded border border-ink-200 px-2 py-1 text-sm"
                    value={count}
                    onChange={(e) => setCount(Number(e.target.value))}
                  >
                    {Array.from({ length: MAX_IMAGE_CANDIDATES }, (_, i) => i + 1).map((n) => (
                      <option key={n} value={n}>
                        {n} 张
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <label className="flex cursor-pointer items-center gap-1.5 text-sm">
                <input type="checkbox" checked={advanced} onChange={(e) => setAdvanced(e.target.checked)} />
                高级模式（手写英文 prompt，跳过转写）
              </label>
              {advanced && (
                <div className="mt-2 rounded border border-ink-100 bg-ink-50 p-2">
                  <textarea
                    className="mb-1 w-full rounded border border-ink-200 px-2 py-1 text-xs focus:border-violet-300 focus:outline-none"
                    rows={3}
                    value={manualPrompt}
                    onChange={(e) => setManualPrompt(e.target.value)}
                    placeholder="prompt：English prompt, comma separated keywords…"
                  />
                  <input
                    className="w-full rounded border border-ink-200 px-2 py-1 text-xs focus:border-violet-300 focus:outline-none"
                    value={manualNegative}
                    onChange={(e) => setManualNegative(e.target.value)}
                    placeholder="negative prompt（可选）：lowres, blurry, bad anatomy…"
                  />
                </div>
              )}
              <div className="mt-2 text-[11px] text-ink-400">
                将生成 {count} 张候选（{size}），仅勾选的图片会入库；转写与生图模型可在设置页「模型分工」分别配置。
              </div>
            </div>

            {warning && (
              <div className="mb-2 rounded bg-amber-50 px-2 py-1.5 text-xs text-amber-700">{warning}</div>
            )}
            {error && <div className="mb-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-600">{error}</div>}

            <div className="flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
                onClick={onClose}
              >
                取消
              </button>
              <button
                type="button"
                className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700"
                onClick={() => void run()}
              >
                生成（{count} 张候选）
              </button>
            </div>
          </>
        )}

        {phase === 'working' && (
          <div className="flex flex-col items-center justify-center gap-3 py-12">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-violet-200 border-t-violet-600" />
            <div className="text-sm text-ink-600">{status || '生成中…'}</div>
          </div>
        )}

        {phase === 'pick' && (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto">
              <div className="mb-2 text-xs text-ink-500">
                勾选满意的候选后入库（未选中的不会保存）：
              </div>
              <div className="grid grid-cols-2 gap-2">
                {candidates.map((c, i) => (
                  <button
                    key={i}
                    type="button"
                    className={`relative overflow-hidden rounded border-2 transition ${
                      selected.has(i) ? 'border-violet-500 ring-2 ring-violet-200' : 'border-ink-100 hover:border-violet-300'
                    }`}
                    onClick={() => toggleSelect(i)}
                  >
                    <img src={c.url} alt={`候选 ${i + 1}`} className="max-h-52 w-full object-contain" />
                    <span
                      className={`absolute left-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded border text-[11px] ${
                        selected.has(i)
                          ? 'border-violet-500 bg-violet-600 text-white'
                          : 'border-ink-300 bg-white/80 text-transparent'
                      }`}
                    >
                      ✓
                    </span>
                  </button>
                ))}
              </div>
              {finalPrompt && (
                <details className="mt-2 rounded bg-ink-50 px-2 py-1.5 text-[11px] text-ink-500">
                  <summary className="cursor-pointer">使用的 prompt</summary>
                  <div className="mt-1 break-all">{finalPrompt.prompt}</div>
                  {finalPrompt.negativePrompt && (
                    <div className="mt-1 break-all text-red-400">负面：{finalPrompt.negativePrompt}</div>
                  )}
                </details>
              )}
            </div>

            {error && <div className="mt-2 rounded bg-red-50 px-2 py-1.5 text-xs text-red-600">{error}</div>}

            <div className="mt-3 flex justify-end gap-2">
              <button
                type="button"
                className="rounded border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
                disabled={saving}
                onClick={() => setPhase('config')}
              >
                返回调整
              </button>
              <button
                type="button"
                className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700 disabled:opacity-40"
                disabled={selected.size === 0 || saving}
                onClick={() => void confirm()}
              >
                {saving ? '入库中…' : `入库所选 ${selected.size} 张`}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
