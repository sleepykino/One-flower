/**
 * 正文插图节点（P3）
 * attrs: { assetId, fileName, alt, caption, width(25|50|100), align(left|center|right) }
 * - 图片 src 经 assetProtocol 解析（createImageNode 工厂注入 resolver，含 bookId 上下文）
 * - 图注点击进入编辑态；宽度预设 25/50/100%；对齐 左/中/右
 * - 随章节 JSON 存储与版本管理；导出时按 assetId 找回文件（pmdoc 遍历 imageBlock）
 * - 文件缺失（被手动删除等）显示占位文字，不中断编辑
 */

import { useEffect, useState } from 'react';
import { Node, mergeAttributes } from '@tiptap/core';
import { NodeViewWrapper, ReactNodeViewRenderer, type NodeViewProps } from '@tiptap/react';

type Align = 'left' | 'center' | 'right';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    imageBlock: {
      /** 在光标处插入正文插图 */
      insertIllustration: (asset: { id: string; fileName: string; caption?: string }) => ReturnType;
    };
  }
}

/** fileName（相对 storageDir）-> asset 协议 URL 的解析器（编辑器注入，含 bookId 上下文） */
export type ImageUrlResolver = (fileName: string) => Promise<string | null>;

export function createImageNode(resolveUrl: ImageUrlResolver) {
  return Node.create({
    name: 'imageBlock',
    group: 'block',
    atom: true,
    draggable: true,

    addAttributes() {
      return {
        assetId: { default: null },
        fileName: { default: null },
        alt: { default: '' },
        caption: { default: '' },
        width: { default: 100 }, // 25 | 50 | 100（百分比）
        align: { default: 'center' } // left | center | right
      };
    },

    parseHTML() {
      return [{ tag: 'figure[data-image-block]' }];
    },

    renderHTML({ node, HTMLAttributes }) {
      return [
        'figure',
        mergeAttributes(HTMLAttributes, {
          'data-image-block': '',
          'data-asset-id': String(node.attrs.assetId ?? ''),
          'data-file-name': String(node.attrs.fileName ?? ''),
          'data-width': String(node.attrs.width),
          'data-align': String(node.attrs.align)
        }),
        ['img', { alt: node.attrs.alt }],
        ['figcaption', node.attrs.caption]
      ];
    },

    addNodeView() {
      return ReactNodeViewRenderer((props: NodeViewProps) => (
        <ImageNodeView {...props} resolveUrl={resolveUrl} />
      ));
    },

    addCommands() {
      return {
        insertIllustration:
          (asset) =>
          ({ chain }) =>
            chain()
              .insertContent({
                type: this.name,
                attrs: {
                  assetId: asset.id,
                  fileName: asset.fileName,
                  alt: asset.caption ?? '',
                  caption: asset.caption ?? ''
                }
              })
              .run()
      };
    }
  });
}

function ImageNodeView({
  node,
  updateAttributes,
  selected,
  resolveUrl
}: NodeViewProps & { resolveUrl: ImageUrlResolver }): JSX.Element {
  const [url, setUrl] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [editingCaption, setEditingCaption] = useState(false);
  const [captionDraft, setCaptionDraft] = useState('');
  const fileName = String(node.attrs.fileName ?? '');
  const width = Math.max(25, Math.min(100, Number(node.attrs.width) || 100));
  const align = (String(node.attrs.align ?? 'center') as Align) || 'center';
  const caption = String(node.attrs.caption ?? '');

  useEffect(() => {
    let cancelled = false;
    setMissing(false);
    if (!fileName) {
      setUrl(null);
      return;
    }
    void resolveUrl(fileName).then((u) => {
      if (!cancelled) setUrl(u);
    });
    return () => {
      cancelled = true;
    };
  }, [fileName, resolveUrl]);

  const setWidth = (w: number): void => updateAttributes({ width: w });
  const setAlign = (a: Align): void => updateAttributes({ align: a });

  const startEditCaption = (): void => {
    setCaptionDraft(caption);
    setEditingCaption(true);
  };

  const commitCaption = (): void => {
    updateAttributes({ caption: captionDraft.trim() });
    setEditingCaption(false);
  };

  return (
    <NodeViewWrapper
      as="figure"
      className="node-imageBlock my-4"
      data-align={align}
      style={{
        width: `${width}%`,
        marginInline: align === 'center' ? 'auto' : align === 'left' ? '0 auto 0 0' : '0 0 0 auto'
      }}
    >
      {/* 选中时显示宽度/对齐控制条 */}
      {selected && (
        <div
          contentEditable={false}
          className="mb-1 flex items-center justify-center gap-1 rounded border border-violet-200 bg-violet-50 px-1 py-0.5 text-[10px]"
        >
          <span className="text-ink-400">宽度</span>
          {[25, 50, 100].map((w) => (
            <button
              key={w}
              type="button"
              className={`rounded px-1 py-0.5 ${width === w ? 'bg-violet-600 text-white' : 'hover:bg-violet-100'}`}
              onClick={() => setWidth(w)}
            >
              {w}%
            </button>
          ))}
          <span className="ml-2 text-ink-400">对齐</span>
          {(['left', 'center', 'right'] as Align[]).map((a) => (
            <button
              key={a}
              type="button"
              className={`rounded px-1 py-0.5 ${align === a ? 'bg-violet-600 text-white' : 'hover:bg-violet-100'}`}
              onClick={() => setAlign(a)}
            >
              {a === 'left' ? '左' : a === 'center' ? '中' : '右'}
            </button>
          ))}
        </div>
      )}

      {url && !missing ? (
        <img
          src={url}
          alt={String(node.attrs.alt ?? '')}
          className="w-full rounded border border-ink-100"
          onError={() => setMissing(true)}
        />
      ) : (
        <div
          contentEditable={false}
          className="rounded border border-dashed border-ink-200 bg-ink-50 px-3 py-6 text-center text-xs text-ink-400"
        >
          [图片缺失: {fileName || '未知文件'}]
        </div>
      )}

      {/* 图注：点击进入编辑态 */}
      {editingCaption ? (
        <input
          autoFocus
          value={captionDraft}
          onChange={(e) => setCaptionDraft(e.target.value)}
          onBlur={commitCaption}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Enter' || e.key === 'Escape') commitCaption();
          }}
          onClick={(e) => e.stopPropagation()}
          onPaste={(e) => e.stopPropagation()}
          placeholder="图注…"
          className="mt-1 w-full rounded border border-violet-300 px-2 py-0.5 text-center text-xs text-ink-500 outline-none"
        />
      ) : (
        <div
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            startEditCaption();
          }}
          onKeyDown={(e) => e.stopPropagation()}
          className={`mt-1 w-full cursor-text px-2 py-0.5 text-center text-xs ${
            caption ? 'text-ink-500' : 'text-ink-300'
          } hover:bg-violet-50`}
          title="点击编辑图注"
        >
          {caption || '（点击添加图注）'}
        </div>
      )}
    </NodeViewWrapper>
  );
}
