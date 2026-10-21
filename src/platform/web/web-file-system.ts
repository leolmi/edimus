import { Injectable } from '@angular/core';
import { FileFilter, FileSystemPort } from '../../app/core/platform/file-system.port';
import { dirName, fileName } from '../../app/core/montage/montage.model';
import { WebFile, WebFileRegistry } from './web-file-registry';

/** Parts of the File System Access API not yet in the DOM typings (Chromium only). */
interface PickerType {
  description: string;
  accept: Record<string, string[]>;
}
type PickerWindow = Window & {
  showOpenFilePicker?: (options: { id?: string; multiple?: boolean; types?: PickerType[] }) => Promise<FileSystemFileHandle[]>;
  showSaveFilePicker?: (options: { id?: string; suggestedName?: string; types?: PickerType[] }) => Promise<FileSystemFileHandle>;
};
type PermissionMode = { mode: 'read' | 'readwrite' };
type ExtendedHandle = FileSystemFileHandle & {
  queryPermission?: (options: PermissionMode) => Promise<PermissionState>;
  requestPermission?: (options: PermissionMode) => Promise<PermissionState>;
  move?: (name: string) => Promise<void>;
  remove?: () => Promise<void>;
};

const picker = window as PickerWindow;
const isAbort = (err: unknown) => (err as { name?: string })?.name === 'AbortError';

/** Picker types of the dialog filters ('*' is the "all files" choice the picker adds by itself). */
const pickerTypes = (filters: FileFilter[]): PickerType[] =>
  filters
    .filter((f) => !f.extensions.includes('*'))
    .map((f) => ({ description: f.name, accept: { 'application/octet-stream': f.extensions.map((e) => `.${e}`) } }));

async function ensurePermission(handle: ExtendedHandle, mode: PermissionMode['mode']): Promise<void> {
  if (!handle.queryPermission || (await handle.queryPermission({ mode })) === 'granted') return;
  if ((await handle.requestPermission?.({ mode })) !== 'granted') throw new Error(`Access to ${handle.name} was not allowed`);
}

/** File chooser of the page, for browsers without the File System Access API. */
function chooseFiles(filters: FileFilter[]): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.multiple = true;
    input.accept = filters.flatMap((f) => f.extensions.filter((e) => e !== '*').map((e) => `.${e}`)).join(',');
    input.onchange = () => resolve([...(input.files ?? [])]);
    input.oncancel = () => resolve([]);
    input.click();
  });
}

function download(name: string, data: BlobPart): void {
  const url = URL.createObjectURL(new Blob([data]));
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}

/** Files of the user through the File System Access API, or upload and download where it is missing. */
@Injectable()
export class WebFileSystem extends FileSystemPort {
  private readonly registry = new WebFileRegistry();

  async exists(path: string): Promise<boolean> {
    return (await this.registry.get(path)) !== undefined;
  }

  async size(path: string): Promise<number | undefined> {
    return this.read(path).then(
      (file) => file.size,
      () => undefined,
    );
  }

  async readText(path: string): Promise<string> {
    return (await this.read(path)).text();
  }

  async readBinary(path: string, range?: { start: number; length: number }): Promise<ArrayBuffer> {
    const file = await this.read(path);
    return (range ? file.slice(range.start, range.start + range.length) : file).arrayBuffer();
  }

  writeText(path: string, text: string): Promise<void> {
    return this.write(path, text);
  }

  writeBinary(path: string, data: ArrayBuffer): Promise<void> {
    return this.write(path, data);
  }

  async move(from: string, to: string): Promise<void> {
    const file = await this.require(from);
    if (file.kind === 'handle') {
      const handle = file.handle as ExtendedHandle;
      if (!handle.move) throw new Error('This browser cannot rename files');
      await ensurePermission(handle, 'readwrite');
      await handle.move(fileName(to));
    }
    this.registry.rename(from, to, file);
  }

  async remove(path: string): Promise<void> {
    const file = await this.registry.get(path);
    if (file?.kind === 'handle') await (file.handle as ExtendedHandle).remove?.();
    this.registry.delete(path);
  }

  async relativePath(): Promise<string | undefined> {
    // no folders: files are reached one by one
    return undefined;
  }

  async resolvePath(dir: string, relative: string): Promise<string> {
    const parts = dir.split('/');
    for (const part of relative.split(/[\\/]/)) {
      if (part === '..') parts.pop();
      else if (part && part !== '.') parts.push(part);
    }
    return parts.join('/');
  }

  async importFile(name: string, data: ArrayBuffer): Promise<string> {
    return this.registry.add(name, { kind: 'file', file: new File([data], name) });
  }

  async showOpenDialog(_title: string, filters: FileFilter[]): Promise<string[]> {
    if (!picker.showOpenFilePicker) {
      return (await chooseFiles(filters)).map((file) => this.registry.add(file.name, { kind: 'file', file }));
    }
    try {
      const handles = await picker.showOpenFilePicker({ id: 'edimus-open', multiple: true, types: pickerTypes(filters) });
      return handles.map((handle) => this.registry.add(handle.name, { kind: 'handle', handle }));
    } catch (err) {
      if (isAbort(err)) return [];
      throw err;
    }
  }

  async showSaveDialog(_title: string, filters: FileFilter[], defaultPath?: string): Promise<string | undefined> {
    const suggestedName = defaultPath ? fileName(defaultPath) : undefined;
    if (!picker.showSaveFilePicker) {
      // the browser asks where to save the download (or uses its folder)
      return suggestedName ? this.registry.add(suggestedName, { kind: 'download' }) : undefined;
    }
    try {
      const handle = await picker.showSaveFilePicker({ id: 'edimus-save', suggestedName, types: pickerTypes(filters) });
      return this.registry.add(handle.name, { kind: 'handle', handle });
    } catch (err) {
      if (isAbort(err)) return undefined;
      throw err;
    }
  }

  async resolveDropped(files: File[]): Promise<{ paths: string[]; imported: number }> {
    // dropped files are read where they are: nothing is copied
    return { paths: files.map((file) => this.registry.add(file.name, { kind: 'file', file })), imported: 0 };
  }

  private async require(path: string): Promise<WebFile> {
    const file = await this.registry.get(path);
    if (!file) throw new Error(`File not available: ${fileName(path)} (${dirName(path)})`);
    return file;
  }

  private async read(path: string): Promise<File> {
    const file = await this.require(path);
    switch (file.kind) {
      case 'file':
        return file.file;
      case 'handle':
        await ensurePermission(file.handle, 'read');
        return file.handle.getFile();
      case 'download':
        throw new Error(`${fileName(path)} was downloaded and cannot be read back`);
    }
  }

  /** Writes to a handle; any other path (no handle, or a path given by the AI) becomes a download. */
  private async write(path: string, data: string | ArrayBuffer): Promise<void> {
    const file = await this.registry.get(path);
    if (file?.kind !== 'handle') return download(fileName(path), data);
    await ensurePermission(file.handle, 'readwrite');
    const stream = await file.handle.createWritable();
    await stream.write(data);
    await stream.close();
  }
}
