import { describe, expect, it } from 'vitest';
import type { NativeBridge } from '../../src/native/NativeBridge';
import type { Database } from '../../src/db/Database';
import type { WriteQueue } from '../../src/db/WriteQueue';
import { ScreenplayService } from '../../src/services/screenplay/ScreenplayService';
import type { ScreenplayDoc } from '../../src/services/screenplay/types';

// T10.5：Fountain 纯文本导出单测（场景头 / 角色名大写 / 括注与台词规范）
// 服务依赖（db/bridge/wq）以内存桩注入，不触碰 Tauri 运行时

const DOC: ScreenplayDoc = {
  episodes: [
    {
      id: 'ep1',
      number: 1,
      title: '初见',
      logline: '少年初入江湖',
      scenes: [
        {
          id: 'sc1',
          interior: 'INT',
          location: '悦来客栈',
          timeOfDay: '夜',
          synopsis: '主角夜宿客栈，掌柜欲言又止',
          status: 'done',
          shots: [
            {
              id: 'sh1',
              number: 1,
              size: 'LS',
              camera: '推',
              durationSec: 3,
              description: '客栈大堂全景',
              dialogue: []
            },
            {
              id: 'sh2',
              number: 2,
              size: 'CU',
              description: '掌柜眯起眼睛',
              dialogue: [
                { character: 'li bai', parenthetical: '低声', line: '客官打尖还是住店？' },
                { character: 'wang', line: '住店。' }
              ]
            }
          ]
        }
      ]
    }
  ]
};

const ROW = {
  id: 'sp1',
  book_id: 'b1',
  title: 'TEST-剧本',
  status: 'done',
  source_range: null,
  data: JSON.stringify(DOC),
  created_at: 0,
  updated_at: 0
};

async function exportText(row: unknown): Promise<string> {
  let captured = '';
  const bridge = {
    fs: {
      writeFile: async (_path: string, content: string) => {
        captured = content;
      }
    }
  } as unknown as NativeBridge;
  const db = {
    queryOne: async () => row
  } as unknown as Database;
  const wq = { enqueue: (fn: () => Promise<void>) => fn() } as unknown as WriteQueue;
  const svc = new ScreenplayService(bridge, db, wq);
  await svc.exportFountain('sp1', 'C:/out/test.fountain');
  return captured;
}

describe('ScreenplayService.exportFountain', () => {
  it('标题头 + 集标题 + logline 规范输出', async () => {
    const out = await exportText(ROW);
    const lines = out.split('\n');
    expect(lines[0]).toBe('Title: TEST-剧本');
    expect(out).toContain('# 第 1 集：初见');
    expect(out).toContain('> 少年初入江湖');
  });

  it('场景头大写规范 + 场序标注 + 概要', async () => {
    const out = await exportText(ROW);
    expect(out).toContain('INT. 悦来客栈 - 夜');
    expect(out).toContain('[[场 1]] 主角夜宿客栈，掌柜欲言又止');
  });

  it('镜头头：景别中文标签 / 运镜 / 时长 组合，无时长时省略段', async () => {
    const out = await exportText(ROW);
    expect(out).toContain('(全景 / 推 / 3s) 客栈大堂全景');
    expect(out).toContain('(近景) 掌柜眯起眼睛'); // 无运镜与时长，仅景别
  });

  it('对白：角色名全大写、括注独立行、台词独立行', async () => {
    const out = await exportText(ROW);
    const lines = out.split('\n');
    const i = lines.findIndex((l) => l === 'LI BAI');
    expect(i).toBeGreaterThan(-1);
    expect(lines[i + 1]).toBe('(低声)');
    expect(lines[i + 2]).toBe('客官打尖还是住店？');
    const j = lines.findIndex((l) => l === 'WANG');
    expect(lines[j + 1]).toBe('住店。'); // 无括注时不留空行
  });

  it('空剧本仅输出标题头；剧本不存在抛错', async () => {
    const out = await exportText({ ...ROW, data: '{bad json' });
    expect(out.trim()).toBe('Title: TEST-剧本');

    const svc = new ScreenplayService(
      {} as unknown as NativeBridge,
      { queryOne: async () => null } as unknown as Database,
      { enqueue: (fn: () => Promise<void>) => fn() } as unknown as WriteQueue
    );
    await expect(svc.exportFountain('nope', 'C:/out/x.fountain')).rejects.toThrow('剧本不存在');
  });

  it('可选字段缺省：集无标题/无 logline、场景无概要、镜头无描述时按规范省略', async () => {
    const out = await exportText({
      ...ROW,
      data: JSON.stringify({
        episodes: [
          {
            id: 'epX',
            number: 2,
            logline: '',
            scenes: [
              {
                id: 'scX',
                interior: 'EXT',
                location: '荒野',
                timeOfDay: '日',
                synopsis: '',
                status: 'done',
                shots: [
                  {
                    id: 'shX',
                    number: 1,
                    size: 'MS',
                    description: '',
                    dialogue: [{ character: 'king', line: '……' }]
                  }
                ]
              }
            ]
          }
        ]
      })
    });
    expect(out).toContain('# 第 2 集'); // 无标题：不加「：标题」段
    expect(out).not.toContain('> ');
    expect(out).toContain('EXT. 荒野 - 日');
    expect(out).toContain('[[场 1]] '); // 无概要：空段仍保留场序标注
    expect(out).not.toContain('(中景)'); // 无描述：不输出镜头行，但对白仍在
    expect(out).toContain('KING');
    expect(out).toContain('……');
  });
});
