// Publishes the update package made by `npm run package` as the GitHub release v<version> of
// this repository (GitHub CLI, logged in with `gh auth login`): the installed apps find it as
// the latest release. Notes: `npm run release -- "text"`, default the subject of the last commit.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const releaseDir = join(root, 'release');
const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const manifestPath = join(releaseDir, 'manifest.json');
if (!existsSync(manifestPath)) throw new Error('missing release/manifest.json: run "npm run package" first');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
if (manifest.version !== version) throw new Error(`release/ holds version ${manifest.version}, package.json ${version}: run "npm run package" again`);
const zipPath = join(releaseDir, manifest.package.name);
if (!existsSync(zipPath)) throw new Error(`missing ${zipPath}: run "npm run package" again`);

const run = (cmd, args) => execFileSync(cmd, args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] }).trim();
try {
  run('gh', ['--version']);
} catch {
  throw new Error('GitHub CLI not found: install it ("winget install GitHub.cli") and log in ("gh auth login")');
}
const notes = process.argv[2] ?? run('git', ['log', '-1', '--format=%s']);
const tag = `v${version}`;
console.log(run('gh', ['release', 'create', tag, zipPath, manifestPath, '--title', `edimus ${version}`, '--notes', notes, '--target', run('git', ['rev-parse', 'HEAD'])]));
