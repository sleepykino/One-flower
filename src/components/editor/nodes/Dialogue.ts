/**
 * 对白节点：段落变体，视觉上左侧强调条 + 深色文字
 */

import { Node, mergeAttributes } from '@tiptap/core';

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    dialogue: {
      toggleDialogue: () => ReturnType;
    };
  }
}

export const Dialogue = Node.create({
  name: 'dialogue',

  group: 'block',
  content: 'inline*',

  parseHTML() {
    return [{ tag: 'p.dialogue' }];
  },

  renderHTML({ HTMLAttributes }) {
    return ['p', mergeAttributes(HTMLAttributes, { class: 'dialogue' }), 0];
  },

  addCommands() {
    return {
      toggleDialogue:
        () =>
        ({ commands, state }) => {
          const { selection } = state;
          const isDialogue = selection.$from.parent.type.name === 'dialogue';
          return isDialogue
            ? commands.setNode('paragraph')
            : commands.setNode('dialogue');
        }
    };
  }
});
