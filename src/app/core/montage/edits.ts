import { Clip, Montage, clipRate } from './montage.model';

/** Length of a clip on the timeline (resolves `duration: 0` with the source length). */
export type ClipLength = (clip: Clip) => number;

/** Shortest clip a trim can leave (seconds). */
export const MIN_CLIP_LENGTH = 0.01;

const EPSILON = 1e-6;

function mapClips(montage: Montage, map: (clip: Clip) => Clip[]): Montage {
  let changed = false;
  const tracks = montage.tracks.map((track) => {
    const clips = track.clips.flatMap((clip) => {
      const result = map(clip);
      if (result.length !== 1 || result[0] !== clip) changed = true;
      return result;
    });
    return clips.length === track.clips.length && clips.every((c, i) => c === track.clips[i]) ? track : { ...track, clips };
  });
  return changed ? { ...montage, tracks } : montage;
}

/** Portion [from, to) of a clip (timeline times), placed at `start`; null when empty. */
function portion(clip: Clip, length: number, from: number, to: number, start: number): Clip | null {
  const a = Math.max(from, clip.start);
  const b = Math.min(to, clip.start + length);
  if (b - a < EPSILON) return null;
  const keepId = a === clip.start;
  return {
    ...clip,
    id: keepId ? clip.id : crypto.randomUUID(),
    start,
    offset: clip.offset + (a - clip.start) * clipRate(clip),
    duration: (b - a) * clipRate(clip),
  };
}

/**
 * Moves an edge of a clip to `time` (timeline), keeping the other edge still.
 * `sourceLength` bounds the clip to the audio available in its source.
 */
export function trimClip(
  montage: Montage,
  clipId: string,
  edge: 'start' | 'end',
  time: number,
  length: ClipLength,
  sourceLength: number,
): Montage {
  return mapClips(montage, (clip) => {
    if (clip.id !== clipId) return [clip];
    const rate = clipRate(clip);
    const end = clip.start + length(clip);
    if (edge === 'end') {
      const max = (sourceLength - clip.offset) / rate;
      return [{ ...clip, duration: Math.min(max, Math.max(MIN_CLIP_LENGTH, time - clip.start)) * rate }];
    }
    // the start cannot go before the beginning of the source, nor before 0 on the timeline
    const min = Math.max(clip.start - clip.offset / rate, 0);
    const start = Math.min(end - MIN_CLIP_LENGTH, Math.max(min, time));
    return [{ ...clip, start, offset: clip.offset + (start - clip.start) * rate, duration: (end - start) * rate }];
  });
}

/**
 * Moves a group of clips by `delta` seconds and `rows` tracks, keeping their spacing; the
 * caller keeps every clip on an existing track and at or after 0.
 */
export function moveClips(montage: Montage, clipIds: ReadonlySet<string>, delta: number, rows: number): Montage {
  const moved = montage.tracks.map((track) => track.clips.filter((c) => clipIds.has(c.id)).map((c) => ({ ...c, start: c.start + delta })));
  return {
    ...montage,
    tracks: montage.tracks.map((track, index) => {
      const incoming = moved[index - rows] ?? [];
      const kept = track.clips.filter((c) => !clipIds.has(c.id));
      return kept.length === track.clips.length && !incoming.length ? track : { ...track, clips: [...kept, ...incoming] };
    }),
  };
}

/** Splits the clips crossing `time` in two (only `clipIds` when given). */
export function splitAt(montage: Montage, time: number, length: ClipLength, clipIds?: Set<string>): Montage {
  return mapClips(montage, (clip) => {
    const len = length(clip);
    if (clipIds && !clipIds.has(clip.id)) return [clip];
    if (time <= clip.start + EPSILON || time >= clip.start + len - EPSILON) return [clip];
    return [portion(clip, len, clip.start, time, clip.start)!, portion(clip, len, time, clip.start + len, time)!];
  });
}

/** Keeps only [from, to) of every track, moved to the start of the timeline (envelopes travel with the clips). */
export function cropToRange(montage: Montage, from: number, to: number, length: ClipLength): Montage {
  return mapClips(montage, (clip) => {
    const part = portion(clip, length(clip), from, to, Math.max(clip.start, from) - from);
    return part ? [part] : [];
  });
}

/** Removes [from, to) from every track, moving what follows back to close the gap. */
export function deleteRange(montage: Montage, from: number, to: number, length: ClipLength): Montage {
  const gap = to - from;
  return mapClips(montage, (clip) => {
    const len = length(clip);
    const end = clip.start + len;
    if (end <= from + EPSILON) return [clip];
    if (clip.start >= to - EPSILON) return [{ ...clip, start: clip.start - gap }];
    const parts = [
      portion(clip, len, clip.start, from, clip.start),
      portion(clip, len, to, end, Math.max(from, clip.start - gap)),
    ];
    return parts.filter((p): p is Clip => p !== null);
  });
}

/** Sets speed and pitch of a clip, keeping its start (the end moves with the speed). */
export function setClipTiming(
  montage: Montage,
  clipId: string,
  rate: number,
  pitch: number,
  sourceLength: number,
  varispeed = false,
): Montage {
  return mapClips(montage, (clip) => {
    if (clip.id !== clipId) return [clip];
    // a fixed source portion: "up to the end" becomes explicit
    const duration = clip.duration > 0 ? clip.duration : Math.max(0, sourceLength - clip.offset);
    return [
      {
        ...clip,
        duration,
        rate: rate === 1 ? undefined : rate,
        pitch: pitch === 0 ? undefined : pitch,
        varispeed: varispeed && rate !== 1 ? true : undefined,
      },
    ];
  });
}
