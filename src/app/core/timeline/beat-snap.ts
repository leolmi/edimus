import { beatsPerBar, type Tempo } from '../audio/tempo';
import { barLengthAt, gridPoints } from '../audio/tempo-map';
import { Clip, Montage, clipRate } from '../montage/montage.model';
import type { SnapStep } from '../settings.service';

export interface SnapContext {
  tempoOf: (sourceId: string) => Tempo | null | undefined;
  /** Length of a clip on the timeline (seconds). */
  length: (clip: Clip) => number;
  step: SnapStep;
  /** Clips moving with the dragged one: their grid is not a target. */
  moving?: ReadonlySet<string>;
}

/** Seconds around the anchor where the grid points of the other clips are looked for. */
const REACH = 4;

/** Grid points per bar for a step: the bar, the beat or half a beat. */
function perBar(tempo: Tempo, step: SnapStep): number {
  const beats = beatsPerBar(tempo);
  return step === 'bar' ? 1 : step === 'half' ? beats * 2 : beats;
}

/** Timeline times of the grid points of a clip (from its source bar map) in [from, to], inside the clip. */
function gridOf(clip: Clip, tempo: Tempo, step: SnapStep, start: number, length: number, from: number, to: number): number[] {
  const rate = clipRate(clip);
  const toSource = (time: number) => clip.offset + (time - start) * rate;
  const lo = Math.max(from, start);
  const hi = Math.min(to, start + length);
  if (hi < lo) return [];
  return gridPoints(tempo, perBar(tempo, step), toSource(lo), toSource(hi)).map((p) => start + (p.time - clip.offset) / rate);
}

/**
 * Start of a dragged clip anchored to the beat grid at the chosen step (bar, beat or half a
 * beat): the grid point of the clip nearest the pointer lands on the nearest grid point of the
 * other clips, so the clip moves step by step (bars move from downbeat to downbeat). Clips
 * without a known tempo snap their start; with no other grid around, the move goes by whole
 * steps of the clip itself.
 */
export function snapToBeats(montage: Montage, clipId: string, start: number, originalStart: number, pointer: number, context: SnapContext): number {
  const clips = montage.tracks.flatMap((t) => t.clips);
  const dragged = clips.find((c) => c.id === clipId);
  if (!dragged) return start;
  const tempo = context.tempoOf(dragged.sourceId);
  const length = context.length(dragged);
  // bars are long: look for them further away
  const reach = context.step === 'bar' ? REACH * 4 : REACH;

  // anchor: the grid point of the dragged clip under the pointer (its start without a tempo)
  let anchor = start;
  if (tempo) {
    const own = gridOf(dragged, tempo, context.step, start, length, pointer - reach, pointer + reach);
    if (own.length) anchor = own.reduce((a, b) => (Math.abs(b - pointer) < Math.abs(a - pointer) ? b : a));
  }

  let target: number | undefined;
  for (const clip of clips) {
    const other = clip.id !== clipId && !context.moving?.has(clip.id) && context.tempoOf(clip.sourceId);
    if (!other) continue;
    for (const point of gridOf(clip, other, context.step, clip.start, context.length(clip), anchor - reach, anchor + reach)) {
      if (target === undefined || Math.abs(point - anchor) < Math.abs(target - anchor)) target = point;
    }
  }
  if (target !== undefined) return Math.max(0, start + target - anchor);

  // no grid around: whole steps of the clip itself from where it was
  if (!tempo) return start;
  // the steps of the bar under the clip start
  const step = barLengthAt(tempo, dragged.offset) / perBar(tempo, context.step) / clipRate(dragged);
  return Math.max(0, originalStart + Math.round((start - originalStart) / step) * step);
}
