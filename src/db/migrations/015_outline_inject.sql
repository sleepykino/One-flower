-- G1 大纲注入开关：关闭后全书大纲不再注入续写 / 改写 / 对白 / 检查 / 长文节拍规划（默认开启，兼容旧库）
ALTER TABLE books ADD COLUMN outline_inject_enabled INTEGER NOT NULL DEFAULT 1;