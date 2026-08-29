/**
 * P7.1 全部引导步骤定义（纯数据，零逻辑，文案全部中文、单步 ≤ 2 句）
 * 锚点只用 data-tour 属性与既有 data-rail-tab / data-ai-mode，禁止类名/结构选择器
 * 单点引导只锚定面板可见状态下的元素；锚点缺失超时自动跳步（见 OnboardingService）
 */

import type { Tour } from './types';

export const TOURS: Tour[] = [
  {
    id: 'welcome',
    title: '快速上手',
    trigger: 'auto',
    steps: [
      {
        title: '欢迎使用一花',
        description: '一花一世界。用 3 分钟带你认识核心流程，随时可按 Esc 跳过。',
        before: { navigate: '/' }
      },
      {
        target: '[data-tour="home-sidebar"]',
        title: '全局入口',
        description: '侧边栏汇集我的书架、回收站、灵感库与设置，写作途中随时可达。',
        side: 'right',
        before: { expandSidebar: true }
      },
      {
        target: '[data-tour="home-new-book"]',
        title: '创建第一本书',
        description: '点击「新建书籍」从空白开始；也可以把 TXT / Markdown 文档直接拖进书架。',
        side: 'bottom'
      },
      {
        target: '[data-tour="home-book-grid"]',
        title: '书架',
        description: '支持搜索、类型筛选与排序；书卡展示章节与字数统计，⋮ 菜单可置顶、导出备份与删除。',
        side: 'bottom'
      },
      {
        target: '[data-tour="settings-provider-add"]',
        title: '先配置 AI',
        description: 'AI 能力需要先接入模型：设置 → 模型接入，点预设卡片粘贴 API Key 即可完成。',
        side: 'bottom',
        before: { navigate: '/settings' }
      },
      {
        target: '[data-tour="settings-provider-default"]',
        title: '默认模型与本地模型',
        description: '带「默认」标记的配置用于所有生成；Ollama / LM Studio 本地模型免 API Key。',
        side: 'bottom'
      },
      {
        target: '[data-tour="home-first-book"]',
        title: '打开一本书',
        description: '点击书卡进入编辑器，接下来认识一下写作界面（书架空置时此步自动跳过）。',
        side: 'bottom',
        before: { navigate: '/' },
        waitTimeout: 1500
      }
    ]
  },
  {
    id: 'editor-basics',
    title: '编辑器基础',
    trigger: 'auto',
    steps: [
      {
        target: '[data-tour="editor-chapter-tree"]',
        title: '章节树',
        description: '新建、重命名、拖拽排序多级章节；写作从这里展开。',
        side: 'right'
      },
      {
        target: '[data-tour="editor-canvas"]',
        title: '中央编辑区',
        description: '选中文本可唤起 AI 悬浮菜单；字数实时统计，自动保存（Ctrl+S 立即保存）。',
        side: 'left'
      },
      {
        target: '[data-tour="editor-topbar-focus"]',
        title: '顶栏工具',
        description: '「专注」进入沉浸写作；「大纲」维护全书大纲并注入 AI 生成；Ctrl+Shift+F 全局查找。',
        side: 'bottom'
      },
      {
        target: '[data-rail-tab="ai"]',
        title: '功能面板',
        description: '右侧竖排图标栏分五组：AI、设定、灵感、资产、工具，写作用得到的都在这里。',
        side: 'left'
      },
      {
        target: '[data-rail-tab="worldbook"]',
        title: '先建设定',
        description: '建议先建角色卡与世界书条目，AI 写作时会自动检索注入。',
        side: 'left',
        before: { openEditorTab: 'worldbook' }
      }
    ]
  },
  {
    id: 'ai-panel',
    title: 'AI 面板',
    trigger: 'manual',
    steps: [
      {
        target: '[data-tour="ai-modes"]',
        title: '四种模式 + 长文',
        description: '续写、改写、对白、检查各司其职；整章生成切「长文」。',
        side: 'bottom'
      },
      {
        target: '[data-tour="ai-directives"]',
        title: '本书指令',
        description: 'agents.md 总纲注入本书全部生成，hook.md 生成后自动校验，生效状态在此实时提示。',
        side: 'bottom'
      },
      {
        target: '[data-tour="ai-continue-params"]',
        title: '续写参数',
        description: '@角色参与演出，勾选「按节拍定向」沿当前节拍续写，字数与温度可调。',
        side: 'left'
      },
      {
        target: '[data-tour="ai-candidates"]',
        title: '候选数',
        description: '选 2–3 条候选将逐条生成（各自过 hook 校验），完成后切换预览、保留其一。',
        side: 'top'
      },
      {
        target: '[data-tour="ai-longform-entry"]',
        title: '整章生成',
        description: '长文模式按节拍把整章逐段写完，生成期间可以继续写作。',
        side: 'top'
      }
    ]
  },
  {
    id: 'map-editor',
    title: '地图编辑器',
    trigger: 'manual',
    steps: [
      {
        target: '[data-tour="map-toolbar"]',
        title: '地图编辑器',
        description: '顶部工具栏：切换地图、撤销重做与缩放；左侧栏管理素材与图层。',
        side: 'bottom'
      },
      {
        target: '[data-tour="map-layers"]',
        title: '图层与笔刷',
        description: '多层瓦片管理显隐与顺序；选中瓦片后用笔刷在地形层绘制，橡皮 / 填充 / 吸管配套。',
        side: 'right'
      },
      {
        target: '[data-tour="map-assets"]',
        title: '素材库',
        description: '上传素材或用内置图形做图章，HSV 调色；删除素材前会做引用检查。',
        side: 'right'
      },
      {
        target: '[data-tour="map-terrain-gen"]',
        title: '预设地形生成',
        description: '环岛、群岛、大陆等七种预设一键生成，seeded 可复现，不满意可撤销。',
        side: 'bottom'
      },
      {
        target: '[data-tour="map-auto-layout"]',
        title: '自动布局',
        description: '力导向自动排布地点节点，拥挤的地图一键理顺（可撤销）。',
        side: 'bottom'
      },
      {
        target: '[data-tour="map-export"]',
        title: '导出与插图',
        description: '导出 PNG（可选倍率与透明背景），或直接插入正文光标处作插图。',
        side: 'bottom'
      }
    ]
  },
  {
    id: 'screenplay',
    title: '剧本工作台',
    trigger: 'manual',
    steps: [
      {
        target: '[data-tour="screenplay-panel"]',
        title: '剧本工作台',
        description: '「从章节转化」进入改编向导：选章节范围 → 检查编辑大纲 → 确认成本逐场生成。',
        side: 'left'
      },
      {
        target: '[data-tour="screenplay-tabs"]',
        title: '双视图',
        description: '工作台顶栏切换剧本编辑与分镜画板；生成任务由任务中心托管，中断可恢复。',
        side: 'bottom',
        before: { openOverlay: 'screenplay' }
      },
      {
        target: '[data-tour="screenplay-editor"]',
        title: '三栏剧本编辑',
        description: '场次结构化编辑，可溯源跳回原章节核对正文（未选择剧本时此步自动跳过）。',
        side: 'left'
      },
      {
        target: '[data-tour="screenplay-storyboard"]',
        title: '分镜画板',
        description: 'AI 双候选 / 上传 / 图库三源补图，注入角色外貌保持一致性，支持批量补图。',
        side: 'bottom'
      },
      {
        target: '[data-tour="screenplay-export"]',
        title: '导出',
        description: 'Fountain 专业剧本格式，或 Markdown 分镜表（含图片目录）。',
        side: 'bottom'
      }
    ]
  },
  {
    id: 'longform',
    title: '长文模式',
    trigger: 'manual',
    steps: [
      {
        target: '[data-tour="longform-steps"]',
        title: '长文四步',
        description: '节拍表 → 成本确认 → 生成进度 → 接缝审阅；先把整章拆成节拍，再逐拍生成。',
        side: 'bottom'
      },
      {
        target: '[data-tour="longform-draft"]',
        title: '节拍表',
        description: '设置拍数与总字数，可从章节节拍一键导入，也能手动增删改排序。',
        side: 'left'
      },
      {
        target: '[data-tour="longform-run"]',
        title: '开始生成',
        description: '成本确认后逐拍生成，每拍自动落正文；任务在底部任务中心托管，切章写作不打断。',
        side: 'top'
      },
      {
        target: '[data-tour="longform-recovery"]',
        title: '中断恢复',
        description: '应用重启或中断后，这里可从断点恢复或丢弃会话（无进行中会话时此步自动跳过）。',
        side: 'bottom',
        waitTimeout: 1200
      }
    ]
  },
  {
    id: 'inspiration',
    title: '灵感库',
    trigger: 'manual',
    steps: [
      {
        target: '[data-tour="inspiration-daily"]',
        title: '每日灵感',
        description: '每天一张灵感卡片，没思路时来看一眼。',
        side: 'bottom'
      },
      {
        target: '[data-tour="inspiration-seed"]',
        title: '故事种子',
        description: '组合生成故事种子，选中即可一键建书开写。',
        side: 'bottom'
      },
      {
        target: '[data-tour="inspiration-library"]',
        title: '灵感库',
        description: '收藏的种子与卡片按类型、收藏、关键词过滤检索。',
        side: 'top'
      },
      {
        title: '角色采访与剧情推演',
        description: '编辑器右侧 rail「灵感」分组还提供角色采访与「如果…会怎样」推演。'
      }
    ]
  }
];
