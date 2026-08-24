import { BrowserRouter, Route, Routes } from 'react-router-dom';
import { Home } from './routes/Home';
import { Editor } from './routes/Editor';
import { Settings } from './routes/Settings';
import { Inspiration } from './routes/Inspiration';
import { ToastHost } from './components/common/toast';

export default function App(): JSX.Element {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        <Route path="/editor/:bookId" element={<Editor />} />
        <Route path="/inspiration" element={<Inspiration />} />
        <Route path="/settings" element={<Settings />} />
      </Routes>
      {/* 全局轻量通知（toast.* 的宿主） */}
      <ToastHost />
    </BrowserRouter>
  );
}
