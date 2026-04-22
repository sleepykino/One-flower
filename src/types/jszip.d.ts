declare module 'jszip' {
  interface JSZip {
    file(name: string, data: string | Blob): JSZip
    folder(name: string): JSZip | null
    generateAsync(options: { type: string; mimeType: string }): Promise<Blob>
  }

  interface JSZipConstructor {
    new (): JSZip
    (): JSZip
  }

  const JSZip: JSZipConstructor
  export default JSZip
}
