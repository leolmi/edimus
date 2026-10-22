import type { Tempo } from '../audio/tempo';
import { barAt, barTime, meanBpm } from '../audio/tempo-map';
import { ClipLength, setClipTiming } from './edits';
import { Clip, Montage, clipRate, toSource, toTimeline } from './montage.model';

export type AlignTarget = 'reference' | 'middle' | 'custom';

export interface AlignOptions {
  referenceId: string;
  targetIds: string[];
  /** Tempo to reach: the reference's, a common one in the middle (all clips move), or typed. */
  target: AlignTarget;
  customBpm?: number;
  varispeed: boolean;
  /** Moves the targets so that their bars start on the bars of the reference. */
  alignBars: boolean;
}

export interface AlignContext {
  tempoOf: (sourceId: string) => Tempo | null | undefined;
  length: ClipLength;
  sourceLength: (clip: Clip) => number;
}

const findClip = (montage: Montage, id: string) => montage.tracks.flatMap((t) => t.clips).find((c) => c.id === id);

/** Tempo heard in a clip (average source tempo × speed). */
export function heardBpm(clip: Clip, tempo: Tempo): number {
  return meanBpm(tempo) * clipRate(clip);
}

/** BPM every clip must reach. */
export function alignBpm(montage: Montage, options: AlignOptions, context: AlignContext): number | null {
  if (options.target === 'custom') return options.customBpm ?? null;
  const reference = findClip(montage, options.referenceId);
  const refTempo = reference && context.tempoOf(reference.sourceId);
  if (!reference || !refTempo) return null;
  if (options.target === 'reference') return heardBpm(reference, refTempo);
  // geometric mean: the stretch is shared evenly (in ratio) among the clips
  const bpms = [options.referenceId, ...options.targetIds]
    .map((id) => findClip(montage, id))
    .map((clip) => (clip ? context.tempoOf(clip.sourceId) && heardBpm(clip, context.tempoOf(clip.sourceId)!) : null))
    .filter((bpm): bpm is number => !!bpm);
  return Math.exp(bpms.reduce((sum, bpm) => sum + Math.log(bpm), 0) / bpms.length);
}

/** Brings the chosen clips to a common tempo and, optionally, on the bars of the reference. */
export function alignTempo(montage: Montage, options: AlignOptions, context: AlignContext): Montage {
  const bpm = alignBpm(montage, options, context);
  if (!bpm) return montage;
  const changing = options.target === 'reference' ? options.targetIds : [options.referenceId, ...options.targetIds];
  let result = montage;
  for (const id of changing) {
    const clip = findClip(result, id);
    const tempo = clip && context.tempoOf(clip.sourceId);
    if (!clip || !tempo) continue;
    const rate = Math.round((bpm / meanBpm(tempo)) * 10000) / 10000;
    const pitch = options.varispeed ? (clip.varispeed ? (clip.pitch ?? 0) : 0) : (clip.pitch ?? 0);
    result = setClipTiming(result, id, rate, pitch, context.sourceLength(clip), options.varispeed);
  }
  if (options.alignBars) {
    for (const id of options.targetIds) result = alignToBars(result, id, options.referenceId, context);
  }
  return result;
}

/** Moves a clip so that its first downbeat falls on the nearest downbeat of the reference. */
export function alignToBars(montage: Montage, clipId: string, referenceId: string, context: AlignContext): Montage {
  const clip = findClip(montage, clipId);
  const reference = findClip(montage, referenceId);
  const tempo = clip && context.tempoOf(clip.sourceId);
  const refTempo = reference && context.tempoOf(reference.sourceId);
  if (!clip || !reference || !tempo || !refTempo) return montage;
  // first downbeat inside the clip
  const own = toTimeline(clip, barTime(tempo, Math.ceil(barAt(tempo, clip.offset) - 1e-9)));
  // the reference grid extends before and after the reference clip
  let bar = Math.round(barAt(refTempo, toSource(reference, own)));
  let shift = toTimeline(reference, barTime(refTempo, bar)) - own;
  while (clip.start + shift < 0) shift = toTimeline(reference, barTime(refTempo, ++bar)) - own;
  if (Math.abs(shift) < 1e-6) return montage;
  return {
    ...montage,
    tracks: montage.tracks.map((t) => ({
      ...t,
      clips: t.clips.map((c) => (c.id === clipId ? { ...c, start: c.start + shift } : c)),
    })),
  };
}
