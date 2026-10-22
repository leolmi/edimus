import { type BarAnchor, type OnsetCurve, type Tempo, beatsPerBar } from './tempo';

/**
 * Bar map of a source: where each bar starts (source seconds), from the steady grid of the tempo
 * and its anchors. Bars are numbered from the downbeat at `offset` (bar 0); fractional bar
 * numbers are positions inside a bar (beats are even inside it).
 */

/** Length of a bar of the steady grid (source seconds). */
export const steadyBar = (tempo: Tempo) => (60 * beatsPerBar(tempo)) / tempo.bpm;

/** Points the map goes through: the anchors, or the downbeat of the steady grid. */
function pins(tempo: Tempo): BarAnchor[] {
  return tempo.anchors?.length ? tempo.anchors : [{ bar: 0, time: tempo.offset }];
}

/** Two pins around `value` (outside the pins: the nearest span), by bar or by time. */
function span(points: BarAnchor[], value: number, key: 'bar' | 'time'): [BarAnchor, BarAnchor] {
  if (value <= points[0][key]) return [points[0], points[1]];
  if (value >= points[points.length - 1][key]) return [points[points.length - 2], points[points.length - 1]];
  let lo = 0;
  let hi = points.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid][key] <= value) lo = mid;
    else hi = mid;
  }
  return [points[lo], points[hi]];
}

/** Start (source seconds) of bar `bar`; fractional bars fall inside it. */
export function barTime(tempo: Tempo, bar: number): number {
  const points = pins(tempo);
  if (points.length === 1) return points[0].time + (bar - points[0].bar) * steadyBar(tempo);
  const [a, b] = span(points, bar, 'bar');
  return a.time + ((bar - a.bar) * (b.time - a.time)) / (b.bar - a.bar);
}

/** Bar number (fractional) at a source time: the inverse of `barTime`. */
export function barAt(tempo: Tempo, time: number): number {
  const points = pins(tempo);
  if (points.length === 1) return points[0].bar + (time - points[0].time) / steadyBar(tempo);
  const [a, b] = span(points, time, 'time');
  return a.bar + ((time - a.time) * (b.bar - a.bar)) / (b.time - a.time);
}

/** Length (source seconds) of the bar holding a source time. */
export function barLengthAt(tempo: Tempo, time: number): number {
  const bar = Math.floor(barAt(tempo, time));
  return barTime(tempo, bar + 1) - barTime(tempo, bar);
}

/** Average tempo of the map (the steady one without at least two anchors). */
export function meanBpm(tempo: Tempo): number {
  const points = tempo.anchors ?? [];
  if (points.length < 2) return tempo.bpm;
  const first = points[0];
  const last = points[points.length - 1];
  return (60 * beatsPerBar(tempo) * (last.bar - first.bar)) / (last.time - first.time);
}

/** Tempo not steady: the bars change length somewhere. */
export const isVariable = (tempo: Tempo) => (tempo.anchors?.length ?? 0) >= 2;

/**
 * Grid points (source seconds) in [from, to]: `perBar` per bar (1 = downbeats, beatsPerBar =
 * beats), with their index inside the bar (0 = downbeat) and the bar number.
 */
export function gridPoints(tempo: Tempo, perBar: number, from: number, to: number): { time: number; bar: number; index: number }[] {
  const points: { time: number; bar: number; index: number }[] = [];
  for (let bar = Math.floor(barAt(tempo, from)); ; bar++) {
    for (let index = 0; index < perBar; index++) {
      const time = barTime(tempo, bar + index / perBar);
      if (time > to) return points;
      if (time >= from) points.push({ time, bar, index });
    }
  }
}

/** Anchor of a bar, if any. */
export const anchorOf = (tempo: Tempo, bar: number) => tempo.anchors?.find((a) => a.bar === bar);

/**
 * Pins the start of `bar` at `time` (an anchor set by hand). The bars between it and the
 * anchors around stretch or shrink evenly; past the last anchor they keep the new length. On a
 * steady grid the downbeat at `offset` stays where it is (it becomes an anchor). The time is
 * kept so that no bar gets shorter than `minBar`.
 */
export function pinBar(tempo: Tempo, bar: number, time: number, minBar: number): Tempo {
  const others = (tempo.anchors?.length ? tempo.anchors : [{ bar: 0, time: tempo.offset }]).filter((a) => a.bar !== bar);
  const before = others.filter((a) => a.bar < bar).pop();
  const after = others.find((a) => a.bar > bar);
  const lo = before ? before.time + (bar - before.bar) * minBar : -Infinity;
  const hi = after ? after.time - (after.bar - bar) * minBar : Infinity;
  const pinned: BarAnchor = { bar, time: Math.min(hi, Math.max(lo, time)) };
  return { ...tempo, anchors: [...others, pinned].sort((a, b) => a.bar - b.bar) };
}

/** Takes the anchor away from a bar: it goes back where the anchors around put it. */
export function unpinBar(tempo: Tempo, bar: number): Tempo {
  const anchors = tempo.anchors?.filter((a) => a.bar !== bar) ?? [];
  const { anchors: _, ...steady } = tempo;
  // only the downbeat of the steady grid left: no map any more
  const plain = !anchors.length || (anchors.length === 1 && anchors[0].bar === 0 && anchors[0].time === tempo.offset);
  return plain ? steady : { ...tempo, anchors };
}

/**
 * Takes the anchors away (only those of the bar tracking with `onlyAuto`): with none left the
 * grid goes back to the steady one the map started from (`bpm` and `offset`).
 */
export function clearAnchors(tempo: Tempo, onlyAuto = false): Tempo {
  const anchors = onlyAuto ? (tempo.anchors ?? []).filter((a) => !a.auto) : [];
  const { anchors: _, ...steady } = tempo;
  return anchors.length ? { ...tempo, anchors } : steady;
}

/** The steady grid that best follows the map (no anchors): used when the map is dropped. */
export function steadyTempo(tempo: Tempo): Tempo {
  const { anchors: _, ...steady } = tempo;
  if (!isVariable(tempo)) return steady;
  const bpm = Math.round(meanBpm(tempo) * 100) / 100;
  const bar = (60 * beatsPerBar(tempo)) / bpm;
  // phase from the first anchor, earliest downbeat of the source
  const first = tempo.anchors![0].time;
  return { ...steady, bpm, offset: ((first % bar) + bar) % bar };
}

/** Bounds of the tempo change allowed to the tracking, as a ratio of the starting beat. */
const MIN_DRIFT = 0.7;
const MAX_DRIFT = 1.4;

/**
 * Bar map followed along the whole source: from the anchors set by hand (or the downbeat of the
 * grid), the beats are tracked on the attacks with a phase-locked loop, which follows a tempo
 * that drifts. Between two anchors set by hand the number of bars is kept and the residual error
 * is spread over the beats; before the first and after the last the tracking runs freely to the
 * ends of the source. Every bar gets an anchor (`auto`, except those set by hand). Returns the
 * map and the share of beats found on an attack (0–1).
 */
export function trackBars(tempo: Tempo, curve: OnsetCurve, sourceLength: number): { tempo: Tempo; confidence: number } {
  const meter = beatsPerBar(tempo);
  const manual = (tempo.anchors ?? []).filter((a) => !a.auto);
  const threshold = attackThreshold(curve);
  const found = { hits: 0, beats: 0 };
  if (!manual.length) return trackFree(tempo, curve, sourceLength, threshold, found);
  const pinsList = manual;
  const anchors = new Map<number, BarAnchor>();
  const add = (bar: number, time: number) => {
    if (!anchors.has(bar) && time >= -steadyBar(tempo) && time <= sourceLength) anchors.set(bar, { bar, time, auto: true });
  };

  // between two pins: a fixed number of beats, the error at the end spread over them
  for (let i = 0; i + 1 < pinsList.length; i++) {
    const a = pinsList[i];
    const b = pinsList[i + 1];
    const count = (b.bar - a.bar) * meter;
    const beats = track(curve, a.time, (b.time - a.time) / count, 1, count, Infinity, threshold, found);
    const error = b.time - beats[count - 1];
    for (let k = meter; k < count; k += meter) add(a.bar + k / meter, beats[k - 1] + (error * k) / count);
  }

  // before the first pin and after the last one: free tracking up to the ends of the source
  const first = pinsList[0];
  const last = pinsList[pinsList.length - 1];
  const firstBeat = (pinsList.length > 1 ? (pinsList[1].time - first.time) / ((pinsList[1].bar - first.bar) * meter) : steadyBar(tempo) / meter);
  const lastBeat = pinsList.length > 1 ? (last.time - pinsList[pinsList.length - 2].time) / ((last.bar - pinsList[pinsList.length - 2].bar) * meter) : firstBeat;
  const backward = track(curve, first.time, firstBeat, -1, Infinity, 0, threshold, found);
  for (let k = meter; k <= backward.length; k += meter) add(first.bar - k / meter, backward[k - 1]);
  const forward = track(curve, last.time, lastBeat, 1, Infinity, sourceLength, threshold, found);
  for (let k = meter; k <= forward.length; k += meter) add(last.bar + k / meter, forward[k - 1]);

  for (const pin of pinsList) anchors.set(pin.bar, { bar: pin.bar, time: pin.time });
  const sorted = [...anchors.values()].sort((a, b) => a.bar - b.bar);
  return { tempo: { ...tempo, anchors: sorted }, confidence: found.beats ? found.hits / found.beats : 0 };
}

/**
 * Tracking with no bar pinned by hand: the detected downbeat is only a guess of the phase, so
 * the beats are followed both ways from the attack nearest to it, and the downbeat is the beat
 * of the bar with the strongest attacks on average (the accent). Bar 0 is the first downbeat of
 * the source.
 */
function trackFree(tempo: Tempo, curve: OnsetCurve, sourceLength: number, threshold: number, found: { hits: number; beats: number }): { tempo: Tempo; confidence: number } {
  const meter = beatsPerBar(tempo);
  const beat = steadyBar(tempo) / meter;
  // the strongest attack within the first beat of the grid (any beat will do: the bar phase comes later)
  const start = attackNear(curve, tempo.offset + beat / 2, beat / 2, beat * 10)?.time ?? tempo.offset;
  const before = track(curve, start, beat, -1, Infinity, 0, threshold, found).reverse();
  const beats = [...before, start, ...track(curve, start, beat, 1, Infinity, sourceLength, threshold, found)];
  // accent: total attack strength of each beat of the bar
  const accent = new Array<number>(meter).fill(0);
  beats.forEach((time, i) => (accent[i % meter] += attackNear(curve, time, beat * 0.05, beat * 0.05)?.strength ?? 0));
  const phase = accent.indexOf(Math.max(...accent));
  const anchors: BarAnchor[] = [];
  for (let i = phase; i < beats.length; i += meter) anchors.push({ bar: anchors.length, time: beats[i], auto: true });
  if (!anchors.length) return { tempo, confidence: 0 };
  return {
    // bpm and offset stay: they are the steady grid the map started from
    tempo: { ...tempo, anchors },
    confidence: found.beats ? found.hits / found.beats : 0,
  };
}

/** Attack strength that counts as a hit: well above the average onset strength. */
function attackThreshold(curve: OnsetCurve): number {
  let sum = 0;
  for (const value of curve.novelty) sum += value;
  return (1.5 * sum) / Math.max(1, curve.novelty.length);
}

/**
 * Beats after (`direction` 1) or before (-1) `start`, `count` of them or up to `limit`: each one
 * is expected one beat after the previous and pulled towards the strongest attack near there;
 * the beat length follows slowly the intervals found.
 */
function track(
  curve: OnsetCurve,
  start: number,
  beat: number,
  direction: 1 | -1,
  count: number,
  limit: number,
  threshold: number,
  found: { hits: number; beats: number },
): number[] {
  const beats: number[] = [];
  let time = start;
  let length = beat;
  while (beats.length < count) {
    const expected = time + direction * length;
    if (direction > 0 ? expected > limit : expected < limit) break;
    const hit = attackNear(curve, expected, length * 0.15, length * 0.07);
    found.beats++;
    let next = expected;
    if (hit && hit.strength >= threshold) {
      found.hits++;
      // phase follows most of the error, the beat length a small part of it
      const error = hit.time - expected;
      next = expected + 0.7 * error;
      length = Math.min(beat * MAX_DRIFT, Math.max(beat * MIN_DRIFT, length + direction * 0.15 * error));
    }
    beats.push(next);
    time = next;
  }
  return beats;
}

/** Strongest attack within `reach` seconds of `time`, weighted by its distance (Gaussian of width `spread`). */
function attackNear(curve: OnsetCurve, time: number, reach: number, spread: number): { time: number; strength: number } | null {
  const { novelty, frameRate, frameOffset } = curve;
  const centre = (time - frameOffset) * frameRate;
  let best = -1;
  let bestScore = 0;
  for (let f = Math.max(0, Math.floor(centre - reach * frameRate)); f <= Math.min(novelty.length - 1, Math.ceil(centre + reach * frameRate)); f++) {
    const distance = (f - centre) / frameRate / spread;
    const score = novelty[f] * Math.exp(-0.5 * distance * distance);
    if (score > bestScore) {
      bestScore = score;
      best = f;
    }
  }
  if (best < 0) return null;
  // sub-frame position of the peak
  const a = novelty[best - 1] ?? 0;
  const b = novelty[best];
  const c = novelty[best + 1] ?? 0;
  const curvature = a - 2 * b + c;
  const shift = curvature < 0 ? Math.max(-0.5, Math.min(0.5, (0.5 * (a - c)) / curvature)) : 0;
  return { time: frameOffset + (best + shift) / frameRate, strength: b };
}
