// Builds dist/edimus-mcp.exe: the MCP server as a single executable (Node SEA), so that the
// portable folder needs neither Node.js nor npm install. Steps: bundle server.mjs with its
// dependencies into one CommonJS file, make the SEA blob, inject it into a copy of node.exe.
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { inject } from 'postject';

const here = dirname(fileURLToPath(import.meta.url));
const dist = join(here, 'dist');
const bundle = join(dist, 'server.cjs');
const blob = join(dist, 'sea-prep.blob');
const exe = join(dist, process.platform === 'win32' ? 'edimus-mcp.exe' : 'edimus-mcp');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });

await build({
  entryPoints: [join(here, 'server.mjs')],
  outfile: bundle,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: `node${process.versions.node.split('.')[0]}`,
  // import.meta.url is used only when not packaged
  logOverride: { 'empty-import-meta': 'silent' },
});

const seaConfig = join(dist, 'sea-config.json');
writeFileSync(seaConfig, JSON.stringify({ main: bundle, output: blob, disableExperimentalSEAWarning: true }));
execFileSync(process.execPath, ['--experimental-sea-config', seaConfig], { stdio: 'inherit' });

copyFileSync(process.execPath, exe);
await inject(exe, 'NODE_SEA_BLOB', readFileSync(blob), {
  sentinelFuse: 'NODE_SEA_FUSE_fce680ab2cc467b6e072b8b5df1996b2',
});
console.log(`MCP server executable ready: ${exe}`);
