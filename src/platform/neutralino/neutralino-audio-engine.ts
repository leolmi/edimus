import { Injectable, inject } from '@angular/core';
import { filesystem } from '@neutralinojs/lib';
import { appPath, nativePath } from './app-paths';
import {
  AudioEnginePort,
  AudioInfo,
  AudioProcessing,
  DecodeOptions,
  EncodeOptions,
  ExportFormat,
} from '../../app/core/platform/audio-engine.port';
import { FileSystemPort } from '../../app/core/platform/file-system.port';
import { FfmpegService } from './ffmpeg.service';

interface ProbeOutput {
  streams?: { codec_name?: string; sample_rate?: string; channels?: number; duration?: string; bit_rate?: string }[];
  format?: { format_name?: string; duration?: string; bit_rate?: string };
}

/** Raw PCM files exchanged with ffmpeg, removed after use. */
const cacheFile = async (suffix: string) => {
  const dir = `${await appPath()}/.cache`;
  await filesystem.createDirectory(dir).catch(() => undefined);
  return `${dir}/${crypto.randomUUID()}${suffix}`;
};

/** Microseconds of output written so far, from the `-progress` stream of ffmpeg. */
const progressTime = (chunk: string) => {
  const time = /out_time_us=(\d+)/.exec(chunk.slice(chunk.lastIndexOf('out_time_us=')));
  return time ? Number(time[1]) / 1e6 : undefined;
};

/** Audio files of any format supported by ffmpeg, processed with Rubber Band. */
@Injectable()
export class NeutralinoAudioEngine extends AudioEnginePort {
  private readonly ffmpeg = inject(FfmpegService);
  private readonly files = inject(FileSystemPort);

  readonly exportFormats: readonly ExportFormat[] = ['wav', 'mp3', 'flac', 'ogg', 'opus', 'm4a'];

  async probe(path: string): Promise<AudioInfo> {
    const result = await this.ffmpeg.ffprobe([
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_name,sample_rate,channels,duration,bit_rate:format=format_name,duration,bit_rate',
      '-of', 'json',
      nativePath(path),
    ]);
    if (result.exitCode !== 0) throw new Error(result.stdErr.trim() || `ffprobe exit code ${result.exitCode}`);
    const output = JSON.parse(result.stdOut) as ProbeOutput;
    const stream = output.streams?.[0];
    if (!stream) throw new Error(`No audio stream in ${path}`);
    const sourceChannels = stream.channels ?? 2;
    const bitRate = Number(stream.bit_rate ?? output.format?.bit_rate);
    return {
      codec: stream.codec_name ?? '?',
      format: output.format?.format_name ?? '?',
      sampleRate: Number(stream.sample_rate),
      channels: sourceChannels === 1 ? 1 : 2,
      sourceChannels,
      duration: Number(stream.duration ?? output.format?.duration ?? 0),
      bitRate: Number.isFinite(bitRate) ? bitRate : undefined,
    };
  }

  async decode(
    path: string,
    info: AudioInfo,
    onProgress?: (fraction: number) => void,
    options: DecodeOptions = {},
  ): Promise<AudioBuffer> {
    const expected = options.outputDuration ?? options.duration ?? info.duration;
    const rawPath = await cacheFile('.f32');
    try {
      const result = await this.ffmpeg.ffmpeg(
        [
          '-v', 'error', '-nostats', '-progress', 'pipe:1', '-y',
          ...(options.offset ? ['-ss', String(options.offset)] : []),
          ...(options.duration ? ['-t', String(options.duration)] : []),
          '-i', nativePath(path),
          '-map', '0:a:0', '-vn',
          '-ac', String(info.channels),
          ...(options.processing ? ['-af', processingFilter(options.processing, info.sampleRate)] : []),
          '-f', 'f32le', '-acodec', 'pcm_f32le',
          nativePath(rawPath),
        ],
        (chunk) => {
          const time = progressTime(chunk);
          if (time !== undefined && expected > 0) onProgress?.(Math.min(1, time / expected));
        },
      );
      if (result.exitCode !== 0) throw new Error(result.stdErr.trim() || `ffmpeg exit code ${result.exitCode}`);
      const data = new Float32Array(await this.files.readBinary(rawPath));
      onProgress?.(1);
      return toAudioBuffer(data, info.channels, info.sampleRate);
    } finally {
      await this.files.remove(rawPath).catch(() => undefined);
    }
  }

  async encode(
    path: string,
    samples: Float32Array<ArrayBuffer>,
    options: EncodeOptions,
    onProgress?: (fraction: number) => void,
  ): Promise<void> {
    const duration = samples.length / options.channels / options.sampleRate;
    const rawPath = await cacheFile('.mix.f32');
    try {
      await this.files.writeBinary(rawPath, samples.buffer);
      const result = await this.ffmpeg.ffmpeg(
        [
          '-v', 'error', '-nostats', '-progress', 'pipe:1', '-y',
          '-f', 'f32le', '-ar', String(options.sampleRate), '-ac', String(options.channels),
          '-i', nativePath(rawPath),
          ...codecArgs(options),
          nativePath(path),
        ],
        (chunk) => {
          const time = progressTime(chunk);
          if (time !== undefined && duration > 0) onProgress?.(Math.min(1, time / duration));
        },
      );
      if (result.exitCode !== 0) throw new Error(result.stdErr.trim() || `ffmpeg exit code ${result.exitCode}`);
    } finally {
      await this.files.remove(rawPath).catch(() => undefined);
    }
  }
}

/**
 * ffmpeg filter of a processed clip: Rubber Band time-stretch (speed and pitch independent), or
 * varispeed by resampling (pitch follows the speed) plus an optional extra pitch shift.
 */
function processingFilter({ rate, pitch: semitones, varispeed }: AudioProcessing, sampleRate: number): string {
  const pitch = Math.pow(2, semitones / 12);
  if (!varispeed) return `rubberband=tempo=${rate}:pitch=${pitch}:pitchq=quality:channels=together`;
  const resample = `asetrate=${Math.round(sampleRate * rate)},aresample=${sampleRate}`;
  return pitch === 1 ? resample : `${resample},rubberband=pitch=${pitch}:pitchq=quality:channels=together`;
}

/** Codec arguments of ffmpeg for each format. */
function codecArgs(options: EncodeOptions): string[] {
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

/** Splits interleaved samples into the channels of an AudioBuffer. */
function toAudioBuffer(interleaved: Float32Array<ArrayBuffer>, channels: number, sampleRate: number): AudioBuffer {
  const length = Math.floor(interleaved.length / channels);
  const buffer = new AudioBuffer({ length: Math.max(1, length), numberOfChannels: channels, sampleRate });
  if (channels === 1) {
    buffer.copyToChannel(interleaved.subarray(0, length), 0);
    return buffer;
  }
  for (let c = 0; c < channels; c++) {
    const channel = new Float32Array(length);
    for (let i = 0, j = c; i < length; i++, j += channels) channel[i] = interleaved[j];
    buffer.copyToChannel(channel, c);
  }
  return buffer;
}
