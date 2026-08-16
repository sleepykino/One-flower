/**
 * ProseMirror 文档 JSON 的 deep diff 与重放
 * diff 形态：有序操作列表，顺序 apply 可从旧文档得到新文档
 */

export type DiffOp =
  | { op: 'replace'; path: (string | number)[]; value: unknown }
  | { op: 'add'; path: (string | number)[]; value: unknown }
  | { op: 'remove'; path: (string | number)[] };

export interface VersionPayload {
  t: 'full' | 'delta';
  doc?: unknown; // full 时的完整文档
  ops?: DiffOp[]; // delta 时的操作列表
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** 计算 from → to 的差异操作（数组按索引对比，删除从尾部往前记录保证索引有效） */
export function diffJson(from: unknown, to: unknown, path: (string | number)[] = []): DiffOp[] {
  const ops: DiffOp[] = [];

  if (isPlainObject(from) && isPlainObject(to)) {
    const keys = new Set([...Object.keys(from), ...Object.keys(to)]);
    for (const key of keys) {
      const p = [...path, key];
      if (!(key in from)) {
        ops.push({ op: 'add', path: p, value: to[key] });
      } else if (!(key in to)) {
        ops.push({ op: 'remove', path: p });
      } else if (from[key] !== to[key]) {
        ops.push(...diffJson(from[key], to[key], p));
      }
    }
    return ops;
  }

  if (Array.isArray(from) && Array.isArray(to)) {
    const minLen = Math.min(from.length, to.length);
    for (let i = 0; i < minLen; i++) {
      if (from[i] !== to[i]) {
        ops.push(...diffJson(from[i], to[i], [...path, i]));
      }
    }
    // 多出的元素：删除（从尾往前，索引递减有效）
    for (let i = from.length - 1; i >= minLen; i--) {
      ops.push({ op: 'remove', path: [...path, i] });
    }
    // 新增的元素
    for (let i = minLen; i < to.length; i++) {
      ops.push({ op: 'add', path: [...path, i], value: to[i] });
    }
    return ops;
  }

  if (from !== to) {
    ops.push({ op: 'replace', path, value: to });
  }
  return ops;
}

/** 按顺序重放操作列表（深拷贝后应用） */
export function applyOps(doc: unknown, ops: DiffOp[]): unknown {
  const target: unknown = structuredClone(doc);

  const getParent = (root: unknown, path: (string | number)[]): unknown => {
    let cur: unknown = root;
    for (const seg of path) {
      if (cur === null || cur === undefined) return undefined;
      cur = (cur as Record<string | number, unknown>)[seg];
    }
    return cur;
  };

  for (const op of ops) {
    const parentPath = op.path.slice(0, -1);
    const last = op.path[op.path.length - 1];
    const parent = getParent(target, parentPath);
    if (parent === null || parent === undefined) continue;
    const container = parent as Record<string | number, unknown>;
    if (op.op === 'add') {
      if (Array.isArray(container) && typeof last === 'number') {
        container.splice(last, 0, structuredClone(op.value));
      } else {
        container[last as string] = structuredClone(op.value);
      }
    } else if (op.op === 'remove') {
      if (Array.isArray(container) && typeof last === 'number') {
        container.splice(last, 1);
      } else {
        delete container[last as string];
      }
    } else {
      container[last as string] = structuredClone(op.value);
    }
  }
  return target;
}

/** ============ 段落级 diff（版本对比视图用，LCS 算法） ============ */

export interface TextHunk {
  type: 'add' | 'remove' | 'equal';
  content: string;
}

export interface TextDiffResult {
  added: number;
  removed: number;
  hunks: TextHunk[];
}

/** 基于行的最长公共子序列 diff */
export function diffLines(a: string[], b: string[]): TextDiffResult {
  const n = a.length;
  const m = b.length;
  // LCS 表（篇章段落量级 < 数千，可接受）
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const hunks: TextHunk[] = [];
  let added = 0;
  let removed = 0;
  const push = (type: TextHunk['type'], content: string) => {
    const last = hunks[hunks.length - 1];
    if (last && last.type === type) {
      last.content += '\n' + content;
    } else {
      hunks.push({ type, content });
    }
  };
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push('equal', a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push('remove', a[i]);
      removed++;
      i++;
    } else {
      push('add', b[j]);
      added++;
      j++;
    }
  }
  while (i < n) {
    push('remove', a[i]);
    removed++;
    i++;
  }
  while (j < m) {
    push('add', b[j]);
    added++;
    j++;
  }
  return { added, removed, hunks };
}
