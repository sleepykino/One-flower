/**
 * 角色卡表单：JSON Schema 驱动动态渲染（react-hook-form + Zod）
 * 模板编辑升级为可视化构建器 SchemaBuilder（P1 Phase9）
 */

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getAppContext } from '../../context/app-context';
import type { Character, CharacterSchema } from '../../types';
import { SchemaBuilder } from './SchemaBuilder';
import { parseSchemaFields, type CardField } from './schemaFields';

export function CharacterForm({
  bookId,
  character,
  onDone
}: {
  bookId: string;
  character: Character | null;
  onDone: () => void;
}): JSX.Element {
  const [schema, setSchema] = useState<CharacterSchema | null>(null);
  const [schemaEditOpen, setSchemaEditOpen] = useState(false);
  const [tagsText, setTagsText] = useState('');

  useEffect(() => {
    const load = async (): Promise<void> => {
      const ctx = getAppContext();
      const s = await ctx.characterService.ensureDefaultSchema(bookId);
      setSchema(s);
      if (character) {
        try {
          setTagsText((JSON.parse(character.tags ?? '[]') as string[]).join('、'));
        } catch {
          setTagsText('');
        }
      }
    };
    void load();
  }, [bookId, character]);

  const fields: CardField[] = useMemo(
    () => (schema ? parseSchemaFields(schema.schemaJson) : []),
    [schema]
  );

  const initialData = useMemo((): Record<string, string> => {
    if (!character) return {};
    try {
      const parsed = JSON.parse(character.data) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).map(([k, v]) => [k, v == null ? '' : String(v)])
      );
    } catch {
      return {};
    }
  }, [character]);

  const zodSchema = useMemo(() => {
    const shape: Record<string, z.ZodType> = {};
    for (const f of fields) {
      shape[f.key] = f.required ? z.string().min(1, `${f.title}必填`) : z.string();
    }
    return z.object(shape);
  }, [fields]);

  const {
    register,
    handleSubmit,
    formState: { errors }
  } = useForm<Record<string, string>>({
    resolver: zodResolver(zodSchema),
    defaultValues: initialData
  });

  const submit = handleSubmit(async (values) => {
    const ctx = getAppContext();
    const name = values.name ?? character?.name ?? '';
    const tags = tagsText.split(/[、,，\s]+/).filter(Boolean);
    // 数字字段把字符串值转回数字存储，与 Schema type 对齐
    const data: Record<string, unknown> = { ...values };
    for (const f of fields) {
      if (f.kind === 'number') {
        const v = values[f.key];
        data[f.key] = v !== '' && v != null && !Number.isNaN(Number(v)) ? Number(v) : v;
      }
    }
    if (character) {
      await ctx.characterService.update(character.id, { name, data, tags });
    } else {
      await ctx.characterService.create(bookId, {
        name,
        data,
        tags,
        schemaId: schema?.id ?? null
      });
    }
    onDone();
  });

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-ink-200 px-3 py-2">
        <span className="text-sm font-medium">{character ? '编辑角色' : '新建角色'}</span>
        <div className="flex gap-1">
          <button
            type="button"
            className="text-xs text-violet-600 hover:underline"
            onClick={() => setSchemaEditOpen(!schemaEditOpen)}
          >
            编辑模板
          </button>
        </div>
      </div>

      {schemaEditOpen && schema && (
        <SchemaBuilder
          schema={schema}
          onClose={() => setSchemaEditOpen(false)}
          onSaved={(json) => {
            setSchema({ ...schema, schemaJson: json });
            setSchemaEditOpen(false);
          }}
        />
      )}

      <form onSubmit={(e) => void submit(e)} className="flex-1 overflow-y-auto p-3">
        {fields.map((f) => (
          <div key={f.key} className="mb-3">
            <label className="mb-1 block text-xs font-medium text-ink-600">
              {f.title}
              {f.required && <span className="text-red-500"> *</span>}
            </label>
            {f.kind === 'textarea' ? (
              <textarea
                rows={3}
                {...register(f.key)}
                className="w-full resize-none rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
              />
            ) : f.kind === 'select' ? (
              <select
                {...register(f.key)}
                className="w-full rounded border border-ink-200 bg-white px-2 py-1 text-sm outline-none focus:border-violet-400"
              >
                {f.options.length === 0 && <option value="">（模板未配置候选项）</option>}
                {f.options.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </select>
            ) : f.kind === 'number' ? (
              <input
                type="number"
                {...register(f.key)}
                className="w-full rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
              />
            ) : (
              <input
                {...register(f.key)}
                placeholder={f.kind === 'tags' ? '多个标签用顿号分隔' : ''}
                className="w-full rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
              />
            )}
            {errors[f.key] && (
              <div className="mt-0.5 text-xs text-red-500">{String(errors[f.key]?.message)}</div>
            )}
          </div>
        ))}
        <div className="mb-3">
          <label className="mb-1 block text-xs font-medium text-ink-600">标签（顿号分隔）</label>
          <input
            value={tagsText}
            onChange={(e) => setTagsText(e.target.value)}
            placeholder="主角、剑客、冷峻"
            className="w-full rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
          />
        </div>
        <div className="flex gap-2">
          <button
            type="submit"
            className="rounded bg-violet-600 px-3 py-1.5 text-sm text-white hover:bg-violet-700"
          >
            保存
          </button>
          <button
            type="button"
            className="rounded border border-ink-200 px-3 py-1.5 text-sm hover:bg-ink-100"
            onClick={onDone}
          >
            取消
          </button>
        </div>
      </form>
    </div>
  );
}
