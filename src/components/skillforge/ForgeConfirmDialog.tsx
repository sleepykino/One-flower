/**
 * ForgeConfirmDialog（P7.4 M2）：一把炼化执行前的预估确认弹窗。
 * 预估明细为结构化内容，纯文本 confirmDialog 承载不佳，故用专用轻量软件内弹窗（P7.2 结论应用）。
 * 明细表：预估输入 token / 调用次数 / 预估输出 token；明示将调用模型；
 * inputTokens 超 HEAVY_INPUT_TOKENS 时高亮警示条，采样已关时给「开启采样」快捷按钮。
 */

import { AlertTriangle } from 'lucide-react';
import { HEAVY_INPUT_TOKENS } from '../../services/skill/SkillForgeService';
import type { SkillForgeEstimate } from '../../services/skill/SkillForgeService';

interface Props {
  estimate: SkillForgeEstimate;
  /** 素材来源描述（粘贴文本 / 上传文件 / 《书名》） */
  sourceLabel: string;
  /** 模型说明：'默认配置'（未绑定专用模型）或 '功能绑定' */
  modelNote: string;
  /** 当前采样开关（关闭时给「开启采样」快捷按钮） */
  sample: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  /** 「开启采样」快捷按钮：父组件改 state 后重算预估并重开弹窗 */
  onEnableSample: () => void;
}

export function ForgeConfirmDialog({
  estimate,
  sourceLabel,
  modelNote,
  sample,
  onConfirm,
  onCancel,
  onEnableSample
}: Props): JSX.Element {
  const heavy = estimate.inputTokens > HEAVY_INPUT_TOKENS;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      onClick={onCancel}
    >
      <div
        className="w-full max-w-md rounded-lg border border-ink-200 bg-white p-4 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 font-medium">确认提炼</h3>
        <p className="mb-3 text-xs text-ink-500">素材来源：{sourceLabel}</p>

        {heavy && (
          <div className="mb-3 flex items-center gap-1 rounded border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-700">
            <AlertTriangle size={13} className="shrink-0" />
            <span>预估输入超 10 万 token，建议开启智能采样（可省 80%+）</span>
            {!sample && (
              <button
                type="button"
                className="shrink-0 font-medium underline hover:text-amber-900"
                onClick={onEnableSample}
              >
                开启采样
              </button>
            )}
          </div>
        )}

        <table className="w-full text-sm">
          <tbody>
            <tr className="border-b border-ink-100">
              <td className="py-1.5 text-ink-500">预估输入 token</td>
              <td className="py-1.5 text-right font-medium">{estimate.inputTokens.toLocaleString()}</td>
            </tr>
            <tr className="border-b border-ink-100">
              <td className="py-1.5 text-ink-500">调用次数</td>
              <td className="py-1.5 text-right font-medium">
                {estimate.calls === 1 ? '1 次' : `${estimate.calls - 1} 片 + 1 次汇总`}
              </td>
            </tr>
            <tr className="border-b border-ink-100">
              <td className="py-1.5 text-ink-500">预估输出 token</td>
              <td className="py-1.5 text-right font-medium">{estimate.outputTokens.toLocaleString()}</td>
            </tr>
            <tr>
              <td className="py-1.5 text-ink-500">将调用模型</td>
              <td className="py-1.5 text-right">
                <span className="font-medium">{estimate.model}</span>
                <span className="ml-1 text-[11px] text-ink-400">（{modelNote}）</span>
              </td>
            </tr>
          </tbody>
        </table>

        <div className="mt-4 flex justify-end gap-2 border-t border-ink-100 pt-3">
          <button
            type="button"
            className="rounded border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
            onClick={onCancel}
          >
            取消
          </button>
          <button
            type="button"
            className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700"
            onClick={onConfirm}
          >
            确认执行
          </button>
        </div>
      </div>
    </div>
  );
}
