import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';
import { initApp } from './context/app-context';
import { ErrorBoundary } from './components/common/ErrorBoundary';
import './index.css';

async function bootstrap(): Promise<void> {
  try {
    await initApp();
  } catch (e) {
    console.error('应用初始化失败', e);
    document.getElementById('root')!.innerHTML =
      '<div style="padding:40px;font-family:sans-serif;color:#b91c1c">应用初始化失败：请在 Tauri 环境中运行（npm run tauri dev）。</div>';
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

void bootstrap();
