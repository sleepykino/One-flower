import { describe, expect, it, vi } from 'vitest';
import {
  blocksPlainText,
  blocksToDoc,
  detectBoundary,
  parseDocument,
  parseInline,
  type BlockNode
} from '../../src/services/import/DocParse';
import { DocImportService, docTitleFromFileName } from '../../src/services/import/DocImportService';
import type { NativeBridge } from '../../src/native/NativeBridge';
import type { BookService } from '../../src/services/book/BookService';
import type { ChapterService } from '../../src/services/chapter/ChapterService';

// TXT / Markdown 文档导入：章节切分 + Markdown -> PM doc 纯函数解析 + 导入服务编排
// 服务层用 mock BookService/ChapterService 断言建书建章调用序列，不起真库

describe('detectBoundary 章节边界识别', () => {
  it('识别 第X章/第X节（含连写与汉字数字）', () => {
    for (const line of ['第一章 开端', '第1章 开端', '第1001章 大结局', '第三章节奏', '第二节']) {
      expect(detectBoundary(line, false)?.kind).toBe('chapter');
    }
  });

  it('识别 第X回 仅在序号后接空白或行尾时（避免「第二回合」误判）', () => {
    expect(detectBoundary('第三回 风雪山神庙', false)?.kind).toBe('chapter');
    expect(detectBoundary('第三回', false)?.kind).toBe('chapter');
    expect(detectBoundary('第二回合开始了', false)).toBeNull();
  });

  it('识别 卷/部 与固定章名', () => {
    expect(detectBoundary('第一卷 大风起', false)?.kind).toBe('volume');
    expect(detectBoundary('卷二', false)?.kind).toBe('volume');
    expect(detectBoundary('序章', false)?.kind).toBe('chapter');
    expect(detectBoundary('番外1 新年', false)?.kind).toBe('chapter');
    expect(detectBoundary('Chapter 1 The Beginning', false)?.kind).toBe('chapter');
  });

  it('正文行不误判', () => {
    for (const line of ['第二天一早他出门了', '他说第一章写得不错', '这是普通段落', '']) {
      expect(detectBoundary(line, false)).toBeNull();
    }
  });

  it('Markdown 标题剥前缀后参与匹配，正文标题保留', () => {
    expect(detectBoundary('## 第一章 开端', true)?.title).toBe('第一章 开端');
    expect(detectBoundary('# 第一卷 起源', true)?.kind).toBe('volume');
    expect(detectBoundary('# 书名', true)).toBeNull();
  });
});

describe('parseInline 行内标记', () => {
  it('粗体/斜体/代码 -> marks', () => {
    const nodes = parseInline('前**粗**中*斜*后`码`');
    expect(nodes).toEqual([
      { type: 'text', text: '前' },
      { type: 'text', text: '粗', marks: [{ type: 'bold' }] },
      { type: 'text', text: '中' },
      { type: 'text', text: '斜', marks: [{ type: 'italic' }] },
      { type: 'text', text: '后' },
      { type: 'text', text: '码', marks: [{ type: 'code' }] }
    ]);
  });

  it('空文本返回空数组，纯文本单节点', () => {
    expect(parseInline('')).toEqual([]);
    expect(parseInline('普通')).toEqual([{ type: 'text', text: '普通' }]);
  });
});

describe('parseDocument TXT 切分与文本块', () => {
  it('按卷/章建层级结构，卷头行为独立卷条目', () => {
    const chapters = parseDocument('第一卷 起\n第一章 开端\n他醒了。\n第二章 远行\n她走了。\n第一卷 续\n第三章 归来', {
      markdown: false
    });
    expect(chapters.map((c) => [c.title, c.volume, !!c.isVolume])).toEqual([
      ['第一卷 起', '第一卷 起', true],
      ['第一章 开端', '第一卷 起', false],
      ['第二章 远行', '第一卷 起', false],
      ['第一卷 续', '第一卷 续', true],
      ['第三章 归来', '第一卷 续', false]
    ]);
  });

  it('无边界降级为单章「全文」', () => {
    const chapters = parseDocument('第一段\n\n第二段', { markdown: false });
    expect(chapters).toHaveLength(1);
    expect(chapters[0].title).toBe('全文');
    expect(blocksPlainText(chapters[0].blocks)).toBe('第一段\n第二段');
  });

  it('首个章节前的内容归并进首章', () => {
    const chapters = parseDocument('引言内容\n第一章 开端\n正文', { markdown: false });
    expect(chapters).toHaveLength(1);
    expect(blocksPlainText(chapters[0].blocks)).toBe('引言内容\n正文');
  });

  it('段落剥缩进；整行引号识别为对白块（存裸文本）', () => {
    const chapters = parseDocument('　　他醒了。\n「你终于来了。」\n普通段落', { markdown: false });
    const blocks = chapters[0].blocks;
    expect(blocks[0].type).toBe('paragraph');
    expect(blocksPlainText([blocks[0]])).toBe('他醒了。');
    expect(blocks[1].type).toBe('dialogue');
    expect(blocksPlainText([blocks[1]])).toBe('你终于来了。');
    expect(blocks[2].type).toBe('paragraph');
  });

  it('CRLF 归一化、空行不计段', () => {
    const chapters = parseDocument('第一章 a\r\n段落一\r\n\r\n段落二\r\n', { markdown: false });
    expect(blocksPlainText(chapters[0].blocks)).toBe('段落一\n段落二');
  });
});

describe('parseDocument Markdown 块结构', () => {
  it('标题/引用/分隔线/列表/行内标记', () => {
    const md = [
      '# 卷首语',
      '',
      '## 第一章 开端',
      '正文有**粗体**和*斜体*。',
      '',
      '> 引用一',
      '> 引用二',
      '',
      '- 项目甲',
      '- 项目乙',
      '',
      '---',
      '',
      '1. 其一',
      '2. 其二'
    ].join('\n');
    const chapters = parseDocument(md, { markdown: true });
    // 「# 卷首语」非章节边界 -> 归并进首章，作为标题块保留
    const [intro] = chapters[0].blocks;
    expect(intro).toEqual({ type: 'heading', attrs: { level: 1 }, content: [{ type: 'text', text: '卷首语' }] });
    const b = chapters[0].blocks.slice(1);
    expect(b[0]).toEqual({
      type: 'paragraph',
      content: [
        { type: 'text', text: '正文有' },
        { type: 'text', text: '粗体', marks: [{ type: 'bold' }] },
        { type: 'text', text: '和' },
        { type: 'text', text: '斜体', marks: [{ type: 'italic' }] },
        { type: 'text', text: '。' }
      ]
    });
    expect(b[1].type).toBe('blockquote');
    expect((b[1] as Extract<BlockNode, { type: 'blockquote' }>).content).toHaveLength(2);
    expect(b[2].type).toBe('bulletList');
    expect(b[3].type).toBe('horizontalRule');
    expect(b[4].type).toBe('orderedList');
  });

  it('四级以上标题压到 3 级；图片行降级占位文本', () => {
    const md = '#### 小节\n\n![插图](img.png)\n';
    const chapters = parseDocument(md, { markdown: true });
    expect(chapters[0].blocks[0]).toEqual({
      type: 'heading',
      attrs: { level: 3 },
      content: [{ type: 'text', text: '小节' }]
    });
    expect(blocksPlainText([chapters[0].blocks[1]])).toBe('[图片: 插图]');
  });

  it('引用分组不跨章节边界，各自归属', () => {
    const md = '第一章 开端\n> 引用一\n\n第二章 续\n> 引用二\n';
    const chapters = parseDocument(md, { markdown: true });
    expect(chapters[0].blocks).toHaveLength(1);
    expect(chapters[0].blocks[0].type).toBe('blockquote');
    expect(chapters[1].blocks).toHaveLength(1);
    expect(chapters[1].blocks[0].type).toBe('blockquote');
  });
});

describe('blocksToDoc / docTitleFromFileName', () => {
  it('空块降级单个空段落（与 emptyDoc 语义一致）', () => {
    expect(blocksToDoc([])).toEqual({ type: 'doc', content: [{ type: 'paragraph' }] });
    const doc = blocksToDoc([{ type: 'horizontalRule' }]);
    expect(doc.content).toHaveLength(1);
  });

  it('书名取文件名去扩展名，空名降级', () => {
    expect(docTitleFromFileName('我的小说.txt')).toBe('我的小说');
    expect(docTitleFromFileName('笔记.MD')).toBe('笔记');
    expect(docTitleFromFileName('.txt')).toBe('导入文档');
  });
});

describe('DocImportService 编排', () => {
  interface CreateCall {
    bookId?: string;
    title: string;
    parentId?: string | null;
  }

  function createFixture(fileContent: string) {
    const createCalls: CreateCall[] = [];
    const savedDocs: unknown[] = [];
    let seq = 0;

    const book = { id: 'book-1', title: '书' };
    const books = {
      create: vi.fn(async () => book)
    } as unknown as BookService;

    const chapters = {
      create: vi.fn(async (_bookId: string, input: CreateCall) => {
        createCalls.push(input);
        seq += 1;
        return { id: `ch-${seq}`, bookId: _bookId, ...input } as never;
      }),
      saveContent: vi.fn(async (_id: string, doc: unknown) => {
        savedDocs.push(doc);
        return 0;
      })
    } as unknown as ChapterService;

    const bridge = {
      fs: { readFile: vi.fn(async () => fileContent) }
    } as unknown as NativeBridge;

    const svc = new DocImportService(bridge, books, chapters);
    return { svc, books, chapters, createCalls, savedDocs, bridge };
  }

  it('建书 + 章节按序创建，卷作为父章节，正文经 saveContent 落盘', async () => {
    const content = ['第一卷 起', '第一章 开端', '他醒了。', '第二章 远行', '她走了。', '第三章 归来', '回来了。'].join('\n');
    const { svc, chapters, createCalls, savedDocs } = createFixture(content);

    const r = await svc.importFromFile('D:/books/测试小说.txt');

    expect(r.title).toBe('测试小说');
    expect(r.chapterCount).toBe(3);
    expect(r.volumeCount).toBe(1);
    // 卷 + 3 章：卷无父，三个章全部挂在卷下
    expect(createCalls).toHaveLength(4);
    const volumeCall = createCalls[0];
    expect(volumeCall.parentId).toBeNull();
    const volumeId = 'ch-1';
    for (const c of createCalls.slice(1)) expect(c.parentId).toBe(volumeId);
    expect(chapters.saveContent).toHaveBeenCalledTimes(3);
    // 首章正文为段落 doc
    const firstDoc = savedDocs[0] as { type: string; content: Array<{ type: string }> };
    expect(firstDoc.type).toBe('doc');
    expect(firstDoc.content[0].type).toBe('paragraph');
  });

  it('拒绝不支持扩展名与空内容', async () => {
    const { svc } = createFixture('x');
    await expect(svc.importFromFile('D:/books/书.pdf')).rejects.toThrow('仅支持导入');
    const empty = createFixture('   \n  ');
    await expect(empty.svc.importFromFile('D:/books/空书.txt')).rejects.toThrow('内容为空');
  });

  it('Markdown 内容按 markdown 解析、标题参与切分', async () => {
    const md = '# 第一章 开端\n正文**粗**。\n# 第二章 续\n第二段。';
    const fx = createFixture(md);
    const r = await fx.svc.importFromContent(md, 'MD书', true);
    expect(r.chapterCount).toBe(2);
    expect(fx.createCalls.map((c) => c.title)).toEqual(['第一章 开端', '第二章 续']);
    const doc = fx.savedDocs[0] as { content: Array<{ content?: Array<{ text?: string; marks?: Array<{ type: string }> }> }> };
    const inl = doc.content[0].content ?? [];
    expect(inl.some((n) => n.marks?.[0]?.type === 'bold')).toBe(true);
  });
});
