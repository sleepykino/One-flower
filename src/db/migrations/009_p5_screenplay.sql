-- P5 剧本工作台：剧本主表（行 + data JSON 模式，同 maps 表；结构演化不动表）
CREATE TABLE IF NOT EXISTS screenplays (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  title TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',   -- draft/outlining/generating/review/done
  source_range TEXT,                       -- JSON {fromChapterId,toChapterId}
  data TEXT NOT NULL,                      -- JSON: ScreenplayDoc（episodes/scenes/shots/dialogue）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_screenplays_book ON screenplays(book_id, updated_at DESC);

-- 分镜图不入新表：images 表 usage 扩展值 'storyboard'，ref_id = shot.id
-- 转化进度存 screenplays.status + scene.status（data 内），不建独立会话表
