import { Clip, Montage, toTimeline } from '../montage/montage.model';

/**
 * Timeline times other things align to: start and end of the clips not in `exclude`, and the
 * points of their envelopes inside them (the ones hidden by a trim do not count).
 */
export function snapAnchors(montage: Montage, length: (clip: Clip) => number, exclude: ReadonlySet<string>): number[] {
  const anchors: number[] = [];
  for (const clip of montage.tracks.flatMap((t) => t.clips)) {
    if (exclude.has(clip.id)) continue;
    anchors.push(clip.start, clip.start + length(clip), ...envelopeAnchors(clip, length(clip)));
  }
  return anchors;
}

/** Timeline times of the envelope points of a clip, `length` long (the ones hidden by a trim do not count). */
export function envelopeAnchors(clip: Clip, length: number): number[] {
  const end = clip.start + length;
  return (clip.envelope ?? []).map((point) => toTimeline(clip, point.time)).filter((time) => time > clip.start && time < end);
}

/** Nearest anchor within `tolerance` seconds of `time`; null when none is. */
export function snapTime(time: number, anchors: readonly number[], tolerance: number): number | null {
  let best: number | null = null;
  let distance = tolerance;
  for (const anchor of anchors) {
    const d = Math.abs(anchor - time);
    if (d <= distance) {
      best = anchor;
      distance = d;
    }
  }
  return best;
}

/** Times of a moving clip that align to the anchors: its start, its end and its visible envelope points. */
function ownAnchors(clip: Clip, length: number): number[] {
  return [clip.start, clip.start + length, ...envelopeAnchors(clip, length)];
}

/**
 * Shift (seconds) that brings the start, the end or an envelope point of one of the given clips
 * to the nearest anchor in `direction` (1 later, -1 earlier): edges and envelope points of the
 * other clips, and the `extra` times (e.g. the playhead). Null when there is none (or the clips
 * would go before 0).
 */
export function nextAnchorShift(
  montage: Montage,
  clipIds: ReadonlySet<string>,
  direction: 1 | -1,
  length: (clip: Clip) => number,
  extra: readonly number[] = [],
): number | null {
  const anchors = [...snapAnchors(montage, length, clipIds), ...extra];
  const clips = montage.tracks.flatMap((t) => t.clips).filter((c) => clipIds.has(c.id));
  if (!clips.length) return null;
  const earliest = Math.min(...clips.map((c) => c.start));
  let best: number | null = null;
  for (const clip of clips) {
    for (const edge of ownAnchors(clip, length(clip))) {
      for (const anchor of anchors) {
        const shift = anchor - edge;
        // past the current position (a millisecond at least), and not before 0
        if (shift * direction < 0.001 || earliest + shift < 0) continue;
        if (best === null || Math.abs(shift) < Math.abs(best)) best = shift;
      }
    }
  }
  return best;
}

/**
 * Shift (seconds) that aligns the start, the end or an envelope point of one of the dragged clips
 * (each moved by `delta`) to the nearest anchor of the other clips (edges and envelope points, on
 * any track), when one is within `tolerance` seconds; null when none is.
 */
export function snapToEdges(
  montage: Montage,
  dragged: ReadonlySet<string>,
  delta: number,
  length: (clip: Clip) => number,
  tolerance: number,
): number | null {
  const anchors = snapAnchors(montage, length, dragged);
  let best: number | null = null;
  let distance = tolerance;
  for (const clip of montage.tracks.flatMap((t) => t.clips)) {
    if (!dragged.has(clip.id)) continue;
    for (const time of ownAnchors(clip, length(clip))) {
      const edge = time + delta;
      const anchor = snapTime(edge, anchors, distance);
      // the clip would start before 0
      if (anchor === null || clip.start + delta + anchor - edge < 0) continue;
      best = anchor - edge;
      distance = Math.abs(best);
    }
  }
  return best;
}
