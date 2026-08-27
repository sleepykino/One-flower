-- M7 长文会话增强：作者补充提示透传 + 参与角色注入
-- hints: 节拍表初稿时的作者补充提示，持久化后透传到逐拍生成
-- character_ids: 参与生成的角色卡 id（JSON 数组，空 = 生成时默认注入本书全部角色）
ALTER TABLE longform_sessions ADD COLUMN hints TEXT;
ALTER TABLE longform_sessions ADD COLUMN character_ids TEXT;
