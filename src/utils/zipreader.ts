/**
 * fflate 流式解压封装：备份包读取（书籍备份 / 备忘录备份共用）
 */

import { Unzip, UnzipInflate } from 'fflate';

/** 解压 .zip 字节流为「文件名 -> 内容」Map（流式逐文件回调，返回后才 resolve） */
export function unzipToMap(buffer: Uint8Array): Promise<Map<string, Uint8Array>> {
  return new Promise((resolve, reject) => {
    const files = new Map<string, Uint8Array>();
    const unzip = new Unzip();
    unzip.register(UnzipInflate);
    unzip.onfile = (file) => {
      const chunks: Uint8Array[] = [];
      file.ondata = (err, data, final) => {
        if (err) {
          reject(err);
          return;
        }
        chunks.push(data);
        if (final) {
          const len = chunks.reduce((s, c) => s + c.length, 0);
          const out = new Uint8Array(len);
          let off = 0;
          for (const c of chunks) {
            out.set(c, off);
            off += c.length;
          }
          files.set(file.name, out);
        }
      };
      file.start();
    };
    try {
      unzip.push(buffer, true);
    } catch (e) {
      reject(e);
      return;
    }
    resolve(files);
  });
}

/** UTF-8 解码 zip 内的文本文件 */
export function decodeUtf8(u8: Uint8Array): string {
  return new TextDecoder('utf-8').decode(u8);
}
