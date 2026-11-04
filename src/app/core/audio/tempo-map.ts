import { type BarAnchor, type Tempo, beatsPerBar } from './tempo';

/**
 * Bar map of a source: where each bar starts (source seconds), from the steady grid of the tempo
 * and its anchors. Bars are numbered from the downbeat at `offset` (bar 0); fractional bar
 * numbers are positions inside a bar: on its beats when the tracking found them (`beats`), else
 * even. The bar `bar` has `barMeter` beats; inside the free regions there is no grid.
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

/** Start of a bar (or a point between bars) with the bars even between the pins. */
function evenTime(tempo: Tempo, bar: number): number {
  const points = pins(tempo);
  if (points.length === 1) return points[0].time + (bar - points[0].bar) * steadyBar(tempo);
  const [a, b] = span(points, bar, 'bar');
  return a.time + ((bar - a.bar) * (b.time - a.time)) / (b.bar - a.bar);
}

function evenBar(tempo: Tempo, time: number): number {
  const points = pins(tempo);
  if (points.length === 1) return points[0].bar + (time - points[0].time) / steadyBar(tempo);
  const [a, b] = span(points, time, 'time');
  return a.bar + ((time - a.time) * (b.bar - a.bar)) / (b.time - a.time);
}

/** Anchor of a bar, if any (anchors are sorted by bar). */
export function anchorOf(tempo: Tempo, bar: number): BarAnchor | undefined {
  const anchors = tempo.anchors;
  if (!anchors?.length) return undefined;
  let lo = 0;
  let hi = anchors.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (anchors[mid].bar === bar) return anchors[mid];
    if (anchors[mid].bar < bar) lo = mid + 1;
    else hi = mid - 1;
  }
  return undefined;
}

/** Beats of a bar: its meter. */
export function barMeter(tempo: Tempo, bar: number): number {
  const beats = anchorOf(tempo, bar)?.beats;
  return beats ? beats.length + 1 : beatsPerBar(tempo);
}

/** Downbeat, beats and end of a bar: the points its fractional positions run through. */
function barPoints(tempo: Tempo, bar: number): number[] {
  const beats = anchorOf(tempo, bar)?.beats;
  if (!beats?.length) return [];
  const start = evenTime(tempo, bar);
  const end = evenTime(tempo, bar + 1);
  // beats out of order (the bar was stretched by hand after the tracking): even
  if (beats.some((t, i) => t <= (i ? beats[i - 1] : start) || t >= end)) return [];
  return [start, ...beats, end];
}

/** Start (source seconds) of bar `bar`; fractional bars fall inside it, on its beats. */
export function barTime(tempo: Tempo, bar: number): number {
  const whole = Math.floor(bar);
  const points = whole === bar ? [] : barPoints(tempo, whole);
  if (!points.length) return evenTime(tempo, bar);
  const position = (bar - whole) * (points.length - 1);
  const i = Math.floor(position);
  return points[i] + (position - i) * (points[i + 1] - points[i]);
}

/** Bar number (fractional) at a source time: the inverse of `barTime`. */
export function barAt(tempo: Tempo, time: number): number {
  const even = evenBar(tempo, time);
  const whole = Math.floor(even);
  const points = barPoints(tempo, whole);
  if (!points.length) return even;
  let i = 0;
  while (i < points.length - 2 && time >= points[i + 1]) i++;
  return whole + (i + (time - points[i]) / (points[i + 1] - points[i])) / (points.length - 1);
}

/** Free region (no pulse, no grid) holding a source time, if any. */
export const freeRegionAt = (tempo: Tempo, time: number) => tempo.regions?.find((r) => time >= r.from && time < r.to);

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
  // the bars may have different meters
  let beats = 0;
  for (let bar = first.bar; bar < last.bar; bar++) beats += barMeter(tempo, bar);
  return (60 * beats) / (last.time - first.time);
}

/** Tempo not steady: the bars change length somewhere. */
export const isVariable = (tempo: Tempo) => (tempo.anchors?.length ?? 0) >= 2;

/** Steps of the grid: bars, beats or half beats. */
export type GridStep = 'bar' | 'beat' | 'half';

/** Grid points of a bar for a step. */
export const stepsInBar = (tempo: Tempo, bar: number, step: GridStep) => (step === 'bar' ? 1 : barMeter(tempo, bar) * (step === 'half' ? 2 : 1));

/**
 * Grid points (source seconds) in [from, to] at a step, with their index inside the bar (0 =
 * downbeat) and the bar number; none inside the free regions.
 */
export function gridPoints(tempo: Tempo, step: GridStep, from: number, to: number): { time: number; bar: number; index: number }[] {
  const points: { time: number; bar: number; index: number }[] = [];
  const first = Math.floor(barAt(tempo, from));
  for (let bar = first; bar < first + 100000; bar++) {
    const count = stepsInBar(tempo, bar, step);
    for (let index = 0; index < count; index++) {
      const time = barTime(tempo, bar + index / count);
      if (time > to) return points;
      if (time >= from && !freeRegionAt(tempo, time)) points.push({ time, bar, index });
    }
  }
  return points;
}

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
  // the beats found by the tracking in the bar before no longer fit: they become even
  const kept = others.map((a) => (a.bar === bar - 1 && a.beats ? withoutBeats(a) : a));
  return { ...tempo, anchors: [...kept, pinned].sort((a, b) => a.bar - b.bar) };
}

function withoutBeats(anchor: BarAnchor): BarAnchor {
  const { beats: _, ...rest } = anchor;
  return rest;
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
  const anchors = onlyAuto ? (tempo.anchors ?? []).filter((a) => !a.auto).map(withoutBeats) : [];
  // the free regions come from the tracking too
  const { anchors: _, regions: __, ...steady } = tempo;
  return anchors.length ? { ...steady, anchors } : steady;
}

/** The steady grid that best follows the map (no anchors): used when the map is dropped. */
export function steadyTempo(tempo: Tempo): Tempo {
  const { anchors: _, regions: __, ...steady } = tempo;
  if (!isVariable(tempo)) return steady;
  const bpm = Math.round(meanBpm(tempo) * 100) / 100;
  const bar = (60 * beatsPerBar(tempo)) / bpm;
  // phase from the first anchor, earliest downbeat of the source
  const first = tempo.anchors![0].time;
  return { ...steady, bpm, offset: ((first % bar) + bar) % bar };
}
