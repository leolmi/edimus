import { Injectable, computed, inject, signal } from '@angular/core';
import { AudioLibraryService } from '../audio/audio-library.service';
import type { Tempo } from '../audio/tempo';
import { readMontage, writeMontage } from './montage-file';
import {
  AudioSource,
  MONTAGE_EXTENSION,
  MONTAGE_VERSION,
  Montage,
  Track,
  baseName,
  fileExtension,
  isAudioFile,
} from './montage.model';

const HISTORY_LIMIT = 200;

/** Drops the sources not referenced by any clip. */
function withoutUnusedSources(montage: Montage): Montage {
  const used = new Set(montage.tracks.flatMap((t) => t.clips.map((c) => c.sourceId)));
  const sources = montage.sources.filter((s) => used.has(s.id));
  return sources.length === montage.sources.length ? montage : { ...montage, sources };
}

const emptyMontage = (): Montage => ({ version: MONTAGE_VERSION, channels: 2, sources: [], tracks: [] });

/**
 * Holds the single montage governed by this app instance (a new, empty one at startup).
 * The montage is immutable: every edit replaces it, so the previous states form the undo history.
 */
@Injectable({ providedIn: 'root' })
export class MontageService {
  private readonly library = inject(AudioLibraryService);

  readonly montage = signal<Montage>(emptyMontage());
  /** Path of the montage file; null while the montage has never been saved. */
  readonly path = signal<string | null>(null);
  /** Incremented every time another montage replaces the current one (not on edits). */
  readonly generation = signal(0);
  /** Montage as last saved (or opened); null when it has never been saved. */
  private readonly saved = signal<Montage | null>(this.montage());
  private readonly undoStack = signal<Montage[]>([]);
  private readonly redoStack = signal<Montage[]>([]);

  /** Name of the montage file, null for a new montage. */
  readonly fileName = computed(() => {
    const path = this.path();
    return path ? baseName(path) : null;
  });
  /** Name chosen by the user and not yet applied to the file (applied by the next save). */
  readonly pendingName = signal<string | null>(null);
  /** Name shown: the chosen one, or the file name; null for a new montage never named. */
  readonly displayName = computed(() => this.pendingName() ?? this.fileName());
  readonly isEmpty = computed(() => this.montage().tracks.length === 0);
  readonly dirty = computed(
    () =>
      (this.montage() !== this.saved() && !(this.saved() === null && this.isEmpty())) ||
      (this.path() !== null && this.pendingName() !== null && this.pendingName() !== this.fileName()),
  );
  /** A new, untouched montage: opening something can replace it in this instance. */
  readonly pristine = computed(() => this.path() === null && this.isEmpty() && !this.dirty());
  readonly canUndo = computed(() => this.undoStack().length > 0);
  readonly canRedo = computed(() => this.redoStack().length > 0);

  /** Replaces the current montage with the one in the file. */
  async openMontage(path: string): Promise<void> {
    this.reset(await readMontage(path), path);
  }

  /** Starts over with a new, empty montage. */
  reset(montage: Montage = emptyMontage(), path: string | null = null): void {
    this.montage.set(montage);
    this.path.set(path);
    this.saved.set(path ? montage : null);
    this.pendingName.set(null);
    this.undoStack.set([]);
    this.redoStack.set([]);
    this.generation.update((g) => g + 1);
    void this.library.load(montage.sources);
  }

  /** Applies an edit, recording the previous state for undo. */
  update(edit: (montage: Montage) => Montage): void {
    const current = this.montage();
    const next = edit(current);
    if (next === current) return;
    this.undoStack.update((stack) => [...stack.slice(-HISTORY_LIMIT + 1), current]);
    this.redoStack.set([]);
    this.apply(next);
  }

  /**
   * Continuous edits (e.g. dragging): `preview` shows intermediate states without recording
   * them, `commit` records the whole gesture as one undo step from the state it started on.
   */
  preview(montage: Montage): void {
    this.apply(montage);
  }

  commit(from: Montage): void {
    if (this.montage() === from) return;
    this.undoStack.update((stack) => [...stack.slice(-HISTORY_LIMIT + 1), from]);
    this.redoStack.set([]);
  }

  /** Applies a structural edit (clips may disappear), dropping the sources left unused. */
  edit(edit: (montage: Montage) => Montage): void {
    this.update((m) => {
      const next = edit(m);
      return next === m ? m : withoutUnusedSources(next);
    });
  }

  /** Adds one track per audio file, decoding the new sources. */
  addAudio(paths: string[]): number {
    const audio = paths.filter(isAudioFile);
    if (!audio.length) return 0;
    const { sources, tracks } = this.tracksFromAudio(audio);
    this.update((m) => ({ ...m, sources: [...m.sources, ...sources], tracks: [...m.tracks, ...tracks] }));
    return audio.length;
  }

  /**
   * Adds audio files to a track, one after the other from `start` (`lengths`: their durations,
   * in seconds, to place them in sequence).
   */
  addAudioToTrack(trackId: string, paths: string[], start: number, lengths: number[]): number {
    const audio = paths.filter(isAudioFile);
    if (!audio.length || !this.montage().tracks.some((t) => t.id === trackId)) return 0;
    const sources: AudioSource[] = audio.map((path) => ({ id: crypto.randomUUID(), path }));
    let at = start;
    const clips = sources.map((source, i) => {
      const clip = { id: crypto.randomUUID(), sourceId: source.id, start: at, offset: 0, duration: 0 };
      at += lengths[paths.indexOf(audio[i])] ?? 0;
      return clip;
    });
    this.update((m) => ({
      ...m,
      sources: [...m.sources, ...sources],
      tracks: m.tracks.map((t) => (t.id === trackId ? { ...t, clips: [...t.clips, ...clips] } : t)),
    }));
    return audio.length;
  }

  /** Sets (or, with null, removes) the tempo given by hand to a source. */
  setSourceTempo(sourceId: string, tempo: Tempo | null): void {
    this.update((m) => ({
      ...m,
      sources: m.sources.map((s) => (s.id === sourceId ? { ...s, tempo: tempo ?? undefined } : s)),
    }));
  }

  /** Replaces a track with the result of `edit`. */
  updateTrack(id: string, edit: (track: Track) => Track): void {
    this.update((m) => ({ ...m, tracks: m.tracks.map((t) => (t.id === id ? edit(t) : t)) }));
  }

  /** Removes a track and the sources no longer used by any clip. */
  removeTrack(id: string): void {
    this.update((m) => withoutUnusedSources({ ...m, tracks: m.tracks.filter((t) => t.id !== id) }));
  }

  /** Removes a clip (and its track when it was the last clip). */
  removeClip(id: string): void {
    this.update((m) =>
      withoutUnusedSources({
        ...m,
        tracks: m.tracks
          .map((t) => (t.clips.some((c) => c.id === id) ? { ...t, clips: t.clips.filter((c) => c.id !== id) } : t))
          .filter((t) => t.clips.length > 0),
      }),
    );
  }

  undo(): void {
    const stack = this.undoStack();
    if (!stack.length) return;
    this.redoStack.update((redo) => [...redo, this.montage()]);
    this.undoStack.set(stack.slice(0, -1));
    this.apply(stack[stack.length - 1]);
  }

  redo(): void {
    const stack = this.redoStack();
    if (!stack.length) return;
    this.undoStack.update((undo) => [...undo, this.montage()]);
    this.redoStack.set(stack.slice(0, -1));
    this.apply(stack[stack.length - 1]);
  }

  /** Chooses a new name, applied to the file by the next save (null: back to the file name). */
  rename(name: string | null): void {
    this.pendingName.set(name && name !== this.fileName() ? name : null);
  }

  /** Saves to the given path (adding the montage extension when missing). */
  async saveAs(path: string): Promise<string> {
    if (fileExtension(path) !== MONTAGE_EXTENSION) path = `${path}.${MONTAGE_EXTENSION}`;
    const montage = this.montage();
    await writeMontage(path, montage);
    this.path.set(path);
    this.saved.set(montage);
    this.pendingName.set(null);
    return path;
  }

  /** Replaces the montage, decoding the sources it adds. */
  private apply(montage: Montage): void {
    const before = this.montage().sources;
    this.montage.set(montage);
    if (montage.sources !== before) void this.library.sync(montage.sources);
  }

  private tracksFromAudio(paths: string[]): { sources: AudioSource[]; tracks: Track[] } {
    const sources: AudioSource[] = paths.map((path) => ({ id: crypto.randomUUID(), path }));
    const tracks: Track[] = sources.map((source) => ({
      id: crypto.randomUUID(),
      name: baseName(source.path),
      clips: [{ id: crypto.randomUUID(), sourceId: source.id, start: 0, offset: 0, duration: 0 }],
    }));
    return { sources, tracks };
  }
}
