/** 内置示例 Skill（首次启动种入 ~/.novelagent/skills/） */

export interface BuiltinSkill {
  name: string;
  content: string;
}

export const BUILTIN_SKILLS: BuiltinSkill[] = [
  {
    name: 'wuxia-classical',
    content: `---
name: wuxia-classical
description: 武侠小说古典文风。对白半文半白，打斗注重招式名称与意境
trigger: manual
applies_to: [continue, rewrite, dialogue]
priority: 10
---

# 文风指令

## 用词偏好
- 对白使用半文半白，避免现代口语
- 打斗描写优先使用具象招式名（如"白鹤亮翅"），不用泛化动词

## 句式
- 短句为主，长句不超过 25 字
- 段落首句即立场

## 禁忌
- 不出现现代科技词汇
- 不使用网络流行语
`
  },
  {
    name: 'mystery-first-person',
    content: `---
name: mystery-first-person
description: 悬疑小说第一人称叙事。注重心理描写与信息悬念控制
trigger: manual
applies_to: [continue, rewrite, dialogue]
priority: 8
---

# 文风指令

## 视角
- 严格第一人称，不可切换
- 只能描写"我"能感知到的信息

## 悬念控制
- 关键线索点到为止，不直接揭示
- 适当留白，让读者推理

## 节奏
- 紧张场景用短句、断句
- 心理活动用长句、复句
`
  },
  {
    name: 'hard-sf',
    content: `---
name: hard-sf
description: 硬科幻文风。技术细节严谨，注重科学逻辑自洽
trigger: manual
applies_to: [continue, rewrite, dialogue]
priority: 9
---

# 文风指令

## 技术描写
- 技术原理需符合已知物理定律
- 虚构技术需有自洽的设定基础
- 优先使用具体数值和单位

## 语言
- 叙述客观冷静
- 避免过度修辞
- 专业术语首次出现时简注
`
  }
];
