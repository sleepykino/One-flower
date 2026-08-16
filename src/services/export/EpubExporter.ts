/**
 * EPUB 导出器：直接以 fflate 构造标准 EPUB 3 结构
 * （mimetype + container.xml + content.opf + nav + 章节 xhtml）
 * 说明：epub-gen-memory 依赖 Node 运行时（Buffer），在 Tauri WebView 内不可靠，
 * 故用已引入的 fflate 确定性生成，输出兼容主流阅读器。
 */

import type { ProseMirrorDoc } from '../../types';
import { docToHtml } from '../../utils/pmdoc';
import { ZipWriter } from '../../utils/zipbuilder';
import type { DocExporter } from './ExportService';

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export class EpubExporter implements DocExporter {
  readonly extension = 'epub';
  readonly binary = true;

  convertDoc(_doc: ProseMirrorDoc, _chapterTitle: string): string {
    throw new Error('EPUB 为二进制格式，请使用 exportEpub');
  }

  /** 全书 EPUB 生成（含目录页与章节导航） */
  async exportEpub(
    bookTitle: string,
    author: string,
    chapters: Array<{ title: string; doc: ProseMirrorDoc }>
  ): Promise<Uint8Array> {
    const uuid = crypto.randomUUID();
    const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

    const zip = new ZipWriter();

    // mimetype 必须为首个文件且不压缩（存储）
    const encoder = new TextEncoder();
    zip.addBinary('mimetype', encoder.encode('application/epub+zip'), true);

    zip.addText(
      'META-INF/container.xml',
      `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
    );

    const chapterItems = chapters
      .map((_, i) => `    <item id="ch${i + 1}" href="ch${i + 1}.xhtml" media-type="application/xhtml+xml"/>`)
      .join('\n');
    const spineItems = chapters.map((_, i) => `    <itemref idref="ch${i + 1}"/>`).join('\n');
    const navItems = chapters
      .map((c, i) => `        <li><a href="ch${i + 1}.xhtml">${xmlEscape(c.title)}</a></li>`)
      .join('\n');

    zip.addText(
      'OEBPS/content.opf',
      `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">urn:uuid:${uuid}</dc:identifier>
    <dc:title>${xmlEscape(bookTitle)}</dc:title>
    <dc:creator>${xmlEscape(author || '佚名')}</dc:creator>
    <dc:language>zh</dc:language>
    <meta property="dcterms:modified">${modified}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>
${chapterItems}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>`
    );

    zip.addText(
      'OEBPS/nav.xhtml',
      `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>${xmlEscape(bookTitle)}</title></head>
<body>
  <nav epub:type="toc">
    <h1>${xmlEscape(bookTitle)}</h1>
    <ol>
${navItems}
    </ol>
  </nav>
</body>
</html>`
    );

    zip.addText(
      'OEBPS/style.css',
      `body { font-family: serif; line-height: 1.8; margin: 1em; }
h1, h2, h3 { text-align: center; }
blockquote { border-left: 3px solid #ccc; padding-left: 1em; color: #555; }
p.dialogue { color: #1a6b4a; padding-left: 1em; }`
    );

    chapters.forEach((c, i) => {
      zip.addText(
        `OEBPS/ch${i + 1}.xhtml`,
        `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${xmlEscape(c.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<h2>${xmlEscape(c.title)}</h2>
${docToHtml(c.doc)}
</body>
</html>`
      );
    });

    return zip.finish();
  }
}
