-- M7 长文会话增强：接缝自检结果持久化（优化批次4建议2）
-- seams: JSON: SeamIssue[]；接缝自检完成后与 status=done 同步落库，
-- 重启/进程退出后仍可展示遗留会话的接缝问题（getSeamIssues 内存 Map 清空后回退读此列）
ALTER TABLE longform_sessions ADD COLUMN seams TEXT;