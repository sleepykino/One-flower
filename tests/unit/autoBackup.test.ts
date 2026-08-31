import { describe, expect, it, vi } from 'vitest';
import { AutoBackupService, formatBackupStamp, sanitizeFileName } from '../../src/services/backup/AutoBackupService';
import type { DirEntry, NativeBridge } from '../../src/native/NativeBridge';
import type { AppSettingsService } from '../../src/services/settings/AppSettingsService';

// P6 M2：AutoBackupService 纯逻辑单测（文件名 sanitize / 时间戳 / 设置缺省回退 / shouldRun 间隔判断）
// P6 补充：listBookBackups / purgeBookBackups（彻底删除联动清理备份）前缀匹配与删除语义
// 依赖均以最小 mock 注入（该模块依赖全为 import type，无运行时耦合）

function createService(
  settings: Record<string, string | null> = {},
  fs: { listDir?: ReturnType<typeof vi.fn>; deletePath?: ReturnType<typeof vi.fn> } = {},
  books: Array<{ id: string; title: string }> = [],
  extra: {
    exportBackup?: ReturnType<typeof vi.fn>;
    notesExportBackup?: ReturnType<typeof vi.fn>;
  } = {}
) {
  const appSettings = {
    get: vi.fn(async (key: string): Promise<string | null> => settings[key] ?? null),
    set: vi.fn(async (): Promise<void> => undefined)
  } as unknown as AppSettingsService;
  const listDir = fs.listDir ?? vi.fn(async (): Promise<DirEntry[]> => []);
  const deletePath = fs.deletePath ?? vi.fn(async (): Promise<void> => undefined);
  const bridge = {
    storage: { appDataDir: vi.fn(async () => 'C:/Users/x/AppData/OneFlower') },
    fs: { ensureDir: vi.fn(async () => undefined), listDir, deletePath }
  } as unknown as NativeBridge;
  const bookService = { list: vi.fn(async (): Promise<unknown[]> => books) };
  const exportService = { exportBook: extra.exportBackup ?? vi.fn(async () => undefined) };
  const notesService = { exportBackup: extra.notesExportBackup ?? vi.fn(async () => undefined) };
  const svc = new AutoBackupService(
    bridge as never,
    appSettings,
    exportService as never,
    bookService as never,
    notesService as never,
    {
      list: () => [],
      register: vi.fn()
    } as never
  );
  return { svc, appSettings, listDir, deletePath, bookService, notesService, exportService };
}

describe('sanitizeFileName（备份文件名）', () => {
  it('Windows 非法字符替换为 _', () => {
    expect(sanitizeFileName('a/b\\c:d*e?f"g<h>i|j', 'fb')).toBe('a_b_c_d_e_f_g_h_i_j');
  });

  it('首尾空白裁剪；空标题回退 fallback', () => {
    expect(sanitizeFileName('  书名  ', 'fb')).toBe('书名');
    expect(sanitizeFileName('   ', 'fb12345')).toBe('fb12345');
    expect(sanitizeFileName('', 'fb12345')).toBe('fb12345');
  });
});

describe('formatBackupStamp（时间戳后缀）', () => {
  it('生成 yyyyMMdd-HHmmss 且补零（字典序 = 时间序）', () => {
    expect(formatBackupStamp(new Date(2026, 7, 26, 9, 5, 3).getTime())).toBe('20260826-090503');
    expect(formatBackupStamp(new Date(2026, 11, 1, 23, 59, 59).getTime())).toBe('20261201-235959');
  });
});

describe('AutoBackupService.getSettings（缺省回退）', () => {
  it('全部键缺失时回默认值（关 / 24h / appDataDir/backups / 5 份）', async () => {
    const { svc } = createService({});
    const s = await svc.getSettings();
    expect(s.enabled).toBe(false);
    expect(s.intervalHours).toBe(24);
    expect(s.dir).toBe('C:/Users/x/AppData/OneFlower/backups');
    expect(s.keepPerBook).toBe(5);
  });

  it('已保存的设置覆盖默认值；dir 空串回默认目录', async () => {
    const { svc } = createService({
      'backup.auto.enabled': 'true',
      'backup.auto.intervalHours': '12',
      'backup.auto.keepPerBook': '2',
      'backup.auto.dir': ''
    });
    const s = await svc.getSettings();
    expect(s.enabled).toBe(true);
    expect(s.intervalHours).toBe(12);
    expect(s.keepPerBook).toBe(2);
    expect(s.dir).toBe('C:/Users/x/AppData/OneFlower/backups');
  });
});

describe('AutoBackupService.shouldRun（幂等间隔判断）', () => {
  it('开关关闭 -> false', async () => {
    const { svc } = createService({ 'backup.auto.enabled': 'false' });
    expect(await svc.shouldRun()).toBe(false);
  });

  it('开关开 + 无 lastRunAt -> true（首次执行）', async () => {
    const { svc } = createService({ 'backup.auto.enabled': 'true' });
    expect(await svc.shouldRun()).toBe(true);
  });

  it('开关开 + 距上次未超间隔 -> false；超间隔 -> true', async () => {
    const recent = createService({
      'backup.auto.enabled': 'true',
      'backup.auto.lastRunAt': String(Date.now() - 23 * 60 * 60 * 1000)
    });
    expect(await recent.svc.shouldRun()).toBe(false);

    const stale = createService({
      'backup.auto.enabled': 'true',
      'backup.auto.lastRunAt': String(Date.now() - 25 * 60 * 60 * 1000)
    });
    expect(await stale.svc.shouldRun()).toBe(true);
  });
});

describe('AutoBackupService.saveSettings（diff 写回）', () => {
  it('仅写传入的键', async () => {
    const { svc, appSettings } = createService({});
    await svc.saveSettings({ enabled: true, keepPerBook: 3 });
    const set = appSettings.set as unknown as ReturnType<typeof vi.fn>;
    expect(set.mock.calls).toEqual([
      ['backup.auto.enabled', 'true'],
      ['backup.auto.keepPerBook', '3']
    ]);
  });
});

describe('AutoBackupService.listBookBackups / purgeBookBackups（P6 补充：联动清理备份）', () => {
  // 书名含 Windows 非法字符：sanitize 后前缀为 '武侠_传奇_卷一_'（与生成时同规则）
  const BOOK = { title: '武侠:传奇/卷一', id: 'book1234567890' };

  const ENTRIES: DirEntry[] = [
    { name: '武侠_传奇_卷一_20260826-100000.zip', isDir: false }, // 匹配（新）
    { name: '武侠_传奇_卷一_20260825-100000.zip', isDir: false }, // 匹配（旧）
    { name: '武侠_传奇_卷一_20260826-110000.zip.txt', isDir: false }, // 非 zip 后缀
    { name: '武侠_传奇_卷一_20260826-090000', isDir: false }, // 无 .zip 后缀
    { name: '武侠_传奇_卷一_20260826-080000.zip', isDir: true }, // 目录
    { name: '另一本书_20260826-100000.zip', isDir: false } // 其他书
  ];

  it('listBookBackups 仅前缀匹配的 zip（排除目录/非 zip/其他书），新到旧排序', async () => {
    const listDir = vi.fn(async (): Promise<DirEntry[]> => ENTRIES);
    const { svc } = createService({}, { listDir });
    expect(await svc.listBookBackups(BOOK)).toEqual([
      '武侠_传奇_卷一_20260826-100000.zip',
      '武侠_传奇_卷一_20260825-100000.zip'
    ]);
  });

  it('备份目录不存在时 listBookBackups 返回空（不抛错）', async () => {
    const listDir = vi.fn(async (): Promise<DirEntry[]> => {
      throw new Error('no such dir');
    });
    const { svc } = createService({}, { listDir });
    expect(await svc.listBookBackups(BOOK)).toEqual([]);
  });

  it('purgeBookBackups 逐个删除匹配文件并返回数量；路径含备份目录', async () => {
    const listDir = vi.fn(async (): Promise<DirEntry[]> => ENTRIES);
    const deletePath = vi.fn(async (p: string): Promise<void> => undefined);
    const { svc } = createService({}, { listDir, deletePath });
    expect(await svc.purgeBookBackups(BOOK)).toBe(2);
    expect(deletePath.mock.calls.map((c) => String(c[0]))).toEqual([
      'C:/Users/x/AppData/OneFlower/backups/武侠_传奇_卷一_20260826-100000.zip',
      'C:/Users/x/AppData/OneFlower/backups/武侠_传奇_卷一_20260825-100000.zip'
    ]);
  });

  it('无匹配文件时 purgeBookBackups 返回 0 且不触发删除', async () => {
    const deletePath = vi.fn(async (): Promise<void> => undefined);
    const { svc } = createService({}, { deletePath });
    expect(await svc.purgeBookBackups(BOOK)).toBe(0);
    expect(deletePath).not.toHaveBeenCalled();
  });

  it('单个文件删除失败跳过不中断，仅计成功数', async () => {
    const listDir = vi.fn(async (): Promise<DirEntry[]> => ENTRIES);
    const deletePath = vi.fn(async (p: string): Promise<void> => {
      if (String(p).includes('20260825')) throw new Error('被占用');
    });
    const { svc } = createService({}, { listDir, deletePath });
    expect(await svc.purgeBookBackups(BOOK)).toBe(1);
    expect(deletePath).toHaveBeenCalledTimes(2);
  });

  it('自定义备份目录生效', async () => {
    const listDir = vi.fn(async (_dir?: string): Promise<DirEntry[]> => ENTRIES);
    const { svc } = createService({ 'backup.auto.dir': 'D:/my-backups' }, { listDir });
    await svc.listBookBackups(BOOK);
    expect(String(listDir.mock.calls[0][0])).toBe('D:/my-backups');
  });
});

describe('AutoBackupService.cleanInvalidBackups（清理无效备份）', () => {
  // 现存书只含《武侠:传奇/卷一》，其 sanitize 前缀为 '武侠_传奇_卷一_'
  const BOOKS = [{ id: 'book1234567890', title: '武侠:传奇/卷一' }];

  const ENTRIES: DirEntry[] = [
    { name: '武侠_传奇_卷一_20260826-100000.zip', isDir: false }, // 现存书 -> 有效，保留
    { name: '旧书名_20260701-080000.zip', isDir: false }, // 改名前遗留 -> 无效，删除
    { name: '已删除书_20260601-080000.zip', isDir: false }, // 已删除书遗留 -> 无效，删除
    { name: '武侠_传奇_卷一_20260826-110000.zip.txt', isDir: false }, // 非 zip 后缀，忽略
    { name: '武侠_传奇_卷一_20260826-090000', isDir: false }, // 无 .zip 后缀，忽略
    { name: '旧书名_20260702-080000.zip', isDir: true } // 目录，忽略
  ];

  it('仅删除不对应现存书的 zip，名字典序保留有效备份', async () => {
    const listDir = vi.fn(async (): Promise<DirEntry[]> => ENTRIES);
    const deletePath = vi.fn(async (p: string): Promise<void> => undefined);
    const { svc } = createService({}, { listDir, deletePath }, BOOKS);
    const r = await svc.cleanInvalidBackups();
    expect(r.deleted).toBe(2);
    expect(r.names).toEqual(['旧书名_20260701-080000.zip', '已删除书_20260601-080000.zip']);
    expect(deletePath.mock.calls.map((c) => String(c[0]))).toEqual([
      'C:/Users/x/AppData/OneFlower/backups/旧书名_20260701-080000.zip',
      'C:/Users/x/AppData/OneFlower/backups/已删除书_20260601-080000.zip'
    ]);
  });

  it('全部有效时无删除', async () => {
    const listDir = vi.fn(async (): Promise<DirEntry[]> => [
      { name: '武侠_传奇_卷一_20260826-100000.zip', isDir: false }
    ]);
    const deletePath = vi.fn(async (): Promise<void> => undefined);
    const { svc } = createService({}, { listDir, deletePath }, BOOKS);
    const r = await svc.cleanInvalidBackups();
    expect(r.deleted).toBe(0);
    expect(deletePath).not.toHaveBeenCalled();
  });

  it('备份目录不存在时返回 0 不抛错', async () => {
    const listDir = vi.fn(async (): Promise<DirEntry[]> => {
      throw new Error('no such dir');
    });
    const { svc } = createService({}, { listDir }, BOOKS);
    expect(await svc.cleanInvalidBackups()).toEqual({ deleted: 0, names: [] });
  });

  it('单个文件删除失败跳过，只计成功数', async () => {
    const listDir = vi.fn(async (): Promise<DirEntry[]> => ENTRIES);
    const deletePath = vi.fn(async (p: string): Promise<void> => {
      if (String(p).includes('已删除书')) throw new Error('被占用');
    });
    const { svc } = createService({}, { listDir, deletePath }, BOOKS);
    const r = await svc.cleanInvalidBackups();
    expect(r.deleted).toBe(1);
    expect(r.names).toEqual(['旧书名_20260701-080000.zip']);
    expect(deletePath).toHaveBeenCalledTimes(2);
  });

  it('备忘录_ 前缀的备份（跨书全局）视为有效保留，不删除', async () => {
    const listDir = vi.fn(async (): Promise<DirEntry[]> => [
      { name: '武侠_传奇_卷一_20260826-100000.zip', isDir: false }, // 现存书 -> 有效
      { name: '备忘录_20260826-100000.zip', isDir: false }, // 全局备忘录 -> 有效，保留
      { name: '旧书名_20260701-080000.zip', isDir: false } // 改名前遗留 -> 无效，删除
    ]);
    const deletePath = vi.fn(async (p: string): Promise<void> => undefined);
    const { svc } = createService({}, { listDir, deletePath }, BOOKS);
    const r = await svc.cleanInvalidBackups();
    expect(r.deleted).toBe(1);
    expect(r.names).toEqual(['旧书名_20260701-080000.zip']);
  });
});

describe('AutoBackupService.runNow（备忘录单独备份，跨书全局）', () => {
  it('书籍完成后调用 notesService.exportBackup 并置 notesOk=true；路径含备份目录与「备忘录_」前缀', async () => {
    const exportBook = vi.fn(async (): Promise<void> => undefined);
    const notesExportBackup = vi.fn(async (_path: string): Promise<void> => undefined);
    const { svc } = createService(
      {},
      {},
      [{ id: 'b1', title: '书A' }],
      { exportBackup: exportBook, notesExportBackup }
    );
    const r = await svc.runNow();
    expect(exportBook).toHaveBeenCalledTimes(1);
    expect(notesExportBackup).toHaveBeenCalledTimes(1);
    expect(String(notesExportBackup.mock.calls[0][0])).toMatch(
      /^C:\/Users\/x\/AppData\/OneFlower\/backups\/备忘录_\d{8}-\d{6}\.zip$/
    );
    expect(r.notesOk).toBe(true);
    expect(r.failed).toEqual([]);
    expect(r.total).toBe(1);
    expect(r.ok).toBe(1);
  });

  it('备忘录备份失败时 failed 含「备忘录」且 notesOk=false，书籍备份不受影响', async () => {
    const exportBook = vi.fn(async (): Promise<void> => undefined);
    const notesExportBackup = vi.fn(async (): Promise<void> => {
      throw new Error('磁盘满');
    });
    const { svc } = createService(
      {},
      {},
      [{ id: 'b1', title: '书A' }],
      { exportBackup: exportBook, notesExportBackup }
    );
    const r = await svc.runNow();
    expect(r.notesOk).toBe(false);
    expect(r.failed).toEqual(['备忘录']);
    expect(r.ok).toBe(1);
  });

  it('books 为空时仍执行备忘录备份（移除早退）', async () => {
    const notesExportBackup = vi.fn(async (): Promise<void> => undefined);
    const { svc } = createService({}, {}, [], { notesExportBackup });
    const r = await svc.runNow();
    expect(notesExportBackup).toHaveBeenCalledTimes(1);
    expect(r.notesOk).toBe(true);
    expect(r.failed).toEqual([]);
  });

  it('单书导出失败不中断，备忘录仍在全部书籍之后执行', async () => {
    const exportBook = vi.fn(async (): Promise<void> => {
      throw new Error('导出失败');
    });
    const notesExportBackup = vi.fn(async (): Promise<void> => undefined);
    const { svc } = createService(
      {},
      {},
      [{ id: 'b1', title: '书A' }],
      { exportBackup: exportBook, notesExportBackup }
    );
    const r = await svc.runNow();
    expect(r.failed).toEqual(['书A']);
    expect(notesExportBackup).toHaveBeenCalledTimes(1);
    expect(r.notesOk).toBe(true);
  });
});

describe('AutoBackupService.listNotesBackups（备忘录备份前缀匹配）', () => {
  const ENTRIES: DirEntry[] = [
    { name: '备忘录_20260826-100000.zip', isDir: false }, // 匹配（新）
    { name: '备忘录_20260825-100000.zip', isDir: false }, // 匹配（旧）
    { name: '书A_20260826-100000.zip', isDir: false }, // 其他书，不匹配
    { name: '备忘录_20260826-110000.zip.txt', isDir: false }, // 非 zip 后缀
    { name: '备忘录_20260826-090000', isDir: false }, // 无 .zip 后缀
    { name: '备忘录_20260826-080000.zip', isDir: true } // 目录
  ];

  it('仅前缀匹配的 zip（排除目录/非 zip/其他书），新到旧排序', async () => {
    const listDir = vi.fn(async (): Promise<DirEntry[]> => ENTRIES);
    const { svc } = createService({}, { listDir });
    expect(await svc.listNotesBackups()).toEqual([
      '备忘录_20260826-100000.zip',
      '备忘录_20260825-100000.zip'
    ]);
  });

  it('备份目录不存在时返回空（不抛错）', async () => {
    const listDir = vi.fn(async (): Promise<DirEntry[]> => {
      throw new Error('no such dir');
    });
    const { svc } = createService({}, { listDir });
    expect(await svc.listNotesBackups()).toEqual([]);
  });

  it('自定义备份目录生效', async () => {
    const listDir = vi.fn(async (_dir?: string): Promise<DirEntry[]> => ENTRIES);
    const { svc } = createService({ 'backup.auto.dir': 'D:/my-backups' }, { listDir });
    await svc.listNotesBackups();
    expect(String(listDir.mock.calls[0][0])).toBe('D:/my-backups');
  });
});
