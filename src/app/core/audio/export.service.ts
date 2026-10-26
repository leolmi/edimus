import { Injectable, inject, signal } from '@angular/core';
import { AudioEnginePort, EncodeOptions } from '../platform/audio-engine.port';
import { TimelineService } from '../timeline/timeline.service';
import { MixService } from './mix.service';

export type { ExportFormat } from '../platform/audio-engine.port';

export interface ExportOptions extends EncodeOptions {
  /** Scales the mix so that its peak is at -1 dBFS. */
  normalize: boolean;
  /** Seconds of silence appended after the end of the montage (and after the tails of the effects). */
  trailingSilence?: number;
}

export interface ExportProgress {
  stage: 'render' | 'encode';
  /** 0–1. */
  progress: number;
}

/** Peak level of the normalized mix (-1 dBFS). */
const NORMALIZED_PEAK = Math.pow(10, -1 / 20);

/** Mixdown of the montage to a single mono or stereo file, in any of the supported formats. */
@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly mixer = inject(MixService);
  private readonly timeline = inject(TimelineService);
  private readonly engine = inject(AudioEnginePort);

  /** Progress of the running export, null when idle. */
  readonly progress = signal<ExportProgress | null>(null);

  async export(path: string, options: ExportOptions): Promise<void> {
    if (this.progress()) throw new Error('An export is already running');
    if (this.timeline.duration() <= 0) throw new Error('The montage is empty');
    // the echoes and reverbs still sounding at the end are kept
    const duration = this.timeline.duration() + this.mixer.tail() + Math.max(0, options.trailingSilence ?? 0);
    if (!this.mixer.isComplete()) throw new Error('Some clips are still being decoded or processed');
    try {
      this.progress.set({ stage: 'render', progress: 0 });
      const mix = await this.render(duration, options);
      this.progress.set({ stage: 'encode', progress: 0 });
      await this.engine.encode(path, mix, options, (progress) => this.progress.set({ stage: 'encode', progress }));
    } finally {
      this.progress.set(null);
    }
  }

  /** Renders the mix offline and returns its samples interleaved. */
  private async render(duration: number, options: ExportOptions): Promise<Float32Array<ArrayBuffer>> {
    const buffer = await this.mixer.render(0, duration, options.channels, options.sampleRate, (progress) =>
      this.progress.set({ stage: 'render', progress }),
    );
    const channels = Array.from({ length: buffer.numberOfChannels }, (_, c) => buffer.getChannelData(c));
    let scale = 1;
    if (options.normalize) {
      let peak = 0;
      for (const data of channels) for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
      if (peak > 0) scale = NORMALIZED_PEAK / peak;
    }
    const count = channels.length;
    const interleaved = new Float32Array(buffer.length * count);
    for (let c = 0; c < count; c++) {
      const data = channels[c];
      for (let i = 0, j = c; i < data.length; i++, j += count) interleaved[j] = data[i] * scale;
    }
    return interleaved;
  }
}
