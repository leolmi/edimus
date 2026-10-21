import { curveThroughMidpoint, withFade } from './envelope';
import { Clip, Montage, toSource } from './montage.model';

type ClipLength = (clip: Clip) => number;

/** Clips of a crossfade and the span (timeline seconds) where it happens. */
export interface Crossfade {
  outClip: Clip;
  inClip: Clip;
  from: number;
  to: number;
}

/** Shortest crossfade (seconds). */
const MIN_SPAN = 0.01;

/**
 * Equal-power bends: the gains pass through √½ at half of the fade, so the sum of the two
 * uncorrelated signals keeps its loudness (within ±0.2 dB of the sine/cosine law).
 */
const IN_CURVE = curveThroughMidpoint(Math.SQRT1_2);
const OUT_CURVE = curveThroughMidpoint(1 - Math.SQRT1_2);

/**
 * Crossfade inside [from, to]: a clip that ends there over one that starts there, on any track
 * (both among `clipIds` when given); the span is their overlap clamped to the range. The pair
 * with the widest span wins.
 */
export function findCrossfade(montage: Montage, from: number, to: number, length: ClipLength, clipIds?: ReadonlySet<string>): Crossfade | null {
  const clips = montage.tracks.flatMap((t) => t.clips).filter((c) => !clipIds || clipIds.has(c.id));
  let best: Crossfade | null = null;
  for (const outClip of clips) {
    const outEnd = outClip.start + length(outClip);
    for (const inClip of clips) {
      // the incoming clip starts inside the outgoing one and goes on after it
      if (inClip.start <= outClip.start || inClip.start >= outEnd || inClip.start + length(inClip) <= outEnd) continue;
      const start = Math.max(from, inClip.start);
      const end = Math.min(to, outEnd);
      if (end - start < MIN_SPAN || (best && end - start <= best.to - best.from)) continue;
      best = { outClip, inClip, from: start, to: end };
    }
  }
  return best;
}

/**
 * Fade-out of the outgoing clip and fade-in of the incoming one over the crossfade span, in
 * their own envelopes: the outgoing clip stays silent after it, the incoming one before it.
 */
export function applyCrossfade(montage: Montage, crossfade: Crossfade): Montage {
  const { outClip, inClip, from, to } = crossfade;
  const fade = (clip: Clip, inward: boolean): Clip => ({
    ...clip,
    envelope: withFade(clip.envelope, toSource(clip, from), toSource(clip, to), inward, inward ? IN_CURVE : OUT_CURVE),
  });
  return {
    ...montage,
    tracks: montage.tracks.map((track) =>
      track.clips.some((c) => c.id === outClip.id || c.id === inClip.id)
        ? { ...track, clips: track.clips.map((c) => (c.id === outClip.id ? fade(c, false) : c.id === inClip.id ? fade(c, true) : c)) }
        : track,
    ),
  };
}
