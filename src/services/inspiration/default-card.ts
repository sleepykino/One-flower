/**
 * 默认兜底卡片（P2.1-B M2）：仅 1 张内置卡。
 * 用途：模型未配置 / 无网络 / AI 生成失败时在灵感库页「今日灵感」区块展示，引导用户配置模型。
 * 除此之外所有卡片均为 AI 生成。
 */

import type { InspirationCard } from './types';

export const DEFAULT_CARD: InspirationCard = {
  id: 'builtin-default',
  type: 'quote',
  title: '先写下来',
  content: '灵感不会等你准备好。卡住的时候，先把最糟糕的版本写出来——第一稿的任务是存在，不是完美。',
  tags: ['默认'],
  source: 'builtin',
  createdAt: 0,
  favorited: false
};
