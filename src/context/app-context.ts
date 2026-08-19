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
import { ExportService } from '../services/export/ExportService';
import { MarkdownExporter } from '../services/export/MarkdownExporter';
import { TxtExporter } from '../services/export/TxtExporter';
import { EpubExporter } from '../services/export/EpubExporter';
import { DocxExporter } from '../services/export/DocxExporter';
import { ImportService } from '../services/import/ImportService';
import { PromptAssembler } from '../services/ai/PromptAssembler';
import { AIOrchestrator } from '../services/ai/AIOrchestrator';
import { GlobalPromptService } from '../services/ai/GlobalPromptService';
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
import { useTaskStore } from '../store/taskStore';
import { createProvider } from '../services/ai/providers/LLMProvider';
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
  exportService: ExportService;
  importService: ImportService;
  promptAssembler: PromptAssembler;
  orchestrator: AIOrchestrator;
  /** P2.1-M1：自定义全局提示词 */
  globalPrompts: GlobalPromptService;
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

  const promptAssembler = new PromptAssembler();

  // providerFactory：按配置 ID 从 SQLite + keytar 组装 Provider
  const providerFactory = async (configId: string): Promise<LLMProvider> => {
    const row = await db.queryOne<Record<string, unknown>>(
      'SELECT * FROM provider_configs WHERE id = ?',
      [configId]
    );
    if (!row) throw new Error('模型配置不存在');
    const apiKey = (await tauriBridge.keyStore.getSecret(`provider_${String(row.id)}`)) ?? '';
    if (!apiKey) throw new Error(`配置「${String(row.name)}」未设置 API Key`);
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
  const appSettings = new AppSettingsService(db, wq);
  const ragService = new WorldbookRAGService(tauriBridge, db, wq, providerFactory, appSettings);
  // P2：全量 RAG / 地图 / 时间线 / 命名 / Skill 包
  const fullRagService = new FullRAGService(tauriBridge, db, wq, providerFactory, appSettings);
  const mapService = new MapEditorService(db, wq);
  const timelineService = new TimelineService(db, wq);
  const nameGenService = new NameGeneratorService(tauriBridge, db, wq);
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
    fullRagService
  });
  // P2.1-M1：全局提示词（四模式统一注入 system 段，优先级高于 Skill）
  const globalPrompts = new GlobalPromptService(appSettings);
  orchestrator.setGlobalPromptService(globalPrompts);

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
    chapterService
  );

  // 客户端更新（方案 A：GitHub latest release 检查，浏览器打开下载页）
  const updateService = new UpdateService(appSettings);

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
    exportService,
    importService,
    promptAssembler,
    orchestrator,
    globalPrompts,
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
    updateService
  };
  return ctx;
}
