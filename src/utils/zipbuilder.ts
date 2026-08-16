/**
 * fflate 0.8.x 流式 Zip 构建封装：
 * ZipPassThrough（存储，用于 EPUB mimetype）+ ZipDeflate（压缩）
 */

import { Zip, ZipDeflate, ZipPassThrough } from 'fflate';

export class ZipWriter {
  private zip = new Zip();
  private chunks: Uint8Array[] = [];
  private done: Promise<Uint8Array>;
  private settled = false;

  constructor() {
    this.done = new Promise<Uint8Array>((resolve, reject) => {
      this.zip.ondata = (err, data, final) => {
        if (err) {
          reject(err);
          return;
        }
        this.chunks.push(data);
        if (final) {
          this.settled = true;
          resolve(concat(this.chunks));
        }
      };
    });
  }

  /** 添加文件（文本，deflate 压缩） */
  addText(name: string, text: string): void {
    const encoder = new TextEncoder();
    this.addBinary(name, encoder.encode(text), false);
  }

  /** 添加文件（二进制，可选存储/压缩） */
  addBinary(name: string, data: Uint8Array, stored = false): void {
    if (this.settled) throw new Error('Zip 已结束');
    const file = stored ? new ZipPassThrough(name) : new ZipDeflate(name);
    this.zip.add(file);
    file.push(data, true);
  }

  /** 结束并等待完整 zip 字节 */
  async finish(): Promise<Uint8Array> {
    this.zip.end();
    return this.done;
  }
}

function concat(chunks: Uint8Array[]): Uint8Array {
  const total = chunks.reduce((s, c) => s + c.length, 0);
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out;
}
