import { filesystem } from '@neutralinojs/lib';
import { MONTAGE_VERSION, Montage, dirName } from './montage.model';

const exists = (path: string) =>
  filesystem.getStats(path).then(
    () => true,
    () => false,
  );

/** Reads a montage file, relocating the sources moved together with it. */
export async function readMontage(path: string): Promise<Montage> {
  const montage = JSON.parse(await filesystem.readFile(path)) as Montage;
  if (montage.version !== MONTAGE_VERSION || !Array.isArray(montage.tracks) || !Array.isArray(montage.sources)) {
    throw new Error(`Unsupported montage format: ${path}`);
  }
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
