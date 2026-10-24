import { Injectable, inject, signal } from '@angular/core';
import { SettingsPort } from './platform/settings.port';

export interface RecentFile {
  path: string;
  /** Kept in the list however many other files are opened later. */
  pinned: boolean;
}

const STORAGE_KEY = 'recentFiles';
/** Unpinned files kept: the pinned ones do not count. */
export const RECENT_LIMIT = 20;

const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/**
 * Montage files opened or saved lately, most recent first, without duplicates. Shared by all
 * the instances: every change starts from the stored list, so windows do not overwrite each other.
 */
@Injectable({ providedIn: 'root' })
export class RecentFilesService {
  private readonly store = inject(SettingsPort);

  readonly files = signal<RecentFile[]>([]);

  /** Reads the list again (another instance may have changed it). */
  async load(): Promise<RecentFile[]> {
    try {
      const saved = JSON.parse((await this.store.read(STORAGE_KEY)) ?? '[]') as RecentFile[];
      this.files.set(Array.isArray(saved) ? saved.filter((f) => typeof f?.path === 'string').map((f) => ({ path: f.path, pinned: !!f.pinned })) : []);
    } catch {
      // nothing saved yet (or storage unavailable)
    }
    return this.files();
  }

  /** Moves the file to the top (adding it), dropping the oldest unpinned ones beyond the limit. */
  touch(path: string): Promise<void> {
    return this.change((files) => {
      const pinned = files.some((f) => f.pinned && samePath(f.path, path));
      let unpinned = 0;
      return [{ path, pinned }, ...files.filter((f) => !samePath(f.path, path))].filter((f) => f.pinned || ++unpinned <= RECENT_LIMIT);
    });
  }

  togglePin(path: string): Promise<void> {
    return this.change((files) => files.map((f) => (samePath(f.path, path) ? { ...f, pinned: !f.pinned } : f)));
  }

  remove(path: string): Promise<void> {
    return this.change((files) => files.filter((f) => !samePath(f.path, path)));
  }

  /** A file renamed by saving keeps its place (and pin). */
  rename(from: string, to: string): Promise<void> {
    return this.change((files) => files.filter((f) => !samePath(f.path, to)).map((f) => (samePath(f.path, from) ? { ...f, path: to } : f)));
  }

  private async change(edit: (files: RecentFile[]) => RecentFile[]): Promise<void> {
    const files = edit(await this.load());
    this.files.set(files);
    try {
      await this.store.write(STORAGE_KEY, JSON.stringify(files));
    } catch (err) {
      console.error('Unable to save the recent files', err);
    }
  }
}
