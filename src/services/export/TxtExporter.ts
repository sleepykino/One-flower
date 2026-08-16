/**
 * TXT 导出器：ProseMirror → 纯文本，段落间空行
 */

import type { ProseMirrorDoc } from '../../types';
import { docToPlainText } from '../../utils/pmdoc';
import type { DocExporter } from './ExportService';

export class TxtExporter implements DocExporter {
  readonly extension = 'txt';
  readonly binary = false;

  convertDoc(doc: ProseMirrorDoc, chapterTitle: string): string {
    const body = docToPlainText(doc);
    return `${chapterTitle}\n\n${body}\n`;
  }
}
