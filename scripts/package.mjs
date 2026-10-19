// Assembles the portable Windows folder release/edimus (no installation: copy it anywhere):
// the Neutralino executable with embedded resources (built by `neu build --embed-resources`),
// ffmpeg/ffprobe next to it, the MCP server as a single executable (npm run mcp:build), and the
// license files.
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'release', 'edimus');

const files = [
  ['dist/edimus/edimus-win_x64.exe', 'edimus.exe'],
  ['tools/ffmpeg/bin/ffmpeg.exe', 'ffmpeg.exe'],
  ['tools/ffmpeg/bin/ffprobe.exe', 'ffprobe.exe'],
  ['mcp/dist/edimus-mcp.exe', 'edimus-mcp.exe'],
  ['THIRD_PARTY_LICENSES.md', 'THIRD_PARTY_LICENSES.md'],
  ['tools/ffmpeg/LICENSE', 'licenses/FFMPEG-LICENSE.txt'],
  ['tools/ffmpeg/README.txt', 'licenses/FFMPEG-README.txt'],
];

for (const [from] of files) {
  if (!existsSync(join(root, from))) throw new Error(`missing ${from}: run "npm run setup", "neu build" and "npm run mcp:build" first`);
}
rmSync(out, { recursive: true, force: true });
for (const [from, to] of files) {
  mkdirSync(dirname(join(out, to)), { recursive: true });
  copyFileSync(join(root, from), join(out, to));
}
console.log(`portable folder ready: ${out}`);
