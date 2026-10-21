import { Clip, Montage, toTimeline } from '../montage/montage.model';

/**
 * Timeline times other things align to: start and end of the clips not in `exclude`, and the
 * points of their envelopes inside them (the ones hidden by a trim do not count).
 */
export function snapAnchors(montage: Montage, length: (clip: Clip) => number, exclude: ReadonlySet<string>): number[] {
  const anchors: number[] = [];
  for (const clip of montage.tracks.flatMap((t) => t.clips)) {
    if (exclude.has(clip.id)) continue;
    const end = clip.start + length(clip);
    anchors.push(clip.start, end);
    for (const point of clip.envelope ?? []) {
      const time = toTimeline(clip, point.time);
      if (time > clip.start && time < end) anchors.push(time);
    }
  }
  return anchors;
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

/**
 * Shift (seconds) that aligns the start or end of one of the dragged clips (each `start` +
 * `delta`, as `length` long) to the nearest anchor of the other clips (edges and envelope
 * points, on any track), when one is within `tolerance` seconds; null when none is.
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
    const start = clip.start + delta;
    const own = length(clip);
    // both edges of the dragged clip
    for (const [edge, offset] of [[start, 0], [start + own, own]] as const) {
      const anchor = snapTime(edge, anchors, distance);
      if (anchor === null || anchor - offset < 0) continue;
      best = anchor - edge;
      distance = Math.abs(best);
    }
  }
  return best;
}
