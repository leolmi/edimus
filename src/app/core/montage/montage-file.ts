import { Zippable, strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import type { FileSystemPort } from '../platform/file-system.port';
import type { EnvelopePoint } from './envelope';
import { sanitizeEffects } from '../effects/effects';
import { fileFingerprint } from './fingerprint';
import { MONTAGE_VERSION, Montage, Track, dirName, fileName, isBundleFile, toSource } from './montage.model';

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

/** Name of the montage inside a bundle. */
const BUNDLE_MONTAGE = 'montage.edimus';

function parseMontage(text: string, path: string): Montage {
  let montage = JSON.parse(text) as Montage;
  if (!Array.isArray(montage.tracks) || !Array.isArray(montage.sources)) throw new Error(`Unsupported montage format: ${path}`);
  if (montage.version === 1) montage = upgradeV1(montage);
  // 2 → 3 only adds the effects: nothing to convert
  if (montage.version === 2) montage = { ...montage, version: MONTAGE_VERSION };
  if (montage.version !== MONTAGE_VERSION) throw new Error(`Unsupported montage format: ${path}`);
  return withValidEffects(montage);
}

/** The effects of the tracks checked against their descriptors (unknown types dropped, values in range). */
function withValidEffects(montage: Montage): Montage {
  return {
    ...montage,
    tracks: montage.tracks.map((track) => {
      const { effects, ...rest } = track;
      const valid = sanitizeEffects(effects);
      return valid ? { ...rest, effects: valid } : rest;
    }),
  };
}

/** Reads a montage file (or bundle), relocating the sources moved together with it. */
export async function readMontage(files: FileSystemPort, path: string): Promise<Montage> {
  if (isBundleFile(path)) return readBundle(files, path);
  const montage = parseMontage(await files.readText(path), path);
  const dir = dirName(path);
  for (const source of montage.sources) {
    if (source.relativePath && !(await files.exists(source.path))) {
      const relocated = await files.resolvePath(dir, source.relativePath);
      if (await files.exists(relocated)) source.path = relocated;
    }
  }
  return montage;
}

/**
 * Writes the montage (or bundle), storing each source path also relative to the montage file,
 * and its fingerprint (kept from the montage when the file is missing).
 */
export async function writeMontage(files: FileSystemPort, path: string, montage: Montage): Promise<void> {
  if (isBundleFile(path)) return writeBundle(files, path, montage);
  const dir = dirName(path);
  const sources = await Promise.all(
    montage.sources.map(async (source) => ({
      ...source,
      relativePath: await files.relativePath(source.path, dir),
      fingerprint: (await fileFingerprint(files, source.path)) ?? source.fingerprint,
    })),
  );
  await files.writeText(path, JSON.stringify({ ...montage, sources }, null, 2));
}

/**
 * Bundle: a zip with the montage and a copy of every source (`sources/<n>-<name>`, the path of
 * the source in the bundled montage), to move or share a montage as one file.
 */
async function writeBundle(files: FileSystemPort, path: string, montage: Montage): Promise<void> {
  const entries: Zippable = {};
  const bundled = new Map<string, string>();
  const sources = [];
  for (const source of montage.sources) {
    let entry = bundled.get(source.path);
    if (!entry) {
      entry = `sources/${bundled.size + 1}-${fileName(source.path)}`;
      // stored as they are: audio files are already compressed
      entries[entry] = [new Uint8Array(await files.readBinary(source.path)), { level: 0 }];
      bundled.set(source.path, entry);
    }
    const fingerprint = (await fileFingerprint(files, source.path)) ?? source.fingerprint;
    sources.push({ ...source, path: entry, relativePath: undefined, fingerprint });
  }
  entries[BUNDLE_MONTAGE] = strToU8(JSON.stringify({ ...montage, sources }, null, 2));
  await files.writeBinary(path, zipSync(entries).buffer as ArrayBuffer);
}

/** Opens a bundle, making its sources available as files (see `FileSystemPort.importFile`). */
async function readBundle(files: FileSystemPort, path: string): Promise<Montage> {
  const entries = unzipSync(new Uint8Array(await files.readBinary(path)));
  const text = entries[BUNDLE_MONTAGE];
  if (!text) throw new Error(`Unsupported montage format: ${path}`);
  const montage = parseMontage(strFromU8(text), path);
  const imported = new Map<string, string>();
  for (const source of montage.sources) {
    const data = entries[source.path];
    if (!data) continue;
    let file = imported.get(source.path);
    if (!file) {
      file = await files.importFile(fileName(source.path), data.slice().buffer, path);
      imported.set(source.path, file);
    }
    source.path = file;
  }
  return montage;
}
