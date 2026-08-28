-- G4：AI 用量流水（累计统计）
-- 每次对话类 LLM 调用一条记录：chat() 优先取 API 返回 usage，stream() 与缺失 usage 时按字符估算（estimated=1）
-- 不记录嵌入（embed）与生图（ComfyUI/图片 API）调用——后者为按张计费的另一成本模型

CREATE TABLE IF NOT EXISTS ai_usage (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ts INTEGER NOT NULL,                          -- 时间戳（ms）
  book_id TEXT,                                 -- 书籍上下文；NULL = 无书（全局任务）
  feature TEXT NOT NULL,                        -- 功能点（FeatureKey，如 continue / summary / longform-draft）
  config_id TEXT,                               -- Provider 配置 id（provider_configs.id）
  model TEXT,                                   -- 实际请求的模型名
  prompt_tokens INTEGER NOT NULL DEFAULT 0,
  completion_tokens INTEGER NOT NULL DEFAULT 0,
  estimated INTEGER NOT NULL DEFAULT 0          -- 1 = 字符估算（非 API usage）
);

CREATE INDEX IF NOT EXISTS idx_ai_usage_ts ON ai_usage(ts);
CREATE INDEX IF NOT EXISTS idx_ai_usage_book ON ai_usage(book_id);
CREATE INDEX IF NOT EXISTS idx_ai_usage_feature ON ai_usage(feature);
