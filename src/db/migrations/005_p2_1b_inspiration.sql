-- P2.1-B 迁移: 005_p2_1b_inspiration.sql（灵感激发包：灵感库 + 角色采访会话）

-- 灵感库（统一存储种子、收藏卡片、推演报告、采访摘要）
CREATE TABLE inspirations (
  id TEXT PRIMARY KEY,
  book_id TEXT,                -- NULL 为全局（种子/收藏卡片）；按书绑定（推演报告/采访摘要）
  type TEXT NOT NULL,          -- 'seed' | 'card' | 'whatif_report' | 'interview_summary'
  title TEXT,
  content TEXT NOT NULL,       -- JSON 序列化的完整内容
  tags TEXT,                   -- JSON array
  source TEXT DEFAULT 'ai',   -- 'builtin' | 'ai'（builtin 仅收藏的默认兜底卡）
  favorited INTEGER DEFAULT 0,
  metadata TEXT,               -- JSON: 额外元数据（如种子的 genre/elements、报告所属书籍名）
  created_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);
CREATE INDEX idx_inspirations_book_type ON inspirations(book_id, type, favorited);
CREATE INDEX idx_inspirations_type_fav ON inspirations(type, favorited);

-- 角色采访会话
CREATE TABLE interview_sessions (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  character_id TEXT NOT NULL,
  angle TEXT NOT NULL,        -- childhood/motivation/secret/relationships/event_opinion/free
  messages TEXT NOT NULL,     -- JSON array of InterviewMessage
  started_at INTEGER NOT NULL,
  ended_at INTEGER,
  saved_to_character INTEGER DEFAULT 0,  -- 用户确认「添加到角色卡」后置 1
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY (character_id) REFERENCES characters(id) ON DELETE CASCADE
);
CREATE INDEX idx_interviews_character ON interview_sessions(character_id, started_at DESC);

-- 说明：每日卡片状态与屏蔽类型存 app_settings（dailyCard.today / dailyCard.blockedTypes），
-- 不建 daily_card_views / blocked_card_types 表（卡片全部 AI 生成，无内置库轮换与查看记录需求）
