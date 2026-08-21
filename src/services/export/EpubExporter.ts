/**
 * EPUB 导出器：直接以 fflate 构造标准 EPUB 3 结构
 * （mimetype + container.xml + content.opf + nav + 章节 xhtml）
 * 说明：epub-gen-memory 依赖 Node 运行时（Buffer），在 Tauri WebView 内不可靠，
 * 故用已引入的 fflate 确定性生成，输出兼容主流阅读器。
 *
 * P3：封面（OPF metadata + 封面页）+ 正文插图内嵌（manifest + xhtml img）；
 * 图片缺失时降级为占位文字，不中断导出。
 */

import type { ProseMirrorDoc } from '../../types';
import { docToHtml } from '../../utils/pmdoc';
import { extOfMime } from '../../utils/imageMeta';
import { ZipWriter } from '../../utils/zipbuilder';
import type { DocExporter, ExportImage } from './ExportService';

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 导出选项：封面图片 + 按资产 ID 解析插图 */
export interface EpubExportOptions {
  cover?: ExportImage | null;
  getImage?: (assetId: string) => ExportImage | null;
}

export class EpubExporter implements DocExporter {
  readonly extension = 'epub';
  readonly binary = true;

  convertDoc(_doc: ProseMirrorDoc, _chapterTitle: string): string {
    throw new Error('EPUB 为二进制格式，请使用 exportEpub');
  }

  /** 全书 EPUB 生成（含封面页、目录页与章节导航、正文插图） */
  async exportEpub(
    bookTitle: string,
    author: string,
    chapters: Array<{ title: string; doc: ProseMirrorDoc }>,
    opts?: EpubExportOptions
  ): Promise<Uint8Array> {
    const uuid = crypto.randomUUID();
    const modified = new Date().toISOString().replace(/\.\d+Z$/, 'Z');

    const zip = new ZipWriter();

    // 收集需要入包的图片：href -> 图片字节（先收集后入包，manifest 需完整清单）
    const images = new Map<string, ExportImage>();
    const imageItems: string[] = [];
    const registerImage = (img: ExportImage, preferredId?: string): string => {
      const href = `images/${preferredId ?? img.assetId}.${extOfMime(img.mimeType)}`;
      if (!images.has(href)) {
        images.set(href, img);
        imageItems.push(
          `    <item id="img${images.size}" href="${xmlEscape(href)}" media-type="${xmlEscape(img.mimeType)}"/>`
        );
      }
      return href;
    };

    // 封面（OPF metadata + 封面页）
    const cover = opts?.cover ?? null;
    let coverHref: string | null = null;
    if (cover) {
      coverHref = registerImage(cover, 'cover');
      // 封面 manifest 项需带 properties="cover-image"：替换刚生成的普通 item
      imageItems[imageItems.length - 1] =
        `    <item id="cover-image" href="${xmlEscape(coverHref)}" media-type="${xmlEscape(cover.mimeType)}" properties="cover-image"/>`;
    }

    // 章节正文（图片经 resolver 注册进包并转为相对 href）
    const resolveImageSrc = (attrs: { assetId: string }): string | null => {
      const img = opts?.getImage?.(attrs.assetId);
      if (!img) return null; // 缺图降级为占位文字
      return registerImage(img);
    };
    const chapterBodies = chapters.map((c) => docToHtml(c.doc, { resolveImageSrc }));

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
    const spineItems = [
      ...(cover ? ['    <itemref idref="cover-page"/>'] : []),
      ...chapters.map((_, i) => `    <itemref idref="ch${i + 1}"/>`)
    ].join('\n');
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
    <meta property="dcterms:modified">${modified}</meta>${cover ? '\n    <meta name="cover" content="cover-image"/>' : ''}
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="css" href="style.css" media-type="text/css"/>${cover ? '\n    <item id="cover-page" href="cover.xhtml" media-type="application/xhtml+xml"/>' : ''}
${chapterItems}
${imageItems.join('\n')}
  </manifest>
  <spine>
${spineItems}
  </spine>
</package>`
    );

    // 封面页（整页封面图）
    if (cover && coverHref) {
      zip.addText(
        'OEBPS/cover.xhtml',
        `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head><title>封面</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
  <div epub:type="cover" class="cover-page">
    <img src="${xmlEscape(coverHref)}" alt="${xmlEscape(bookTitle)}"/>
  </div>
</body>
</html>`
      );
    }

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
p.dialogue { color: #1a6b4a; padding-left: 1em; }
figure.image-block { margin: 1em auto; }
figure.image-block img { max-width: 100%; }
figure.image-block figcaption { text-align: center; font-size: 0.85em; color: #666; }
p.image-missing { color: #999; text-align: center; border: 1px dashed #ccc; padding: 0.5em; }
.cover-page { text-align: center; margin: 0; padding: 0; }
.cover-page img { max-width: 100%; max-height: 100vh; }`
    );

    chapters.forEach((c, i) => {
      zip.addText(
        `OEBPS/ch${i + 1}.xhtml`,
        `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml">
<head><title>${xmlEscape(c.title)}</title><link rel="stylesheet" type="text/css" href="style.css"/></head>
<body>
<h2>${xmlEscape(c.title)}</h2>
${chapterBodies[i]}
</body>
</html>`
      );
    });

    // 图片二进制入包
    for (const [href, img] of images) {
      zip.addBinary(`OEBPS/${href}`, img.bytes);
    }

    return zip.finish();
  }
}
