/**
 * 角色卡模板字段模型（P1 Phase9）：JSON Schema <-> 可视化字段 双向转换
 * 字段类型：text 文本 / textarea 多行 / select 选择 / tags 标签 / number 数字
 * 旧模板（P0 无 format 标记）中固定的多行 key 保持多行行为不变
 */

export type FieldKind = 'text' | 'textarea' | 'select' | 'tags' | 'number';

export interface CardField {
  key: string;
  title: string;
  kind: FieldKind;
  required: boolean;
  /** select 类型的候选值 */
  options: string[];
}

export const FIELD_KINDS: FieldKind[] = ['text', 'textarea', 'select', 'tags', 'number'];

export const KIND_LABEL: Record<FieldKind, string> = {
  text: '文本',
  textarea: '多行',
  select: '选择',
  tags: '标签',
  number: '数字'
};

/** P0 简版中固定渲染为多行文本的 key（无 format 标记时兜底） */
const LEGACY_MULTILINE = new Set(['background', 'relationships', 'appearance', 'personality']);

interface PropDef {
  type?: string;
  title?: string;
  format?: string;
  enum?: unknown[];
}

export function parseSchemaFields(schemaJson: string): CardField[] {
  try {
    const parsed = JSON.parse(schemaJson) as { properties?: Record<string, PropDef>; required?: string[] };
    const req = parsed.required ?? [];
    return Object.entries(parsed.properties ?? {}).map(([key, def]) => {
      let kind: FieldKind = 'text';
      if (Array.isArray(def.enum) && def.enum.length > 0) kind = 'select';
      else if (def.type === 'number' || def.type === 'integer') kind = 'number';
      else if (def.format === 'textarea' || def.format === 'tags') kind = def.format;
      else if (LEGACY_MULTILINE.has(key)) kind = 'textarea';
      return {
        key,
        title: def.title ?? key,
        kind,
        required: req.includes(key),
        options: kind === 'select' ? (def.enum ?? []).map(String) : []
      };
    });
  } catch {
    return [];
  }
}

export function fieldsToSchemaJson(fields: CardField[]): string {
  const properties: Record<string, Record<string, unknown>> = {};
  const required: string[] = [];
  for (const f of fields) {
    if (!f.key.trim()) continue;
    const def: Record<string, unknown> = { title: f.title || f.key };
    if (f.kind === 'select') {
      def.type = 'string';
      def.enum = f.options;
    } else if (f.kind === 'number') {
      def.type = 'number';
    } else {
      def.type = 'string';
      if (f.kind !== 'text') def.format = f.kind;
    }
    properties[f.key.trim()] = def;
    if (f.required) required.push(f.key.trim());
  }
  return JSON.stringify({ type: 'object', properties, required }, null, 2);
}
