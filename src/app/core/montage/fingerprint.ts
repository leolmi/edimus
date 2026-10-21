import type { FileSystemPort } from '../platform/file-system.port';

/** Bytes read from the start and from the end of the file. */
const SAMPLE = 256 * 1024;

/** By path and size: a file is read once per session (saves happen often). */
const known = new Map<string, Promise<string | undefined>>();

/**
 * Fingerprint of a file: SHA-256 of its size and of its first and last 256 KiB. Cheap even for
 * long recordings, and enough to recognize the same audio file under another name or path
 * (relinking of the sources), undefined when the file cannot be read.
 */
export async function fileFingerprint(files: FileSystemPort, path: string): Promise<string | undefined> {
  const size = await files.size(path);
  if (size === undefined) return undefined;
  const key = `${path}|${size}`;
  let fingerprint = known.get(key);
  if (!fingerprint) {
    fingerprint = compute(files, path, size).catch(() => undefined);
    known.set(key, fingerprint);
  }
  return fingerprint;
}

async function compute(files: FileSystemPort, path: string, size: number): Promise<string> {
  const head = await files.readBinary(path, { start: 0, length: Math.min(SAMPLE, size) });
  const tail = size > SAMPLE ? await files.readBinary(path, { start: Math.max(SAMPLE, size - SAMPLE), length: Math.min(SAMPLE, size - SAMPLE) }) : new ArrayBuffer(0);
  const data = new Uint8Array(8 + head.byteLength + tail.byteLength);
  new DataView(data.buffer).setFloat64(0, size);
  data.set(new Uint8Array(head), 8);
  data.set(new Uint8Array(tail), 8 + head.byteLength);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
  return [...digest].map((b) => b.toString(16).padStart(2, '0')).join('');
}
