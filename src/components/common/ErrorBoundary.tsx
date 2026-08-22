/**
 * 全局错误边界：渲染期异常不再白屏整个应用
 * - 根部使用：显示错误卡片 + 重载按钮
 * - overlay 使用：传 onClose，崩溃只关闭浮窗不炸全 app（地图/剧本工作台等重组件建议包裹）
 */

import React from 'react';

interface Props {
  children: React.ReactNode;
  /** 错误卡片标题（如「地图编辑器出错了」） */
  title?: string;
  /** overlay 场景：提供后显示「关闭窗口」按钮（由父级卸载本边界） */
  onClose?: () => void;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends React.Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('[ErrorBoundary] 渲染崩溃:', error, info.componentStack);
  }

  private reset = (): void => {
    this.setState({ error: null });
  };

  render(): JSX.Element | null {
    const { error } = this.state;
    if (!error) return this.props.children as JSX.Element;
    return (
      <div className="flex h-full w-full items-center justify-center bg-ink-50 p-6">
        <div className="w-full max-w-xl rounded-lg border border-red-200 bg-white p-5 shadow-lg">
          <div className="mb-2 text-base font-medium text-red-700">
            {this.props.title ?? '界面出错了'}
          </div>
          <div className="mb-3 text-xs leading-5 text-ink-500">
            渲染过程中发生异常，你的数据已自动保存、不会丢失。可以重试本界面，或关闭后重新打开。
          </div>
          <pre className="mb-4 max-h-40 overflow-auto rounded bg-ink-50 p-2 text-[11px] leading-4 text-red-600">
            {error.message}
            {error.stack ? `\n${error.stack.split('\n').slice(1, 4).join('\n')}` : ''}
          </pre>
          <div className="flex justify-end gap-2">
            {this.props.onClose && (
              <button
                type="button"
                className="rounded border border-ink-200 px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-100"
                onClick={this.props.onClose}
              >
                关闭窗口
              </button>
            )}
            <button
              type="button"
              className="rounded bg-violet-600 px-4 py-1.5 text-sm text-white hover:bg-violet-700"
              onClick={this.reset}
            >
              重试
            </button>
            <button
              type="button"
              className="rounded border border-ink-200 px-3 py-1.5 text-sm text-ink-600 hover:bg-ink-100"
              onClick={() => window.location.reload()}
            >
              重载应用
            </button>
          </div>
        </div>
      </div>
    );
  }
}
