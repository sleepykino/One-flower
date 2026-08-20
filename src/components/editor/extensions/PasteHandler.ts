/**
 * 粘贴清洗：粘贴内容强制转为纯文本，经 ProseMirror Schema 重新解析，
 * 去除外部富文本格式（字体/颜色/字号等污染）
 * 保留换行：按行拆分为多个段落，避免粘贴整章内容时丢失换行
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';
import { Fragment, Slice, type Node as PMNode } from '@tiptap/pm/model';

export const PasteHandler = Extension.create({
  name: 'pasteHandler',

  addProseMirrorPlugins() {
    return [
      new Plugin({
        key: new PluginKey('pasteHandler'),
        props: {
          handlePaste: (view, event) => {
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
          }
        }
      })
    ];
  }
});
