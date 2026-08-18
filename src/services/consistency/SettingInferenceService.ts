/**
 * SettingInferenceService（P2.1-M6）：设定反推环境校验
 * 事实抽取（世界书+角色卡+章节）-> 推导链（按领域）-> 越级矛盾校验
 * 抽取与推导为后台任务（注册任务中心）；写操作过 wq
 */

import type { NativeBridge } from '../../native/NativeBridge';
import type { WriteQueue } from '../../db/WriteQueue';
import type { LLMProvider } from '../ai/providers/LLMProvider';
import { resolveProvider, resolveModelName } from '../ai/providerResolver';
import type { TaskCenterService } from '../task/TaskCenterService';
import type { ConsistencyReport } from '../ai/types';
import type { ExtractionScope, FactKind, FactSource, InferenceChainItem, SettingFact } from './types';
import { docToPlainText } from '../../utils/pmdoc';
import type { ProseMirrorDoc } from '../../types';

const EXTRACT_SYSTEM = `你是小说世界观分析师。从给定材料中抽取可核验的"设定事实"（物件、技术、社会形态、魔法体系、地理等，作为时代感基线）。
严格只输出 JSON 数组（不要 markdown 代码围栏、不要解释）：
[{"kind":"object|technology|social|magic|geography|other","domain":"所属领域（如：光学/航海/火药/冶金，1-4 字）","fact":"事实陈述（如：存在眼镜）","basis":"依据摘录（材料原文片段，40 字内）","confidence":0.85}]
只抽取材料明确支持的事实，不要推测；材料中不存在可抽取事实时输出 []。`;

const INFER_SYSTEM = `你是严谨的世界观逻辑推演师。基于给定领域的已确认事实，推导该领域应有的技术/社会前提链。
示例：事实"存在眼镜" -> 前提"光学玻璃打磨工艺成熟" -> 结论"望远镜与航海天文应有相应发展"。
严格只输出 JSON 数组（不要 markdown 代码围栏）：
[{"factId":"依据事实的 id","premise":"前提（如：光学玻璃打磨工艺成熟）","conclusion":"结论（如：望远镜与航海天文应有相应发展）","confidence":0.7}]
只推导与事实强相关的必要前提，不要虚构材料不支持的内容；无推导输出 []。`;

const CHECK_SYSTEM = `你是严谨的小说一致性审校。给定"时代感基线"（已确认设定事实 + 由其推导的技术/社会前提）与章节正文，找出正文中的越级矛盾：
正文出现了基线之外的、明显超出已确认技术/社会发展水平的元素（例如基线无任何光学工艺记载却出现望远镜）。
严格只输出 JSON（不要 markdown 代码围栏）：
{"contradictions":[{"severity":"high|medium|low","description":"越级矛盾描述","relatedSetting":"关联的基线事实或推导链","chapterExcerpt":"章节原文片段"}]}
无矛盾时 contradictions 为空数组。`;

/** 从 LLM 输出解析 JSON（容忍围栏与前后缀文本） */
function parseJsonLoose<T>(raw: string): T | null {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) text = fence[1].trim();
  const start = Math.min(
    ...[text.indexOf('['), text.indexOf('{')].filter((i) => i >= 0).concat([Number.MAX_SAFE_INTEGER])
  );
  const isArray = text.indexOf('[') === start;
  const end = isArray ? text.lastIndexOf(']') : text.lastIndexOf('}');
  if (start >= Number.MAX_SAFE_INTEGER || end <= start) return null;
  try {
    return JSON.parse(text.slice(start, end + 1)) as T;
  } catch {
    return null;
  }
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export class SettingInferenceService {
  private bridge: NativeBridge;
  private providerFactory: (configId: string) => Promise<LLMProvider>;
  private tasks: TaskCenterService;

  constructor(
    bridge: NativeBridge,
    db: { wq: WriteQueue },
    providerFactory: (configId: string) => Promise<LLMProvider>,
    tasks: TaskCenterService
  ) {
    this.bridge = bridge;
    this.wq = db.wq;
    this.providerFactory = providerFactory;
    this.tasks = tasks;
  }

  private wq: WriteQueue;

  // ---------------- 范围预估 ----------------

  /** 抽取范围与预计调用数（UI 确认弹层用） */
  async extractionScope(bookId: string, opts?: { chapterIds?: string[] }): Promise<ExtractionScope> {
    const [wb, chars, chapters] = await Promise.all([
      this.bridge.db.query<{ n: number }>(
        'SELECT COUNT(*) AS n FROM worldbook_entries WHERE book_id = ?',
        [bookId]
      ),
      this.bridge.db.query<{ n: number }>(
        'SELECT COUNT(*) AS n FROM characters WHERE book_id = ?',
        [bookId]
      ),
      this.chapterRows(bookId, opts?.chapterIds)
    ]);
    const worldbookEntries = Number(wb[0]?.n ?? 0);
    const characters = Number(chars[0]?.n ?? 0);
    const facts = await this.listFacts(bookId);
    const domains = new Set(facts.filter((f) => !f.exempt).map((f) => f.domain)).size;
    return {
      worldbookEntries,
      characters,
      chapters: chapters.length,
      extractCalls:
        Math.ceil(worldbookEntries / 5) + Math.ceil(characters / 5) + chapters.length,
      domains
    };
  }

  private async chapterRows(
    bookId: string,
    chapterIds?: string[]
  ): Promise<Array<{ id: string; title: string }>> {
    if (chapterIds && chapterIds.length === 0) return [];
    const rows = await this.bridge.db.query<{ id: string; title: string }>(
      'SELECT id, title FROM chapters WHERE book_id = ? ORDER BY sort_order ASC, created_at ASC',
      [bookId]
    );
    return chapterIds ? rows.filter((r) => chapterIds.includes(r.id)) : rows;
  }

  // ---------------- 事实抽取 ----------------

  /** 事实抽取：世界书全部条目 + 角色卡 + 章节（分批，每批 1 次 LLM 调用出 JSON 事实数组）
   *  注册为任务中心 'fact-extract' 任务；返回 taskId
   *  相同 (book_id, source, source_ref, fact) 去重，不重复入库 */
  extractFacts(bookId: string, opts?: { chapterIds?: string[] }): string {
    const exec = (): void => {
      void this.tasks.register({
        kind: 'fact-extract',
        title: '设定事实抽取',
        cancellable: true,
        run: async ({ report, signal }) => {
          await this.runExtractFacts(bookId, opts, report, signal);
        },
        retry: exec
      });
    };
    exec();
    // register 同步完成，返回最近注册的 fact-extract 任务 id
    const running = this.tasks
      .list()
      .filter((t) => t.kind === 'fact-extract' && t.status === 'running');
    return running[running.length - 1]?.id ?? '';
  }

  private async runExtractFacts(
    bookId: string,
    opts: { chapterIds?: string[] } | undefined,
    report: (p: number, d?: string) => void,
    signal: AbortSignal
  ): Promise<void> {
    const provider = await resolveProvider(this.bridge, bookId, this.providerFactory);
    const model = await resolveModelName(this.bridge, bookId);

    // 组装材料批次：[label, text, source, sourceRef][]
    type Batch = { label: string; material: string; source: FactSource; sourceRef: string };
    const wbRows = await this.bridge.db.query<{ id: string; title: string; content: string }>(
      'SELECT id, title, content FROM worldbook_entries WHERE book_id = ?',
      [bookId]
    );
    const charRows = await this.bridge.db.query<{ id: string; name: string; data: string }>(
      'SELECT id, name, data FROM characters WHERE book_id = ?',
      [bookId]
    );
    const chRows = await this.chapterRows(bookId, opts?.chapterIds);

    const batches: Batch[] = [];
    for (const g of chunk(wbRows, 5)) {
      batches.push({
        label: '世界书条目',
        material: g.map((w) => `《${w.title}》：${w.content}`).join('\n\n'),
        source: 'worldbook',
        sourceRef: g[0].id
      });
    }
    for (const g of chunk(charRows, 5)) {
      batches.push({
        label: '角色卡',
        material: g.map((c) => `【${c.name}】${c.data}`).join('\n\n'),
        source: 'character',
        sourceRef: g[0].id
      });
    }
    for (const c of chRows) {
      const text = await this.loadChapterText(c.id);
      if (!text.trim()) continue;
      batches.push({
        label: `章节《${c.title}》`,
        material: text.slice(0, 3000),
        source: 'chapter',
        sourceRef: c.id
      });
    }
    if (batches.length === 0) throw new Error('无可抽取的材料（世界书 / 角色卡 / 章节均为空）');

    // 既有事实去重键
    const existing = await this.listFacts(bookId);
    const seen = new Set(existing.map((f) => `${f.source}|${f.sourceRef}|${f.fact}`));

    let done = 0;
    let inserted = 0;
    for (const b of batches) {
      if (signal.aborted) throw new DOMException('已取消', 'AbortError');
      report(Math.round((done / batches.length) * 100), `${b.label}（${done + 1}/${batches.length}）`);
      const res = await provider.chat(
        [
          { role: 'system', content: EXTRACT_SYSTEM },
          { role: 'user', content: `【材料】\n${b.material}` }
        ],
        { model, temperature: 0.2, maxTokens: 4096, signal }
      );
      const parsed = parseJsonLoose<
        Array<{ kind?: string; domain?: string; fact?: string; basis?: string; confidence?: number }>
      >(res.content);
      done += 1;
      if (!Array.isArray(parsed)) continue;
      const KINDS: FactKind[] = ['object', 'technology', 'social', 'magic', 'geography', 'other'];
      for (const f of parsed) {
        const factText = String(f.fact ?? '').trim();
        if (!factText) continue;
        const key = `${b.source}|${b.sourceRef}|${factText}`;
        if (seen.has(key)) continue;
        seen.add(key);
        await this.wq.enqueue(() =>
          this.bridge.db.exec(
            `INSERT INTO setting_facts (id, book_id, kind, domain, fact, basis, confidence, exempt, source, source_ref, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?, ?)`,
            [
              crypto.randomUUID(),
              bookId,
              KINDS.includes(String(f.kind) as FactKind) ? String(f.kind) : 'other',
              String(f.domain ?? '其他').slice(0, 20) || '其他',
              factText,
              String(f.basis ?? '').slice(0, 120),
              Math.min(1, Math.max(0, Number(f.confidence ?? 0.8))),
              b.source,
              b.sourceRef,
              Date.now()
            ]
          )
        );
        inserted += 1;
      }
    }
    report(100, `完成：新增 ${inserted} 条事实`);
  }

  private async loadChapterText(chapterId: string): Promise<string> {
    try {
      const row = await this.bridge.db.queryOne<{
        content_path: string | null;
        book_id: string;
      }>('SELECT content_path, book_id FROM chapters WHERE id = ?', [chapterId]);
      if (!row) return '';
      let path = row.content_path ?? null;
      if (!path) {
        const book = await this.bridge.db.queryOne<{ storage_dir: string }>(
          'SELECT storage_dir FROM books WHERE id = ?',
          [row.book_id]
        );
        if (!book) return '';
        path = `${String(book.storage_dir)}/chapters/${chapterId}.json`;
      }
      const raw = await this.bridge.fs.readFile(path);
      const doc = JSON.parse(raw) as ProseMirrorDoc;
      if (doc?.type !== 'doc') return '';
      return docToPlainText(doc);
    } catch {
      return '';
    }
  }

  // ---------------- 推导链 ----------------

  /** 推导链：按 domain 聚合非豁免事实，每领域 1 次调用推导前提链
   *  注册为 'inference' 任务；返回 taskId */
  inferChains(bookId: string): string {
    const exec = (): void => {
      void this.tasks.register({
        kind: 'inference',
        title: '设定前提链推导',
        cancellable: true,
        run: async ({ report, signal }) => {
          await this.runInferChains(bookId, report, signal);
        },
        retry: exec
      });
    };
    exec();
    const running = this.tasks
      .list()
      .filter((t) => t.kind === 'inference' && t.status === 'running');
    return running[running.length - 1]?.id ?? '';
  }

  private async runInferChains(
    bookId: string,
    report: (p: number, d?: string) => void,
    signal: AbortSignal
  ): Promise<void> {
    const facts = (await this.listFacts(bookId)).filter((f) => !f.exempt);
    if (facts.length === 0) throw new Error('无待推导事实，请先抽取事实或解除豁免');

    const provider = await resolveProvider(this.bridge, bookId, this.providerFactory);
    const model = await resolveModelName(this.bridge, bookId);

    const byDomain = new Map<string, SettingFact[]>();
    for (const f of facts) {
      const list = byDomain.get(f.domain) ?? [];
      list.push(f);
      byDomain.set(f.domain, list);
    }
    const domains = [...byDomain.entries()];

    // 重新推导前清空本书推导链（结果整体替换）
    await this.wq.enqueue(() =>
      this.bridge.db.exec('DELETE FROM setting_inferences WHERE book_id = ?', [bookId])
    );

    let done = 0;
    let inserted = 0;
    for (const [domain, list] of domains) {
      if (signal.aborted) throw new DOMException('已取消', 'AbortError');
      report(Math.round((done / domains.length) * 100), `领域「${domain}」（${done + 1}/${domains.length}）`);
      const material = list
        .map((f) => `- id=${f.id}：${f.fact}（依据：${f.basis}）`)
        .join('\n');
      const res = await provider.chat(
        [
          { role: 'system', content: INFER_SYSTEM },
          { role: 'user', content: `【领域：${domain}】\n【已确认事实】\n${material}` }
        ],
        { model, temperature: 0.3, maxTokens: 4096, signal }
      );
      const parsed = parseJsonLoose<
        Array<{ factId?: string; premise?: string; conclusion?: string; confidence?: number }>
      >(res.content);
      done += 1;
      if (!Array.isArray(parsed)) continue;
      const factIds = new Set(list.map((f) => f.id));
      for (const c of parsed) {
        const factId = String(c.factId ?? '');
        const premise = String(c.premise ?? '').trim();
        const conclusion = String(c.conclusion ?? '').trim();
        if (!factIds.has(factId) || !premise || !conclusion) continue;
        await this.wq.enqueue(() =>
          this.bridge.db.exec(
            `INSERT INTO setting_inferences (id, fact_id, book_id, premise, conclusion, confidence, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [
              crypto.randomUUID(),
              factId,
              bookId,
              premise,
              conclusion,
              Math.min(1, Math.max(0, Number(c.confidence ?? 0.7))),
              Date.now()
            ]
          )
        );
        inserted += 1;
      }
    }
    report(100, `完成：生成 ${inserted} 条推导`);
  }

  // ---------------- 越级矛盾校验 ----------------

  /** 越级矛盾校验：文本 vs 非豁免事实+推导链基线，输出与 ConsistencyReport.contradictions 同构 */
  async checkChapter(
    bookId: string,
    chapterContent: string,
    signal?: AbortSignal
  ): Promise<ConsistencyReport['contradictions']> {
    const baseline = await this.loadBaseline(bookId);
    if (!baseline) return [];
    const provider = await resolveProvider(this.bridge, bookId, this.providerFactory);
    const model = await resolveModelName(this.bridge, bookId);
    const user = [
      baseline,
      '',
      '【待检查的章节正文】',
      chapterContent.slice(0, 6000)
    ].join('\n');
    const res = await provider.chat(
      [
        { role: 'system', content: CHECK_SYSTEM },
        { role: 'user', content: user }
      ],
      { model, temperature: 0.2, maxTokens: 4096, signal }
    );
    const parsed = parseJsonLoose<{
      contradictions?: Array<{
        severity?: string;
        description?: string;
        relatedSetting?: string;
        chapterExcerpt?: string;
      }>;
    }>(res.content);
    if (!parsed || !Array.isArray(parsed.contradictions)) return [];
    return parsed.contradictions.map((c) => ({
      severity: (['high', 'medium', 'low'].includes(String(c.severity))
        ? c.severity
        : 'medium') as 'high' | 'medium' | 'low',
      description: String(c.description ?? ''),
      relatedSetting: String(c.relatedSetting ?? ''),
      chapterExcerpt: String(c.chapterExcerpt ?? '')
    }));
  }

  /** 基线文本（事实 + 推导链），无内容返回 null */
  async loadBaseline(bookId: string): Promise<string | null> {
    const facts = (await this.listFacts(bookId)).filter((f) => !f.exempt);
    if (facts.length === 0) return null;
    const chains = await this.listChains(bookId);
    const exemptIds = new Set(
      (await this.listFacts(bookId)).filter((f) => f.exempt).map((f) => f.id)
    );
    const lines = ['【已确认设定事实（时代感基线）】'];
    for (const f of facts.slice(0, 60)) {
      lines.push(`- [${f.domain}] ${f.fact}（依据：${f.basis}）`);
    }
    const validChains = chains.filter((c) => !exemptIds.has(c.factId));
    if (validChains.length > 0) {
      lines.push('', '【由事实推导的技术/社会前提】');
      for (const c of validChains.slice(0, 60)) {
        lines.push(`- ${c.premise} -> ${c.conclusion}`);
      }
    }
    return lines.join('\n');
  }

  // ---------------- 查询与维护 ----------------

  async listFacts(bookId: string): Promise<SettingFact[]> {
    const rows = await this.bridge.db.query<Record<string, unknown>>(
      'SELECT * FROM setting_facts WHERE book_id = ? ORDER BY created_at ASC',
      [bookId]
    );
    return rows.map((r) => ({
      id: String(r.id),
      bookId: String(r.book_id),
      kind: String(r.kind) as SettingFact['kind'],
      domain: String(r.domain),
      fact: String(r.fact),
      basis: String(r.basis),
      confidence: Number(r.confidence ?? 0.8),
      exempt: Number(r.exempt ?? 0) === 1,
      source: String(r.source) as SettingFact['source'],
      sourceRef: String(r.source_ref),
      createdAt: Number(r.created_at)
    }));
  }

  async listChains(bookId: string): Promise<InferenceChainItem[]> {
    const rows = await this.bridge.db.query<Record<string, unknown>>(
      'SELECT * FROM setting_inferences WHERE book_id = ? ORDER BY created_at ASC',
      [bookId]
    );
    return rows.map((r) => ({
      id: String(r.id),
      factId: String(r.fact_id),
      premise: String(r.premise),
      conclusion: String(r.conclusion),
      confidence: Number(r.confidence ?? 0.7)
    }));
  }

  /** 架空豁免：级联豁免该事实的全部推导链（删除其推导链，重新推导时自然跳过） */
  async setExempt(factId: string, exempt: boolean): Promise<void> {
    await this.wq.enqueue(() =>
      this.bridge.db.transaction(async (tx) => {
        await tx.exec('UPDATE setting_facts SET exempt = ? WHERE id = ?', [
          exempt ? 1 : 0,
          factId
        ]);
        if (exempt) {
          await tx.exec('DELETE FROM setting_inferences WHERE fact_id = ?', [factId]);
        }
      })
    );
  }

  /** 删除误抽事实（级联删其推导链），过 wq */
  async deleteFact(factId: string): Promise<void> {
    await this.wq.enqueue(() =>
      this.bridge.db.transaction(async (tx) => {
        await tx.exec('DELETE FROM setting_inferences WHERE fact_id = ?', [factId]);
        await tx.exec('DELETE FROM setting_facts WHERE id = ?', [factId]);
      })
    );
  }
}

export type { ExtractionScope };
