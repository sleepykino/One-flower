/**
 * Markdown 导出器：ProseMirror -> Markdown
 * 实现上直接遍历文档 JSON（turndown 用于导入 HTML 的场景，正文导出用确定性遍历）
 *
 * P3：插图转为相对路径引用（images/xxx.png），文件由 ExportService 复制到输出目录；
 * 缺图降级为占位文字。
 */

import type { ProseMirrorDoc } from '../../types';
import { docToMarkdown } from '../../utils/pmdoc';
import { stripReferenceMarks } from '../../utils/referenceMarks';
import type { DocExporter, MarkdownConvertOptions } from './ExportService';

export class MarkdownExporter implements DocExporter {
  readonly extension = 'md';
  readonly binary = false;

  convertDoc(doc: ProseMirrorDoc, chapterTitle: string, opts?: MarkdownConvertOptions): string {
    // P2.1-M2：引用节点已转为纯名字，另清洗正文纯文本残留标记（不动 Markdown 标题语法 #/##/###）
    const body = stripReferenceMarks(docToMarkdown(doc, { resolveImageSrc: opts?.resolveImageSrc }));
    return `# ${chapterTitle}\n\n${body}\n`;
  }
}
