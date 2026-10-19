import { Injectable, inject } from '@angular/core';
import { filesystem } from '@neutralinojs/lib';
import { appPath, nativePath } from '../app-paths';
import { FfmpegService } from './ffmpeg.service';

/** Properties of the first audio stream of a file. */
export interface AudioInfo {
  codec: string;
  format: string;
  sampleRate: number;
  /** Channels of the decoded audio (sources with more than 2 channels are downmixed to stereo). */
  channels: 1 | 2;
  sourceChannels: number;
  duration: number;
  bitRate?: number;
}

interface ProbeOutput {
  streams?: { codec_name?: string; sample_rate?: string; channels?: number; duration?: string; bit_rate?: string }[];
  format?: { format_name?: string; duration?: string; bit_rate?: string };
}

export interface DecodeOptions {
  /** Start of the portion to decode (seconds). */
  offset?: number;
  /** Length of the portion to decode (seconds). */
  duration?: number;
  /** ffmpeg audio filter graph applied to the decoded audio. */
  filter?: string;
  /** Expected length of the output, for the progress (default: the input length). */
  outputDuration?: number;
}

const cacheDir = async () => `${await appPath()}/.cache`;

/** Reads audio files of any format supported by ffmpeg into AudioBuffers. */
@Injectable({ providedIn: 'root' })
export class AudioDecoderService {
  private readonly ffmpeg = inject(FfmpegService);

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

  /**
   * Decodes the file (or the portion given in `options`, optionally through an ffmpeg audio
   * filter) to float PCM at its native sample rate.
   */
  async decode(
    path: string,
    info: AudioInfo,
    onProgress?: (fraction: number) => void,
    options: DecodeOptions = {},
  ): Promise<AudioBuffer> {
    const expected = options.outputDuration ?? options.duration ?? info.duration;
    const dir = await cacheDir();
    await filesystem.createDirectory(dir).catch(() => undefined);
    const rawPath = `${dir}/${crypto.randomUUID()}.f32`;
    try {
      const result = await this.ffmpeg.ffmpeg(
        [
          '-v', 'error', '-nostats', '-progress', 'pipe:1', '-y',
          ...(options.offset ? ['-ss', String(options.offset)] : []),
          ...(options.duration ? ['-t', String(options.duration)] : []),
          '-i', nativePath(path),
          '-map', '0:a:0', '-vn',
          '-ac', String(info.channels),
          ...(options.filter ? ['-af', options.filter] : []),
          '-f', 'f32le', '-acodec', 'pcm_f32le',
          nativePath(rawPath),
        ],
        (chunk) => {
          const time = /out_time_us=(\d+)/.exec(chunk.slice(chunk.lastIndexOf('out_time_us=')));
          if (time && expected > 0) onProgress?.(Math.min(1, Number(time[1]) / 1e6 / expected));
        },
      );
      if (result.exitCode !== 0) throw new Error(result.stdErr.trim() || `ffmpeg exit code ${result.exitCode}`);
      const data = new Float32Array(await filesystem.readBinaryFile(rawPath));
      onProgress?.(1);
      return toAudioBuffer(data, info.channels, info.sampleRate);
    } finally {
      await filesystem.remove(rawPath).catch(() => undefined);
    }
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
