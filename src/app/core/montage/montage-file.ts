import { filesystem } from '@neutralinojs/lib';
import type { EnvelopePoint } from './envelope';
import { MONTAGE_VERSION, Montage, Track, dirName, toSource } from './montage.model';

const exists = (path: string) =>
  filesystem.getStats(path).then(
    () => true,
    () => false,
  );

/** Track of a version 1 montage: one volume envelope over the timeline. */
type TrackV1 = Track & { envelope?: EnvelopePoint[] };

/**
 * Version 1 → 2: the envelope of a track becomes the envelope of each of its clips, mapped to
 * source time (same gain at every instant, curves included: the mapping is linear).
 */
function upgradeV1(montage: Montage): Montage {
  return {
    ...montage,
    version: MONTAGE_VERSION,
    tracks: montage.tracks.map((track) => {
      const { envelope, ...rest } = track as TrackV1;
      if (!envelope?.length) return rest;
      return {
        ...rest,
        clips: rest.clips.map((clip) => ({ ...clip, envelope: envelope.map((p) => ({ ...p, time: toSource(clip, p.time) })) })),
      };
    }),
  };
}

/** Reads a montage file, relocating the sources moved together with it. */
export async function readMontage(path: string): Promise<Montage> {
  let montage = JSON.parse(await filesystem.readFile(path)) as Montage;
  if (!Array.isArray(montage.tracks) || !Array.isArray(montage.sources)) throw new Error(`Unsupported montage format: ${path}`);
  if (montage.version === 1) montage = upgradeV1(montage);
  if (montage.version !== MONTAGE_VERSION) throw new Error(`Unsupported montage format: ${path}`);
  const dir = dirName(path);
  for (const source of montage.sources) {
    if (source.relativePath && !(await exists(source.path))) {
      const relocated = await filesystem.getAbsolutePath(await filesystem.getJoinedPath(dir, source.relativePath));
      if (await exists(relocated)) source.path = relocated;
    }
  }
  return montage;
}

/** Writes the montage, storing each source path also relative to the montage file. */
export async function writeMontage(path: string, montage: Montage): Promise<void> {
  const dir = dirName(path);
  const sources = await Promise.all(
    montage.sources.map(async (source) => ({
      ...source,
      relativePath: await filesystem.getRelativePath(source.path, dir).catch(() => undefined),
    })),
  );
  await filesystem.writeFile(path, JSON.stringify({ ...montage, sources }, null, 2));
}
