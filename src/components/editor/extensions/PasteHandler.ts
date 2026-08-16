/**
 * 粘贴清洗：粘贴内容强制转为纯文本，经 ProseMirror Schema 重新解析，
 * 去除外部富文本格式（字体/颜色/字号等污染）
 */

import { Extension } from '@tiptap/core';
import { Plugin, PluginKey } from '@tiptap/pm/state';

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
            const lines = text.split(/\r?\n/).filter((l) => l.length > 0);
            const { state, dispatch } = view;
            const { tr, selection } = state;
            tr.replaceSelectionWith(
              state.schema.nodes.paragraph.create(null, lines.length ? state.schema.text(lines.join(' ')) : null)
            );
            // 多段落简化为一行合入（避免粘贴整章网页乱结构）
            void selection;
            dispatch(tr.scrollIntoView());
            return true;
          }
        }
      })
    ];
  }
});
