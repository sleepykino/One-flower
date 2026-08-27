-- P2 迁移: 003_p2_additions.sql

-- 地图（数据以 Konva JSON 存 data 列，宽高为画布尺寸）
CREATE TABLE IF NOT EXISTS maps (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  name TEXT NOT NULL,
  width INTEGER DEFAULT 1200,
  height INTEGER DEFAULT 800,
  background_path TEXT,
  data TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_maps_book ON maps(book_id);

-- 时间线事件
CREATE TABLE IF NOT EXISTS timeline_events (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT,
  timeline TEXT DEFAULT 'main',
  sort_order INTEGER NOT NULL,
  chapter_id TEXT,
  character_ids TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_timeline_book ON timeline_events(book_id, timeline, sort_order);

-- 章节原文片段（全量 RAG 用；id = chapterId_contentHash，内容不变则复用，天然增量）
CREATE TABLE IF NOT EXISTS chapter_segments (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  content TEXT NOT NULL,
  start_pos INTEGER,
  end_pos INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_segments_chapter ON chapter_segments(chapter_id);
CREATE INDEX IF NOT EXISTS idx_segments_book ON chapter_segments(book_id);

-- 章节片段向量（base64 Float32 文本，与 P1 worldbook_embeddings 同模式，JS 侧余弦检索）
CREATE TABLE IF NOT EXISTS chapter_segments_embeddings (
  segment_id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  embedding TEXT NOT NULL,
  dim INTEGER NOT NULL,
  model TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (segment_id) REFERENCES chapter_segments(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_seg_emb_book ON chapter_segments_embeddings(book_id);

-- 章节摘要向量（摘要链检索路）
CREATE TABLE IF NOT EXISTS chapter_summary_embeddings (
  chapter_id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  embedding TEXT NOT NULL,
  dim INTEGER NOT NULL,
  model TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_sum_emb_book ON chapter_summary_embeddings(book_id);

-- 命名生成器收藏
CREATE TABLE IF NOT EXISTS name_favorites (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  name TEXT NOT NULL,
  meaning TEXT,
  type TEXT NOT NULL,
  genre TEXT,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_name_fav_book ON name_favorites(book_id);
