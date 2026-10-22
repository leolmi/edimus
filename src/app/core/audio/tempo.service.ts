import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Clip, clipRate } from '../montage/montage.model';
import { MontageService } from '../montage/montage.service';
import { AudioLibraryService } from './audio-library.service';
import { fileFingerprint } from '../montage/fingerprint';
import { FileSystemPort } from '../platform/file-system.port';
import { PlatformInfo } from '../platform/platform-info';
import { barFilePath, readBarFile } from './bar-file';
import { OnsetCurve, Tempo, detectTempo, onsetStrength } from './tempo';
import { meanBpm } from './tempo-map';

/** `fromFile`: the tempo comes from the bar file next to the audio, not from the detection. */
export type TempoState = { status: 'detecting' } | { status: 'ready'; tempo: Tempo | null; fromFile?: boolean };

/**
 * Tempo of the sources: detected after decoding (kept in memory, recomputed on open) unless
 * set by hand on the source in the montage. Where files beside the sources can be read, the bar
 * file of the audio (`song.mp3.edimusbars`) takes the place of the detection.
 */
@Injectable({ providedIn: 'root' })
export class TempoService {
  private readonly montages = inject(MontageService);
  private readonly library = inject(AudioLibraryService);
  private readonly files = inject(FileSystemPort);
  private readonly platform = inject(PlatformInfo);

  readonly detected = signal<Record<string, TempoState>>({});
  private queue: Promise<void> = Promise.resolve();
  private readonly curves = new Map<string, Promise<OnsetCurve | null>>();

  constructor() {
    effect(() => {
      const sources = this.library.sources();
      untracked(() => {
        for (const [id, state] of Object.entries(sources)) {
          if (state.status !== 'ready' || id in this.detected()) continue;
          this.detected.update((all) => ({ ...all, [id]: { status: 'detecting' } }));
          this.queue = this.queue.then(async () => {
            const saved = await this.besideFile(id);
            const tempo = saved ?? (await detectTempo(state.buffer).catch(() => null));
            this.detected.update((all) => ({ ...all, [id]: { status: 'ready', tempo, ...(saved ? { fromFile: true } : {}) } }));
          });
        }
      });
    });
    // a new montage forgets the detections of the previous one
    effect(() => {
      this.montages.generation();
      untracked(() => {
        this.detected.set({});
        this.curves.clear();
      });
    });
  }

  /** Tempo in the bar file next to a source, when there is one of this very audio. */
  private async besideFile(sourceId: string): Promise<Tempo | null> {
    const source = this.montages.montage().sources.find((s) => s.id === sourceId);
    if (!this.platform.filesBesideSources || !source) return null;
    try {
      const path = barFilePath(source.path);
      if (!(await this.files.exists(path))) return null;
      const file = readBarFile(await this.files.readText(path));
      // a file left by another audio with the same name: ignored
      if (file.fingerprint && file.fingerprint !== (await fileFingerprint(this.files, source.path))) return null;
      return file.tempo;
    } catch {
      return null;
    }
  }

  /** Tempo of a source: the one set by hand, or the detected one. */
  sourceTempo(sourceId: string): Tempo | null | undefined {
    const manual = this.montages.montage().sources.find((s) => s.id === sourceId)?.tempo;
    if (manual) return manual;
    const state = this.detected()[sourceId];
    return state?.status === 'ready' ? state.tempo : undefined;
  }

  /** Tempo heard in a clip: the source tempo times the clip speed. */
  clipBpm(clip: Clip): number | null {
    const tempo = this.sourceTempo(clip.sourceId);
    return tempo ? meanBpm(tempo) * clipRate(clip) : null;
  }

  /** Onset strength of the whole source (computed once, on demand). */
  onsetCurve(sourceId: string): Promise<OnsetCurve | null> {
    let curve = this.curves.get(sourceId);
    if (!curve) {
      const buffer = this.library.ready(sourceId)?.buffer;
      curve = buffer ? onsetStrength(buffer) : Promise.resolve(null);
      this.curves.set(sourceId, curve);
    }
    return curve;
  }

  isDetecting(sourceId: string): boolean {
    return this.detected()[sourceId]?.status === 'detecting';
  }
}
