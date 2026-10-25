// Assembles the portable Windows folder release/edimus (no installation: copy it anywhere):
// the Neutralino executable with embedded resources (built by `neu build --embed-resources`),
// ffmpeg/ffprobe next to it, the MCP server as a single executable (npm run mcp:build), and the
// license files. Also writes the update package published as a GitHub release (npm run release):
// release/edimus-<version>-win-x64.zip with everything but ffmpeg (already on the PC, too big
// to download at every update) and release/manifest.json describing it.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { zipSync } from 'fflate';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = join(root, 'release');
const out = join(releaseDir, 'edimus');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const files = [
  ['dist/edimus/edimus-win_x64.exe', 'edimus.exe'],
  ['tools/ffmpeg/bin/ffmpeg.exe', 'ffmpeg.exe'],
  ['tools/ffmpeg/bin/ffprobe.exe', 'ffprobe.exe'],
  ['mcp/dist/edimus-mcp.exe', 'edimus-mcp.exe'],
  ['THIRD_PARTY_LICENSES.md', 'THIRD_PARTY_LICENSES.md'],
  ['tools/ffmpeg/LICENSE', 'licenses/FFMPEG-LICENSE.txt'],
  ['tools/ffmpeg/README.txt', 'licenses/FFMPEG-README.txt'],
];
/** Left out of the update package: installed once with the app. */
const notUpdated = new Set(['ffmpeg.exe', 'ffprobe.exe']);

// the build the app downloads must satisfy the minimum it asks for
const compareVersions = (a, b) => {
  const [pa, pb] = [a, b].map((v) => v.split('.').map(Number));
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
};
if (compareVersions(pkg.config.ffmpeg.version, pkg.config.minFfmpeg) < 0) throw new Error(`config.ffmpeg.version ${pkg.config.ffmpeg.version} is older than config.minFfmpeg ${pkg.config.minFfmpeg}`);

for (const [from] of files) {
  if (!existsSync(join(root, from))) throw new Error(`missing ${from}: run "npm run setup", "neu build" and "npm run mcp:build" first`);
}
rmSync(out, { recursive: true, force: true });
for (const [from, to] of files) {
  mkdirSync(dirname(join(out, to)), { recursive: true });
  copyFileSync(join(root, from), join(out, to));
}
console.log(`portable folder ready: ${out}`);

const sha256 = (data) => createHash('sha256').update(data).digest('hex');
const walk = (dir) => readdirSync(dir).flatMap((name) => (statSync(join(dir, name)).isDirectory() ? walk(join(dir, name)) : [join(dir, name)]));

const entries = {};
for (const path of walk(out)) {
  const name = relative(out, path).replaceAll('\\', '/');
  if (!notUpdated.has(name)) entries[name] = readFileSync(path);
}
const zipName = `edimus-${pkg.version}-win-x64.zip`;
const zip = zipSync(entries, { level: 9 });
for (const old of readdirSync(releaseDir).filter((name) => /^edimus-.*-win-x64\.zip$/.test(name))) rmSync(join(releaseDir, old));
writeFileSync(join(releaseDir, zipName), zip);
const manifest = {
  version: pkg.version,
  minFfmpeg: pkg.config.minFfmpeg,
  ffmpeg: pkg.config.ffmpeg,
  package: { name: zipName, size: zip.length, sha256: sha256(zip) },
};
writeFileSync(join(releaseDir, 'manifest.json'), JSON.stringify(manifest, null, 2));
console.log(`update package ready: ${join(releaseDir, zipName)} (${(zip.length / 1048576).toFixed(1)} MB)`);
