-- P6 数据安全与书架：回收站软删除 + 置顶 + 手动排序
-- 回收站不建新表：books 行原地保留（关联表/目录零改动），trash/restore 只动 deleted_at 一列
ALTER TABLE books ADD COLUMN deleted_at INTEGER;

-- 置顶与手动排序
ALTER TABLE books ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0;
ALTER TABLE books ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;

-- 手动排序初始序 = 创建时间（毫秒），旧书按创建先后排，避免全 0 导致顺序不稳定
UPDATE books SET sort_order = created_at;
