/**
 * 粘贴清洗：粘贴内容强制转为纯文本，经 ProseMirror Schema 重新解析，
 * 去除外部富文本格式（字体/颜色/字号等污染）
 * 保留换行：按行拆分为多个段落，避免粘贴整章内容时丢失换行
 *
 * P3 扩展：粘贴 / 拖入本地图片 -> 自动入库 {storageDir}/assets 并在光标（或拖放点）插入 imageBlock
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';
import { getAppContext } from '../../../context/app-context';
import { sniffImageMime } from '../../../utils/imageMeta';

export interface PasteHandlerOptions {
  /** 当前书籍 id（图片入库归属） */
  getBookId: () => string;
}

export function createPasteHandler(options: PasteHandlerOptions) {
  return Extension.create({
    name: 'pasteHandler',

    addProseMirrorPlugins() {
      const key = new PluginKey('pasteHandler');

      /** 图片文件 -> 入库 + 在指定位置插入 imageBlock 节点 */
      const insertImageFiles = async (
        view: import('@tiptap/pm/view').EditorView,
        files: File[],
        pos: number
      ): Promise<void> => {
        const bookId = options.getBookId();
        const { imageAssetService } = getAppContext();
        for (const file of files) {
          try {
            const bytes = new Uint8Array(await file.arrayBuffer());
            const mime = file.type?.startsWith('image/')
              ? file.type
              : sniffImageMime(bytes) !== 'application/octet-stream'
                ? sniffImageMime(bytes)
                : '';
            if (!mime) continue;
            const asset = await imageAssetService.importFromBytes(bookId, bytes, mime, 'illustration');
            const node = view.state.schema.nodes.imageBlock?.create({
              assetId: asset.id,
              fileName: asset.fileName,
              alt: '',
              caption: ''
            });
            if (node) {
              const tr = view.state.tr.insert(pos, node);
              tr.scrollIntoView();
              view.dispatch(tr);
            }
          } catch (e) {
            console.error('图片入库失败', e);
          }
        }
      };

      return [
        new Plugin({
          key,
          props: {
            handlePaste: (view, event) => {
              // 优先处理剪贴板中的图片文件
              const files = Array.from(event.clipboardData?.files ?? []).filter(
                (f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name)
              );
              if (files.length > 0) {
                event.preventDefault();
                void insertImageFiles(view, files, view.state.selection.to);
                return true;
              }

              event.preventDefault();
              const text =
                event.clipboardData?.getData('text/plain') ??
                event.clipboardData?.getData('text/html') ??
                '';
              if (!text) return true;
              const schema = view.state.schema;
              // 仅换行（无文本内容）的部分不计段；连续空行合并为一次分段
              const blocks = text
                .replace(/\r\n?/g, '\n')
                .split(/\n+/)
                .map((s) => s.trim())
                .filter(Boolean)
                .map((s) => schema.nodes.paragraph.create(null, schema.text(s)));
              const content: PMNode[] =
                blocks.length > 0 ? blocks : [schema.nodes.paragraph.create()];
              const tr = view.state.tr;
              const slice = Slice.maxOpen(Fragment.fromArray(content));
              tr.replaceSelection(slice).scrollIntoView();
              view.dispatch(tr);
              return true;
            },
            handleDrop: (view, event) => {
              const files = Array.from(event.dataTransfer?.files ?? []).filter(
                (f) => f.type.startsWith('image/') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(f.name)
              );
              if (files.length === 0) return false; // 非图片拖放走默认行为
              event.preventDefault();
              const pos =
                view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ??
                view.state.selection.to;
              void insertImageFiles(view, files, pos);
              return true;
            }
          }
        })
      ];
    }
  });
}
