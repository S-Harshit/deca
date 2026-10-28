// Sending a file over a data channel quickly: read it in big slices (one async read per megabyte, not per few kilobytes), look ahead at the
// next slice while the current one is being sent, and send it in 64 KB pieces (the browsers' common ground is well above that). `send`
// waits when the channel's buffer is full, so memory stays flat however large the file.
export const CHUNK = 64 * 1024;
const READ = 1024 * 1024;

export async function streamFile(file: Blob, send: (piece: ArrayBufferView) => Promise<void>, onProgress?: (sent: number) => void) {
  let next = file.size ? file.slice(0, READ).arrayBuffer() : null;
  for (let o = 0; next; o += READ) {
    const buf = await next;
    next = o + READ < file.size ? file.slice(o + READ, o + 2 * READ).arrayBuffer() : null; // already reading the next one
    for (let i = 0; i < buf.byteLength; i += CHUNK) {
      await send(new Uint8Array(buf, i, Math.min(CHUNK, buf.byteLength - i)));
      onProgress?.(Math.min(file.size, o + i + CHUNK));
    }
  }
}
