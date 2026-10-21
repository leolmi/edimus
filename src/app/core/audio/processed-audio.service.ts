import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { Clip, clipRate, isProcessed } from '../montage/montage.model';
import { MontageService } from '../montage/montage.service';
import { AudioEnginePort } from '../platform/audio-engine.port';
import { AudioLibraryService } from './audio-library.service';
import { ChannelPeaks, computePeaks } from './peaks';

export type ProcessedState =
  | { status: 'rendering'; progress: number }
  | { status: 'ready'; buffer: AudioBuffer; peaks: ChannelPeaks[] }
  | { status: 'error'; error: string };

/**
 * Renders the clips with a speed or pitch change (through the audio engine) into buffers
 * used by both playback and waveform. A render covers the whole source for a speed/pitch pair,
 * so trimming, splitting, undo/redo and clips sharing the settings reuse it.
 */
@Injectable({ providedIn: 'root' })
export class ProcessedAudioService {
  private readonly montages = inject(MontageService);
  private readonly library = inject(AudioLibraryService);
  private readonly engine = inject(AudioEnginePort);

  readonly renders = signal<Record<string, ProcessedState>>({});
  private queue: Promise<void> = Promise.resolve();

  constructor() {
    effect(() => {
      const montage = this.montages.montage();
      const sources = this.library.sources();
      untracked(() => {
        for (const track of montage.tracks) {
          for (const clip of track.clips) {
            if (!isProcessed(clip) || sources[clip.sourceId]?.status !== 'ready') continue;
            const key = renderKey(clip);
            if (!(key in this.renders())) this.enqueue(key, clip);
          }
        }
      });
    });
    // a new montage releases the renders of the previous one
    effect(() => {
      this.montages.generation();
      untracked(() => this.renders.set({}));
    });
  }

  /** Rendered audio of a processed clip, when ready. */
  ready(clip: Clip): Extract<ProcessedState, { status: 'ready' }> | undefined {
    const state = this.renders()[renderKey(clip)];
    return state?.status === 'ready' ? state : undefined;
  }

  state(clip: Clip): ProcessedState | undefined {
    return this.renders()[renderKey(clip)];
  }

  private enqueue(key: string, clip: Clip): void {
    this.update(key, { status: 'rendering', progress: 0 });
    // one render at a time: the engine already uses several cores
    this.queue = this.queue.then(() => this.render(key, clip));
  }

  private async render(key: string, clip: Clip): Promise<void> {
    const source = this.library.ready(clip.sourceId);
    const path = this.montages.montage().sources.find((s) => s.id === clip.sourceId)?.path;
    if (!source || !path) return;
    const rate = clipRate(clip);
    try {
      const onProgress = (progress: number) => this.update(key, { status: 'rendering', progress });
      const buffer = await this.engine.decode(path, source.info, onProgress, {
        processing: { rate, pitch: clip.pitch ?? 0, varispeed: !!clip.varispeed },
        outputDuration: source.buffer.duration / rate,
      });
      this.update(key, { status: 'ready', buffer, peaks: await computePeaks(buffer) });
    } catch (err) {
      this.update(key, { status: 'error', error: String((err as { message?: string }).message ?? err) });
    }
  }

  private update(key: string, state: ProcessedState): void {
    this.renders.update((all) => ({ ...all, [key]: state }));
  }
}

/** Cache key of the render used by a clip: source, speed, pitch and speed mode. */
function renderKey(clip: Clip): string {
  return [clip.sourceId, clipRate(clip), clip.pitch ?? 0, clip.varispeed ? 'v' : 's'].join('|');
}
