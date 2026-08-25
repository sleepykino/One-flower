-- 完整 Schema 参考（权威版本与 migrations/001_init.sql + 002_p1_additions.sql 合并一致）
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS books (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  genre TEXT,
  author TEXT,
  cover_path TEXT,
  storage_dir TEXT NOT NULL,
  enabled_skills TEXT,
  provider_config_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS chapters (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  parent_id TEXT,
  title TEXT NOT NULL,
  outline TEXT,
  status TEXT DEFAULT 'draft',
  sort_order INTEGER NOT NULL,
  word_count INTEGER DEFAULT 0,
  content_path TEXT,
  summary TEXT,
  summary_generated_at INTEGER,
  summary_source_words INTEGER,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_chapters_book ON chapters(book_id, sort_order);

CREATE TABLE IF NOT EXISTS characters (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  name TEXT NOT NULL,
  schema_id TEXT,
  data TEXT NOT NULL,
  tags TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_characters_book ON characters(book_id);

CREATE TABLE IF NOT EXISTS character_schemas (
  id TEXT PRIMARY KEY,
  book_id TEXT,
  name TEXT NOT NULL,
  schema_json TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS worldbook_entries (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  title TEXT NOT NULL,
  category TEXT,
  content TEXT NOT NULL,
  tags TEXT,
  enabled INTEGER NOT NULL DEFAULT 1,   -- 1=启用（参与 AI 注入/RAG/引用）；0=禁用（migration 010）
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_worldbook_book ON worldbook_entries(book_id);

CREATE TABLE IF NOT EXISTS chapter_versions (
  id TEXT PRIMARY KEY,
  chapter_id TEXT NOT NULL,
  diff_json TEXT NOT NULL,
  word_count INTEGER,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_versions_chapter ON chapter_versions(chapter_id, created_at DESC);

CREATE TABLE IF NOT EXISTS foreshadowings (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  description TEXT NOT NULL,
  planted_chapter_id TEXT,
  resolved_chapter_id TEXT,
  status TEXT DEFAULT 'planted',
  created_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE VIRTUAL TABLE IF NOT EXISTS chapters_fts USING fts5(
  chapter_id UNINDEXED,
  book_id UNINDEXED,
  title,
  content,
  tokenize = 'unicode61'
);

CREATE TABLE IF NOT EXISTS provider_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  provider TEXT NOT NULL,
  base_url TEXT,
  model TEXT NOT NULL,
  is_default INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS skills_cache (
  name TEXT PRIMARY KEY,
  dir_path TEXT NOT NULL,
  description TEXT,
  applies_to TEXT,
  priority INTEGER DEFAULT 0,
  body TEXT,
  loaded_at INTEGER NOT NULL
);

-- ===== P1 新增（与 migrations/002_p1_additions.sql 一致） =====

CREATE TABLE IF NOT EXISTS relationships (
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
CREATE INDEX IF NOT EXISTS idx_relationships_book ON relationships(book_id);
CREATE INDEX IF NOT EXISTS idx_relationships_character ON relationships(from_character_id, to_character_id);

CREATE TABLE IF NOT EXISTS writing_stats (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  date TEXT NOT NULL,
  words_written INTEGER DEFAULT 0,
  chapters_worked TEXT,
  session_duration INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_stats_book_date ON writing_stats(book_id, date);

CREATE TABLE IF NOT EXISTS writing_goals (
  book_id TEXT PRIMARY KEY,
  daily_target INTEGER DEFAULT 3000,
  total_target INTEGER DEFAULT 0,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS worldbook_embeddings (
  entry_id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  embedding TEXT NOT NULL,
  dim INTEGER NOT NULL,
  model TEXT,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (entry_id) REFERENCES worldbook_entries(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_embeddings_book ON worldbook_embeddings(book_id);

CREATE TABLE IF NOT EXISTS app_settings (
  key TEXT PRIMARY KEY,
  value TEXT
);
