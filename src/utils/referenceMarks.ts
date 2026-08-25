/**
 * 引用标记清洗（P2.1-M2）：导出时把 @名 / [[题]] / ##题 替换为纯名字
 * 四个 exporter（txt / markdown / docx / epub）统一调用
 */

/** 把引用标记文本（@名 / [[题]] / ##题）替换为纯名字 */
export function stripReferenceMarks(text: string): string {
  // [[标题]] -> 标题
  let out = text.replace(/\[\[([^[\]]+)\]\]/g, '$1');
  // ##章节标题（行内标记，非 Markdown 标题：要求 ## 后紧跟非空白且非 # 的文本）
  out = out.replace(/##(?=\S)(?!#)([^\n]{1,60}?)(?=\s|$)/g, '$1');
  // @名字（中文名/英文单词，避免误伤邮箱：要求 @ 前非数字字母）
  out = out.replace(/(^|[^\w@])@([\p{L}\p{N}_·]{1,30})/gu, '$1$2');
  return out;
}
