import { Injectable } from '@angular/core';
import { filesystem, os } from '@neutralinojs/lib';
import { FileFilter, FileSystemPort } from '../../app/core/platform/file-system.port';
import { baseName, dirName } from '../../app/core/montage/montage.model';
import { resolveDroppedFiles } from './dropped-files';

/** Bytes written per call (Neutralino transfers files through its socket). */
const WRITE_CHUNK = 8 * 1024 * 1024;

@Injectable()
export class NeutralinoFileSystem extends FileSystemPort {
  exists(path: string): Promise<boolean> {
    return filesystem.getStats(path).then(
      () => true,
      () => false,
    );
  }

  size(path: string): Promise<number | undefined> {
    return filesystem.getStats(path).then(
      (stats) => stats.size,
      () => undefined,
    );
  }

  readText(path: string): Promise<string> {
    return filesystem.readFile(path);
  }

  async writeText(path: string, text: string): Promise<void> {
    await filesystem.writeFile(path, text);
  }

  readBinary(path: string, range?: { start: number; length: number }): Promise<ArrayBuffer> {
    return filesystem.readBinaryFile(path, range && { pos: range.start, size: range.length });
  }

  async writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    await filesystem.writeBinaryFile(path, data.slice(0, Math.min(WRITE_CHUNK, data.byteLength)));
    for (let offset = WRITE_CHUNK; offset < data.byteLength; offset += WRITE_CHUNK) {
      await filesystem.appendBinaryFile(path, data.slice(offset, offset + WRITE_CHUNK));
    }
  }

  async move(from: string, to: string): Promise<void> {
    await filesystem.move(from, to);
  }

  async remove(path: string): Promise<void> {
    await filesystem.remove(path);
  }

  relativePath(path: string, dir: string): Promise<string | undefined> {
    return filesystem.getRelativePath(path, dir).catch(() => undefined);
  }

  async resolvePath(dir: string, relative: string): Promise<string> {
    return filesystem.getAbsolutePath(await filesystem.getJoinedPath(dir, relative));
  }

  async importFile(name: string, data: ArrayBuffer, near: string): Promise<string> {
    const dir = `${dirName(near)}/${baseName(near)}.sources`;
    const path = `${dir}/${name}`;
    // a bundle opened again finds its files already there
    if ((await this.size(path)) === data.byteLength) return path;
    await filesystem.createDirectory(dir).catch(() => undefined);
    await this.writeBinary(path, data);
    return path;
  }

  showOpenDialog(title: string, filters: FileFilter[]): Promise<string[]> {
    return os.showOpenDialog(title, { multiSelections: true, filters });
  }

  async showSaveDialog(title: string, filters: FileFilter[], defaultPath?: string): Promise<string | undefined> {
    return (await os.showSaveDialog(title, { defaultPath, filters })) || undefined;
  }

  resolveDropped(files: File[]): Promise<{ paths: string[]; imported: number }> {
    return resolveDroppedFiles(files);
  }
}
