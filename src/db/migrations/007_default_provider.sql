-- P3.1 增量：Provider 默认模型标记
-- 未绑定功能（模型分工）时的后备配置改为「被标记为默认的配置」，无标记时回退第一组
ALTER TABLE provider_configs ADD COLUMN is_default INTEGER NOT NULL DEFAULT 0;
