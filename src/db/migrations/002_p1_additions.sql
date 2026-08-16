-- P1 迁移: 002_p1_additions.sql

-- 章节摘要链：摘要生成时间 + 生成时的源字数（用于判断摘要是否过期）
ALTER TABLE chapters ADD COLUMN summary_generated_at INTEGER;
ALTER TABLE chapters ADD COLUMN summary_source_words INTEGER;

-- 角色关系表
CREATE TABLE relationships (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  from_character_id TEXT NOT NULL,
  to_character_id TEXT NOT NULL,
  type TEXT NOT NULL,
  description TEXT,
  bidirectional INTEGER DEFAULT 1,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY (from_character_id) REFERENCES characters(id) ON DELETE CASCADE,
  FOREIGN KEY (to_character_id) REFERENCES characters(id) ON DELETE CASCADE
);
CREATE INDEX idx_relationships_book ON relationships(book_id);
CREATE INDEX idx_relationships_character ON relationships(from_character_id, to_character_id);

-- 写作统计表（date 为 YYYY-MM-DD；words_written 为当日增量字数之和；session_duration 为当日累计秒数）
CREATE TABLE writing_stats (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  date TEXT NOT NULL,
  words_written INTEGER DEFAULT 0,
  chapters_worked TEXT,
  session_duration INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);
CREATE INDEX idx_stats_book_date ON writing_stats(book_id, date);

-- 写作目标表
CREATE TABLE writing_goals (
  book_id TEXT PRIMARY KEY,
  daily_target INTEGER DEFAULT 3000,
  total_target INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

-- 世界书向量嵌入表
-- 说明：embedding 为 base64 编码的 Float32Array 文本（规避 BLOB 经 Rust 转 UTF-8 字符串的丢失）；
-- 检索在 JS 侧做余弦相似度 top-K（每书条目量级小，性能足够，无需 sqlite-vec 原生扩展）
CREATE TABLE worldbook_embeddings (
  entry_id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  embedding TEXT NOT NULL,
  dim INTEGER NOT NULL,
  model TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (entry_id) REFERENCES worldbook_entries(id) ON DELETE CASCADE
);
CREATE INDEX idx_embeddings_book ON worldbook_embeddings(book_id);

-- 应用级键值设置（如 embedding.providerConfigId / embedding.model）
CREATE TABLE app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
