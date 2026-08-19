/**
 * 轻量 Markdown 渲染（灵感卡片等 AI 返回内容展示用，不引入第三方库）
 * 安全策略：先转义全部 HTML，再做标记转换；链接仅放行 http(s)
 * 支持：标题 / 加粗 / 斜体 / 行内代码 / 代码块 / 引用 / 有序无序列表 / 分隔线 / 链接 / 换行
 */

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/** 行内标记：代码 -> 加粗 -> 斜体 -> 链接 */
function inline(s: string): string {
  return s
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/(^|[^*\w])\*([^*\s][^*]*?)\*/g, '$1<em>$2</em>')
    .replace(
      /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g,
      '<a href="$2" target="_blank" rel="noreferrer">$1</a>'
    );
}

export function renderMarkdown(src: string): string {
  const lines = escapeHtml(src.replace(/\r\n/g, '\n')).split('\n');
  const out: string[] = [];
  let inCode = false;
  let listTag: string | null = null;
  let inQuote = false;
  let para: string[] = [];

  const closeList = (): void => {
    if (listTag) {
      out.push(`</${listTag}>`);
      listTag = null;
    }
  };
  const closeQuote = (): void => {
    if (inQuote) {
      out.push('</blockquote>');
      inQuote = false;
    }
  };
  const flushPara = (): void => {
    if (para.length > 0) {
      out.push(`<p>${para.map(inline).join('<br/>')}</p>`);
      para = [];
    }
  };
  const closeBlocks = (): void => {
    flushPara();
    closeList();
    closeQuote();
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    // 代码块围栏
    if (/^\s*```/.test(line)) {
      if (inCode) {
        out.push('</code></pre>');
        inCode = false;
      } else {
        closeBlocks();
        out.push('<pre><code>');
        inCode = true;
      }
      continue;
    }
    if (inCode) {
      out.push(rawLine);
      continue;
    }

    // 空行：结束当前段落/列表/引用
    if (!line.trim()) {
      closeBlocks();
      continue;
    }

    // 标题
    const h = line.match(/^(#{1,4})\s+(.*)$/);
    if (h) {
      closeBlocks();
      out.push(`<h${h[1].length}>${inline(h[2])}</h${h[1].length}>`);
      continue;
    }

    // 分隔线
    if (/^\s*(-{3,}|\*{3,})\s*$/.test(line)) {
      closeBlocks();
      out.push('<hr/>');
      continue;
    }

    // 引用
    const q = line.match(/^\s*&gt;\s?(.*)$/);
    if (q) {
      flushPara();
      closeList();
      if (!inQuote) {
        out.push('<blockquote>');
        inQuote = true;
      }
      out.push(`<p>${inline(q[1])}</p>`);
      continue;
    }

    // 无序列表（- 或 * 开头，需空格分隔，避免与斜体混淆）
    const ul = line.match(/^\s*[-*]\s+(.*)$/);
    if (ul) {
      flushPara();
      closeQuote();
      if (listTag !== 'ul') {
        closeList();
        out.push('<ul>');
        listTag = 'ul';
      }
      out.push(`<li>${inline(ul[1])}</li>`);
      continue;
    }

    // 有序列表（1. 或 1、）
    const ol = line.match(/^\s*\d+[.、]\s+(.*)$/);
    if (ol) {
      flushPara();
      closeQuote();
      if (listTag !== 'ol') {
        closeList();
        out.push('<ol>');
        listTag = 'ol';
      }
      out.push(`<li>${inline(ol[1])}</li>`);
      continue;
    }

    // 普通段落行
    closeList();
    closeQuote();
    para.push(line);
  }

  closeBlocks();
  if (inCode) out.push('</code></pre>');
  return out.join('\n');
}
