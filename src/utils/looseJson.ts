/**
 * 容错 JSON 解析（AI 输出专用）：统一原先散落在各服务里的 4+ 份重复实现。
 * 处理链：剥 <think> 推理段 -> 剥 markdown 围栏 -> 截取首尾 {} / [] ->
 *         直接解析失败时移除 // 与块注释及尾逗号后重试（AI 常见格式瑕疵）。
 */

/** 提取 JSON 文本：返回仅含首尾大括号/方括号的子串；找不到结构返回 null */
export function extractJsonText(raw: string): string | null {
  let s = raw.replace(/<think>[\s\S]*?<\/think>/gi, '').trim();
  const fence = s.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) s = fence[1].trim();
  const objStart = s.indexOf('{');
  const arrStart = s.indexOf('[');
  const starts = [objStart, arrStart].filter((i) => i >= 0);
  if (starts.length === 0) return null;
  const start = Math.min(...starts);
  const isArray = arrStart >= 0 && arrStart === start;
  const end = isArray ? s.lastIndexOf(']') : s.lastIndexOf('}');
  if (end <= start) return null;
  return s.slice(start, end + 1);
}

/** 容错解析 AI 返回的 JSON（对象或数组均可）；完全失败返回 null */
export function parseLooseJson<T>(raw: string): T | null {
  const text = extractJsonText(raw);
  if (text === null) return null;
  try {
    return JSON.parse(text) as T;
  } catch {
    try {
      return JSON.parse(
        text
          .replace(/\/\*[\s\S]*?\*\//g, '')
          .replace(/(^|[^:"'\\])\/\/[^\n\r]*/g, '$1')
          .replace(/,(\s*[}\]])/g, '$1')
      ) as T;
    } catch {
      return null;
    }
  }
}
