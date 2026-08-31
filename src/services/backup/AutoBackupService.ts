/**
 * AutoBackupService（P6 M2）：自动定期备份编排
 * - 产物与手动备份格式完全一致：逐书调 ExportService.exportBook(bookId, 'backup') 产 v3 zip
 * - 备忘录（跨书全局）另行单独产一份备份包（NotesService.exportBackup），独立前缀与轮换
 * - 调度照抄 UpdateService 幂等标记模式：app_settings 存 backup.auto.*，shouldRun 判断间隔
 * - 防雪崩照抄 StoryboardService：多书顺序执行不并发，单本失败记录书名继续下一本，可取消
 * - 任务中心托管 kind 'backup'（照抄 LongFormService 服务侧注册）
 * 本服务不直接写 books 表（只读 bookService.list），是纯编排者
 */

import type { DirEntry, NativeBridge, FileSystemAdapter } from '../../native/NativeBridge';
import type { AppSettingsService } from '../settings/AppSettingsService';
import type { ExportService } from '../export/ExportService';
import type { BookService } from '../book/BookService';
import type { NotesService } from '../notes/NotesService';
import type { TaskCenterService } from '../task/TaskCenterService';

export interface AutoBackupSettings {
  enabled: boolean;
  intervalHours: number;
  dir: string;
  keepPerBook: number;
}

export interface AutoBackupResult {
  total: number;
  ok: number;
  failed: string[];
  /** 备忘录（跨书全局）单独备份是否成功（books 为空也照常执行） */
  notesOk: boolean;
}

const KEY_ENABLED = 'backup.auto.enabled';
const KEY_INTERVAL = 'backup.auto.intervalHours';
const KEY_DIR = 'backup.auto.dir';
const KEY_KEEP = 'backup.auto.keepPerBook';
const KEY_LAST_RUN = 'backup.auto.lastRunAt';

const DEFAULT_INTERVAL_HOURS = 24;
const DEFAULT_KEEP_PER_BOOK = 5;

/** 备忘录备份文件名前缀（全局数据，独立于逐书前缀；轮换/清理按此前缀识别） */
export const NOTES_BACKUP_PREFIX = '备忘录_';

/** 启动后首检延迟（避开启动高峰）与运行中重检间隔 */
const FIRST_CHECK_DELAY_MS = 15_000;
const RECHECK_INTERVAL_MS = 60 * 60 * 1000;

type FsBridge = FileSystemAdapter & { deletePath(p: string): Promise<void> };

/** 文件名 sanitize：Windows 非法字符替换为 _，空标题回退 fallback */
export function sanitizeFileName(title: string, fallback: string): string {
  const s = title.replace(/[\\/:*?"<>|]/g, '_').trim();
  return s || fallback;
}

/** 备份文件时间戳后缀：yyyyMMdd-HHmmss（字典序 = 时间序） */
export function formatBackupStamp(ts: number): string {
  const p = (n: number): string => String(n).padStart(2, '0');
  const d = new Date(ts);
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

export class AutoBackupService {
  private bridge: NativeBridge;
  private fs: FsBridge;
  private appSettings: AppSettingsService;
  private exportService: ExportService;
  private bookService: BookService;
  private notesService: NotesService;
  private tasks: TaskCenterService;
  private firstTimer: number | null = null;
  private intervalTimer: number | null = null;
  private appDataDirCache: string | null = null;

  constructor(
    bridge: NativeBridge,
    appSettings: AppSettingsService,
    exportService: ExportService,
    bookService: BookService,
    notesService: NotesService,
    tasks: TaskCenterService
  ) {
    this.bridge = bridge;
    this.fs = bridge.fs as FsBridge;
    this.appSettings = appSettings;
    this.exportService = exportService;
    this.bookService = bookService;
    this.notesService = notesService;
    this.tasks = tasks;
  }

  /** 读设置（缺省键回默认值；dir 为空串时取默认目录） */
  async getSettings(): Promise<AutoBackupSettings> {
    const [enabled, interval, dir, keep] = await Promise.all([
      this.appSettings.get(KEY_ENABLED),
      this.appSettings.get(KEY_INTERVAL),
      this.appSettings.get(KEY_DIR),
      this.appSettings.get(KEY_KEEP)
    ]);
    return {
      enabled: enabled === 'true',
      intervalHours: interval != null && Number(interval) > 0 ? Number(interval) : DEFAULT_INTERVAL_HOURS,
      dir: dir && dir.trim() ? dir : `${await this.defaultDir()}/backups`,
      keepPerBook: keep != null && Number(keep) > 0 ? Number(keep) : DEFAULT_KEEP_PER_BOOK
    };
  }

  /** 保存设置（diff 写回，仅写传入的键） */
  async saveSettings(patch: Partial<AutoBackupSettings>): Promise<void> {
    if (patch.enabled !== undefined) {
      await this.appSettings.set(KEY_ENABLED, patch.enabled ? 'true' : 'false');
    }
    if (patch.intervalHours !== undefined) {
      await this.appSettings.set(KEY_INTERVAL, String(patch.intervalHours));
    }
    if (patch.dir !== undefined) {
      await this.appSettings.set(KEY_DIR, patch.dir);
    }
    if (patch.keepPerBook !== undefined) {
      await this.appSettings.set(KEY_KEEP, String(patch.keepPerBook));
    }
  }

  /** 最近一次备份时间（设置页展示） */
  async getLastRunAt(): Promise<number | null> {
    const v = await this.appSettings.get(KEY_LAST_RUN);
    return v != null ? Number(v) : null;
  }

  /** 是否应执行：enabled && 距 lastRunAt 超 intervalHours（无记录视为应执行） */
  async shouldRun(): Promise<boolean> {
    const settings = await this.getSettings();
    if (!settings.enabled) return false;
    const last = await this.getLastRunAt();
    if (last != null && Date.now() - last < settings.intervalHours * 60 * 60 * 1000) return false;
    return true;
  }

  /**
   * 执行一轮：顺序遍历未删除书逐本 exportBook('backup')；
   * 每本成功后做轮换清理（保留最新 keepPerBook 份）；
   * 全部书籍之后，单独产一份全局备忘录备份包（跨书数据，独立前缀 + 轮换保留 keepPerBook 份）；
   * 单本失败 push failed 继续（防雪崩）；开始时写 lastRunAt（防长备份期间调度器重入）；
   * 每步前检查 signal（可取消，已完成的保留）
   */
  async runNow(
    signal?: AbortSignal,
    onProgress?: (done: number, total: number, label: string) => void
  ): Promise<AutoBackupResult> {
    const settings = await this.getSettings();
    const books = await this.bookService.list();
    await this.appSettings.set(KEY_LAST_RUN, String(Date.now()));
    const result: AutoBackupResult = { total: books.length, ok: 0, failed: [], notesOk: false };
    const totalSteps = books.length + 1; // 每本书 + 备忘录一份

    await this.fs.ensureDir(settings.dir).catch(() => undefined);
    let done = 0;
    for (const book of books) {
      if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
      try {
        const safeTitle = sanitizeFileName(book.title, book.id.slice(0, 8));
        const fileName = `${safeTitle}_${formatBackupStamp(Date.now())}.zip`;
        await this.exportService.exportBook(book.id, 'backup', `${settings.dir}/${fileName}`);
        await this.rotate(settings.dir, `${safeTitle}_`, settings.keepPerBook);
        result.ok += 1;
      } catch (e) {
        if (signal?.aborted || (e instanceof Error && e.name === 'AbortError')) {
          throw new DOMException('已取消', 'AbortError');
        }
        result.failed.push(book.title);
      }
      done += 1;
      onProgress?.(done, totalSteps, `第 ${done}/${books.length} 本 · ${book.title}`);
    }

    // 备忘录（跨书全局）：单独一份备份包，books 为空也照常执行
    if (signal?.aborted) throw new DOMException('已取消', 'AbortError');
    try {
      const fileName = `${NOTES_BACKUP_PREFIX}${formatBackupStamp(Date.now())}.zip`;
      await this.notesService.exportBackup(`${settings.dir}/${fileName}`);
      await this.rotate(settings.dir, NOTES_BACKUP_PREFIX, settings.keepPerBook);
      result.notesOk = true;
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        throw new DOMException('已取消', 'AbortError');
      }
      result.failed.push('备忘录');
    }
    done += 1;
    onProgress?.(done, totalSteps, '备忘录');
    return result;
  }

  /**
   * 注册任务中心执行（kind 'backup'，cancellable）；
   * 「立即备份」按钮与调度器共用此入口；进行中时重复调用直接返回现有任务 id
   */
  async run(): Promise<string> {
    const existing = this.tasks
      .list()
      .find((t) => t.kind === 'backup' && t.status === 'running');
    if (existing) return existing.id;
    const books = await this.bookService.list();
    const info = this.tasks.register({
      kind: 'backup',
      title: `自动备份 · ${books.length} 本书 + 备忘录`,
      cancellable: true,
      run: async (ctx) => {
        await this.runNow(ctx.signal, (done, total, label) => {
          ctx.report(Math.round((done / Math.max(total, 1)) * 100), label);
        });
      }
    });
    return info.id;
  }

  /**
   * 调度器：initApp 尾部调用（服务层，StrictMode 安全）。
   * 15s 首检 + 每 60min 重检；每次检查 = shouldRun() 且无进行中备份任务才触发；
   * 全程静默失败（结果仅任务中心可见）。重复调用先清旧定时器（防重入）
   */
  start(): void {
    this.stop();
    this.firstTimer = window.setTimeout(() => void this.check(), FIRST_CHECK_DELAY_MS);
    this.intervalTimer = window.setInterval(() => void this.check(), RECHECK_INTERVAL_MS);
  }

  stop(): void {
    if (this.firstTimer != null) {
      window.clearTimeout(this.firstTimer);
      this.firstTimer = null;
    }
    if (this.intervalTimer != null) {
      window.clearInterval(this.intervalTimer);
      this.intervalTimer = null;
    }
  }

  private async check(): Promise<void> {
    try {
      if (!(await this.shouldRun())) return;
      if (this.tasks.list().some((t) => t.kind === 'backup' && t.status === 'running')) return;
      await this.run();
    } catch {
      // 静默失败：不打断用户（设置页与任务中心可见状态）
    }
  }

  /** 轮换清理：保留前缀匹配的最新 keep 份，超出删除最旧（文件名字典序 = 时间序） */
  private async rotate(dir: string, prefix: string, keep: number): Promise<void> {
    if (keep < 1) return;
    const zips = await this.listPrefixZips(dir, prefix);
    for (const name of zips.slice(keep)) {
      await this.fs.deletePath(`${dir}/${name}`).catch(() => undefined);
    }
  }

  /** 某目录内前缀匹配的 zip 文件名（新到旧，与轮换同一排序） */
  private async listPrefixZips(dir: string, prefix: string): Promise<string[]> {
    let entries: DirEntry[];
    try {
      entries = await this.fs.listDir(dir);
    } catch {
      return []; // 目录不存在等
    }
    return entries
      .filter((e) => !e.isDir && e.name.startsWith(prefix) && e.name.endsWith('.zip'))
      .map((e) => e.name)
      .sort((a, b) => b.localeCompare(a)); // 新在前
  }

  /** 某本书的全部自动备份文件名（前缀与生成时同规则 sanitize，新到旧）；目录不存在返回空 */
  async listBookBackups(book: { title: string; id: string }): Promise<string[]> {
    const settings = await this.getSettings();
    const prefix = `${sanitizeFileName(book.title, book.id.slice(0, 8))}_`;
    return this.listPrefixZips(settings.dir, prefix);
  }

  /** 全局备忘录的全部单独备份文件名（前缀固定「备忘录_」，新到旧）；目录不存在返回空 */
  async listNotesBackups(): Promise<string[]> {
    const settings = await this.getSettings();
    return this.listPrefixZips(settings.dir, NOTES_BACKUP_PREFIX);
  }

  /**
   * 删除某本书的全部自动备份文件（回收站「彻底删除」时按用户勾选联动清理），
   * 返回成功删除数量；单个文件删除失败跳过不中断
   */
  async purgeBookBackups(book: { title: string; id: string }): Promise<number> {
    const settings = await this.getSettings();
    const names = await this.listBookBackups(book);
    let deleted = 0;
    for (const name of names) {
      try {
        await this.fs.deletePath(`${settings.dir}/${name}`);
        deleted += 1;
      } catch {
        // 文件被占用等：跳过
      }
    }
    return deleted;
  }

  /**
   * 清理无效备份：备份目录内所有 .zip，凡文件名前缀（sanitize 标题）不对应任何现存书籍者，
   * 视为书籍改名/删除后遗留的无效备份，一次性删除。返回 { deleted, names }。
   * 单个文件删除失败跳过不中断；目录不存在返回 0
   */
  async cleanInvalidBackups(): Promise<{ deleted: number; names: string[] }> {
    const settings = await this.getSettings();
    const books = await this.bookService.list();
    // 现存书的合法前缀（与生成时同规则：sanitize 标题 + '_'）+ 全局备忘录备份前缀（跨书数据，不属于任何书，视为有效）
    const validPrefixes = [
      ...books.map((b) => `${sanitizeFileName(b.title, b.id.slice(0, 8))}_`),
      NOTES_BACKUP_PREFIX
    ];
    let entries: DirEntry[];
    try {
      entries = await this.fs.listDir(settings.dir);
    } catch {
      return { deleted: 0, names: [] };
    }
    const names: string[] = [];
    let deleted = 0;
    for (const e of entries) {
      if (e.isDir || !e.name.endsWith('.zip')) continue;
      const isValid = validPrefixes.some((p) => e.name.startsWith(p));
      if (isValid) continue;
      try {
        await this.fs.deletePath(`${settings.dir}/${e.name}`);
        names.push(e.name);
        deleted += 1;
      } catch {
        // 文件被占用等：跳过
      }
    }
    return { deleted, names };
  }

  /** 默认备份目录（{appDataDir}/backups），带缓存 */
  private async defaultDir(): Promise<string> {
    if (!this.appDataDirCache) {
      this.appDataDirCache = (await this.bridge.storage.appDataDir()).replace(/\\/g, '/');
    }
    return this.appDataDirCache;
  }
}
