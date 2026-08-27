-- P2.1 迁移: 004_p21_additions.sql（生成质量包：M5 节拍 / M6 设定反推 / M7 长文会话）

-- M5: 章节节拍列表（JSON 数组，null = 未启用）
ALTER TABLE chapters ADD COLUMN beats TEXT;

-- M6: 设定事实
CREATE TABLE IF NOT EXISTS setting_facts (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  kind TEXT NOT NULL,           -- object/technology/social/magic/geography/other
  domain TEXT NOT NULL,         -- 光学/航海/火药...
  fact TEXT NOT NULL,           -- "存在眼镜"
  basis TEXT NOT NULL,          -- 依据摘录："第5章：他从眼镜上方看她"
  confidence REAL DEFAULT 0.8,
  exempt INTEGER DEFAULT 0,     -- 架空豁免
  source TEXT NOT NULL,         -- worldbook/character/chapter
  source_ref TEXT NOT NULL,     -- 条目/角色/章节 id
  created_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_setting_facts_book ON setting_facts(book_id, domain);

-- M6: 推导链
CREATE TABLE IF NOT EXISTS setting_inferences (
  id TEXT PRIMARY KEY,
  fact_id TEXT NOT NULL,
  book_id TEXT NOT NULL,
  premise TEXT NOT NULL,        -- "光学玻璃工艺成熟"
  conclusion TEXT NOT NULL,     -- "望远镜与航海天文应有相应发展"
  confidence REAL DEFAULT 0.7,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (fact_id) REFERENCES setting_facts(id) ON DELETE CASCADE,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_setting_inferences_book ON setting_inferences(book_id);

-- M7: 长文会话
CREATE TABLE IF NOT EXISTS longform_sessions (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  chapter_id TEXT NOT NULL,
  status TEXT NOT NULL,         -- ready/running/paused/seam-review/done/aborted
  beats TEXT NOT NULL,          -- JSON: LongFormBeat[]
  current_beat_index INTEGER NOT NULL DEFAULT 0,
  used_tokens INTEGER NOT NULL DEFAULT 0,
  estimated_tokens INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE,
  FOREIGN KEY (chapter_id) REFERENCES chapters(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_longform_book ON longform_sessions(book_id, status);

-- M1 无迁移：全局提示词存 app_settings（key 'ai.globalPrompts' / 'ai.globalPrompts.enabled'）
