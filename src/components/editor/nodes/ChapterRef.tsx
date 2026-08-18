/**
 * 章节引用节点（P2.1-M2）：输入 ## 触发章节选择，插入 inline 原子节点
 * 模式照抄 WorldbookRef（触发符不同）
 */

import { Node, mergeAttributes } from '@tiptap/core';

export interface ChapterRefOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    chapterRef: {
      /** 在光标处插入章节引用节点 */
      insertChapterRef: (id: string, title: string) => ReturnType;
    };
  }
}

export const ChapterRef = Node.create<ChapterRefOptions>({
  name: 'chapterRef',

  addOptions() {
    return { HTMLAttributes: {} };
  },

  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id: { default: null },
      title: { default: null }
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-chapter-ref]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-chapter-ref': '',
        class: 'node-chapterRef'
      }),
      `##${node.attrs.title ?? ''}`
    ];
  },

  addCommands() {
    return {
      insertChapterRef:
        (id: string, title: string) =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name, attrs: { id, title } })
            .run()
    };
  }
});
