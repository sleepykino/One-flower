import { describe, expect, it } from 'vitest';
import type { ProseMirrorDoc } from '../../src/types';
import { removeImageRefs, removeWorldbookRefs } from '../../src/utils/pmdoc';

// 阶段 5 改进项 1 闭环（2026-08-25）：图片/世界书强删后正文悬挂引用联动清理的纯函数单测
// removeImageRefs(doc, assetId)：按 attrs.assetId 过滤 imageBlock 块节点
// removeWorldbookRefs(doc, entryId)：按 attrs.id 过滤 worldbookRef 原子节点（阶段 3 已闭环，回归）

function makeDoc(blocks: Array<Record<string, unknown>>): ProseMirrorDoc {
  return { type: 'doc', content: blocks as never };
}

describe('removeImageRefs', () => {
  it('移除匹配 assetId 的顶层 imageBlock 节点并计数', () => {
    const doc = makeDoc([
      { type: 'paragraph', content: [{ type: 'text', text: '正文' }] },
      { type: 'imageBlock', attrs: { assetId: 'a1', fileName: 'x.png' } },
      { type: 'imageBlock', attrs: { assetId: 'a2', fileName: 'y.png' } }
    ]);
    const { doc: next, count } = removeImageRefs(doc, 'a1');
    expect(count).toBe(1);
    expect((next.content as unknown[]).filter((b) => (b as { type: string }).type === 'imageBlock')).toHaveLength(1);
    expect(doc.content).toHaveLength(3); // 原文档不被修改（纯函数）
  });

  it('嵌套子节点中的 imageBlock 一并移除', () => {
    const doc = makeDoc([
      { type: 'blockquote', content: [{ type: 'imageBlock', attrs: { assetId: 'a1' } }] }
    ]);
    const { doc: next, count } = removeImageRefs(doc, 'a1');
    expect(count).toBe(1);
    const quote = next.content?.[0] as { content?: unknown[] };
    expect(quote.content).toHaveLength(0);
  });

  it('无匹配时返回原文档结构且计数为 0', () => {
    const doc = makeDoc([
      { type: 'imageBlock', attrs: { assetId: 'a1' } },
      { type: 'paragraph', content: [{ type: 'text', text: '正文' }] }
    ]);
    const { doc: next, count } = removeImageRefs(doc, 'none');
    expect(count).toBe(0);
    expect((next.content as unknown[]).length).toBe(2);
  });

  it('只删图片节点，不误删普通段落/其他块', () => {
    const doc = makeDoc([
      { type: 'paragraph', content: [{ type: 'text', text: '正文' }] },
      { type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: '标题' }] },
      { type: 'imageBlock', attrs: { assetId: 'a1' } }
    ]);
    const { doc: next, count } = removeImageRefs(doc, 'a1');
    expect(count).toBe(1);
    expect((next.content as { type: string }[]).map((b) => b.type)).toEqual(['paragraph', 'heading']);
  });
});

describe('removeWorldbookRefs（阶段 3 回归）', () => {
  it('按 attrs.id 过滤 worldbookRef 原子节点', () => {
    const doc = makeDoc([
      {
        type: 'paragraph',
        content: [
          { type: 'text', text: '提到' },
          { type: 'worldbookRef', attrs: { id: 'e1', title: '雾隐山' } },
          { type: 'worldbookRef', attrs: { id: 'e2', title: '灵境' } }
        ]
      }
    ]);
    const { doc: next, count } = removeWorldbookRefs(doc, 'e1');
    expect(count).toBe(1);
    const para = next.content?.[0] as { content?: unknown[] };
    expect(para.content).toHaveLength(2); // text + e2
  });
});
