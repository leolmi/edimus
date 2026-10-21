import { Injectable, inject, signal } from '@angular/core';
import type { AudioSource } from '../montage/montage.model';
import { AudioEnginePort, AudioInfo } from '../platform/audio-engine.port';
import { ChannelPeaks, computePeaks } from './peaks';

export type SourceState =
  | { status: 'probing' }
  | { status: 'decoding'; info: AudioInfo; progress: number }
  | { status: 'ready'; info: AudioInfo; buffer: AudioBuffer; peaks: ChannelPeaks[] }
  | { status: 'error'; error: string };

/** Decoded audio of the montage sources, by source id. */
@Injectable({ providedIn: 'root' })
export class AudioLibraryService {
  private readonly decoder = inject(AudioEnginePort);

  readonly sources = signal<Record<string, SourceState>>({});

  /** Replaces the library with the given sources and decodes them one at a time. */
  async load(sources: AudioSource[]): Promise<void> {
    this.sources.set(Object.fromEntries(sources.map((s) => [s.id, { status: 'probing' } as SourceState])));
    for (const source of sources) await this.loadOne(source);
  }

  /** Decodes the sources not yet in the library (the others are kept, e.g. for undo). */
  async sync(sources: AudioSource[]): Promise<void> {
    const added = sources.filter((s) => !(s.id in this.sources()));
    if (!added.length) return;
    this.sources.update((all) => ({ ...all, ...Object.fromEntries(added.map((s) => [s.id, { status: 'probing' }])) }));
    for (const source of added) await this.loadOne(source);
  }

  /** Decodes a source again (its file changed, e.g. a relinked source). */
  async reload(source: AudioSource): Promise<void> {
    this.sources.update((all) => ({ ...all, [source.id]: { status: 'probing' } }));
    await this.loadOne(source);
  }

  private async loadOne(source: AudioSource): Promise<void> {
    try {
      const info = await this.decoder.probe(source.path);
      this.update(source.id, { status: 'decoding', info, progress: 0 });
      const buffer = await this.decoder.decode(source.path, info, (progress) =>
        this.update(source.id, { status: 'decoding', info, progress }),
      );
      const peaks = await computePeaks(buffer);
      this.update(source.id, { status: 'ready', info, buffer, peaks });
    } catch (err) {
      this.update(source.id, { status: 'error', error: String((err as { message?: string }).message ?? err) });
    }
  }

  /** Ready state of a source, if decoded. */
  ready(id: string): Extract<SourceState, { status: 'ready' }> | undefined {
    const state = this.sources()[id];
    return state?.status === 'ready' ? state : undefined;
  }

  private update(id: string, state: SourceState): void {
    // ignore updates of sources no longer in the library (another montage was opened)
    if (!(id in this.sources())) return;
    this.sources.update((all) => ({ ...all, [id]: state }));
  }
}
