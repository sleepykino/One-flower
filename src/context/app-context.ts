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
import { ExportService } from '../services/export/ExportService';
import { MarkdownExporter } from '../services/export/MarkdownExporter';
import { TxtExporter } from '../services/export/TxtExporter';
import { EpubExporter } from '../services/export/EpubExporter';
import { DocxExporter } from '../services/export/DocxExporter';
import { ImportService } from '../services/import/ImportService';
import { PromptAssembler } from '../services/ai/PromptAssembler';
import { AIOrchestrator } from '../services/ai/AIOrchestrator';
import { SummaryService } from '../services/summary/SummaryService';
import { AppSettingsService } from '../services/settings/AppSettingsService';
import { WorldbookRAGService } from '../services/worldbook/WorldbookRAGService';
import { RelationshipService } from '../services/relationship/RelationshipService';
import { WritingStatsService } from '../services/stats/WritingStatsService';
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
  summaryService: SummaryService;
  appSettings: AppSettingsService;
  ragService: WorldbookRAGService;
  relationshipService: RelationshipService;
  statsService: WritingStatsService;
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
  const skillLoader = new SkillLoader(tauriBridge, db, wq, await resolveSkillsDir());
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
  const relationshipService = new RelationshipService(db, wq);
  const statsService = new WritingStatsService(tauriBridge, db, wq);
  const orchestrator = new AIOrchestrator(providerFactory, skillLoader, promptAssembler, tauriBridge, {
    summaryService,
    ragService
  });

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
    summaryService,
    appSettings,
    ragService,
    relationshipService,
    statsService
  };
  return ctx;
}
