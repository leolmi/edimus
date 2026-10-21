/** WAV file of interleaved samples: 16 or 24 bit integer PCM, or 32 bit float. */
export function encodeWav(samples: Float32Array, channels: number, sampleRate: number, bitDepth: 16 | 24 | 32): ArrayBuffer {
  const bytesPerSample = bitDepth / 8;
  const dataSize = samples.length * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const text = (at: number, value: string) => [...value].forEach((c, i) => view.setUint8(at + i, c.charCodeAt(0)));

  text(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  text(8, 'WAVE');
  text(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, bitDepth === 32 ? 3 : 1, true); // 3 = IEEE float, 1 = PCM
  view.setUint16(22, channels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channels * bytesPerSample, true);
  view.setUint16(32, channels * bytesPerSample, true);
  view.setUint16(34, bitDepth, true);
  text(36, 'data');
  view.setUint32(40, dataSize, true);

  let at = 44;
  if (bitDepth === 32) {
    for (const sample of samples) {
      view.setFloat32(at, sample, true);
      at += 4;
    }
    return buffer;
  }
  const max = bitDepth === 16 ? 0x7fff : 0x7fffff;
  for (const sample of samples) {
    const value = Math.round(Math.max(-1, Math.min(1, sample)) * max);
    if (bitDepth === 16) {
      view.setInt16(at, value, true);
    } else {
      view.setUint8(at, value & 0xff);
      view.setInt16(at + 1, value >> 8, true);
    }
    at += bytesPerSample;
  }
  return buffer;
}
