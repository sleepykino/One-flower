/**
 * AI 流式临时节点：灰色斜体块，流式输出期间承载生成内容，
 * 完成后标记 done，由用户三选项决定保留 / 丢弃 / 继续
 */

import { Node, mergeAttributes } from '@tiptap/core';

export const AITemporaryNode = Node.create({
  name: 'aiTemp',

  group: 'block',
  content: 'block+',
  defining: true,
  isolating: true,

  addAttributes() {
    return {
      done: { default: false }
    };
  },

  parseHTML() {
    return [{ tag: 'div[data-ai-temp]' }];
  },

  renderHTML({ HTMLAttributes }) {
    return [
      'div',
      mergeAttributes(HTMLAttributes, {
        'data-ai-temp': '',
        class: HTMLAttributes.done ? 'ai-temp-node done' : 'ai-temp-node'
      }),
      0
    ];
  }
});
