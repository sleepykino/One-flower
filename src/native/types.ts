/** NativeBridge 的补充类型：二进制读写（zip 备份用，base64 传输） */

export interface BinaryFileAdapter {
  readBinaryFile(path: string): Promise<Uint8Array>;
  writeBinaryFile(path: string, data: Uint8Array): Promise<void>;
  deletePath(path: string): Promise<void>;
}

export type NativeBridgeWithBinary = import('./NativeBridge').NativeBridge & {
  readonly fs: import('./NativeBridge').FileSystemAdapter & BinaryFileAdapter;
};
