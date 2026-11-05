import type { RhythmReport } from './rhythm';
import type { Tempo } from './tempo';
import { anchorOf, barMeter, barTime } from './tempo-map';

/**
 * What the bar tracking left in doubt, for the user to decide (bar numbers as in the map, from 0):
 * a bar of another meter than its region, a doubtful bar, a region whose 1 does not stand out or
 * that fits another meter nearly as well, a beat twice or half as fast.
 */
export type BarDoubt =
  | { kind: 'meter'; bar: number; meter: number; usual: number }
  | { kind: 'uncertain'; bar: number }
  | { kind: 'downbeat'; from: number; to: number }
  | { kind: 'meterAlt'; from: number; to: number; meter: number }
  | { kind: 'bpmAlt'; bpm: number };

/**
 * Offers the beat twice or half as fast ("Try again at … BPM"). Hidden for now: once two 1s are
 * marked they set the beat already, and the offer only confused.
 */
export const SHOW_BPM_ALTERNATIVES = false;

/** A bar settled by hand: its 1 is a mark (and, for its length, the next one too). */
const marked = (tempo: Tempo, bar: number) => {
  const anchor = anchorOf(tempo, bar);
  return !!anchor && !anchor.auto;
};

/** The doubts of the last tracking still open on the map (the bars marked since are settled). */
export function barDoubts(tempo: Tempo, report: RhythmReport): BarDoubt[] {
  const doubts: BarDoubt[] = [];
  const odd = new Set<number>();
  for (const region of report.regions) {
    if (region.kind !== 'pulsed' || region.firstBar === undefined || region.lastBar === undefined) continue;
    const usual = region.meters?.[0];
    if (region.downbeatUncertain) doubts.push({ kind: 'downbeat', from: region.firstBar, to: region.lastBar });
    if (region.meterAlternative) doubts.push({ kind: 'meterAlt', from: region.firstBar, to: region.lastBar, meter: region.meterAlternative });
    if (!usual) continue;
    for (let bar = region.firstBar; bar <= region.lastBar; bar++) {
      const meter = barMeter(tempo, bar);
      if (meter === usual || (marked(tempo, bar) && marked(tempo, bar + 1))) continue;
      odd.add(bar);
      doubts.push({ kind: 'meter', bar, meter, usual });
    }
  }
  for (const bar of report.uncertainBars) if (!odd.has(bar) && !marked(tempo, bar)) doubts.push({ kind: 'uncertain', bar });
  if (SHOW_BPM_ALTERNATIVES) for (const bpm of report.bpmAlternatives) doubts.push({ kind: 'bpmAlt', bpm });
  // in time order, the readings of the whole piece last
  const first = (d: BarDoubt) => (d.kind === 'bpmAlt' ? Infinity : 'bar' in d ? d.bar : d.from);
  return doubts.sort((a, b) => first(a) - first(b));
}

/** Source times of `count` beats from the downbeat of `bar` on, across the bars. */
export function beatsFrom(tempo: Tempo, bar: number, count: number): number[] {
  const beats: number[] = [];
  for (let b = bar; beats.length < count; b++) {
    const meter = barMeter(tempo, b);
    for (let k = 0; k < meter && beats.length < count; k++) beats.push(barTime(tempo, b + k / meter));
  }
  return beats;
}
