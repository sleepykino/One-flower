import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { getAppContext, initApp } from './context/app-context';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import { applyTheme, parseTheme, THEME_KEY } from './utils/theme';
import './index.css';

async function bootstrap(): Promise<void> {
  try {
    await initApp();
    // P7.5：首帧渲染前应用持久化主题（避免启动闪白）
    applyTheme(parseTheme(await getAppContext().appSettings.get(THEME_KEY)));
  } catch (e) {
    console.error('应用初始化失败', e);
    const root = document.getElementById('root')!;
    root.innerHTML = '';
    const container = document.createElement('div');
    container.style.cssText = 'padding:40px;font-family:sans-serif;max-width:720px;margin:0 auto';
    const title = document.createElement('h2');
    title.textContent = '应用初始化失败';
    title.style.cssText = 'color:#b91c1c;margin:0 0 12px;font-size:20px';
    const desc = document.createElement('p');
    desc.textContent =
      '很抱歉，应用启动时遇到了问题，暂时无法正常使用。请尝试重启应用；若问题持续出现，请将下方错误信息反馈给我。';
    desc.style.cssText = 'color:#374151;margin:0 0 12px;line-height:1.6';
    const detail = document.createElement('pre');
    detail.textContent = e instanceof Error ? e.message : String(e);
    detail.style.cssText =
      'background:#f3f4f6;padding:12px;border-radius:6px;color:#111827;overflow:auto;font-size:12px;line-height:1.5;white-space:pre-wrap;word-break:break-all;margin:0';
    container.appendChild(title);
    container.appendChild(desc);
    container.appendChild(detail);
    root.appendChild(container);
    return;
  }
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <React.StrictMode>
      <ErrorBoundary title="应用出错了">
        <App />
      </ErrorBoundary>
    </React.StrictMode>
  );
}

// 文件拖放兜底：dragDropEnabled=false 后 OS 文件拖放以 HTML5 事件进入页面，
// 未接管拖放入口的页面（设置/灵感库/回收站等）默认行为是 WebView 导航到被拖文件，
// 全局 preventDefault 使其成为无操作；具体入口（书架文档导入/正文插图）在各自
// 目标元素上先行处理，不受影响（preventDefault 幂等）。
window.addEventListener('dragover', (e) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});
window.addEventListener('drop', (e) => {
  if (e.dataTransfer?.types.includes('Files')) e.preventDefault();
});

void bootstrap();
