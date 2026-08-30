import { describe, expect, it, vi } from 'vitest';
import { NotesService } from '../../src/services/notes/NotesService';
import type { NativeBridge } from '../../src/native/NativeBridge';

// 随手记/备忘录：全局 notes + 图片附件（元数据入库，文件落盘 appDataDir/notes）

function createFixture(seed?: {
  notes?: Record<string, unknown>[];
  attachments?: Record<string, unknown>[];
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
      readBinaryFile: vi.fn(async () => new Uint8Array([1, 2, 3])),
      deletePath: vi.fn(async (path: string) => {
        deleted.push(path);
      })
    },
    db: {
      exec: vi.fn(async (sql: string, params: unknown[]) => {
        execs.push({ sql, params });
      }),
      query: vi.fn(async (sql: string) => {
        if (sql.includes('FROM note_attachments')) return seed?.attachments ?? [];
        return seed?.notes ?? [];
      })
    }
  } as unknown as NativeBridge;
  return { svc: new NotesService(bridge), writes, execs, deleted };
}

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