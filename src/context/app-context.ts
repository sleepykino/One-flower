/**
 * 应用上下文：装配 NativeBridge / Database / WriteQueue / 全部服务
 * main.tsx 在渲染前调用 initApp()
 */

import { invoke } from '@tauri-apps/api/core';
import { tauriBridge } from '../native/tauri-bridge';
import { Database } from '../db/Database';
import { WriteQueue } from '../db/WriteQueue';
import { BookService } from '../services/book/BookService';
import { ChapterService } from '../services/chapter/ChapterService';
import { ChapterVersionStore } from '../services/chapter/ChapterVersionStore';
import { CharacterService } from '../services/character/CharacterService';
import { GlobalSearch } from '../services/search/GlobalSearch';
import { SkillLoader } from '../services/skill/SkillLoader';
import { SkillPackService } from '../services/skill/SkillPackService';
import { SkillForgeService } from '../services/skill/SkillForgeService';
import { ExportService } from '../services/export/ExportService';
import { MarkdownExporter } from '../services/export/MarkdownExporter';
import { TxtExporter } from '../services/export/TxtExporter';
import { EpubExporter } from '../services/export/EpubExporter';
import { DocxExporter } from '../services/export/DocxExporter';
import { ImportService } from '../services/import/ImportService';
import { DocImportService } from '../services/import/DocImportService';
import { BookOutlineService } from '../services/outline/BookOutlineService';
import { NotesService } from '../services/notes/NotesService';
import { UsageService, setSharedUsageService } from '../services/usage/UsageService';
import { PromptAssembler } from '../services/ai/PromptAssembler';
import { AIOrchestrator } from '../services/ai/AIOrchestrator';
import { GlobalPromptService } from '../services/ai/GlobalPromptService';
import { ProjectDirectiveService } from '../services/ai/ProjectDirectiveService';
import { GenerationContextService } from '../services/ai/GenerationContext';
import { ModelRoutingService } from '../services/ai/modelRouting';
import { SummaryService } from '../services/summary/SummaryService';
import { AppSettingsService } from '../services/settings/AppSettingsService';
import { WorldbookRAGService } from '../services/worldbook/WorldbookRAGService';
import { FullRAGService } from '../services/rag/FullRAGService';
import { MapEditorService } from '../services/map/MapEditorService';
import { TimelineService } from '../services/timeline/TimelineService';
import { NameGeneratorService } from '../services/namegen/NameGeneratorService';
import { RelationshipService } from '../services/relationship/RelationshipService';
import { WritingStatsService } from '../services/stats/WritingStatsService';
import { TaskCenterService } from '../services/task/TaskCenterService';
import { SettingInferenceService } from '../services/consistency/SettingInferenceService';
import { LongFormService } from '../services/longform/LongFormService';
import { UpdateService } from '../services/update/UpdateService';
import { StorySeedService } from '../services/inspiration/StorySeedService';
import { DailyInspirationService } from '../services/inspiration/DailyInspirationService';
import { CharacterInterviewService } from '../services/inspiration/CharacterInterviewService';
import { WhatIfSimulator } from '../services/inspiration/WhatIfSimulator';
import { MultiPerspectiveRewriter } from '../services/inspiration/MultiPerspectiveRewriter';
import { ImageAssetService } from '../services/image/ImageAssetService';
import { ImagePromptService } from '../services/image/ImagePromptService';
import { ScreenplayService } from '../services/screenplay/ScreenplayService';
import { ScreenplayAdaptService } from '../services/screenplay/ScreenplayAdaptService';
import { StoryboardService } from '../services/screenplay/StoryboardService';
import { AutoBackupService } from '../services/backup/AutoBackupService';
import { useTaskStore } from '../store/taskStore';
import { createProvider, isLocalBaseUrl } from '../services/ai/providers/LLMProvider';
import type { LLMProvider } from '../services/ai/providers/LLMProvider';

export interface AppContext {
  bridge: typeof tauriBridge;
  db: Database;
  wq: WriteQueue;
  bookService: BookService;
  chapterService: ChapterService;
  versionStore: ChapterVersionStore;
  characterService: CharacterService;
  search: GlobalSearch;
  skillLoader: SkillLoader;
  /** P7.4：一把炼化（从文本 / 书籍提炼文风 Skill 的一站式服务） */
  skillForgeService: SkillForgeService;
  exportService: ExportService;
  importService: ImportService;
  /** TXT / Markdown 文档导入（书架按钮 + 拖入书架） */
  docImportService: DocImportService;
  /** G1：全书大纲（storage_dir/outline.md，编辑器「大纲」弹窗编辑，注入 AI 生成） */
  outlineService: BookOutlineService;
  /** 随手记 / 备忘录（全局跨书：文本速记 + 图片附件 + 链接，编辑器顶栏「随手记」弹窗） */
  notesService: NotesService;
  /** G4：AI 用量流水与累计统计（对话类 LLM 调用记账；设置页「用量统计」读取） */
  usageService: UsageService;
  promptAssembler: PromptAssembler;
  orchestrator: AIOrchestrator;
  /** P2.1-M1：自定义全局提示词 */
  globalPrompts: GlobalPromptService;
  /** 批次11-4：不经 orchestrator 的生成类调用统一补充「作者全局要求 + 文风 Skill」 */
  generationContext: GenerationContextService;
  /** 项目级指令文件（agents.md 注入 / hook.md 后处理） */
  projectDirectives: ProjectDirectiveService;
  /** P2 二期：AI 模型分工（按功能点路由 Provider 配置） */
  modelRouting: ModelRoutingService;
  summaryService: SummaryService;
  appSettings: AppSettingsService;
  ragService: WorldbookRAGService;
  /** P2：全量 RAG（三路检索 + 章节片段向量化） */
  fullRagService: FullRAGService;
  /** P2：地图编辑 */
  mapService: MapEditorService;
  /** P2：时间线 */
  timelineService: TimelineService;
  /** P2：命名生成器 */
  nameGenService: NameGeneratorService;
  /** P2：Skill 包导入/导出 */
  skillPackService: SkillPackService;
  relationshipService: RelationshipService;
  statsService: WritingStatsService;
  /** P2.1-M4：任务中心（长任务注册/进度/取消/重试） */
  tasks: TaskCenterService;
  /** P2.1-M6：设定反推（事实抽取/推导链/越级矛盾） */
  inferenceService: SettingInferenceService;
  /** P2.1-M7：长文模式（章节级规划-生成-自洽循环） */
  longformService: LongFormService;
  /** 客户端更新：GitHub Release 检查 + 打开下载页 */
  updateService: UpdateService;
  /** P2.1-B M1：故事种子生成器 */
  storySeedService: StorySeedService;
  /** P2.1-B M2：每日灵感卡片 */
  dailyCardService: DailyInspirationService;
  /** P2.1-B M3：角色采访 */
  interviewService: CharacterInterviewService;
  /** P2.1-B M4："如果…会怎样"推演器 */
  whatIfSimulator: WhatIfSimulator;
  /** P2.1-B M5：多视角重写（改写 tab 视角下拉） */
  multiPerspectiveRewriter: MultiPerspectiveRewriter;
  /** P3：图片资产管理（封面/角色卡/正文插图，文件存 storageDir/assets） */
  imageAssetService: ImageAssetService;
  /** P3：两段式提示词转写（中文场景 -> 英文图片 prompt） */
  imagePromptService: ImagePromptService;
  /** P5：剧本 CRUD 与导出 */
  screenplayService: ScreenplayService;
  /** P5：小说→剧本转化编排（大纲 + 逐场生成，任务中心托管） */
  screenplayAdapt: ScreenplayAdaptService;
  /** P5：分镜图 prompt 组装与生成（含批量任务） */
  storyboardService: StoryboardService;
  /** P6：自动定期备份（调度器 + 任务中心托管 + 轮换清理） */
  autoBackupService: AutoBackupService;
}

let ctx: AppContext | null = null;

export function getAppContext(): AppContext {
  if (!ctx) throw new Error('应用上下文未初始化');
  return ctx;
}

/**
 * Skill 目录：~/.novelagent/skills
 * 通过 Rust 端 USERPROFILE/HOME 环境变量解析 home 目录
 */
async function resolveSkillsDir(): Promise<string> {
  const home = await invoke<string>('home_dir');
  return `${home.replace(/\\/g, '/')}/.novelagent/skills`;
}

export async function initApp(): Promise<AppContext> {
  if (ctx) return ctx;

  // 1. 打开数据库连接（Rust 侧）
  const appDataDir = (await tauriBridge.storage.appDataDir()).replace(/\\/g, '/');
  await tauriBridge.fs.ensureDir(appDataDir);
  await invoke('db_init', { path: `${appDataDir}/novelagent.db` });

  // 2. Database + 迁移
  const db = new Database(tauriBridge);
  await db.runMigrations();

  // 3. 写队列
  const wq = new WriteQueue(tauriBridge.db);

  // 4. 服务装配
  const search = new GlobalSearch(tauriBridge, db, wq);
  const chapterService = new ChapterService(tauriBridge, db, wq, search);
  search.setChapterService(chapterService);

  const bookService = new BookService(tauriBridge, db, wq);
  const versionStore = new ChapterVersionStore(tauriBridge, db, wq);
  const characterService = new CharacterService(tauriBridge, db, wq);
  const skillsDir = await resolveSkillsDir();
  const skillLoader = new SkillLoader(tauriBridge, db, wq, skillsDir);
  await skillLoader.loadAll();

  const markdownExporter = new MarkdownExporter();
  const txtExporter = new TxtExporter();
  const epubExporter = new EpubExporter();
  const docxExporter = new DocxExporter();
  const exportService = new ExportService(
    tauriBridge,
    db,
    chapterService,
    markdownExporter,
    txtExporter,
    epubExporter,
    docxExporter
  );
  const importService = new ImportService(tauriBridge, db, wq);
  const docImportService = new DocImportService(tauriBridge, bookService, chapterService);
  const outlineService = new BookOutlineService(tauriBridge);
  const notesService = new NotesService(tauriBridge);

  const promptAssembler = new PromptAssembler();

  // providerFactory：按配置 ID 从 SQLite + keytar 组装 Provider
  const providerFactory = async (configId: string): Promise<LLMProvider> => {
    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM provider_configs WHERE id = ?',
      [configId]
    );
    if (!row) throw new Error('模型配置不存在');
    const baseUrl = (row.base_url as string) ?? '';
    const apiKey = (await tauriBridge.keyStore.getSecret(`provider_${String(row.id)}`)) ?? '';
    // 本地端点（Ollama / ComfyUI 等 localhost 服务）允许无 API Key
    if (!apiKey && !isLocalBaseUrl(baseUrl)) {
      throw new Error(`配置「${String(row.name)}」未设置 API Key`);
    }
    return createProvider(
      {
        id: String(row.id),
        name: String(row.name),
        provider: String(row.provider),
        baseUrl: (row.base_url as string) ?? undefined,
        model: String(row.model)
      },
      apiKey
    );
  };

  const summaryService = new SummaryService(tauriBridge, db, wq, providerFactory, chapterService);
  // P7.4：一把炼化（文本 / 书籍提炼文风 Skill；providerFactory 与 chapterService 之后装配）
  const skillForgeService = new SkillForgeService(tauriBridge, providerFactory, chapterService);
  const appSettings = new AppSettingsService(db, wq);
  // G4：用量记账（providerResolver / Orchestrator 经共享单例取用，须在首个生成前装配）
  const usageService = new UsageService(tauriBridge, db, wq, appSettings);
  setSharedUsageService(usageService);
  const ragService = new WorldbookRAGService(tauriBridge, db, wq, providerFactory, appSettings);
  // P2：全量 RAG / 地图 / 时间线 / Skill 包
  const fullRagService = new FullRAGService(tauriBridge, db, wq, providerFactory, appSettings);
  const mapService = new MapEditorService(db, wq);
  const timelineService = new TimelineService(db, wq);
  const skillPackService = new SkillPackService(tauriBridge, skillsDir);
  const relationshipService = new RelationshipService(db, wq);
  const statsService = new WritingStatsService(tauriBridge, db, wq);
  // 章节保存带来字数增长时即时写入写作统计（覆盖自动保存/切章 flush/卸载 flush 全部路径）
  chapterService.setWordsGrownNotifier((bookId, chapterId, words) => {
    void statsService.recordWords(bookId, words, [chapterId]);
  });
  const orchestrator = new AIOrchestrator(providerFactory, skillLoader, promptAssembler, tauriBridge, {
    summaryService,
    ragService,
    fullRagService,
    // P7.6：生成安全网限值（ai.gen.maxTokensCap/Floor）读取
    appSettings
  });
  // P2.1-M1：全局提示词（四模式统一注入 system 段，优先级高于 Skill）
  const globalPrompts = new GlobalPromptService(appSettings);
  orchestrator.setGlobalPromptService(globalPrompts);
  // G1：全书大纲注入四模式（user 段前瞻约束）；长文节拍规划在 longformService 构造后接线
  orchestrator.setBookOutlineService(outlineService);
  // 项目级 agents.md / hook.md（storage_dir 文件）
  const projectDirectives = new ProjectDirectiveService(tauriBridge);
  orchestrator.setProjectDirectiveService(projectDirectives);
  // 批次11-4：不经 orchestrator 的生成类调用统一补充「作者全局要求 + 文风 Skill」
  const generationContext = new GenerationContextService(globalPrompts, skillLoader);
  const nameGenService = new NameGeneratorService(tauriBridge, db, wq, generationContext);

  // P2 二期：AI 模型分工（功能点 -> 配置绑定，控制成本）
  const modelRouting = new ModelRoutingService(appSettings);

  // P2.1-M4：任务中心 + taskStore 桥接（subscribe 推入）
  const tasks = new TaskCenterService();
  tasks.subscribe((list) => useTaskStore.getState().setTasks(list));

  // P2.1-M6：设定反推（抽取与推导注册任务中心后台运行）
  const inferenceService = new SettingInferenceService(tauriBridge, { wq }, providerFactory, tasks);

  // P2.1-M7：长文模式（编排层循环调用 continue 模式；每拍落盘 longform_sessions）
  const longformService = new LongFormService(
    tauriBridge,
    { wq },
    providerFactory,
    orchestrator,
    tasks,
    chapterService,
    generationContext
  );
  longformService.setBookOutlineService(outlineService);

  // 客户端更新（方案 A：GitHub latest release 检查，浏览器打开下载页）
  const updateService = new UpdateService(appSettings);

  // P2.1-B 灵感激发包：种子 / 每日卡片 / 角色采访 / 推演 / 多视角重写
  const storySeedService = new StorySeedService(tauriBridge, db, wq, providerFactory, bookService, ragService, generationContext);
  const dailyCardService = new DailyInspirationService(tauriBridge, db, wq, providerFactory, appSettings, generationContext);
  const interviewService = new CharacterInterviewService(tauriBridge, db, wq, providerFactory, characterService, generationContext);
  const whatIfSimulator = new WhatIfSimulator(tauriBridge, db, wq, providerFactory, generationContext);
  // P7.6：多视角重写注入 appSettings（安全网限值读取）
  const multiPerspectiveRewriter = new MultiPerspectiveRewriter(tauriBridge, db, wq, providerFactory, generationContext, appSettings);

  // P3 图片能力：资产服务 + 提示词转写（生图 Provider 在组件侧经 resolveImageProvider 解析）
  const imageAssetService = new ImageAssetService(tauriBridge, db, wq);
  const imagePromptService = new ImagePromptService(tauriBridge, providerFactory, generationContext);

  // P5 剧本工作台：CRUD/导出 + 转化编排 + 分镜图链路
  const screenplayService = new ScreenplayService(tauriBridge, db, wq);
  const screenplayAdapt = new ScreenplayAdaptService(
    tauriBridge,
    providerFactory,
    screenplayService,
    tasks,
    projectDirectives,
    generationContext
  );
  const storyboardService = new StoryboardService(tauriBridge, imageAssetService, screenplayService, tasks);

  // P6 自动备份：调度器（幂等检查 + 定时重检），ctx 赋值后启动
  const autoBackupService = new AutoBackupService(tauriBridge, appSettings, exportService, bookService, notesService, tasks);

  ctx = {
    bridge: tauriBridge,
    db,
    wq,
    bookService,
    chapterService,
    versionStore,
    characterService,
    search,
    skillLoader,
    skillForgeService,
    exportService,
    importService,
    docImportService,
    outlineService,
    notesService,
    usageService,
    promptAssembler,
    orchestrator,
    globalPrompts,
    generationContext,
    projectDirectives,
    modelRouting,
    summaryService,
    appSettings,
    ragService,
    fullRagService,
    mapService,
    timelineService,
    nameGenService,
    skillPackService,
    relationshipService,
    statsService,
    tasks,
    inferenceService,
    longformService,
    updateService,
    storySeedService,
    dailyCardService,
    interviewService,
    whatIfSimulator,
    multiPerspectiveRewriter,
    imageAssetService,
    imagePromptService,
    screenplayService,
    screenplayAdapt,
    storyboardService,
    autoBackupService
  };

  // P6：自动备份调度器启动（服务层挂载，StrictMode 安全；15s 首检 + 每小时重检，全程静默）
  autoBackupService.start();
  // G4：用量保留期清理调度（15s 首检 + 每 6 小时重检，保留期 0 = 永久时跳过）
  usageService.startScheduler();

  return ctx;
}
