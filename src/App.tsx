import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Home } from './routes/Home';
import { Editor } from './routes/Editor';
import { Settings } from './routes/Settings';
import { Inspiration } from './routes/Inspiration';
import { Trash } from './routes/Trash';
import { ToastHost } from './components/common/toast';

export default function App(): JSX.Element {
  return (
    <BrowserRouter future={{ v7_startTransition: true, v7_relativeSplatPath: true }}>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/editor/:bookId" element={<Editor />} />
        <Route path="/inspiration" element={<Inspiration />} />
        <Route path="/trash" element={<Trash />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
      {/* 全局轻量通知（toast.* 的宿主） */}
      <ToastHost />
    </BrowserRouter>
  );
}
