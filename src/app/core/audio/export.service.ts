import { Injectable, inject, signal } from '@angular/core';
import { filesystem } from '@neutralinojs/lib';
import { appPath, nativePath } from '../app-paths';
import { TimelineService } from '../timeline/timeline.service';
import { FfmpegService } from './ffmpeg.service';
import { MixService } from './mix.service';

export type ExportFormat = 'wav' | 'mp3' | 'flac' | 'ogg' | 'opus' | 'm4a';

export interface ExportOptions {
  format: ExportFormat;
  channels: 1 | 2;
  sampleRate: number;
  /** Bits per sample of the lossless formats (32 = float for WAV). */
  bitDepth: 16 | 24 | 32;
  /** Bitrate (kbps) of MP3, Opus and AAC. */
  bitrate: number;
  /** Vorbis quality (0–10). */
  quality: number;
  /** Scales the mix so that its peak is at -1 dBFS. */
  normalize: boolean;
}

export interface ExportProgress {
  stage: 'render' | 'encode';
  /** 0–1. */
  progress: number;
}

/** Peak level of the normalized mix (-1 dBFS). */
const NORMALIZED_PEAK = Math.pow(10, -1 / 20);
/** Bytes written per call when saving the raw mix (Neutralino transfers files through its socket). */
const WRITE_CHUNK = 8 * 1024 * 1024;

/** Codec arguments of ffmpeg for each format. */
function codecArgs(options: ExportOptions): string[] {
  switch (options.format) {
    case 'wav':
      return ['-c:a', { 16: 'pcm_s16le', 24: 'pcm_s24le', 32: 'pcm_f32le' }[options.bitDepth]];
    case 'flac':
      return ['-c:a', 'flac', '-compression_level', '8', '-sample_fmt', options.bitDepth === 16 ? 's16' : 's32',
        ...(options.bitDepth === 24 ? ['-bits_per_raw_sample', '24'] : [])];
    case 'mp3':
      return ['-c:a', 'libmp3lame', '-b:a', `${options.bitrate}k`];
    case 'ogg':
      return ['-c:a', 'libvorbis', '-q:a', String(options.quality)];
    case 'opus':
      // Opus works at 48 kHz
      return ['-c:a', 'libopus', '-b:a', `${options.bitrate}k`, '-ar', '48000'];
    case 'm4a':
      return ['-c:a', 'aac', '-b:a', `${options.bitrate}k`];
  }
}

/** Mixdown of the montage to a single mono or stereo file, in any of the supported formats. */
@Injectable({ providedIn: 'root' })
export class ExportService {
  private readonly mixer = inject(MixService);
  private readonly timeline = inject(TimelineService);
  private readonly ffmpeg = inject(FfmpegService);

  /** Progress of the running export, null when idle. */
  readonly progress = signal<ExportProgress | null>(null);

  async export(path: string, options: ExportOptions): Promise<void> {
    if (this.progress()) throw new Error('An export is already running');
    const duration = this.timeline.duration();
    if (duration <= 0) throw new Error('The montage is empty');
    if (!this.mixer.isComplete()) throw new Error('Some clips are still being decoded or processed');
    const rawPath = `${await appPath()}/.cache/${crypto.randomUUID()}.mix.f32`;
    try {
      this.progress.set({ stage: 'render', progress: 0 });
      const mix = await this.render(duration, options);
      await this.writeRaw(rawPath, mix);
      this.progress.set({ stage: 'encode', progress: 0 });
      const result = await this.ffmpeg.ffmpeg(
        [
          '-v', 'error', '-nostats', '-progress', 'pipe:1', '-y',
          '-f', 'f32le', '-ar', String(options.sampleRate), '-ac', String(options.channels),
          '-i', nativePath(rawPath),
          ...codecArgs(options),
          nativePath(path),
        ],
        (chunk) => {
          const time = /out_time_us=(\d+)/.exec(chunk.slice(chunk.lastIndexOf('out_time_us=')));
          if (time) this.progress.set({ stage: 'encode', progress: Math.min(1, Number(time[1]) / 1e6 / duration) });
        },
      );
      if (result.exitCode !== 0) throw new Error(result.stdErr.trim() || `ffmpeg exit code ${result.exitCode}`);
    } finally {
      await filesystem.remove(rawPath).catch(() => undefined);
      this.progress.set(null);
    }
  }

  /** Renders the mix offline and returns its samples interleaved. */
  private async render(duration: number, options: ExportOptions): Promise<Float32Array<ArrayBuffer>> {
    const ctx = new OfflineAudioContext({
      numberOfChannels: options.channels,
      length: Math.ceil(duration * options.sampleRate),
      sampleRate: options.sampleRate,
    });
    this.mixer.schedule(ctx, ctx.destination, 0, 0);
    const timer = setInterval(() => {
      this.progress.set({ stage: 'render', progress: Math.min(1, ctx.currentTime / duration) });
    }, 200);
    const buffer = await ctx.startRendering().finally(() => clearInterval(timer));

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

  private async writeRaw(path: string, samples: Float32Array<ArrayBuffer>): Promise<void> {
    await filesystem.createDirectory(path.slice(0, path.lastIndexOf('/'))).catch(() => undefined);
    const bytes = samples.buffer;
    await filesystem.writeBinaryFile(path, bytes.slice(0, Math.min(WRITE_CHUNK, bytes.byteLength)));
    for (let offset = WRITE_CHUNK; offset < bytes.byteLength; offset += WRITE_CHUNK) {
      await filesystem.appendBinaryFile(path, bytes.slice(offset, offset + WRITE_CHUNK));
    }
  }
}
