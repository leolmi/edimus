/**
 * A file the page can reach: a handle of the File System Access API (read and write, kept across
 * sessions), or, where the API is missing, a picked/dropped file (read only) or a save target
 * whose writes become downloads.
 */
export type WebFile =
  | { kind: 'handle'; handle: FileSystemFileHandle }
  | { kind: 'file'; file: File }
  | { kind: 'download' };

const DB_NAME = 'edimus';
const STORE = 'handles';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, run: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const request = run(db.transaction(STORE, mode).objectStore(STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  } finally {
    db.close();
  }
}

/**
 * Files known to the page, by path. The browser gives no real paths: each file gets
 * `/<id>/<name>`, so that folder and name helpers keep working. Handles are stored in
 * IndexedDB, so a montage reopened in a later session finds its sources again.
 */
export class WebFileRegistry {
  private readonly files = new Map<string, WebFile>();

  add(name: string, file: WebFile): string {
    const path = `/${crypto.randomUUID().slice(0, 8)}/${name}`;
    this.set(path, file);
    return path;
  }

  async get(path: string): Promise<WebFile | undefined> {
    const known = this.files.get(path);
    if (known) return known;
    const handle = await withStore<FileSystemFileHandle | undefined>('readonly', (s) => s.get(path)).catch(() => undefined);
    if (!handle) return undefined;
    const file: WebFile = { kind: 'handle', handle };
    this.files.set(path, file);
    return file;
  }

  rename(from: string, to: string, file: WebFile): void {
    this.delete(from);
    this.set(to, file);
  }

  delete(path: string): void {
    this.files.delete(path);
    void withStore('readwrite', (s) => s.delete(path)).catch(() => undefined);
  }

  private set(path: string, file: WebFile): void {
    this.files.set(path, file);
    if (file.kind === 'handle') void withStore('readwrite', (s) => s.put(file.handle, path)).catch(() => undefined);
  }
}
