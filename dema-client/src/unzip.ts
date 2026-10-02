/** A small, defensive ZIP reader: stored or deflated entries, no ZIP64, with hard limits against zip bombs. */

export type UnzipEntry = { name: string; method: number; csize: number; size: number; offset: number };
export const UNZIP_LIMITS = { entries: 2000, entryBytes: 52 * 1024 * 1024, totalBytes: 400 * 1024 * 1024 };

const dec = new TextDecoder();

export async function openZip(file: Blob): Promise<{ entries: Map<string, UnzipEntry>; read: (e: UnzipEntry) => Promise<Uint8Array> }> {
  const tailLen = Math.min(file.size, 65557);
  const tail = new DataView(await file.slice(file.size - tailLen).arrayBuffer());
  let eocd = -1;
  for (let i = tailLen - 22; i >= 0; i--) {
    if (tail.getUint32(i, true) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error("not a zip file");
  const count = tail.getUint16(eocd + 10, true);
  const cdSize = tail.getUint32(eocd + 12, true);
  const cdOffset = tail.getUint32(eocd + 16, true);
  if (count === 0xffff || cdSize === 0xffffffff || cdOffset === 0xffffffff) throw new Error("zip64 archives are not supported");
  if (count > UNZIP_LIMITS.entries) throw new Error("too many files in the archive");
  if (cdOffset + cdSize > file.size) throw new Error("damaged zip");
  const cd = new DataView(await file.slice(cdOffset, cdOffset + cdSize).arrayBuffer());
  const entries = new Map<string, UnzipEntry>();
  let p = 0;
  let total = 0;
  for (let i = 0; i < count; i++) {
    if (p + 46 > cd.byteLength || cd.getUint32(p, true) !== 0x02014b50) throw new Error("damaged zip");
    const method = cd.getUint16(p + 10, true);
    const csize = cd.getUint32(p + 20, true);
    const size = cd.getUint32(p + 24, true);
    const nameLen = cd.getUint16(p + 28, true);
    const extraLen = cd.getUint16(p + 30, true);
    const commentLen = cd.getUint16(p + 32, true);
    const offset = cd.getUint32(p + 42, true);
    const name = dec.decode(new Uint8Array(cd.buffer, p + 46, nameLen));
    p += 46 + nameLen + extraLen + commentLen;
    if (size > UNZIP_LIMITS.entryBytes) throw new Error("a file in the archive is too large");
    total += size;
    if (total > UNZIP_LIMITS.totalBytes) throw new Error("the archive is too large");
    if (!name.endsWith("/")) entries.set(name, { name, method, csize, size, offset });
  }
  const read = async (e: UnzipEntry) => {
    const head = new DataView(await file.slice(e.offset, e.offset + 30).arrayBuffer());
    if (head.getUint32(0, true) !== 0x04034b50) throw new Error("damaged zip");
    const start = e.offset + 30 + head.getUint16(26, true) + head.getUint16(28, true);
    const raw = file.slice(start, start + e.csize);
    if (e.method === 0) return new Uint8Array(await raw.arrayBuffer());
    if (e.method !== 8) throw new Error("unsupported compression");
    const out = await new Response(raw.stream().pipeThrough(new DecompressionStream("deflate-raw"))).arrayBuffer();
    if (out.byteLength > UNZIP_LIMITS.entryBytes || out.byteLength !== e.size) throw new Error("damaged zip");
    return new Uint8Array(out);
  };
  return { entries, read };
}
