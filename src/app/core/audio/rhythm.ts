import { type BarAnchor, type OnsetCurve, type Tempo, type TempoRegion, beatsPerBar, fft } from './tempo';

/**
 * Rhythm analysis of a whole source: beats followed one by one along the piece (played music is
 * never perfectly even), regions with and without a pulse, meter and downbeats from the accents.
 *
 * 1. features: onset strength per band (bass = kick, middle = snare and voice, treble = hi-hat)
 *    and the pitch-class profile (chroma), whose changes mark the downbeats;
 * 2. local tempo: autocorrelation of the onsets on windows of a few seconds, followed along the
 *    piece by Viterbi (the tempo moves slowly, never jumps an octave), so a free intro takes the
 *    tempo of the music after it;
 * 3. beats: dynamic programming over the whole source (each beat about one local period after
 *    the previous, on the attacks), a global choice that works backwards as well as forwards;
 * 4. regions: where the pulse is too weak (free intro, rubato, silence) there is no grid;
 * 5. bars: in each region a second Viterbi over the beats places the downbeats on the accents
 *    (bass, harmonic changes), with 3 or 4 beats per bar and a cost to change meter.
 */

/** Onset strength of a source by frequency band, and its harmonic content. */
export interface RhythmFeatures extends OnsetCurve {
  /** Onset strength of the bass (kick), of the middle (snare, voice) and of the treble (hi-hat). */
  low: Float32Array;
  mid: Float32Array;
  high: Float32Array;
  /** Pitch-class profile (12 values, unit length) every `chromaStep` frames. */
  chroma: Float32Array;
  chromaStep: number;
}

const FRAME = 1024;
const HOP = 512;
/** Longer frames for the pitch classes: the low notes need the resolution. */
const CHROMA_FRAME = 4096;
const CHROMA_STEP = 8;
const LOW_HZ = 200;
const HIGH_HZ = 2500;
/** Frames processed between two yields to the event loop. */
const CHUNK_FRAMES = 1500;

const nextTick = () => new Promise<void>((resolve) => setTimeout(resolve));

/** Onsets per band and chroma of the whole source. */
export async function analyzeRhythm(buffer: AudioBuffer): Promise<RhythmFeatures | null> {
  const sampleRate = buffer.sampleRate;
  const length = buffer.length;
  const frames = Math.floor((length - FRAME) / HOP);
  if (frames < 64) return null;

  const mono = new Float32Array(length);
  for (let c = 0; c < buffer.numberOfChannels; c++) {
    const data = buffer.getChannelData(c);
    for (let i = 0; i < length; i++) mono[i] += data[i] / buffer.numberOfChannels;
  }

  const window = hann(FRAME);
  const chromaWindow = hann(CHROMA_FRAME);
  const re = new Float32Array(FRAME);
  const im = new Float32Array(FRAME);
  const cre = new Float32Array(CHROMA_FRAME);
  const cim = new Float32Array(CHROMA_FRAME);
  const bins = FRAME / 2;
  const lowBin = Math.round((LOW_HZ * FRAME) / sampleRate);
  const highBin = Math.round((HIGH_HZ * FRAME) / sampleRate);
  // pitch class of each bin of the chroma frame (-1 outside the range of the notes)
  const pitchClass = Int8Array.from({ length: CHROMA_FRAME / 2 }, (_, k) => {
    const hz = (k * sampleRate) / CHROMA_FRAME;
    if (hz < 60 || hz > 5000) return -1;
    return (((Math.round(12 * Math.log2(hz / 440)) + 9) % 12) + 12) % 12;
  });

  let previous = new Float32Array(bins);
  let current = new Float32Array(bins);
  const total = new Float32Array(frames);
  const low = new Float32Array(frames);
  const mid = new Float32Array(frames);
  const high = new Float32Array(frames);
  const chroma = new Float32Array(Math.ceil(frames / CHROMA_STEP) * 12);
  for (let f = 0; f < frames; f++) {
    const start = f * HOP;
    for (let i = 0; i < FRAME; i++) {
      re[i] = mono[start + i] * window[i];
      im[i] = 0;
    }
    fft(re, im);
    // positive change of the log magnitude spectrum, per band
    let l = 0;
    let m = 0;
    let h = 0;
    for (let k = 1; k < bins; k++) {
      const magnitude = Math.log1p(100 * Math.sqrt(re[k] * re[k] + im[k] * im[k]));
      current[k] = magnitude;
      const rise = magnitude - previous[k];
      if (rise <= 0) continue;
      if (k < lowBin) l += rise;
      else if (k < highBin) m += rise;
      else h += rise;
    }
    low[f] = l;
    mid[f] = m;
    high[f] = h;
    total[f] = l + m + h;
    [previous, current] = [current, previous];

    if (f % CHROMA_STEP === 0) {
      // centred on the same point as the onset frame
      const from = start + FRAME / 2 - CHROMA_FRAME / 2;
      for (let i = 0; i < CHROMA_FRAME; i++) {
        cre[i] = (mono[from + i] ?? 0) * chromaWindow[i];
        cim[i] = 0;
      }
      fft(cre, cim);
      const at = (f / CHROMA_STEP) * 12;
      for (let k = 1; k < CHROMA_FRAME / 2; k++) {
        const pc = pitchClass[k];
        if (pc >= 0) chroma[at + pc] += Math.sqrt(Math.sqrt(cre[k] * cre[k] + cim[k] * cim[k]));
      }
      let norm = 0;
      for (let c = 0; c < 12; c++) norm += chroma[at + c] * chroma[at + c];
      norm = Math.sqrt(norm);
      if (norm > 0) for (let c = 0; c < 12; c++) chroma[at + c] /= norm;
    }
    if (f % CHUNK_FRAMES === 0) await nextTick();
  }

  const frameRate = sampleRate / HOP;
  const span = Math.round(frameRate / 2);
  return {
    novelty: detrend(total, span),
    low: detrend(low, span),
    mid: detrend(mid, span),
    high: detrend(high, span),
    frameRate,
    frameOffset: FRAME / 2 / sampleRate,
    chroma,
    chromaStep: CHROMA_STEP,
  };
}

function hann(size: number): Float32Array {
  return new Float32Array(size).map((_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / size));
}

/** The curve without its slow trend (local mean over 2·span + 1 frames): only the peaks of the attacks. */
function detrend(onset: Float32Array, span: number): Float32Array {
  const frames = onset.length;
  const result = new Float32Array(frames);
  let sum = 0;
  for (let f = 0; f < Math.min(frames, span); f++) sum += onset[f];
  for (let f = 0; f < frames; f++) {
    if (f + span < frames) sum += onset[f + span];
    if (f - span - 1 >= 0) sum -= onset[f - span - 1];
    const count = Math.min(frames, f + span + 1) - Math.max(0, f - span);
    result[f] = Math.max(0, onset[f] - sum / count);
  }
  return result;
}

/** Choices of the tracking. */
export interface TrackOptions {
  /** Beats per bar kept on the whole source; without it each bar has 3 or 4 (mixed meters). */
  meter?: number;
  /** Tempo of the beat (BPM) to stay near; default the one of the tempo. */
  bpm?: number;
}

/** A span of the source as the tracking found it. */
export interface RhythmRegion {
  /** Source seconds. */
  from: number;
  to: number;
  kind: 'free' | 'pulsed';
  /** Bars of the region (numbers from 0, as in the map). */
  firstBar?: number;
  lastBar?: number;
  /** Tempo of the beat in the region (10th and 90th percentile of its bars, and the mean). */
  bpm?: { min: number; max: number; mean: number };
  /** Meters found, the most frequent first. */
  meters?: number[];
  /** Another meter that fits the accents nearly as well (or better, with a meter imposed). */
  meterAlternative?: number;
  /** The accents do not single out the downbeat: the 1 may be on another beat. */
  downbeatUncertain?: boolean;
  /** Average reliability of its bars, 0–1. */
  confidence?: number;
}

/** What the tracking found, with its doubts: shown to the user and given to the AI. */
export interface RhythmReport {
  regions: RhythmRegion[];
  /** Other tempos (BPM of the beat) with nearly as strong a pulse: twice or half as fast. */
  bpmAlternatives: number[];
  /** Bars whose beats or downbeat are doubtful. */
  uncertainBars: number[];
  /** Local tempo every second, with how clear the pulse is there (0–1). */
  tempoCurve: { time: number; bpm: number; clarity: number }[];
  /** Average reliability of the bars, 0–1. */
  confidence: number;
}

/** Bars below this reliability are reported (and drawn) as doubtful. */
export const UNCERTAIN_BAR = 0.45;

/** Usual tempo of a beat, when none is known: the middle of the range of most music. */
const PRIOR_BPM = 110;
const WINDOW_S = 8;
const STEP_S = 1;
/** Weight of the onsets against the cost of a tempo change, in the local tempo path. */
const TEMPO_EMISSION = 8;
const TEMPO_CHANGE = 150;
/** How strictly a beat comes one period after the previous (as in Ellis 2007). */
const TIGHTNESS = 100;
/** Cost (in standard deviations of the accent) of a change of meter. */
const METER_CHANGE = 4;
/**
 * Cost of a bar with one beat more or less than the meter: the tracking put a beat too many (or
 * too few) where there are no attacks to follow, as in a held chord or a pause before an entrance.
 */
// Experimental, off (Infinity): on real pieces it put odd bars in the wrong places. Was 6.
const ODD_BAR = Infinity;
/** Weight of the back beat (snare on the beats after the 1) in the choice of the downbeat. */
// Experimental, off (0): on real pieces it did not help. Was 0.6.
const BACK_BEAT = 0;
/** Accents beyond this many standard deviations count as this: an entrance after a pause, or a
 * chord anticipated on the last beat, must not move all the bars around it. */
const ACCENT_CLIP = 3;
/** A bar pinned by hand forces a beat there. */
const FORCED = 1e4;

/**
 * Bar map of the whole source from its rhythm features: an anchor (`auto`) on every downbeat with
 * the beats of its bar, the regions with no pulse, the bars pinned by hand kept (they force a
 * downbeat and get the number counted by the tracking). Returns the map and the report.
 */
export function trackRhythm(tempo: Tempo, features: RhythmFeatures, sourceLength: number, options: TrackOptions = {}): { tempo: Tempo; report: RhythmReport } {
  const { frameRate: fr, frameOffset } = features;
  // each band on the same scale (the treble has many more bins), the hi-hat counting less: it
  // marks the subdivisions more than the beat
  const [low, mid, high] = [features.low, features.mid, features.high].map((band) => 1 / (band.reduce((a, b) => a + b, 0) / band.length || 1));
  const novelty = features.low.map((value, f) => value * low + features.mid[f] * mid + 0.25 * features.high[f] * high);
  const frames = novelty.length;
  const manual = (tempo.anchors ?? []).filter((a) => !a.auto).sort((a, b) => a.time - b.time);
  const frameOf = (time: number) => Math.max(0, Math.min(frames - 1, Math.round((time - frameOffset) * fr)));
  const timeOf = (frame: number) => frameOffset + frame / fr;

  // 2. local tempo
  // tempo to stay near: the one asked for, the one set by hand, or a usual one (the detection
  // often takes the subdivision for the beat)
  const [prior, width] = options.bpm ? [options.bpm, 0.4] : tempo.confidence >= 1 ? [tempo.bpm, 0.6] : [PRIOR_BPM, 1];
  const local = localTempo(novelty, fr, prior, width);
  const periodAt = (frame: number) => {
    const w = Math.min(local.period.length - 1, Math.max(0, frame / local.hop));
    const i = Math.floor(w);
    const j = Math.min(local.period.length - 1, i + 1);
    return local.period[i] + (w - i) * (local.period[j] - local.period[i]);
  };

  // 3. beats on the whole source
  const forcedFrames = manual.map((a) => frameOf(a.time));
  const beatFrames = trackBeats(normalizeLocal(novelty, fr), periodAt, forcedFrames);
  const beats = beatFrames.map((f) => timeOf(refinePeak(novelty, f)));
  // the pinned bars exactly where the user put them
  for (const anchor of manual) {
    const i = nearest(beats, anchor.time);
    if (i >= 0 && Math.abs(beats[i] - anchor.time) < 0.1) beats[i] = anchor.time;
  }
  const strength = beats.map((t) => peak(novelty, frameOf(t), 2));

  // 4. regions with a pulse, as ranges of beats
  const pulsedWindows = pulseMask(local.clarity, manual.map((a) => Math.round(frameOf(a.time) / local.hop)));
  const patterns = new Map<number, Float32Array>();
  const pattern = (i: number) => {
    let found = patterns.get(i);
    if (!found) patterns.set(i, (found = beatPattern(novelty, frameOf(beats[i]), periodAt(frameOf(beats[i])))));
    return found;
  };
  const ranges = beatRanges(pulsedWindows, local.hop / fr, beats, pattern);

  // 5. bars of each region
  const meters = options.meter ? [options.meter] : [3, 4];
  const regions: RegionBars[] = ranges.map(([i0, i1]) => regionBars(features, beats.slice(i0, i1 + 1), strength.slice(i0, i1 + 1), meters, manual, frameOf));

  const { anchors, numbers } = numberBars(regions, manual, sourceLength);
  const report = buildReport(regions, numbers, local, fr, sourceLength, options);
  const free = report.regions.filter((r) => r.kind === 'free').map((r): TempoRegion => ({ from: round(r.from), to: round(r.to), kind: 'free' }));
  const counts = new Map<number, number>();
  for (const region of regions) for (const bar of region.bars) counts.set(bar.meter, (counts.get(bar.meter) ?? 0) + 1);
  const dominant = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? beatsPerBar(tempo);

  const { anchors: _, regions: __, ...base } = tempo;
  const result: Tempo = { ...base, beatsPerBar: options.meter ?? dominant };
  if (anchors.length) result.anchors = anchors;
  else if (manual.length) result.anchors = manual;
  if (free.length) result.regions = free;
  return { tempo: result, report };
}

interface LocalTempo {
  /** Frames between two windows. */
  hop: number;
  /** Beat period (frames) in each window. */
  period: Float32Array;
  /** Strength of the pulse at that period (autocorrelation, 0–1). */
  clarity: Float32Array;
  /** Autocorrelation of window `w` at a (fractional) lag. */
  acfAt: (w: number, lag: number) => number;
}

/**
 * Tempo along the source: autocorrelation of the onsets on windows of WINDOW_S seconds every
 * STEP_S, and the path of periods that collects the most correlation changing slowly, near the
 * prior tempo.
 */
function localTempo(novelty: Float32Array, fr: number, prior: number, width: number): LocalTempo {
  const frames = novelty.length;
  const win = Math.round(WINDOW_S * fr);
  const hop = Math.round(STEP_S * fr);
  const count = Math.max(1, Math.ceil(frames / hop));
  const minBpm = Math.max(30, prior / 2.2);
  const maxBpm = Math.min(320, prior * 2.2);
  const minLag = Math.max(2, Math.floor((60 * fr) / maxBpm));
  const maxLag = Math.ceil((60 * fr) / minBpm);
  const lags = 2 * maxLag + 2;
  const acf = new Float32Array(count * lags);

  let globalEnergy = 0;
  for (let f = 0; f < frames; f++) globalEnergy += novelty[f] * novelty[f];
  globalEnergy /= frames;
  for (let w = 0; w < count; w++) {
    const a = Math.max(0, w * hop - (win >> 1));
    const b = Math.min(frames, w * hop + (win >> 1));
    let energy = 0;
    for (let f = a; f < b; f++) energy += novelty[f] * novelty[f];
    // silence: no pulse
    if (energy <= 0.02 * globalEnergy * (b - a)) continue;
    for (let lag = minLag; lag < lags && lag < b - a; lag++) {
      let sum = 0;
      for (let f = a; f + lag < b; f++) sum += novelty[f] * novelty[f + lag];
      // compensates for the shorter overlap of the long lags
      acf[w * lags + lag] = (sum / energy) * ((b - a) / (b - a - lag));
    }
  }
  const acfAt = (w: number, lag: number) => {
    const i = Math.floor(lag);
    if (i < 0 || i + 1 >= lags) return 0;
    const base = w * lags;
    return acf[base + i] + (lag - i) * (acf[base + i + 1] - acf[base + i]);
  };

  // Viterbi over the windows: states are the lags of the beat
  const states = maxLag - minLag + 1;
  // correlation weighted by the closeness to the prior tempo (log-normal): a steady pulse also
  // correlates at twice and three times its period, the prior picks the usual level
  const weights = Float32Array.from({ length: states }, (_, s) => Math.exp(-0.5 * Math.pow(Math.log2((60 * fr) / (minLag + s) / prior) / width, 2)));
  const score = (w: number, lag: number) => acf[w * lags + lag] * weights[lag - minLag];
  let value = new Float64Array(states);
  let next = new Float64Array(states);
  const back = new Int16Array(count * states);
  for (let s = 0; s < states; s++) value[s] = TEMPO_EMISSION * score(0, minLag + s);
  for (let w = 1; w < count; w++) {
    for (let s = 0; s < states; s++) {
      const lag = minLag + s;
      const reach = Math.max(2, Math.round(lag * 0.12));
      let best = -Infinity;
      let from = s;
      for (let p = Math.max(0, s - reach); p <= Math.min(states - 1, s + reach); p++) {
        const change = Math.log2(lag / (minLag + p));
        const candidate = value[p] - TEMPO_CHANGE * change * change;
        if (candidate > best) {
          best = candidate;
          from = p;
        }
      }
      next[s] = best + TEMPO_EMISSION * score(w, lag);
      back[w * states + s] = from;
    }
    [value, next] = [next, value];
  }
  let state = 0;
  for (let s = 1; s < states; s++) if (value[s] > value[state]) state = s;
  const period = new Float32Array(count);
  const clarity = new Float32Array(count);
  for (let w = count - 1; w >= 0; w--) {
    const lag = minLag + state;
    // sub-lag period (parabola through the scores around it)
    const a = lag > minLag ? score(w, lag - 1) : score(w, lag);
    const b = score(w, lag);
    const c = lag < maxLag ? score(w, lag + 1) : b;
    const curvature = a - 2 * b + c;
    period[w] = lag + (curvature < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / curvature)) : 0);
    clarity[w] = Math.max(0, Math.min(1, acf[w * lags + lag]));
    if (w) state = back[w * states + state];
  }
  // the windows at the ends of the source see half the music: they take the period of the first whole one
  const edge = Math.ceil(win / 2 / hop);
  if (count > 2 * edge + 1) {
    for (let w = 0; w < edge; w++) period[w] = period[edge];
    for (let w = count - edge; w < count; w++) period[w] = period[count - edge - 1];
  }
  return { hop, period, clarity, acfAt };
}

/**
 * Onsets made comparable along the piece: divided by their local mean (±4 s), so the quiet
 * passages count as much as the loud ones (but silence stays silence), then by their deviation.
 */
function normalizeLocal(novelty: Float32Array, fr: number): Float32Array {
  const frames = novelty.length;
  const span = Math.round(4 * fr);
  const prefix = new Float64Array(frames + 1);
  for (let f = 0; f < frames; f++) prefix[f + 1] = prefix[f] + novelty[f];
  const global = prefix[frames] / frames;
  const result = new Float32Array(frames);
  for (let f = 0; f < frames; f++) {
    const a = Math.max(0, f - span);
    const b = Math.min(frames, f + span + 1);
    result[f] = novelty[f] / ((prefix[b] - prefix[a]) / (b - a) + 0.25 * global + 1e-9);
  }
  let mean = 0;
  for (const v of result) mean += v;
  mean /= frames;
  let variance = 0;
  for (const v of result) variance += (v - mean) * (v - mean);
  const deviation = Math.sqrt(variance / frames) || 1;
  // light smoothing: a beat a frame away from the peak still collects it
  const smooth = new Float32Array(frames);
  for (let f = 0; f < frames; f++) smooth[f] = (0.25 * (result[f - 1] ?? 0) + 0.5 * result[f] + 0.25 * (result[f + 1] ?? 0)) / deviation;
  return smooth;
}

/**
 * Beats of the whole source by dynamic programming (Ellis 2007): the best chain of beats on the
 * onsets, each about one local period after the previous. The choice is global, so a beat is
 * placed as much by the music after it as by the music before. Forced frames are always beats.
 */
function trackBeats(onset: Float32Array, periodAt: (frame: number) => number, forced: number[]): number[] {
  const frames = onset.length;
  const local = Float32Array.from(onset);
  for (const f of forced) local[f] += FORCED;
  const total = new Float64Array(frames);
  const back = new Int32Array(frames).fill(-1);
  for (let t = 0; t < frames; t++) {
    const period = periodAt(t);
    let best = -Infinity;
    let from = -1;
    for (let p = Math.max(0, t - Math.round(2 * period)); p <= t - Math.max(1, Math.round(period / 2)); p++) {
      const deviation = Math.log((t - p) / period);
      const candidate = total[p] - TIGHTNESS * deviation * deviation;
      if (candidate > best) {
        best = candidate;
        from = p;
      }
    }
    // a chain worth less than nothing starts again here
    if (from >= 0 && best > 0) {
      total[t] = local[t] + best;
      back[t] = from;
    } else total[t] = local[t];
  }
  // last beat: the best one in the last period
  const tail = Math.max(0, frames - Math.round(periodAt(frames - 1)));
  let last = tail;
  for (let t = tail; t < frames; t++) if (total[t] > total[last]) last = t;
  const beats: number[] = [];
  for (let t = last; t >= 0; t = back[t]) beats.push(t);
  return beats.reverse();
}

/** Sub-frame position of a peak of the curve at (or next to) a frame. */
function refinePeak(curve: Float32Array, frame: number): number {
  const a = curve[frame - 1] ?? 0;
  const b = curve[frame];
  const c = curve[frame + 1] ?? 0;
  if (b < a || b < c) return frame;
  const curvature = a - 2 * b + c;
  return frame + (curvature < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / curvature)) : 0);
}

/** Highest value of the curve within `reach` frames. */
function peak(curve: Float32Array, frame: number, reach: number): number {
  let best = 0;
  for (let f = Math.max(0, frame - reach); f <= Math.min(curve.length - 1, frame + reach); f++) best = Math.max(best, curve[f]);
  return best;
}

/** Index of the value nearest `time` in a sorted list (-1 if empty). */
function nearest(values: number[], time: number): number {
  let best = -1;
  for (let i = 0; i < values.length; i++) if (best < 0 || Math.abs(values[i] - time) < Math.abs(values[best] - time)) best = i;
  return best;
}

/**
 * Windows with a pulse: clarity well above the weak ones of the piece (relative, so a soft piece
 * keeps its grid), short gaps filled and short islands dropped; the windows of the bars pinned
 * by hand always have one.
 */
function pulseMask(clarity: Float32Array, pinned: number[]): boolean[] {
  const sorted = Array.from(clarity).sort((a, b) => a - b);
  const q75 = sorted[Math.floor(0.75 * (sorted.length - 1))] ?? 0;
  const threshold = Math.max(0.05, 0.4 * q75);
  const mask = Array.from(clarity, (c) => c >= threshold);
  // gaps shorter than 4 windows between pulsed ones: a break, not a free passage
  fillRuns(mask, false, 4, true);
  // pulsed islands shorter than 6 windows: too short for bars
  fillRuns(mask, true, Math.min(6, Math.ceil(mask.length / 3)), false);
  for (const w of pinned) for (let k = w - 3; k <= w + 3; k++) if (k >= 0 && k < mask.length) mask[k] = true;
  return mask;
}

/** Turns the runs of `value` shorter than `min` into the other value (inner runs only when `inner`). */
function fillRuns(mask: boolean[], value: boolean, min: number, inner: boolean): void {
  for (let i = 0; i < mask.length; ) {
    if (mask[i] !== value) {
      i++;
      continue;
    }
    let j = i;
    while (j < mask.length && mask[j] === value) j++;
    const edge = i === 0 || j === mask.length;
    if (j - i < min && !(inner && edge)) for (let k = i; k < j; k++) mask[k] = !value;
    i = j;
  }
}

/**
 * Ranges of beats (inclusive indices) of the regions with a pulse. The windows are seconds wide,
 * so each edge is moved to the beats: a beat belongs to the region when the onsets around it
 * (two beats each side) look like those of a typical beat well inside it, the regular pattern
 * of the pulse, which the irregular notes of a free passage do not have.
 */
function beatRanges(mask: boolean[], windowSeconds: number, beats: number[], pattern: (i: number) => Float32Array): [number, number][] {
  const ranges: [number, number][] = [];
  for (let w = 0; w < mask.length; ) {
    if (!mask[w]) {
      w++;
      continue;
    }
    let end = w;
    while (end < mask.length && mask[end]) end++;
    const from = (w - 0.5) * windowSeconds;
    const to = (end - 0.5) * windowSeconds;
    w = end;
    const lower = ranges.length ? ranges[ranges.length - 1][1] + 1 : 0;
    let i0 = Math.max(lower, beats.findIndex((t) => t >= from));
    let i1 = beats.length - 1 - [...beats].reverse().findIndex((t) => t <= to);
    if (i0 < 0 || i1 >= beats.length || i1 - i0 < 6) continue;
    // the typical beat: the mean pattern of the beats away from the edges
    let core = [...Array(i1 - i0 + 1).keys()].map((k) => i0 + k).filter((i) => beats[i] > from + WINDOW_S / 2 && beats[i] < to - WINDOW_S / 2);
    if (core.length < 4) core = [...Array(i1 - i0 + 1).keys()].map((k) => i0 + k);
    const typical = new Float32Array(PATTERN);
    for (const i of core) pattern(i).forEach((v, k) => (typical[k] += v / core.length));
    const similarity = (i: number) => correlation(pattern(i), typical);
    const median = medianOf(core.map(similarity));
    const inside = (i: number) => similarity(i) >= 0.6 * median;
    for (let n = 0; n < 12 && i1 - i0 > 6 && !inside(i0); n++) i0++;
    for (let n = 0; n < 12 && i1 - i0 > 6 && !inside(i1); n++) i1--;
    for (let n = 0; n < 8 && i0 - 1 >= lower && similarity(i0 - 1) >= 0.8 * median; n++) i0--;
    for (let n = 0; n < 8 && i1 + 1 < beats.length && similarity(i1 + 1) >= 0.8 * median; n++) i1++;
    if (i1 - i0 >= 6) ranges.push([i0, i1]);
  }
  return ranges;
}

/** Points of the onset pattern around a beat (two beats each side). */
const PATTERN = 32;

/** Onsets from two beats before to two beats after a frame, standardized. */
function beatPattern(curve: Float32Array, frame: number, period: number): Float32Array {
  const values = new Float32Array(PATTERN).map((_, k) => {
    const f = Math.round(frame + ((k + 0.5) / PATTERN - 0.5) * 4 * period);
    return peak(curve, f, 1);
  });
  const mean = values.reduce((a, b) => a + b, 0) / PATTERN;
  const deviation = Math.sqrt(values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / PATTERN) || 1;
  return values.map((v) => (v - mean) / deviation);
}

function correlation(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let k = 0; k < a.length; k++) {
    dot += a[k] * b[k];
    na += a[k] * a[k];
    nb += b[k] * b[k];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

function medianOf(values: number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

/** A bar found in a region: its downbeat and the beats after it (source seconds). */
interface FoundBar {
  time: number;
  beats: number[];
  meter: number;
  confidence: number;
  /** Bar pinned by hand on this downbeat. */
  pinned?: BarAnchor;
}

interface RegionBars {
  bars: FoundBar[];
  /** First and last beat of the region, and the beat after the last one (predicted). */
  first: number;
  last: number;
  end: number;
  meterAlternative?: number;
  downbeatUncertain?: boolean;
}

/**
 * Downbeats of a region: the accent of each beat (bass, harmonic change, overall onset; the
 * middle band, where snares hit the back beats, counts against) and the segmentation of the
 * beats into bars of the allowed meters that puts the downbeats on the strongest accents.
 */
function regionBars(features: RhythmFeatures, beats: number[], strength: number[], meters: number[], manual: BarAnchor[], frameOf: (t: number) => number): RegionBars {
  const n = beats.length;
  const ibi = (j: number) => (j + 1 < n ? beats[j + 1] - beats[j] : beats[j] - beats[j - 1]);
  const at = (curve: Float32Array) => beats.map((t) => peak(curve, frameOf(t), 2));
  // pitch classes of each beat, and their change from the two beats before to the two after
  const chroma = beats.map((t, j) => chromaMean(features, t, t + ibi(j)));
  const harmony = beats.map((_, j) => {
    const before = sum12(chroma[j - 2], chroma[j - 1]);
    const after = sum12(chroma[j], chroma[j + 1]);
    return before && after ? 1 - cosine(before, after) : 0;
  });
  const accent = combine([
    [standardize(at(features.low)), 1],
    [standardize(harmony), 1.2],
    [standardize(strength), 0.4],
  ]);
  // back beat: the snare on the beats after the 1 (2 and 4 in a 4, 2 and 3 in a 3) and not on it,
  // which tells the 1 from the beat before or after it when the bass and the harmony do not
  const mid = standardize(at(features.mid));
  const midAt = (j: number) => mid[j] ?? 0;
  const accentOf = (meter: number, j: number) => {
    // without the back beat: the middle band on the beat itself counts against
    if (!BACK_BEAT || (meter !== 3 && meter !== 4)) return accent[j] - 0.3 * midAt(j);
    const back = meter === 4 ? (midAt(j + 1) + midAt(j + 3) - midAt(j) - midAt(j + 2)) / 2 : (midAt(j + 1) + midAt(j + 2)) / 2 - midAt(j);
    return accent[j] + BACK_BEAT * Math.max(-ACCENT_CLIP, Math.min(ACCENT_CLIP, back));
  };
  const forced = beats.map((t) => manual.some((a) => Math.abs(a.time - t) < 0.06));

  const best = segment(accentOf, meters, forced);
  const result: RegionBars = { bars: [], first: beats[0], last: beats[n - 1], end: beats[n - 1] + ibi(n - 1) };
  if (meters.length > 1) {
    // a single meter all along, and the other one nearly as good: worth telling
    const used = new Set(best.meters);
    if (used.size === 1) {
      const other = meters.find((m) => !used.has(m))!;
      const alternative = segment(accentOf, [other], forced);
      if ((best.score - alternative.score) / Math.max(1, best.starts.length) < 0.3) result.meterAlternative = other;
    }
  } else if (meters[0] === 3 || meters[0] === 4) {
    // the meter imposed, while the accents ask for the other one (all along or in places)
    const other = meters[0] === 3 ? 4 : 3;
    const alternative = segment(accentOf, [3, 4], forced);
    if (alternative.meters.includes(other) && (alternative.score - best.score) / Math.max(1, best.starts.length) > 0.3) result.meterAlternative = other;
  }

  // the 1 against the other beats of the bar, on average
  const byPosition = new Map<number, number[]>();
  best.starts.forEach((start, k) => {
    for (let p = 0; p < best.meters[k] && start + p < n; p++) byPosition.set(p, [...(byPosition.get(p) ?? []), accent[start + p]]);
  });
  const mean = (values?: number[]) => (values?.length ? values.reduce((a, b) => a + b, 0) / values.length : 0);
  const others = [...byPosition.keys()].filter((p) => p > 0).map((p) => mean(byPosition.get(p)));
  if (others.length && mean(byPosition.get(0)) - Math.max(...others) < 0.5) result.downbeatUncertain = true;

  const median = medianOf(strength);
  const beatConfidence = beats.map((_, j) => {
    const onAttack = Math.min(1, strength[j] / (median || 1));
    const steady = j ? 1 - Math.min(1, Math.abs(ibi(j) / ibi(j - 1) - 1) / 0.3) : 1;
    return onAttack * steady;
  });
  best.starts.forEach((start, k) => {
    const length = best.meters[k];
    const odd = !meters.includes(length);
    // a bar with a beat too many or too few: the meter of the bars around, its beats evenly spread
    const meter = odd ? (best.meters.slice(0, k).reverse().find((m) => meters.includes(m)) ?? best.meters.slice(k).find((m) => meters.includes(m)) ?? meters[0]) : length;
    const stop = best.starts[k + 1] ?? Math.min(n, start + length);
    let own = beats.slice(start + 1, stop);
    if (odd && best.starts[k + 1] !== undefined) {
      const next = beats[best.starts[k + 1]];
      own = Array.from({ length: meter - 1 }, (_, p) => beats[start] + ((p + 1) * (next - beats[start])) / meter);
    } else if (odd) own = own.slice(0, meter - 1);
    // beats missing at the end of the region: one beat apart
    for (let p = own.length; p < meter - 1; p++) own.push((own[own.length - 1] ?? beats[start]) + ibi(n - 1));
    const inner = accent.slice(start + 1, stop);
    const margin = accent[start] - (inner.length ? Math.max(...inner) : 0);
    const steadiness = mean(beatConfidence.slice(start, stop));
    const confidence = 0.65 * steadiness + 0.35 / (1 + Math.exp(-2 * margin));
    const pinned = manual.find((a) => Math.abs(a.time - beats[start]) < 0.06);
    result.bars.push({ time: beats[start], beats: own, meter, confidence, ...(pinned ? { pinned } : {}) });
  });
  return result;
}

/**
 * Best segmentation of the beats into bars (Viterbi): states are (beats in the bar, position);
 * a bar scores the accent of its downbeat for its meter, a change of meter costs METER_CHANGE, a
 * bar one beat longer or shorter than the meters (a tracking error) ODD_BAR; the beats before the
 * first downbeat are an upbeat. Forced beats are downbeats. Returns the length of each bar.
 */
function segment(accentOf: (meter: number, beat: number) => number, meters: number[], forced: boolean[]): { starts: number[]; meters: number[]; score: number } {
  const n = forced.length;
  const odd = Number.isFinite(ODD_BAR) ? [...new Set(meters.flatMap((m) => [m - 1, m + 1]))].filter((m) => m >= 2 && !meters.includes(m)) : [];
  const lengths = [...meters, ...odd];
  const states: [number, number][] = lengths.flatMap((m) => Array.from({ length: m }, (_, p): [number, number] => [m, p]));
  const count = states.length;
  const index = (m: number, p: number) => states.findIndex(([sm, sp]) => sm === m && sp === p);
  const back = new Int16Array(n * count);
  const entry = (m: number, j: number) => accentOf(m, j) - (meters.includes(m) ? 0 : ODD_BAR);
  let value = states.map(([m, p]) => (forced[0] && p > 0 ? -Infinity : p === 0 ? entry(m, 0) : 0));
  for (let j = 1; j < n; j++) {
    const next = new Array<number>(count);
    for (let s = 0; s < count; s++) {
      const [m, p] = states[s];
      if (p > 0) {
        const from = index(m, p - 1);
        next[s] = forced[j] ? -Infinity : value[from];
        back[j * count + s] = from;
        continue;
      }
      let best = -Infinity;
      let from = 0;
      for (const m2 of lengths) {
        const last = index(m2, m2 - 1);
        const change = m2 !== m && meters.includes(m) && meters.includes(m2);
        const candidate = value[last] - (change ? METER_CHANGE : 0);
        if (candidate > best) {
          best = candidate;
          from = last;
        }
      }
      next[s] = best + entry(m, j);
      back[j * count + s] = from;
    }
    value = next;
  }
  let state = 0;
  for (let s = 1; s < count; s++) if (value[s] > value[state]) state = s;
  const score = value[state];
  const starts: number[] = [];
  const found: number[] = [];
  for (let j = n - 1; j >= 0; j--) {
    const [m, p] = states[state];
    if (p === 0) {
      starts.push(j);
      found.push(m);
    }
    if (j) state = back[j * count + state];
  }
  return { starts: starts.reverse(), meters: found.reverse(), score };
}

/** Mean pitch-class profile between two source times. */
function chromaMean(features: RhythmFeatures, from: number, to: number): Float32Array {
  const { chroma, chromaStep, frameRate, frameOffset } = features;
  const count = chroma.length / 12;
  const toIndex = (t: number) => ((t - frameOffset) * frameRate) / chromaStep;
  let a = Math.max(0, Math.ceil(toIndex(from)));
  let b = Math.min(count - 1, Math.floor(toIndex(to)));
  if (b < a) a = b = Math.max(0, Math.min(count - 1, Math.round(toIndex(from))));
  const mean = new Float32Array(12);
  for (let i = a; i <= b; i++) for (let c = 0; c < 12; c++) mean[c] += chroma[i * 12 + c];
  return mean;
}

function sum12(a?: Float32Array, b?: Float32Array): Float32Array | null {
  if (!a || !b) return null;
  return a.map((v, c) => v + b[c]);
}

function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let c = 0; c < 12; c++) {
    dot += a[c] * b[c];
    na += a[c] * a[c];
    nb += b[c] * b[c];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 1;
}

/** Values in standard deviations from their mean, at most ACCENT_CLIP away. */
function standardize(values: number[]): number[] {
  const n = values.length || 1;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const deviation = Math.sqrt(values.reduce((a, b) => a + (b - mean) * (b - mean), 0) / n) || 1;
  return values.map((v) => Math.max(-ACCENT_CLIP, Math.min(ACCENT_CLIP, (v - mean) / deviation)));
}

function combine(parts: [number[], number][]): number[] {
  return parts[0][0].map((_, j) => parts.reduce((total, [values, weight]) => total + weight * values[j], 0));
}

/**
 * Bar numbers along the source (bar 0: the first downbeat found; across a free passage the bars
 * it would hold at the tempo before it) and the anchors: one per downbeat with its beats, and one
 * closing each region. The bars pinned by hand keep their time and take the counted number.
 */
function numberBars(regions: RegionBars[], manual: BarAnchor[], sourceLength: number): { anchors: BarAnchor[]; numbers: number[][] } {
  const anchors: BarAnchor[] = [];
  const numbers: number[][] = [];
  let bar = 0;
  let previousEnd: { time: number; length: number } | null = null;
  for (const region of regions) {
    if (!region.bars.length) {
      numbers.push([]);
      continue;
    }
    if (previousEnd) bar += Math.max(0, Math.round((region.bars[0].time - previousEnd.time) / previousEnd.length));
    const own: number[] = [];
    for (const [k, found] of region.bars.entries()) {
      own.push(bar);
      const beats = found.beats.map((t) => round(t));
      if (found.pinned) anchors.push({ bar, time: found.pinned.time, beats });
      else anchors.push({ bar, time: round(found.time), auto: true, beats, confidence: round(found.confidence, 2) });
      bar++;
      // after the last bar, its end closes the region
      if (k === region.bars.length - 1) {
        const lastBeat = found.beats[found.beats.length - 1] ?? found.time;
        const beat = found.beats.length ? (lastBeat - found.time) / found.beats.length : region.end - region.last;
        const end = lastBeat + beat;
        if (end <= sourceLength + beat) anchors.push({ bar, time: round(end), auto: true });
        const recent = region.bars.slice(-4);
        const length = recent.length > 1 ? (end - recent[0].time) / recent.length : end - found.time;
        previousEnd = { time: end, length };
      }
    }
    numbers.push(own);
  }
  anchors.sort((a, b) => a.bar - b.bar);
  // pinned bars the tracking did not reach stay as they were, if they still fit in between
  for (const pin of manual) {
    if (anchors.some((a) => a.time === pin.time || a.bar === pin.bar)) continue;
    const before = anchors.filter((a) => a.bar < pin.bar).pop();
    const after = anchors.find((a) => a.bar > pin.bar);
    if ((!before || before.time < pin.time) && (!after || after.time > pin.time)) anchors.splice(after ? anchors.indexOf(after) : anchors.length, 0, pin);
  }
  // a closing anchor on the same bar as the next downbeat: the downbeat wins
  return { anchors: anchors.filter((a, i) => !(a.auto && !a.beats && anchors[i + 1]?.bar === a.bar)), numbers };
}

function buildReport(regions: RegionBars[], numbers: number[][], local: LocalTempo, fr: number, sourceLength: number, options: TrackOptions): RhythmReport {
  const spans: RhythmRegion[] = [];
  let cursor = 0;
  const uncertainBars: number[] = [];
  let confidenceSum = 0;
  let barCount = 0;
  regions.forEach((region, r) => {
    if (!region.bars.length) return;
    const beat = (region.end - region.last) || 0.5;
    const from = Math.max(0, region.first - beat / 2);
    const to = Math.min(sourceLength, region.last + beat / 2);
    if (from - cursor > 0.5) spans.push({ from: cursor, to: from, kind: 'free' });
    const bpms = region.bars.map((b) => 60 / (b.beats.length ? (b.beats[b.beats.length - 1] - b.time) / b.beats.length : beat));
    const sorted = [...bpms].sort((a, b) => a - b);
    const counts = new Map<number, number>();
    region.bars.forEach((b, k) => {
      counts.set(b.meter, (counts.get(b.meter) ?? 0) + 1);
      confidenceSum += b.confidence;
      barCount++;
      if (b.confidence < UNCERTAIN_BAR) uncertainBars.push(numbers[r][k]);
    });
    spans.push({
      from,
      to,
      kind: 'pulsed',
      firstBar: numbers[r][0],
      lastBar: numbers[r][numbers[r].length - 1],
      bpm: {
        min: round(sorted[Math.floor(0.1 * (sorted.length - 1))], 1),
        max: round(sorted[Math.ceil(0.9 * (sorted.length - 1))], 1),
        mean: round(bpms.reduce((a, b) => a + b, 0) / bpms.length, 1),
      },
      meters: [...counts.entries()].sort((a, b) => b[1] - a[1]).map(([m]) => m),
      ...(region.meterAlternative ? { meterAlternative: region.meterAlternative } : {}),
      ...(region.downbeatUncertain ? { downbeatUncertain: true } : {}),
      confidence: round(region.bars.reduce((a, b) => a + b.confidence, 0) / region.bars.length, 2),
    });
    cursor = to;
  });
  if (sourceLength - cursor > 0.5) spans.push({ from: cursor, to: sourceLength, kind: 'free' });

  // the beat twice or half as fast: how strong their pulse is where the music has one
  const seconds = local.hop / fr;
  const inside = (w: number) => spans.some((s) => s.kind === 'pulsed' && w * seconds >= s.from && w * seconds <= s.to);
  let same = 0;
  let double = 0;
  let half = 0;
  for (let w = 0; w < local.period.length; w++) {
    if (!inside(w)) continue;
    same += local.acfAt(w, local.period[w]);
    double += local.acfAt(w, local.period[w] / 2);
    half += local.acfAt(w, local.period[w] * 2);
  }
  const pulsed = spans.filter((s) => s.kind === 'pulsed');
  const meanBpm = pulsed.length ? pulsed.reduce((a, s) => a + s.bpm!.mean, 0) / pulsed.length : (options.bpm ?? 0);
  const bpmAlternatives: number[] = [];
  if (same > 0 && double >= 0.8 * same && meanBpm * 2 <= 320) bpmAlternatives.push(round(meanBpm * 2, 1));
  if (same > 0 && half >= 1.05 * same && meanBpm / 2 >= 30) bpmAlternatives.push(round(meanBpm / 2, 1));

  return {
    regions: spans.map((s) => ({ ...s, from: round(s.from, 2), to: round(s.to, 2) })),
    bpmAlternatives,
    uncertainBars,
    tempoCurve: Array.from(local.period, (period, w) => ({ time: w * seconds, bpm: round((60 * fr) / period, 1), clarity: round(local.clarity[w], 2) })),
    confidence: barCount ? round(confidenceSum / barCount, 2) : 0,
  };
}

const round = (value: number, digits = 4) => Math.round(value * 10 ** digits) / 10 ** digits;
