/**
 * 角色提及节点：输入 @ 触发角色选择，插入 inline 原子节点
 */

import { Node, mergeAttributes } from '@tiptap/core';

export interface CharacterMentionOptions {
  HTMLAttributes: Record<string, unknown>;
}

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    characterMention: {
      /** 在光标处插入角色提及节点 */
      insertCharacterMention: (id: string, name: string) => ReturnType;
    };
  }
}

export const CharacterMention = Node.create<CharacterMentionOptions>({
  name: 'characterMention',

  addOptions() {
    return { HTMLAttributes: {} };
  },

  group: 'inline',
  inline: true,
  atom: true,

  addAttributes() {
    return {
      id: { default: null },
      name: { default: null }
    };
  },

  parseHTML() {
    return [{ tag: 'span[data-character-mention]' }];
  },

  renderHTML({ node, HTMLAttributes }) {
    return [
      'span',
      mergeAttributes(this.options.HTMLAttributes, HTMLAttributes, {
        'data-character-mention': '',
        class: 'node-characterMention'
      }),
      `@${node.attrs.name ?? ''}`
    ];
  },

  addCommands() {
    return {
      insertCharacterMention:
        (id: string, name: string) =>
        ({ chain }) =>
          chain()
            .insertContent({ type: this.name, attrs: { id, name } })
            .run()
    };
  }
});
