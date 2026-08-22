-- P4.1 地图重设计：全局素材库（跨书共享，不建外键）
CREATE TABLE IF NOT EXISTS map_assets (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT '自定义',
  tags TEXT DEFAULT '[]',
  file_name TEXT NOT NULL,
  width INTEGER DEFAULT 0,
  height INTEGER DEFAULT 0,
  mime TEXT NOT NULL,
  usage TEXT NOT NULL DEFAULT 'stamp',
  builtin INTEGER DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_map_assets_cat ON map_assets(usage, category);

-- MapData v2（tileLayers 多层瓦片）走 maps.data JSON + migrateMapData，不动 maps 表
