/** Renders kept at most: the oldest are removed first. */
const MAX_ENTRIES = 24;
const DIR = 'renders';
/** channels, sample rate, frames (32 bit each) before the samples. */
const HEADER = 12;

const hash = async (key: string) =>
  [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key)))]
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');

/**
 * Processed renders (Rubber Band) kept in the Origin Private File System, so that a reload
 * does not render them again. Every failure just means "not cached".
 */
export class RenderCache {
  private dir?: Promise<FileSystemDirectoryHandle>;

  async get(key: string): Promise<AudioBuffer | undefined> {
    try {
      const file = await (await (await this.folder()).getFileHandle(await hash(key))).getFile();
      const bytes = await file.arrayBuffer();
      const [channels, sampleRate, length] = new Uint32Array(bytes, 0, 3);
      const buffer = new AudioBuffer({ numberOfChannels: channels, sampleRate, length });
      for (let c = 0; c < channels; c++) {
        buffer.copyToChannel(new Float32Array(bytes, HEADER + c * length * 4, length), c);
      }
      return buffer;
    } catch {
      return undefined;
    }
  }

  async set(key: string, buffer: AudioBuffer): Promise<void> {
    try {
      const folder = await this.folder();
      const stream = await (await folder.getFileHandle(await hash(key), { create: true })).createWritable();
      await stream.write(new Uint32Array([buffer.numberOfChannels, buffer.sampleRate, buffer.length]));
      for (let c = 0; c < buffer.numberOfChannels; c++) await stream.write(buffer.getChannelData(c) as Float32Array<ArrayBuffer>);
      await stream.close();
      await this.trim(folder);
    } catch {
      // storage full or unavailable: rendered again next time
    }
  }

  private async trim(folder: FileSystemDirectoryHandle): Promise<void> {
    const entries: { name: string; modified: number }[] = [];
    for await (const [name, handle] of (folder as unknown as AsyncIterable<[string, FileSystemHandle]>)) {
      if (handle.kind === 'file') entries.push({ name, modified: (await (handle as FileSystemFileHandle).getFile()).lastModified });
    }
    entries.sort((a, b) => b.modified - a.modified);
    for (const entry of entries.slice(MAX_ENTRIES)) await folder.removeEntry(entry.name);
  }

  private folder(): Promise<FileSystemDirectoryHandle> {
    this.dir ??= navigator.storage.getDirectory().then((root) => root.getDirectoryHandle(DIR, { create: true }));
    return this.dir;
  }
}
