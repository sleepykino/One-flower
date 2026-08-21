/**
 * 图片二进制元数据解析：MIME 嗅探（魔数）与宽高解析（PNG/JPEG/WebP）
 * 供生图入库（saveGenerated）与上传导入（importFromFile）统一使用
 */

/** base64 -> Uint8Array（WebView 环境无 Buffer，用 atob） */
export function base64ToUint8Array(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}

/** 按魔数嗅探图片 MIME 类型 */
export function sniffImageMime(bytes: Uint8Array): string {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    return 'image/png';
  }
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) {
    return 'image/jpeg';
  }
  if (
    bytes.length >= 12 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 && // RIFF
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50 // WEBP
  ) {
    return 'image/webp';
  }
  if (bytes.length >= 6 && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
    return 'image/gif';
  }
  if (bytes.length >= 4 && bytes[0] === 0x42 && bytes[1] === 0x4d) {
    return 'image/bmp';
  }
  return 'application/octet-stream';
}

/** 解析图片宽高（PNG IHDR / JPEG SOF / WebP VP8 系列），失败返回 null */
export function parseImageSize(bytes: Uint8Array): { width: number; height: number } | null {
  if (bytes.length < 24) return null;

  // PNG：签名 8B + 块长 4B + 'IHDR' 4B -> width BE(16..19) / height BE(20..23)
  if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) {
    const width = (bytes[16] << 24) | (bytes[17] << 16) | (bytes[18] << 8) | bytes[19];
    const height = (bytes[20] << 24) | (bytes[21] << 16) | (bytes[22] << 8) | bytes[23];
    if (width > 0 && height > 0) return { width: width >>> 0, height: height >>> 0 };
    return null;
  }

  // JPEG：遍历段标记寻找 SOF0-SOF15（排除 C4/C8/CC）
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let i = 2;
    while (i + 9 < bytes.length) {
      if (bytes[i] !== 0xff) {
        i++;
        continue;
      }
      const marker = bytes[i + 1];
      if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
        i += 2;
        continue;
      }
      const len = (bytes[i + 2] << 8) | bytes[i + 3];
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        const height = (bytes[i + 5] << 8) | bytes[i + 6];
        const width = (bytes[i + 7] << 8) | bytes[i + 8];
        if (width > 0 && height > 0) return { width, height };
        return null;
      }
      if (len <= 0) return null;
      i += 2 + len;
    }
    return null;
  }

  // WebP：RIFF 头 + VP8 / VP8L / VP8X 块
  if (
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50
  ) {
    const fourcc = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
    if (fourcc === 'VP8 ') {
      // 帧 tag 3B + 同步码 3B -> width LE(26..27) / height LE(28..29)
      const width = bytes[26] | (bytes[27] << 8);
      const height = bytes[28] | (bytes[29] << 8);
      if (width > 0 && height > 0) return { width, height };
    } else if (fourcc === 'VP8L') {
      // 签名 1B + 4B 位域：width-1(14bit) / height-1(14bit)
      const b = bytes[21] | (bytes[22] << 8) | (bytes[23] << 16) | (bytes[24] << 24);
      const width = (b & 0x3fff) + 1;
      const height = ((b >>> 14) & 0x3fff) + 1;
      if (width > 0 && height > 0) return { width, height };
    } else if (fourcc === 'VP8X') {
      // flags 4B + canvas width-1 3B LE(24..26) + height-1 3B LE(27..29)
      const width = 1 + (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16));
      const height = 1 + (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16));
      if (width > 0 && height > 0) return { width, height };
    }
  }

  return null;
}

/** MIME 类型 -> 扩展名 */
export function extOfMime(mime: string): string {
  switch (mime) {
    case 'image/png':
      return 'png';
    case 'image/jpeg':
      return 'jpg';
    case 'image/webp':
      return 'webp';
    case 'image/gif':
      return 'gif';
    case 'image/bmp':
      return 'bmp';
    default:
      return 'bin';
  }
}

/** 文件名后缀 -> MIME 类型（上传导入时用于兜底） */
export function mimeOfExt(name: string): string | null {
  const ext = name.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'png':
      return 'image/png';
    case 'jpg':
    case 'jpeg':
      return 'image/jpeg';
    case 'webp':
      return 'image/webp';
    case 'gif':
      return 'image/gif';
    case 'bmp':
      return 'image/bmp';
    default:
      return null;
  }
}
