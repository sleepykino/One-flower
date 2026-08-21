-- P3 迁移：图片能力（书籍封面 / 角色卡图片 / 正文插图）

-- 图片资产元数据（文件本体存 {storageDir}/assets/，不入库）
CREATE TABLE IF NOT EXISTS images (
  id TEXT PRIMARY KEY,
  book_id TEXT NOT NULL,
  file_name TEXT NOT NULL,          -- 相对 storageDir：assets/xxx.png
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  size_bytes INTEGER NOT NULL,
  mime_type TEXT NOT NULL,
  source TEXT NOT NULL,             -- 'upload' | 'ai'
  prompt TEXT,
  negative_prompt TEXT,
  provider_config_id TEXT,
  model TEXT,
  usage TEXT NOT NULL,              -- 'cover' | 'character' | 'illustration' | 'library'
  ref_id TEXT,                      -- usage='character' 时为 character_id
  created_at INTEGER NOT NULL,
  FOREIGN KEY (book_id) REFERENCES books(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_images_book ON images(book_id, usage);

-- books.cover_path：P0 已有列，P3 启用（存相对 storageDir 路径）
-- characters：不加列，角色图片关联由 images.ref_id 维护
