import { Injectable, computed, inject, signal } from '@angular/core';
import { AudioLibraryService } from '../audio/audio-library.service';
import { FileAccess, FileSystemPort } from '../platform/file-system.port';
import { fileFingerprint } from './fingerprint';
import { AUDIO_EXTENSIONS, AudioSource, fileName, isAudioFile } from './montage.model';
import { MontageService } from './montage.service';

/** A source of the montage and whether its file can be read. */
export interface SourceFile {
  source: AudioSource;
  name: string;
  access: FileAccess;
}

/** Candidate files fingerprinted at most when looking for sources not found by name. */
const MAX_FINGERPRINTED = 400;

const sameName = (a: string, b: string) => fileName(a).toLowerCase() === fileName(b).toLowerCase();

/**
 * The audio files of the montage: which ones can be read, and how to reach the others again
 * (permission of the browser, or files chosen by the user, matched by fingerprint or name).
 */
@Injectable({ providedIn: 'root' })
export class SourceFilesService {
  private readonly montages = inject(MontageService);
  private readonly library = inject(AudioLibraryService);
  private readonly files = inject(FileSystemPort);

  /** State of the sources, as of the last `check`. */
  readonly sources = signal<SourceFile[]>([]);
  readonly pending = computed(() => this.sources().filter((s) => s.access !== 'ready'));
  readonly needPermission = computed(() => this.sources().some((s) => s.access === 'permission'));

  /** Reads the state of the files of the current montage. */
  async check(): Promise<SourceFile[]> {
    const sources = this.montages.montage().sources;
    const access = await Promise.all(sources.map((s) => this.files.access(s.path)));
    const state = sources.map((source, i) => ({ source, name: fileName(source.path), access: access[i] }));
    this.sources.set(state);
    return state;
  }

  /** Asks the browser to allow reading the known files again (from a click). */
  async allow(): Promise<void> {
    const waiting = this.sources().filter((s) => s.access === 'permission');
    const ready = new Set(await this.files.requestAccess(waiting.map((s) => s.source.path)));
    for (const { source } of waiting) if (ready.has(source.path)) void this.library.reload(source);
    await this.check();
  }

  /**
   * Relinks the sources not ready to the given files: same fingerprint, or same name for
   * sources saved without one. Returns the files used.
   */
  async relink(paths: string[]): Promise<string[]> {
    await this.check();
    const waiting = this.pending().map((s) => s.source);
    const candidates = paths.filter(isAudioFile);
    const used = new Set<string>();
    const link = async (source: AudioSource, path: string) => {
      waiting.splice(waiting.indexOf(source), 1);
      used.add(path);
      this.montages.relinkSource(source.id, path, await fileFingerprint(this.files, path));
    };
    // files with the same name first: cheap, and the usual case
    for (const source of [...waiting]) {
      // a file can serve more sources (the same file added twice)
      for (const path of candidates.filter((p) => sameName(p, source.path))) {
        const fingerprint = source.fingerprint && (await fileFingerprint(this.files, path));
        if (!source.fingerprint || fingerprint === source.fingerprint) {
          await link(source, path);
          break;
        }
      }
    }
    // then by content (renamed files), within a limit for large folders
    const byContent = waiting.filter((s) => s.fingerprint);
    if (byContent.length) {
      for (const path of candidates.filter((p) => !used.has(p)).slice(0, MAX_FINGERPRINTED)) {
        const fingerprint = await fileFingerprint(this.files, path);
        const source = byContent.find((s) => s.fingerprint === fingerprint && waiting.includes(s));
        if (source) await link(source, path);
        if (!waiting.some((s) => s.fingerprint)) break;
      }
    }
    await this.check();
    return [...used];
  }

  /** Files chosen by the user, matched to the sources not ready. Returns how many were relinked. */
  async chooseFiles(title: string, filterName: string): Promise<number> {
    const paths = await this.files.showOpenDialog(title, [{ name: filterName, extensions: AUDIO_EXTENSIONS }]);
    return (await this.relink(paths)).length;
  }

  /** Audio files of a folder (and subfolders) chosen by the user, matched to the sources not ready. */
  async searchFolder(title: string): Promise<number> {
    const paths = await this.files.showFolderDialog(title, AUDIO_EXTENSIONS);
    return (await this.relink(paths)).length;
  }

  /** The file chosen by the user for one source, whatever its content (the user knows best). */
  async find(sourceId: string, title: string, filterName: string): Promise<void> {
    const [path] = (await this.files.showOpenDialog(title, [{ name: filterName, extensions: AUDIO_EXTENSIONS }])).filter(isAudioFile);
    if (!path) return;
    this.montages.relinkSource(sourceId, path, await fileFingerprint(this.files, path));
    await this.check();
  }
}
