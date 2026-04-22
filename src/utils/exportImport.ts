import { ElMessage } from 'element-plus'

export interface Chapter {
  id: string
  title: string
  content: string
  wordCount: number
}

export interface ExportOptions {
  includeMetadata?: boolean
  chapterTitlePrefix?: string
}

function htmlToMarkdown(html: string): string {
  let markdown = html
  
  markdown = markdown.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '# $1\n\n')
  markdown = markdown.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '## $1\n\n')
  markdown = markdown.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '### $1\n\n')
  markdown = markdown.replace(/<h4[^>]*>(.*?)<\/h4>/gi, '#### $1\n\n')
  markdown = markdown.replace(/<h5[^>]*>(.*?)<\/h5>/gi, '##### $1\n\n')
  markdown = markdown.replace(/<h6[^>]*>(.*?)<\/h6>/gi, '###### $1\n\n')
  
  markdown = markdown.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '**$1**')
  markdown = markdown.replace(/<b[^>]*>(.*?)<\/b>/gi, '**$1**')
  markdown = markdown.replace(/<em[^>]*>(.*?)<\/em>/gi, '*$1*')
  markdown = markdown.replace(/<i[^>]*>(.*?)<\/i>/gi, '*$1*')
  markdown = markdown.replace(/<s[^>]*>(.*?)<\/s>/gi, '~~$1~~')
  markdown = markdown.replace(/<strike[^>]*>(.*?)<\/strike>/gi, '~~$1~~')
  
  markdown = markdown.replace(/<ul[^>]*>(.*?)<\/ul>/gi, '$1\n')
  markdown = markdown.replace(/<ol[^>]*>(.*?)<\/ol>/gi, '$1\n')
  markdown = markdown.replace(/<li[^>]*>(.*?)<\/li>/gi, '- $1\n')
  
  markdown = markdown.replace(/<a[^>]*href="([^"]*)"[^>]*>(.*?)<\/a>/gi, '[$2]($1)')
  markdown = markdown.replace(/<img[^>]*src="([^"]*)"[^>]*alt="([^"]*)"[^>]*\/?>/gi, '![$2]($1)')
  
  markdown = markdown.replace(/<br\s*\/?>/gi, '\n')
  markdown = markdown.replace(/<p[^>]*>(.*?)<\/p>/gi, '$1\n\n')
  markdown = markdown.replace(/<div[^>]*>(.*?)<\/div>/gi, '$1\n')
  
  markdown = markdown.replace(/<[^>]+>/g, '')
  
  markdown = markdown.replace(/&nbsp;/g, ' ')
  markdown = markdown.replace(/&lt;/g, '<')
  markdown = markdown.replace(/&gt;/g, '>')
  markdown = markdown.replace(/&amp;/g, '&')
  markdown = markdown.replace(/&quot;/g, '"')
  
  markdown = markdown.replace(/\n{3,}/g, '\n\n')
  markdown = markdown.trim()
  
  return markdown
}

function markdownToHtml(markdown: string): string {
  let html = markdown
  
  html = html.replace(/^###### (.*$)/gim, '<h6>$1</h6>')
  html = html.replace(/^##### (.*$)/gim, '<h5>$1</h5>')
  html = html.replace(/^#### (.*$)/gim, '<h4>$1</h4>')
  html = html.replace(/^### (.*$)/gim, '<h3>$1</h3>')
  html = html.replace(/^## (.*$)/gim, '<h2>$1</h2>')
  html = html.replace(/^# (.*$)/gim, '<h1>$1</h1>')
  
  html = html.replace(/\*\*\*(.*?)\*\*\*/g, '<strong><em>$1</em></strong>')
  html = html.replace(/\*\*(.*?)\*\*/g, '<strong>$1</strong>')
  html = html.replace(/\*(.*?)\*/g, '<em>$1</em>')
  html = html.replace(/~~(.*?)~~/g, '<s>$1</s>')
  
  html = html.replace(/^\- (.*$)/gim, '<li>$1</li>')
  html = html.replace(/(<li>.*<\/li>)/s, '<ul>$1</ul>')
  
  html = html.replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
  html = html.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
  
  html = html.replace(/\n\n/g, '</p><p>')
  html = html.replace(/\n/g, '<br>')
  html = '<p>' + html + '</p>'
  
  html = html.replace(/<p><\/p>/g, '')
  html = html.replace(/<p>(<h[1-6]>)/g, '$1')
  html = html.replace(/(<\/h[1-6]>)<\/p>/g, '$1')
  html = html.replace(/<p>(<ul>)/g, '$1')
  html = html.replace(/(<\/ul>)<\/p>/g, '$1')
  
  return html
}

export function exportToTxt(chapters: Chapter[], filename?: string): void {
  let txtContent = ''
  
  chapters.forEach((chapter, index) => {
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = chapter.content || ''
    const plainText = tempDiv.textContent || tempDiv.innerText || ''
    
    txtContent += `${chapter.title}\n\n`
    txtContent += `${plainText}\n\n`
    if (index < chapters.length - 1) {
      txtContent += '---\n\n'
    }
  })

  const blob = new Blob([txtContent], { type: 'text/plain;charset=utf-8' })
  downloadBlob(blob, filename || `小说_${getDateString()}.txt`)
  ElMessage.success('TXT导出成功')
}

export function exportToMarkdown(chapters: Chapter[], filename?: string, options: ExportOptions = {}): void {
  let markdownContent = ''
  
  if (options.includeMetadata) {
    markdownContent += `# 小说创作\n\n`
    markdownContent += `> 导出时间: ${new Date().toLocaleString()}\n\n`
    markdownContent += `> 总章节: ${chapters.length}\n\n`
    markdownContent += `> 总字数: ${chapters.reduce((sum, ch) => sum + ch.wordCount, 0)}\n\n`
    markdownContent += `---\n\n`
  }
  
  chapters.forEach((chapter, index) => {
    const prefix = options.chapterTitlePrefix || ''
    markdownContent += `## ${prefix}${chapter.title}\n\n`
    
    const markdown = htmlToMarkdown(chapter.content || '')
    markdownContent += markdown + '\n\n'
    
    if (index < chapters.length - 1) {
      markdownContent += '---\n\n'
    }
  })

  const blob = new Blob([markdownContent], { type: 'text/markdown;charset=utf-8' })
  downloadBlob(blob, filename || `小说_${getDateString()}.md`)
  ElMessage.success('Markdown导出成功')
}

export async function exportToEpub(chapters: Chapter[], filename?: string): Promise<void> {
  try {
    const JSZip = await import('jszip').then(module => module.default).catch(() => {
      throw new Error('EPUB导出功能需要安装jszip库。请运行: npm install jszip')
    })
    
    if (!JSZip) {
      throw new Error('EPUB导出功能需要安装jszip库。请运行: npm install jszip')
    }
    
    const zip = new JSZip()
    
    const uuid = 'urn:uuid:' + generateUUID()
    const now = new Date()
    const dateStr = now.toISOString()
    
    const mimetype = 'application/epub+zip'
    zip.file('mimetype', mimetype)
    
    const metaInf = zip.folder('META-INF')
    const containerXml = `<?xml version="1.0" encoding="UTF-8"?>
<container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container">
  <rootfiles>
    <rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/>
  </rootfiles>
</container>`
    metaInf?.file('container.xml', containerXml)
    
    const oebps = zip.folder('OEBPS')
    
    const contentOpf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="BookId">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="BookId">${uuid}</dc:identifier>
    <dc:title>小说创作</dc:title>
    <dc:language>zh-CN</dc:language>
    <dc:creator>一花一世界</dc:creator>
    <meta property="dcterms:modified">${dateStr}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="ncx" href="toc.ncx" media-type="application/x-dtbncx+xml"/>
    ${chapters.map((_, index) => `<item id="chapter${index + 1}" href="chapter${index + 1}.xhtml" media-type="application/xhtml+xml"/>`).join('\n    ')}
    <item id="style" href="style.css" media-type="text/css"/>
  </manifest>
  <spine toc="ncx">
    <itemref idref="nav"/>
    ${chapters.map((_, index) => `<itemref idref="chapter${index + 1}"/>`).join('\n    ')}
  </spine>
</package>`
    oebps?.file('content.opf', contentOpf)
    
    const tocNcx = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1">
  <head>
    <meta name="dtb:uid" content="${uuid}"/>
    <meta name="dtb:depth" content="1"/>
    <meta name="dtb:totalPageCount" content="0"/>
    <meta name="dtb:maxPageNumber" content="0"/>
  </head>
  <navMap>
    <navPoint id="navpoint-0" playOrder="0">
      <navLabel><text>目录</text></navLabel>
      <content src="nav.xhtml"/>
    </navPoint>
    ${chapters.map((chapter, index) => `<navPoint id="navpoint-${index + 1}" playOrder="${index + 1}">
      <navLabel><text>${chapter.title}</text></navLabel>
      <content src="chapter${index + 1}.xhtml"/>
    </navPoint>`).join('\n    ')}
  </navMap>
</ncx>`
    oebps?.file('toc.ncx', tocNcx)
    
    const navXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops">
<head>
  <title>目录</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <nav epub:type="toc">
    <h1>目录</h1>
    <ol>
      ${chapters.map((chapter, index) => `<li><a href="chapter${index + 1}.xhtml">${chapter.title}</a></li>`).join('\n      ')}
    </ol>
  </nav>
</body>
</html>`
    oebps?.file('nav.xhtml', navXhtml)
    
    const styleCss = `body {
  font-family: "Noto Serif SC", "Source Han Serif CN", serif;
  line-height: 1.8;
  margin: 2em;
  text-align: justify;
}

h1, h2, h3 {
  text-align: center;
  margin: 1.5em 0;
}

p {
  text-indent: 2em;
  margin: 0.5em 0;
}`
    oebps?.file('style.css', styleCss)
    
    chapters.forEach((chapter, index) => {
      const chapterContent = chapter.content || ''
      const plainText = convertHtmlToEpubHtml(chapterContent)
      
      const chapterXhtml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml">
<head>
  <title>${chapter.title}</title>
  <link rel="stylesheet" type="text/css" href="style.css"/>
</head>
<body>
  <h2>${chapter.title}</h2>
  ${plainText}
</body>
</html>`
      oebps?.file(`chapter${index + 1}.xhtml`, chapterXhtml)
    })
    
    const blob = await zip.generateAsync({ type: 'blob', mimeType: 'application/epub+zip' })
    downloadBlob(blob, filename || `小说_${getDateString()}.epub`)
    ElMessage.success('EPUB导出成功')
  } catch (error) {
    console.error('EPUB导出错误:', error)
    ElMessage.error('EPUB导出失败，请确保已安装jszip库')
  }
}

function convertHtmlToEpubHtml(html: string): string {
  let epubHtml = html
  
  epubHtml = epubHtml.replace(/<h1[^>]*>(.*?)<\/h1>/gi, '<h1>$1</h1>')
  epubHtml = epubHtml.replace(/<h2[^>]*>(.*?)<\/h2>/gi, '<h2>$1</h2>')
  epubHtml = epubHtml.replace(/<h3[^>]*>(.*?)<\/h3>/gi, '<h3>$1</h3>')
  
  epubHtml = epubHtml.replace(/<p[^>]*>(.*?)<\/p>/gi, '<p>$1</p>')
  epubHtml = epubHtml.replace(/<strong[^>]*>(.*?)<\/strong>/gi, '<strong>$1</strong>')
  epubHtml = epubHtml.replace(/<em[^>]*>(.*?)<\/em>/gi, '<em>$1</em>')
  
  epubHtml = epubHtml.replace(/style="[^"]*"/gi, '')
  epubHtml = epubHtml.replace(/class="[^"]*"/gi, '')
  
  return epubHtml
}

export function importFromMarkdown(markdown: string): Chapter[] {
  const chapters: Chapter[] = []
  
  const parts = markdown.split(/^---\s*$/m)
  
  parts.forEach((part, index) => {
    const lines = part.trim().split('\n')
    let title = `第${index + 1}章`
    let contentStartIndex = 0
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line.startsWith('## ')) {
        title = line.substring(3).trim()
        contentStartIndex = i + 1
        break
      } else if (line.startsWith('# ')) {
        continue
      } else if (line.startsWith('> ')) {
        continue
      } else if (line.length > 0) {
        contentStartIndex = i
        break
      }
    }
    
    const contentMarkdown = lines.slice(contentStartIndex).join('\n')
    const contentHtml = markdownToHtml(contentMarkdown)
    
    const tempDiv = document.createElement('div')
    tempDiv.innerHTML = contentHtml
    const wordCount = (tempDiv.textContent || tempDiv.innerText || '').replace(/\s/g, '').length
    
    chapters.push({
      id: Date.now().toString() + index,
      title,
      content: contentHtml,
      wordCount
    })
  })
  
  return chapters
}

export function importFromTxt(txt: string): Chapter[] {
  const chapters: Chapter[] = []
  
  const parts = txt.split(/^---\s*$/m)
  
  parts.forEach((part, index) => {
    const lines = part.trim().split('\n')
    let title = `第${index + 1}章`
    let contentStartIndex = 0
    
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i].trim()
      if (line.length > 0 && !line.startsWith('---')) {
        if (i === 0 || (i < 3 && lines.slice(0, i).every(l => l.trim().length === 0))) {
          title = line
          contentStartIndex = i + 1
        } else {
          contentStartIndex = i
        }
        break
      }
    }
    
    const content = lines.slice(contentStartIndex).join('\n')
    const contentHtml = content.split('\n\n').map(p => `<p>${p}</p>`).join('')
    const wordCount = content.replace(/\s/g, '').length
    
    chapters.push({
      id: Date.now().toString() + index,
      title,
      content: contentHtml,
      wordCount
    })
  })
  
  return chapters
}

function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  setTimeout(() => {
    document.body.removeChild(link)
    URL.revokeObjectURL(url)
  }, 100)
}

function getDateString(): string {
  return new Date().toLocaleDateString().replace(/\//g, '-')
}

function generateUUID(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function(c) {
    const r = Math.random() * 16 | 0
    const v = c === 'x' ? r : (r & 0x3 | 0x8)
    return v.toString(16)
  })
}

export function readFileAsText(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = (e) => {
      resolve(e.target?.result as string)
    }
    reader.onerror = (e) => {
      reject(e)
    }
    reader.readAsText(file, 'UTF-8')
  })
}
