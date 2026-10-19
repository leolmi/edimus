/** Tempo of an audio source. */
export interface Tempo {
  /** Beats per minute. */
  bpm: number;
  /** Time of a beat (seconds from the start of the source): the grid is offset + k·60/bpm. */
  offset: number;
  /** Reliability of the detection, 0–1 (1 for values set by hand). */
  confidence: number;
  /** Beats per bar (the meter: 4 for 4/4); default 4. `offset` is then a downbeat. */
  beatsPerBar?: number;
}

/** Beats per bar of a tempo. */
export const beatsPerBar = (tempo: Tempo) => tempo.beatsPerBar ?? 4;

/** Onset strength of a source over time (frames of HOP samples). */
export interface OnsetCurve {
  novelty: Float32Array;
  frameRate: number;
  /** Time of the centre of frame 0 (seconds). */
  frameOffset: number;
}

const FRAME = 1024;
const HOP = 512;
const MIN_BPM = 60;
const MAX_BPM = 200;
/** Preferred tempo: resolves the double/half ambiguity towards the usual range. */
const PRIOR_BPM = 120;
/** Seconds analysed at most (from the start). */
const MAX_SECONDS = 300;
/** Frames processed between two yields to the event loop. */
const CHUNK_FRAMES = 1500;

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve));

/**
 * Estimates tempo and beat phase: onset strength by spectral flux, tempo from its
 * autocorrelation (weighted towards ~120 BPM), phase from the comb that best fits the onsets.
 */
export async function detectTempo(buffer: AudioBuffer): Promise<Tempo | null> {
  const curve = await onsetStrength(buffer, MAX_SECONDS);
  if (!curve) return null;
  const { novelty, frameRate } = curve;
  const sampleRate = buffer.sampleRate;
  const frames = novelty.length;
  return estimate(novelty, frameRate, sampleRate, frames);
}

/** Onset strength by spectral flux, without its slow trend (only the peaks of the attacks). */
export async function onsetStrength(buffer: AudioBuffer, maxSeconds = Infinity): Promise<OnsetCurve | null> {
  const sampleRate = buffer.sampleRate;
  const length = Math.min(buffer.length, Math.floor(maxSeconds * sampleRate));
  const frames = Math.floor((length - FRAME) / HOP);
  if (frames < 64) return null;

  // mono mix
  const mono = new Float32Array(length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }

  // onset strength: positive change of the log magnitude spectrum
  const window = new Float32Array(FRAME).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / FRAME));
  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  const bins = FRAME / 2;
  let previous = new Float32Array(bins);
  let current = new Float32Array(bins);
  const onset = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const start = f * HOP;
    for (let i = 0; i < FRAME; i++) {
      re[i] = mono[start + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    let flux = 0;
    for (let k = 1; k < bins; k++) {
      const magnitude = Math.log1p(100 * Math.hypot(re[k], im[k]));
      current[k] = magnitude;
      const rise = magnitude - previous[k];
      if (rise > 0) flux += rise;
    }
    onset[f] = flux;
    [previous, current] = [current, previous];
    if (f % CHUNK_FRAMES === 0) await nextTick();
  }

  // remove the slow trend (local mean over ~1 s) and keep the peaks
  const frameRate = sampleRate / HOP;
  const span = Math.round(frameRate / 2);
  const novelty = new Float32Array(frames);
  let sum = 0;
  for (let f = 0; f < Math.min(frames, span); f++) sum += onset[f];
  for (let f = 0; f < frames; f++) {
    if (f + span < frames) sum += onset[f + span];
    if (f - span - 1 >= 0) sum -= onset[f - span - 1];
    const count = Math.min(frames, f + span + 1) - Math.max(0, f - span);
    novelty[f] = Math.max(0, onset[f] - sum / count);
  }
  return { novelty, frameRate, frameOffset: FRAME / 2 / sampleRate };
}

async function estimate(novelty: Float32Array, frameRate: number, sampleRate: number, frames: number): Promise<Tempo | null> {

  // autocorrelation over the lags of the tempo range
  const minLag = Math.floor((60 / MAX_BPM) * frameRate);
  const maxLag = Math.ceil((60 / MIN_BPM) * frameRate);
  const acf = new Float32Array(maxLag + 2);
  for (let lag = minLag - 1; lag <= maxLag + 1; lag++) {
    let total = 0;
    for (let f = 0; f + lag < frames; f++) total += novelty[f] * novelty[f + lag];
    acf[lag] = total / (frames - lag);
  }
  await nextTick();

  let best = -1;
  let bestScore = -Infinity;
  let mean = 0;
  for (let lag = minLag; lag <= maxLag; lag++) {
    mean += acf[lag];
    const bpm = (60 * frameRate) / lag;
    const prior = Math.exp(-0.5 * Math.pow(Math.log2(bpm / PRIOR_BPM) / 0.9, 2));
    const score = acf[lag] * prior;
    if (score > bestScore) {
      bestScore = score;
      best = lag;
    }
  }
  mean /= maxLag - minLag + 1;
  if (best < 0 || acf[best] <= 0) return null;

  // sub-frame lag by parabolic interpolation
  const a = acf[best - 1];
  const b = acf[best];
  const c = acf[best + 1];
  const shift = a - 2 * b + c !== 0 ? (0.5 * (a - c)) / (a - 2 * b + c) : 0;
  const coarse = best + Math.max(-0.5, Math.min(0.5, shift));

  // fine period and phase: the comb of beats that collects the most onset strength, over
  // periods around the coarse one (the autocorrelation peak is too broad for a precise tempo)
  let period = coarse;
  let bestPhase = 0;
  let bestEnergy = -Infinity;
  for (let p = coarse * 0.985; p <= coarse * 1.015; p += coarse * 0.0005) {
    for (let phase = 0; phase < p; phase += 0.5) {
      let energy = 0;
      let beats = 0;
      for (let t = phase; t < frames - 1; t += p, beats++) energy += comb(novelty, t);
      energy /= beats;
      if (energy > bestEnergy) {
        bestEnergy = energy;
        bestPhase = phase;
        period = p;
      }
    }
    await nextTick();
  }
  const bpm = (60 * frameRate) / period;
  // the onset of frame f is centred half a frame after its start
  const offset = (bestPhase * HOP + FRAME / 2) / sampleRate;

  // how much the chosen period stands out from the average correlation
  const confidence = Math.max(0, Math.min(1, (acf[best] - mean) / (acf[best] + 1e-9)));
  return { bpm: Math.round(bpm * 100) / 100, offset: offset % (60 / bpm), confidence: Math.round(confidence * 100) / 100 };
}

/** Onset strength around a fractional frame: the strongest of the two nearest frames. */
function comb(novelty: Float32Array, t: number): number {
  const i = Math.floor(t);
  return Math.max(novelty[i], novelty[i + 1] ?? 0);
}

/** In-place radix-2 FFT (length must be a power of two). */
function fft(re: Float32Array, im: Float32Array): void {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let size = 2; size <= n; size <<= 1) {
    const angle = (-2 * Math.PI) / size;
    const wr = Math.cos(angle);
    const wi = Math.sin(angle);
    for (let start = 0; start < n; start += size) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < size / 2; k++) {
        const a = start + k;
        const b = a + size / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const next = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = next;
      }
    }
  }
}

/**
 * Moves each time (source seconds) to the strongest attack within `window` seconds, so that
 * beats marked by hand land exactly on the hits.
 */
export function snapToOnsets(curve: OnsetCurve, times: number[], window = 0.07): number[] {
  const { novelty, frameRate, frameOffset } = curve;
  const reach = Math.round(window * frameRate);
  return times.map((time) => {
    const centre = Math.round((time - frameOffset) * frameRate);
    let best = -1;
    let bestValue = 0;
    for (let f = Math.max(0, centre - reach); f <= Math.min(novelty.length - 1, centre + reach); f++) {
      if (novelty[f] > bestValue) {
        bestValue = novelty[f];
        best = f;
      }
    }
    // no attack nearby: keep the click
    if (best < 0) return time;
    // sub-frame position of the peak (parabola through the three frames around it)
    const a = novelty[best - 1] ?? 0;
    const c = novelty[best + 1] ?? 0;
    const curvature = a - 2 * bestValue + c;
    const shift = curvature < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / curvature)) : 0;
    return frameOffset + (best + shift) / frameRate;
  });
}
