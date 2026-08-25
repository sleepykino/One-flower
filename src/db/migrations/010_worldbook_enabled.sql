-- P3 设定面板改进：世界书条目启用/禁用开关
-- 禁用条目不参与 AI 上下文注入、RAG 检索/向量化、一致性检查与 [[ 新增引用列表
ALTER TABLE worldbook_entries ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1;
