/** Breakpoint of a volume envelope: linear gain at a timeline time (seconds). */
export interface EnvelopePoint {
  time: number;
  gain: number;
  /**
   * Bend of the segment from this point to the next one: 0 = straight; positive = slow start
   * (exponential, e.g. a natural fade-in), negative = fast start (logarithmic, e.g. a fade-out).
   */
  curve?: number;
}

/** Highest gain the envelope can reach (+6 dB). */
export const MAX_GAIN = 2;
/** Strongest bend of a segment. */
export const MAX_CURVE = 10;

/** Progress (0–1) along a segment with the given bend at fraction `t` (0–1) of its duration. */
export function curveShape(t: number, curve = 0): number {
  if (Math.abs(curve) < 1e-3) return t;
  return Math.expm1(curve * t) / Math.expm1(curve);
}

/** Bend that makes the curve pass through `fraction` (0–1) of its rise at half of the segment. */
export function curveThroughMidpoint(fraction: number): number {
  const target = Math.min(0.99, Math.max(0.01, fraction));
  // curveShape(0.5) decreases as the curve grows: bisection
  let lo = -MAX_CURVE;
  let hi = MAX_CURVE;
  for (let i = 0; i < 40; i++) {
    const mid = (lo + hi) / 2;
    if (curveShape(0.5, mid) > target) lo = mid;
    else hi = mid;
  }
  const curve = (lo + hi) / 2;
  return Math.abs(curve) < 0.05 ? 0 : Math.round(curve * 100) / 100;
}

/** Gain inside the segment starting at point `a`, at `time`. */
function segmentGain(a: EnvelopePoint, b: EnvelopePoint, time: number): number {
  const span = b.time - a.time;
  if (span <= 0) return b.gain;
  return a.gain + (b.gain - a.gain) * curveShape((time - a.time) / span, a.curve);
}

/**
 * Gain at `time`: along the (possibly bent) segment between the surrounding points, constant
 * before the first and after the last one, 1 with no points.
 */
export function gainAt(points: readonly EnvelopePoint[] | undefined, time: number): number {
  if (!points?.length) return 1;
  if (time <= points[0].time) return points[0].gain;
  const last = points[points.length - 1];
  if (time >= last.time) return last.gain;
  let i = 1;
  while (points[i].time < time) i++;
  return segmentGain(points[i - 1], points[i], time);
}

/** Changes the bend of the segment starting at point `index`. */
export function setCurve(points: readonly EnvelopePoint[], index: number, curve: number): EnvelopePoint[] {
  const value = Math.min(MAX_CURVE, Math.max(-MAX_CURVE, curve));
  return points.map((p, i) => (i === index ? { ...p, curve: value === 0 ? undefined : value } : p));
}

/** Gain expressed in dB, for display. */
export function gainToDb(gain: number): string {
  if (gain <= 0.0001) return '-∞ dB';
  const db = 20 * Math.log10(gain);
  return `${db > 0 ? '+' : ''}${db.toFixed(1)} dB`;
}

/**
 * Inserts a point keeping the list sorted; returns the new list and the index of the point.
 * A point added inside a bent segment continues its bend.
 */
export function insertPoint(points: readonly EnvelopePoint[], point: EnvelopePoint): [EnvelopePoint[], number] {
  const index = points.findIndex((p) => p.time > point.time);
  const at = index < 0 ? points.length : index;
  const curve = at > 0 && at < points.length ? points[at - 1].curve : undefined;
  return [[...points.slice(0, at), curve ? { ...point, curve } : point, ...points.slice(at)], at];
}

/** Moves the point at `index`, keeping it between its neighbours. */
export function movePoint(points: readonly EnvelopePoint[], index: number, time: number, gain: number): EnvelopePoint[] {
  const min = index > 0 ? points[index - 1].time : 0;
  const max = index < points.length - 1 ? points[index + 1].time : Infinity;
  const clamped = { time: Math.min(max, Math.max(min, time)), gain: Math.min(MAX_GAIN, Math.max(0, gain)) };
  return points.map((p, i) => (i === index ? { ...p, ...clamped } : p));
}

/** Envelope after removing [from, to) from the timeline (what follows moves back). */
export function envelopeWithoutRange(points: readonly EnvelopePoint[] | undefined, from: number, to: number): EnvelopePoint[] | undefined {
  if (!points?.length) return points as EnvelopePoint[] | undefined;
  const gap = to - from;
  return [
    ...points.filter((p) => p.time < from).map((p, i, kept) => (i === kept.length - 1 ? { ...p, curve: undefined } : p)),
    { time: from, gain: gainAt(points, from) },
    { time: from, gain: gainAt(points, to) },
    ...points.filter((p) => p.time > to).map((p) => ({ ...p, time: p.time - gap })),
  ];
}

/** Envelope of the range [from, to) moved to the start of the timeline. */
export function envelopeOfRange(points: readonly EnvelopePoint[] | undefined, from: number, to: number): EnvelopePoint[] | undefined {
  if (!points?.length) return points as EnvelopePoint[] | undefined;
  return [
    { time: 0, gain: gainAt(points, from) },
    ...points.filter((p) => p.time > from && p.time < to).map((p) => ({ ...p, time: p.time - from })),
    { time: to - from, gain: gainAt(points, to) },
  ];
}

/**
 * Automation of an AudioParam with the envelope from montage time `from`, played at context time
 * `when`: straight segments as linear ramps, bent ones as value curves.
 */
export function automate(param: AudioParam, points: readonly EnvelopePoint[] | undefined, from: number, when: number): void {
  param.setValueAtTime(gainAt(points, from), when);
  if (!points?.length) return;
  for (let i = 0; i < points.length; i++) {
    const a = points[i];
    const b = points[i + 1];
    if (!b) {
      // last point: reached from the previous segment
      if (a.time > from && i === 0) param.linearRampToValueAtTime(a.gain, when + a.time - from);
      return;
    }
    if (b.time <= from) continue;
    if (i === 0 && a.time > from) param.linearRampToValueAtTime(a.gain, when + a.time - from);
    const start = Math.max(from, a.time);
    if (!a.curve || b.time - start < 0.005) {
      param.linearRampToValueAtTime(b.gain, when + b.time - from);
      continue;
    }
    // sampled curve from the current position to the end of the segment
    const duration = b.time - start;
    const count = Math.max(2, Math.min(512, Math.ceil(duration * 100)));
    const curve = new Float32Array(count);
    for (let k = 0; k < count; k++) curve[k] = segmentGain(a, b, start + (duration * k) / (count - 1));
    // a value curve cannot start exactly on another event: start it a hair later
    param.setValueCurveAtTime(curve, when + start - from + 1e-4, duration - 1e-4);
  }
}
