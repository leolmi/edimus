import { createEncoder } from 'wasm-media-encoders';
import type { EncodeOptions } from '../../app/core/platform/audio-engine.port';

/** Frames encoded per call: the page yields between calls, keeping the progress alive. */
const CHUNK = 1 << 16;

/** MP3 (LAME) or Ogg Vorbis file of interleaved samples, encoded in wasm. */
export async function encodeCompressed(
  samples: Float32Array,
  options: EncodeOptions,
  onProgress?: (fraction: number) => void,
): Promise<Uint8Array<ArrayBuffer>> {
  const wasmUrl = (name: string) => new URL(`wasm/${name}.wasm`, document.baseURI).href;
  const { channels, sampleRate } = options;
  // same settings as the ffmpeg encoders of the desktop: constant bitrate MP3, Vorbis quality
  let encoder: { encode(samples: Float32Array[]): Uint8Array; finalize(): Uint8Array };
  if (options.format === 'mp3') {
    const mp3 = await createEncoder('audio/mpeg', wasmUrl('mp3'));
    mp3.configure({ channels, sampleRate, bitrate: options.bitrate as Parameters<typeof mp3.configure>[0]['bitrate'] });
    encoder = mp3;
  } else {
    const ogg = await createEncoder('audio/ogg', wasmUrl('ogg'));
    ogg.configure({ channels, sampleRate, vbrQuality: options.quality });
    encoder = ogg;
  }

  const parts: Uint8Array[] = [];
  // the encoder owns the returned data: copied at once
  const keep = (data: Uint8Array) => data.length && parts.push(data.slice());
  const frames = samples.length / channels;
  for (let start = 0; start < frames; start += CHUNK) {
    const count = Math.min(CHUNK, frames - start);
    const planes = Array.from({ length: channels }, () => new Float32Array(count));
    for (let i = 0, j = start * channels; i < count; i++) {
      for (let c = 0; c < channels; c++) planes[c][i] = samples[j++];
    }
    keep(encoder.encode(planes));
    onProgress?.((start + count) / frames);
    await new Promise((resolve) => setTimeout(resolve));
  }
  keep(encoder.finalize());

  const output = new Uint8Array(parts.reduce((total, part) => total + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    output.set(part, offset);
    offset += part.length;
  }
  return output;
}
