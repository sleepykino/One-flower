-- 随手记 / 备忘录：全局（跨书共享），文本速记 + 图片附件 + 链接（链接以 markdown 文本存放）
CREATE TABLE IF NOT EXISTS notes (
  id TEXT PRIMARY KEY,
  content TEXT NOT NULL DEFAULT '',
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_notes_pinned ON notes(pinned, updated_at DESC);

-- 图片附件：文件本体存 {appDataDir}/notes/{note_id}/{file_name}，不入库
CREATE TABLE IF NOT EXISTS note_attachments (
  id TEXT PRIMARY KEY,
  note_id TEXT NOT NULL,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY (note_id) REFERENCES notes(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_note_attachments_note ON note_attachments(note_id);