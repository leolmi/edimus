import { Injectable, inject } from '@angular/core';
import {
  AudioEnginePort,
  AudioInfo,
  DecodeOptions,
  EncodeOptions,
  ExportFormat,
} from '../../app/core/platform/audio-engine.port';
import { fileFingerprint } from '../../app/core/montage/fingerprint';
import { FileSystemPort } from '../../app/core/platform/file-system.port';
import { readAudioHeader } from './audio-header';
import { RenderCache } from './render-cache';
import { RubberBandClient } from './rubberband-client';
import { encodeCompressed } from './media-encoder';
import { encodeWav } from './wav-encoder';

/** Rate used when the header does not tell it (the decoder resamples to it). */
const FALLBACK_RATE = 48000;
/** Decoded files kept from the probe for the decode that usually follows it. */
const DECODED_KEPT = 8;

/** Audio in the browser: the decoders of the browser, the Web Audio API and Rubber Band (wasm). */
@Injectable()
export class WebAudioEngine extends AudioEnginePort {
  private readonly files = inject(FileSystemPort);
  /** Decoded audio of the probed files, by path (the probe must decode to know the length). */
  private readonly decoded = new Map<string, Promise<AudioBuffer>>();
  private readonly rubberBand = new RubberBandClient();
  private readonly renders = new RenderCache();

  readonly exportFormats: readonly ExportFormat[] = ['wav', 'mp3', 'ogg'];

  async probe(path: string): Promise<AudioInfo> {
    const bytes = await this.files.readBinary(path);
    const header = readAudioHeader(bytes);
    const sampleRate = header.sampleRate || FALLBACK_RATE;
    const decoding = new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate }).decodeAudioData(bytes);
    this.keep(path, decoding);
    const buffer = await decoding;
    const sourceChannels = buffer.numberOfChannels;
    return {
      codec: header.codec,
      format: header.format,
      sampleRate: buffer.sampleRate,
      channels: sourceChannels === 1 ? 1 : 2,
      sourceChannels,
      duration: buffer.duration,
      bitRate: header.codec === 'pcm' ? undefined : Math.round((bytes.byteLength * 8) / buffer.duration),
    };
  }

  async decode(
    path: string,
    info: AudioInfo,
    onProgress?: (fraction: number) => void,
    options: DecodeOptions = {},
  ): Promise<AudioBuffer> {
    const processing = options.processing;
    onProgress?.(0);
    const source = await (this.decoded.get(path) ?? this.decodeFile(path, info.sampleRate));
    this.decoded.delete(path);
    const offset = options.offset ?? 0;
    const duration = Math.min(options.duration ?? source.duration - offset, source.duration - offset);
    // varispeed by resampling; stretch and pitch shift by Rubber Band (as the ffmpeg filters on the desktop)
    const playbackRate = processing?.varispeed ? processing.rate : 1;
    const timeRatio = processing && !processing.varispeed ? 1 / processing.rate : 1;
    const pitchScale = Math.pow(2, (processing?.pitch ?? 0) / 12);
    const stretched = timeRatio !== 1 || pitchScale !== 1;
    const resampled =
      playbackRate === 1 && offset === 0 && duration >= source.duration && source.numberOfChannels === info.channels
        ? source
        : await render(source, info, offset, duration, playbackRate);
    if (!stretched) {
      onProgress?.(1);
      return resampled;
    }
    // by content: the same file dropped again (another path) finds its render
    const cacheKey = JSON.stringify([(await fileFingerprint(this.files, path)) ?? path, offset, duration, playbackRate, timeRatio, pitchScale]);
    const cached = await this.renders.get(cacheKey);
    if (cached) {
      onProgress?.(1);
      return cached;
    }
    // copies: the worker takes the data (the buffer may be shared with the library)
    const channels = Array.from({ length: resampled.numberOfChannels }, (_, c) => resampled.getChannelData(c).slice());
    const output = await this.rubberBand.process(channels, info.sampleRate, timeRatio, pitchScale, onProgress);
    const buffer = new AudioBuffer({ length: Math.max(1, output[0].length), numberOfChannels: output.length, sampleRate: info.sampleRate });
    output.forEach((data, c) => buffer.copyToChannel(data as Float32Array<ArrayBuffer>, c));
    void this.renders.set(cacheKey, buffer);
    onProgress?.(1);
    return buffer;
  }

  async encode(
    path: string,
    samples: Float32Array<ArrayBuffer>,
    options: EncodeOptions,
    onProgress?: (fraction: number) => void,
  ): Promise<void> {
    if (!this.exportFormats.includes(options.format)) {
      throw new Error(`Export to ${options.format} is not available in the web version (${this.exportFormats.join(', ')})`);
    }
    const data =
      options.format === 'wav'
        ? encodeWav(samples, options.channels, options.sampleRate, options.bitDepth)
        : (await encodeCompressed(samples, options, onProgress)).buffer;
    await this.files.writeBinary(path, data);
    onProgress?.(1);
  }

  private async decodeFile(path: string, sampleRate: number): Promise<AudioBuffer> {
    const bytes = await this.files.readBinary(path);
    return new OfflineAudioContext({ numberOfChannels: 1, length: 1, sampleRate }).decodeAudioData(bytes);
  }

  private keep(path: string, decoding: Promise<AudioBuffer>): void {
    this.decoded.set(path, decoding);
    decoding.catch(() => this.decoded.delete(path));
    // oldest first: probes not followed by a decode do not pile up
    for (const key of this.decoded.keys()) {
      if (this.decoded.size <= DECODED_KEPT) break;
      this.decoded.delete(key);
    }
  }
}

/** Portion of the source played at `rate` (varispeed) into a buffer of the target channels (downmix). */
function render(source: AudioBuffer, info: AudioInfo, offset: number, duration: number, rate: number): Promise<AudioBuffer> {
  const ctx = new OfflineAudioContext({
    numberOfChannels: info.channels,
    length: Math.max(1, Math.ceil((duration / rate) * info.sampleRate)),
    sampleRate: info.sampleRate,
  });
  const node = new AudioBufferSourceNode(ctx, { buffer: source, playbackRate: rate });
  node.connect(ctx.destination);
  node.start(0, offset, duration);
  return ctx.startRendering();
}
