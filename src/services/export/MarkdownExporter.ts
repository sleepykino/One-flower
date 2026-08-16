/**
 * Markdown 导出器：ProseMirror → Markdown
 * 实现上直接遍历文档 JSON（turndown 用于导入 HTML 的场景，正文导出用确定性遍历）
 */

import type { ProseMirrorDoc } from '../../types';
import { docToMarkdown } from '../../utils/pmdoc';
import type { DocExporter } from './ExportService';

export class MarkdownExporter implements DocExporter {
  readonly extension = 'md';
  readonly binary = false;

  convertDoc(doc: ProseMirrorDoc, chapterTitle: string): string {
    const body = docToMarkdown(doc);
    return `# ${chapterTitle}\n\n${body}\n`;
  }
}
