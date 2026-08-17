# OneFlower · 一花一世界

**AI 辅助的小说创作工作台**

一花一世界，创作属于你的世界。

[![License: Apache 2.0](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](./LICENSE)
[![Tauri](https://img.shields.io/badge/Tauri-2.0-FFC131?logo=tauri&logoColor=white)](https://tauri.app)
[![React](https://img.shields.io/badge/React-18-61DAFB?logo=react&logoColor=white)](https://react.dev)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/sleepykino/OneFlower/pulls)

[功能特性](#-功能特性) · [快速开始](#-快速开始) · [首次配置](#-首次配置) · [项目结构](#-项目结构) · [路线图](#-路线图)

---

## 为什么是 OneFlower

- **本地优先**：SQLite + 文件系统存储，不依赖任何云端服务，断网也能写作
- **密钥安全**：API Key 存于操作系统钥匙串，不落明文磁盘
- **模型自由**：OpenAI 兼容 / Anthropic / Google 任选，DeepSeek、智谱、Kimi 等国内服务即配即用
- **上下文透明**：每次 AI 调用注入了什么（摘要链 / 世界书 / 角色卡 / 文风），ContextPanel 一目了然，含 token 占用

## ✨ 功能特性

### ✍️ 创作与编辑

- **富文本编辑器**（TipTap）：标题 / 引用 / 对白块、字体字号设置、全文查找替换、粘贴自动清洗
- **章节树**：多卷多章树形管理、拖拽排序、摘要状态与伏笔标记（绿点埋设 / 蓝点回收）
- **@角色 / #世界书** 节点：正文中直接引用设定，随提示词自动注入
- **版本历史**：章节级快照与差异对比，随时回滚
- **导入导出**：导入 TXT / Markdown；导出 TXT / Markdown / EPUB / DOCX（含封面、目录、页眉页脚）

### 🤖 AI 辅助（四模式）

| 模式 | 说明 |
|---|---|
| **续写** | 前情摘要链 + 近章原文 + 世界书 RAG + 角色卡自动组装上下文；可填续写要求定向引导，支持字数上限与温度调节 |
| **改写** | 选中文本 + 改写要求，流式生成替换 |
| **对白** | 场景描述 + 参与角色，生成符合人物性格的对白 |
| **检查** | 章节正文与角色卡 / 世界书设定一致性审查，输出结构化矛盾报告 |

- **流式输出**：实时渲染到编辑器临时节点，可随时中断；中断后三选项（保留 / 丢弃 / 继续补完）
- **上下文可见**：ContextPanel 展示每次调用注入的完整上下文清单与 token 占用
- **文风 Skill**：Markdown 文件定义文风指令，按模式启用、按优先级排序

### 📇 设定管理

- **角色卡**：模板可视化构建器（拖拽字段 / 实时预览 / JSON 导入导出），结构化角色数据
- **角色关系图**（React Flow）：圆形布局、拖拽节点、连线建关系、点击跳转角色卡
- **世界书 RAG**：条目自动向量化（embedding），续写时余弦检索 top-3 注入
- **伏笔追踪**：埋设 / 回收 / 弃用管理，时间线可视化，未回收过滤

### 📊 写作统计

今日字数 · 目标进度 · 近 30 天趋势图 · 连续写作天数（streak）

## 🛠️ 技术栈

| 层 | 技术 |
|---|---|
| 桌面壳 | Tauri 2（Rust） |
| 前端 | React 18 + TypeScript（严格模式）+ Vite 5 |
| 状态管理 | Zustand |
| 编辑器 | TipTap / ProseMirror |
| 关系图 | @xyflow/react |
| 文档导出 | docx、fflate（EPUB 打包） |
| 样式 | Tailwind CSS |
| 存储 | SQLite（WAL + 单写队列）、系统钥匙串 |

## 🚀 快速开始

releases中有打包好的版本，可以直接下载使用。

### 环境要求

- Node.js >= 18
- Rust（stable 工具链）与 Tauri 2 系统依赖（见 [官方文档](https://tauri.app/start/prerequisites/)）
  - Windows：WebView2（Win10/11 自带）、MSVC Build Tools

### 命令

```bash
# 安装依赖
npm install

# 开发模式（自动拉起 Tauri 窗口与热更新）
npm run tauri dev

# 打包生产版本（产物在 src-tauri/target/release/bundle/）
npm run tauri build

# 仅做前端类型检查 / 构建
npm run typecheck
npm run build
```

## ⚙️ 首次配置

1. **添加模型**：设置页 → Provider 管理，新建配置（类型选 OpenAI 兼容 / Anthropic / Google，填 Base URL、模型名、API Key），点击"测试连接"验证
2. **绑定书籍**：在书籍设置中选择该 Provider；不绑定时默认使用首组配置
3. **向量嵌入（可选）**：设置页 → 向量嵌入（世界书 RAG），选择支持 embeddings 的 Provider 并填嵌入模型（如 `text-embedding-3-small`）
   - Anthropic 无 embeddings 接口
   - 更换嵌入模型后，需在世界书面板重新批量向量化
4. **文风 Skill（可选）**：将 Markdown 格式的 Skill 文件放入 `~/.novelagent/skills/`，在 Skill 面板启用并设定适用模式与优先级

## 🔒 数据存储

所有数据保存在本机，不经过任何云端：

| 数据 | 位置 |
|---|---|
| 应用数据（数据库、书籍、版本快照） | 系统应用数据目录（Windows：`%APPDATA%\com.oneflower.novelagent`） |
| 文风 Skill | `~/.novelagent/skills/` |
| API Key | 操作系统钥匙串 |

## 📁 项目结构

```
src/
  components/    # UI 组件（编辑器、章节树、AI 面板、角色/世界书/伏笔/统计面板等）
  context/       # 应用上下文（服务装配）
  db/            # SQLite 初始化、迁移（schema.sql + migrations/）、单写队列
  native/        # Tauri 桥（storage/fs/db/keyStore）、对话框封装
  routes/        # 页面（首页书架 / 编辑器 / 设置）
  services/      # 业务服务（AI 编排、提示词组装、摘要链、RAG、角色、关系、
                 #   章节、版本、导入导出、统计、Skill 加载等）
  store/         # Zustand 状态（book/editor/ai/settings）
  types/         # 共享类型定义
src-tauri/       # Rust 侧：命令、存储桥、窗口配置
doc/             # 设计文档（P0-P3 蓝图与实现规格）
```

## 🗺️ 路线图

- [x] **P0 - 核心**：编辑器、章节管理、AI 续写/改写/对白/检查、角色卡、世界书、版本历史、导入导出、文风 Skill
- [x] **P1 - 增强**：章节摘要链、世界书 RAG、角色关系图、上下文透明化、DOCX 导出、写作统计、伏笔时间线、模板构建器、流式继续补完
- [ ] **P2 / P3**：进行中

## 🤝 参与贡献

欢迎 Issue 与 PR：<https://github.com/sleepykino/OneFlower>

## 📄 许可

本项目基于 [Apache License 2.0](./LICENSE) 开源。

Copyright 2026 sleepykino
