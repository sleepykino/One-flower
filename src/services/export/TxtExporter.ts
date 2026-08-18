/**
 * TXT 导出器：ProseMirror → 纯文本，段落间空行
 */

import type { ProseMirrorDoc } from '../../types';
import { docToPlainText } from '../../utils/pmdoc';
import { stripReferenceMarks } from '../../utils/referenceMarks';
import type { DocExporter } from './ExportService';

export class TxtExporter implements DocExporter {
  readonly extension = 'txt';
  readonly binary = false;

  convertDoc(doc: ProseMirrorDoc, chapterTitle: string): string {
    // P2.1-M2：引用节点已转为纯名字，另清洗正文中以纯文本形式残留的 @ / [[ ]] / ## 标记
    const body = stripReferenceMarks(docToPlainText(doc));
    return `${chapterTitle}\n\n${body}\n`;
  }
}
