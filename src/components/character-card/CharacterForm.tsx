/**
 * 角色卡表单：JSON Schema 驱动动态渲染（react-hook-form + Zod）
 * 默认模板：姓名 / 外貌 / 性格 / 背景 / 关系 / 标签
 * 支持手动编辑 JSON Schema（P0 简版）
 */

import { useEffect, useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { getAppContext } from '../../context/app-context';
import { alertDialog } from '../../native/dialog';
import type { Character, CharacterSchema } from '../../types';

interface StringField {
  key: string;
  title: string;
  required: boolean;
}

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
  const [schemaDraft, setSchemaDraft] = useState('');
  const [tagsText, setTagsText] = useState('');

  useEffect(() => {
    const load = async (): Promise<void> => {
      const ctx = getAppContext();
      const s = await ctx.characterService.ensureDefaultSchema(bookId);
      setSchema(s);
      setSchemaDraft(s.schemaJson);
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

  const fields: StringField[] = useMemo(() => {
    if (!schema) return [];
    try {
      const parsed = JSON.parse(schema.schemaJson) as {
        properties?: Record<string, { type?: string; title?: string }>;
        required?: string[];
      };
      return Object.entries(parsed.properties ?? {})
        .filter(([, def]) => (def.type ?? 'string') === 'string')
        .map(([key, def]) => ({
          key,
          title: def.title ?? key,
          required: (parsed.required ?? []).includes(key)
        }));
    } catch {
      return [];
    }
  }, [schema]);

  const initialData = useMemo((): Record<string, string> => {
    if (!character) return {};
    try {
      return JSON.parse(character.data) as Record<string, string>;
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
    if (character) {
      await ctx.characterService.update(character.id, {
        name,
        data: values,
        tags
      });
    } else {
      await ctx.characterService.create(bookId, {
        name,
        data: values,
        tags,
        schemaId: schema?.id ?? null
      });
    }
    onDone();
  });

  const saveSchema = async (): Promise<void> => {
    if (!schema) return;
    try {
      JSON.parse(schemaDraft);
    } catch {
      void alertDialog('JSON Schema 格式错误');
      return;
    }
    await getAppContext().characterService.saveSchema(schema.id, schemaDraft);
    setSchema({ ...schema, schemaJson: schemaDraft });
    setSchemaEditOpen(false);
  };

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
            编辑模板 Schema
          </button>
        </div>
      </div>

      {schemaEditOpen && (
        <div className="border-b border-ink-200 bg-ink-50 p-2">
          <textarea
            value={schemaDraft}
            onChange={(e) => setSchemaDraft(e.target.value)}
            rows={8}
            spellCheck={false}
            className="w-full resize-none rounded border border-ink-200 p-2 font-mono text-xs outline-none focus:border-violet-400"
          />
          <button
            type="button"
            className="mt-1 rounded bg-violet-600 px-2 py-1 text-xs text-white hover:bg-violet-700"
            onClick={() => void saveSchema()}
          >
            保存模板
          </button>
        </div>
      )}

      <form onSubmit={(e) => void submit(e)} className="flex-1 overflow-y-auto p-3">
        {fields.map((f) => (
          <div key={f.key} className="mb-3">
            <label className="mb-1 block text-xs font-medium text-ink-600">
              {f.title}
              {f.required && <span className="text-red-500"> *</span>}
            </label>
            {f.key === 'background' || f.key === 'relationships' || f.key === 'appearance' || f.key === 'personality' ? (
              <textarea
                rows={3}
                {...register(f.key)}
                className="w-full resize-none rounded border border-ink-200 px-2 py-1 text-sm outline-none focus:border-violet-400"
              />
            ) : (
              <input
                {...register(f.key)}
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
