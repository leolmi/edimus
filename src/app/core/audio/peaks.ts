/** Samples summarized by each peak of the finest level. */
const BASE_SAMPLES_PER_PEAK = 256;
/** Samples processed between two yields to the event loop. */
const CHUNK = 1 << 21;

/** Min/max of consecutive blocks of samples. */
export interface PeakLevel {
  samplesPerPeak: number;
  min: Float32Array;
  max: Float32Array;
}

/** Min/max pyramid of a channel: each level halves the resolution of the previous one. */
export type ChannelPeaks = PeakLevel[];

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve));

/** Builds the peak pyramid of every channel of the buffer, without blocking the UI for long. */
export async function computePeaks(buffer: AudioBuffer): Promise<ChannelPeaks[]> {
  const result: ChannelPeaks[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    const count = Math.ceil(data.length / BASE_SAMPLES_PER_PEAK);
    const min = new Float32Array(count);
    const max = new Float32Array(count);
    for (let start = 0; start < data.length; start += CHUNK) {
      const end = Math.min(data.length, start + CHUNK);
      for (let i = start; i < end; i += BASE_SAMPLES_PER_PEAK) {
        let lo = 1;
        let hi = -1;
        const blockEnd = Math.min(end, i + BASE_SAMPLES_PER_PEAK);
        for (let j = i; j < blockEnd; j++) {
          const v = data[j];
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
        const p = i / BASE_SAMPLES_PER_PEAK;
        min[p] = lo;
        max[p] = hi;
      }
      await nextTick();
    }
    const levels: ChannelPeaks = [{ samplesPerPeak: BASE_SAMPLES_PER_PEAK, min, max }];
    while (levels[levels.length - 1].min.length > 512) levels.push(halve(levels[levels.length - 1]));
    result.push(levels);
  }
  return result;
}

function halve(level: PeakLevel): PeakLevel {
  const count = Math.ceil(level.min.length / 2);
  const min = new Float32Array(count);
  const max = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    const a = i * 2;
    const b = Math.min(a + 1, level.min.length - 1);
    min[i] = Math.min(level.min[a], level.min[b]);
    max[i] = Math.max(level.max[a], level.max[b]);
  }
  return { samplesPerPeak: level.samplesPerPeak * 2, min, max };
}

/**
 * Min/max of the samples in [from, to) of a channel, read from the coarsest level
 * that is still finer than the range (or from the samples for short ranges).
 */
export function rangePeak(data: Float32Array, peaks: ChannelPeaks, from: number, to: number): [number, number] {
  from = Math.max(0, Math.floor(from));
  to = Math.min(data.length, Math.ceil(to));
  if (to <= from) return [0, 0];
  const span = to - from;
  let level: PeakLevel | undefined;
  for (const l of peaks) {
    if (l.samplesPerPeak * 2 <= span) level = l;
    else break;
  }
  let lo = 1;
  let hi = -1;
  if (!level) {
    for (let i = from; i < to; i++) {
      const v = data[i];
      if (v < lo) lo = v;
      if (v > hi) hi = v;
    }
    return [lo, hi];
  }
  const first = Math.floor(from / level.samplesPerPeak);
  const last = Math.min(level.min.length, Math.ceil(to / level.samplesPerPeak));
  for (let i = first; i < last; i++) {
    if (level.min[i] < lo) lo = level.min[i];
    if (level.max[i] > hi) hi = level.max[i];
  }
  return [lo, hi];
}
