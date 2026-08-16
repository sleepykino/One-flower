/**
 * 世界书引用节点：输入 [[ 触发条目选择，插入 inline 原子节点
 */

import { Node, mergeAttributes } from '@tiptap/core';

export interface WorldbookRefOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    worldbookRef: {
      /** 在光标处插入世界书引用节点 */
      insertWorldbookRef: (id: string, title: string) => ReturnType;
    };
  }
}

export const WorldbookRef = Node.create<WorldbookRefOptions>({
  name: 'worldbookRef',

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
    return [{ tag: 'span[data-worldbook-ref]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-worldbook-ref': '',
        class: 'node-worldbookRef'
      }),
      `[[${node.attrs.title ?? ''}]]`
    ];
  },

  addCommands() {
    return {
      insertWorldbookRef:
        (id: string, title: string) =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name, attrs: { id, title } })
            .run()
    };
  }
});
