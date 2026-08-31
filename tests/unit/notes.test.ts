import { describe, expect, it, vi } from 'vitest';
import { NotesService } from '../../src/services/notes/NotesService';
import type { NativeBridge } from '../../src/native/NativeBridge';
import { ZipWriter } from '../../src/utils/zipbuilder';
import { decodeUtf8, unzipToMap } from '../../src/utils/zipreader';

// 随手记/备忘录：全局 notes + 图片附件（元数据入库，文件落盘 appDataDir/notes）
// 备份：跨书全局单独打包（meta.json + files/），import 全量重建新 ID

function createFixture(seed?: {
  notes?: Record<string, unknown>[];
  attachments?: Record<string, unknown>[];
  readBinaryFile?: (path: string) => Promise<Uint8Array>;
}) {
  const writes: Array<{ path: string; data: Uint8Array }> = [];
  const execs: Array<{ sql: string; params: unknown[] }> = [];
  const deleted: string[] = [];
  const bridge = {
    storage: {
      appDataDir: vi.fn(async () => '/appdata')
    },
    fs: {
      ensureDir: vi.fn(async () => undefined),
      writeBinaryFile: vi.fn(async (path: string, data: Uint8Array) => {
        writes.push({ path, data });
      }),
      readBinaryFile: vi.fn(
        seed?.readBinaryFile ?? (async () => new Uint8Array([1, 2, 3]))
      ),
      deletePath: vi.fn(async (path: string) => {
        deleted.push(path);
      })
    },
    db: {
      exec: vi.fn(async (sql: string, params: unknown[]) => {
        execs.push({ sql, params });
      }),
      query: vi.fn(async (sql: string, params?: unknown[]) => {
        if (sql.includes('FROM note_attachments')) {
          const list = seed?.attachments ?? [];
          if (params && params.length > 0) {
            return list.filter((a) => String(a.note_id) === String(params[0]));
          }
          return list;
        }
        return seed?.notes ?? [];
      })
    }
  } as unknown as NativeBridge;
  return { svc: new NotesService(bridge), writes, execs, deleted };
}

type MemoMeta = {
  version: number;
  notes: Array<{ id: string; content: string; pinned: boolean; createdAt: number; updatedAt: number }>;
  attachments: Array<{ id: string; noteId: string; fileName: string; mimeType: string; createdAt: number }>;
};

describe('NotesService 备忘录 CRUD', () => {
  it('create 写入 pinned=0 并返回 Note', async () => {
    const { svc, execs } = createFixture();
    const note = await svc.create('第一想法');
    expect(note.content).toBe('第一想法');
    expect(note.pinned).toBe(false);
    expect(note.id).toBeTruthy();
    expect(execs).toEqual([
      {
        sql: 'INSERT INTO notes (id, content, pinned, created_at, updated_at) VALUES (?, ?, 0, ?, ?)',
        params: [note.id, '第一想法', note.createdAt, note.updatedAt]
      }
    ]);
  });

  it('list 映射 pinned 布尔并按表返回', async () => {
    const { svc } = createFixture({
      notes: [
        { id: 'n1', content: 'A', pinned: 1, created_at: 1, updated_at: 3 },
        { id: 'n2', content: 'B', pinned: 0, created_at: 2, updated_at: 2 }
      ]
    });
    const list = await svc.list();
    expect(list).toEqual([
      { id: 'n1', content: 'A', pinned: true, createdAt: 1, updatedAt: 3 },
      { id: 'n2', content: 'B', pinned: false, createdAt: 2, updatedAt: 2 }
    ]);
  });

  it('updateContent / setPinned 更新对应列', async () => {
    const { svc, execs } = createFixture();
    await svc.updateContent('n1', '新内容');
    await svc.setPinned('n1', true);
    await svc.setPinned('n1', false);
    expect(execs.map((e) => e.sql)).toEqual([
      'UPDATE notes SET content = ?, updated_at = ? WHERE id = ?',
      'UPDATE notes SET pinned = ?, updated_at = ? WHERE id = ?',
      'UPDATE notes SET pinned = ?, updated_at = ? WHERE id = ?'
    ]);
    expect(execs[1].params).toEqual([1, expect.any(Number), 'n1']);
    expect(execs[2].params).toEqual([0, expect.any(Number), 'n1']);
  });

  it('remove 删除附件文件与元数据、再删笔记行', async () => {
    const { svc, deleted, execs } = createFixture({
      attachments: [
        { id: 'a1', note_id: 'n1', file_name: 'n1/abc.png', mime_type: 'image/png', created_at: 1 }
      ]
    });
    await svc.remove('n1');
    expect(deleted).toEqual(['/appdata/notes/n1/abc.png']);
    expect(execs.map((e) => e.sql)).toEqual([
      'DELETE FROM note_attachments WHERE note_id = ?',
      'DELETE FROM notes WHERE id = ?'
    ]);
  });
});

describe('NotesService 图片附件', () => {
  it('addAttachment 落盘到 notes/{noteId} 并插入元数据', async () => {
    const { svc, writes, execs } = createFixture();
    const att = await svc.addAttachment('n1', {
      name: '截图.jpg',
      mime: 'image/jpeg',
      bytes: new Uint8Array([9, 9])
    });
    expect(att.noteId).toBe('n1');
    expect(att.fileName).toMatch(/^n1\/[0-9a-f-]+\.jpg$/);
    expect(writes).toEqual([{ path: `/appdata/notes/${att.fileName}`, data: new Uint8Array([9, 9]) }]);
    expect(execs[0].sql).toContain('INSERT INTO note_attachments');
    expect(execs[0].params).toEqual([att.id, 'n1', att.fileName, 'image/jpeg', att.createdAt]);
  });

  it('attachmentsOf / removeAttachment 读写元数据并删文件', async () => {
    const { svc, deleted, execs } = createFixture({
      attachments: [
        { id: 'a1', note_id: 'n1', file_name: 'n1/abc.png', mime_type: 'image/png', created_at: 5 }
      ]
    });
    const atts = await svc.attachmentsOf('n1');
    expect(atts).toEqual([{ id: 'a1', noteId: 'n1', fileName: 'n1/abc.png', mimeType: 'image/png', createdAt: 5 }]);

    await svc.removeAttachment(atts[0]);
    expect(deleted).toEqual(['/appdata/notes/n1/abc.png']);
    expect(execs[0].sql).toBe('DELETE FROM note_attachments WHERE id = ?');
    expect(execs[0].params).toEqual(['a1']);
  });

  it('attachmentUrl 读取二进制并转 blob URL', async () => {
    const { svc } = createFixture();
    const stub = vi.fn(() => 'blob:mock-url');
    vi.stubGlobal('URL', { ...URL, createObjectURL: stub });
    try {
      const url = await svc.attachmentUrl({ id: 'a1', noteId: 'n1', fileName: 'n1/abc.png', mimeType: 'image/png', createdAt: 1 });
      expect(url).toBe('blob:mock-url');
      expect(stub).toHaveBeenCalledTimes(1);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});

describe('NotesService 备忘录备份（exportBackup / importBackup，跨书全局单独包）', () => {
  it('exportBackup 打包 meta.json + files/ 附件到输出路径', async () => {
    const { svc, writes } = createFixture({
      notes: [
        { id: 'n1', content: '备忘A', pinned: 1, created_at: 10, updated_at: 20 },
        { id: 'n2', content: '备忘B', pinned: 0, created_at: 11, updated_at: 21 }
      ],
      attachments: [
        { id: 'a1', note_id: 'n1', file_name: 'n1/abc.png', mime_type: 'image/png', created_at: 30 },
        { id: 'a2', note_id: 'n2', file_name: 'n2/def.jpg', mime_type: 'image/jpeg', created_at: 31 }
      ]
    });
    await svc.exportBackup('C:/backups/备忘录_20260831.zip');
    expect(writes).toHaveLength(1);
    const [out] = writes;
    expect(out.path).toBe('C:/backups/备忘录_20260831.zip');
    const files = await unzipToMap(out.data);
    expect([...files.keys()].sort()).toEqual(['files/n1/abc.png', 'files/n2/def.jpg', 'meta.json']);
    const meta = JSON.parse(decodeUtf8(files.get('meta.json')!)) as MemoMeta;
    expect(meta.version).toBe(1);
    expect(meta.notes).toEqual([
      { id: 'n1', content: '备忘A', pinned: true, createdAt: 10, updatedAt: 20 },
      { id: 'n2', content: '备忘B', pinned: false, createdAt: 11, updatedAt: 21 }
    ]);
    expect(meta.attachments).toEqual([
      { id: 'a1', noteId: 'n1', fileName: 'n1/abc.png', mimeType: 'image/png', createdAt: 30 },
      { id: 'a2', noteId: 'n2', fileName: 'n2/def.jpg', mimeType: 'image/jpeg', createdAt: 31 }
    ]);
    expect(files.get('files/n1/abc.png')).toEqual(new Uint8Array([1, 2, 3]));
  });

  it('附件文件缺失时跳过该附件，不中断备份', async () => {
    const { svc, writes } = createFixture({
      notes: [{ id: 'n1', content: '备忘A', pinned: 0, created_at: 1, updated_at: 2 }],
      attachments: [{ id: 'a1', note_id: 'n1', file_name: 'n1/abc.png', mime_type: 'image/png', created_at: 3 }],
      readBinaryFile: async () => {
        throw new Error('ENOENT');
      }
    });
    await svc.exportBackup('C:/backups/m.zip');
    const files = await unzipToMap(writes[0].data);
    expect(files.has('files/n1/abc.png')).toBe(false);
    expect(files.has('meta.json')).toBe(true);
  });

  it('importBackup 全量重建新 ID，附件恢复到新 note 目录', async () => {
    const zip = new ZipWriter();
    zip.addText(
      'meta.json',
      JSON.stringify({
        version: 1,
        notes: [{ id: 'old1', content: '备忘A', pinned: true, createdAt: 10, updatedAt: 20 }],
        attachments: [{ id: 'olda1', noteId: 'old1', fileName: 'old1/abc.png', mimeType: 'image/png', createdAt: 30 }]
      })
    );
    zip.addBinary('files/old1/abc.png', new Uint8Array([9, 9, 9]));
    const zipBytes = await zip.finish();

    const { svc, execs, writes } = createFixture({ readBinaryFile: async () => zipBytes });
    const r = await svc.importBackup('C:/backups/memo.zip');
    expect(r).toEqual({ noteCount: 1, attachmentCount: 1 });
    expect(execs).toHaveLength(2);
    expect(execs[0].sql).toContain('INSERT INTO notes');
    expect(execs[0].params).toEqual([expect.any(String), '备忘A', 1, 10, 20]);
    const newNoteId = execs[0].params[0] as string;
    expect(newNoteId).not.toBe('old1');
    expect(execs[1].sql).toContain('INSERT INTO note_attachments');
    const newFileName = execs[1].params[2] as string;
    expect(execs[1].params[1]).toBe(newNoteId);
    expect(newFileName).toBe(`${newNoteId}/abc.png`);
    expect(writes).toEqual([{ path: `/appdata/notes/${newFileName}`, data: new Uint8Array([9, 9, 9]) }]);
  });

  it('附件二进制缺失时仍重建元数据但不落盘文件', async () => {
    const zip = new ZipWriter();
    zip.addText(
      'meta.json',
      JSON.stringify({
        version: 1,
        notes: [{ id: 'old1', content: 'A', pinned: 0, createdAt: 1, updatedAt: 2 }],
        attachments: [{ id: 'olda1', noteId: 'old1', fileName: 'old1/abc.png', mimeType: 'image/png', createdAt: 3 }]
      })
    );
    const zipBytes = await zip.finish();
    const { svc, execs, writes } = createFixture({ readBinaryFile: async () => zipBytes });
    const r = await svc.importBackup('C:/backups/memo.zip');
    expect(r).toEqual({ noteCount: 1, attachmentCount: 1 });
    expect(execs).toHaveLength(2);
    expect(writes).toHaveLength(0);
  });

  it('zip 缺少 meta.json 时报错', async () => {
    const zip = new ZipWriter();
    zip.addBinary('files/x.png', new Uint8Array([1]));
    const zipBytes = await zip.finish();
    const { svc } = createFixture({ readBinaryFile: async () => zipBytes });
    await expect(svc.importBackup('C:/backups/memo.zip')).rejects.toThrow('缺少 meta.json');
  });

  it('meta.json 解析失败时报错', async () => {
    const zip = new ZipWriter();
    zip.addText('meta.json', '{ not json');
    const zipBytes = await zip.finish();
    const { svc } = createFixture({ readBinaryFile: async () => zipBytes });
    await expect(svc.importBackup('C:/backups/memo.zip')).rejects.toThrow('解析失败');
  });
});