// Collects the licenses of everything edimus ships or runs (npm packages bundled in the
// frontend, Neutralino runtime, ffmpeg and the libraries built into it) into:
// - public/licenses.json, shown by the "Licenses" dialog of the app;
// - THIRD_PARTY_LICENSES.md, at the project root.
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (path) => readFileSync(join(root, path), 'utf8');
const readJson = (path) => JSON.parse(read(path));

/** License file of a package folder (LICENSE, LICENCE, COPYING, with any extension). */
function licenseText(dir) {
  const file = readdirSync(dir).find((name) => /^(licen[cs]e|copying)(\.|$)/i.test(name));
  return file ? readFileSync(join(dir, file), 'utf8').trim() : null;
}

function repositoryUrl(pkg) {
  const repo = typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url;
  return pkg.homepage ?? repo?.replace(/^git\+/, '').replace(/\.git$/, '') ?? null;
}

// --- npm packages: production dependencies, transitively -------------------------------
const npm = new Map();
/** Adds a package of `base` (a folder with node_modules) and its dependencies. */
function visit(name, base, usage) {
  if (npm.has(name)) return;
  const dir = join(root, base, 'node_modules', name);
  if (!existsSync(join(dir, 'package.json'))) return;
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'));
  npm.set(name, {
    name,
    version: pkg.version,
    license: typeof pkg.license === 'string' ? pkg.license : (pkg.license?.type ?? 'UNKNOWN'),
    url: repositoryUrl(pkg),
    usage,
    text: licenseText(dir),
  });
  for (const dep of Object.keys(pkg.dependencies ?? {})) visit(dep, base, usage);
}
for (const dep of Object.keys(readJson('package.json').dependencies ?? {})) visit(dep, '.', 'Frontend (npm)');
// bundled into edimus-mcp.exe
for (const dep of Object.keys(readJson('mcp/package.json').dependencies ?? {})) visit(dep, 'mcp', 'MCP server (edimus-mcp.exe)');

// --- native runtime and tools ----------------------------------------------------------
const neutralinoVersion = readJson('neutralino.config.json').cli.binaryVersion;
const ffmpegReadme = existsSync(join(root, 'tools/ffmpeg/README.txt')) ? read('tools/ffmpeg/README.txt') : '';
const ffmpegVersion = /ffmpeg-([\d.]+)-essentials/.exec(ffmpegReadme)?.[1] ?? /Version: ([\d.]+)/.exec(ffmpegReadme)?.[1] ?? '?';
const gpl3 = existsSync(join(root, 'tools/ffmpeg/LICENSE')) ? read('tools/ffmpeg/LICENSE').trim() : null;

const native = [
  {
    name: 'Neutralinojs',
    version: neutralinoVersion,
    license: 'MIT',
    url: 'https://neutralino.js.org',
    usage: 'Runtime (native window, file system, processes)',
    text: licenseText(join(root, 'node_modules/@neutralinojs/lib')),
  },
  {
    name: 'FFmpeg (build gyan.dev "essentials")',
    version: ffmpegVersion,
    license: 'GPL-3.0-or-later',
    url: 'https://ffmpeg.org — https://www.gyan.dev/ffmpeg/builds/',
    usage: 'Decoding, encoding and Rubber Band processing (ffmpeg.exe, ffprobe.exe)',
    text: gpl3,
  },
  {
    name: 'Node.js',
    version: process.versions.node,
    license: 'MIT (and the licenses of its bundled dependencies)',
    url: 'https://nodejs.org',
    usage: 'Runtime embedded in the MCP server (edimus-mcp.exe, built with this Node version)',
    text: existsSync(join(dirname(process.execPath), 'LICENSE')) ? readFileSync(join(dirname(process.execPath), 'LICENSE'), 'utf8').trim() : null,
  },
];

// libraries statically built into the ffmpeg binary (versions from its README)
const LIBRARY_LICENSES = {
  AMF: 'MIT', aom: 'BSD-2-Clause', AviSynthPlus: 'GPL-2.0-or-later (with linking exception)', cairo: 'LGPL-2.1 OR MPL-1.1',
  ffnvcodec: 'MIT', freetype: 'FTL OR GPL-2.0', fribidi: 'LGPL-2.1-or-later', gsm: 'TU-Berlin-1.0', harfbuzz: 'MIT-Modern-Variant',
  lame: 'LGPL-2.0-or-later', libass: 'ISC', libgme: 'LGPL-2.1-or-later', 'libopencore-amrnb': 'Apache-2.0',
  'libopencore-amrwb': 'Apache-2.0', libssh: 'LGPL-2.1', libtheora: 'BSD-3-Clause', libwebp: 'BSD-3-Clause',
  'openal-soft': 'LGPL-2.0-or-later', openjpeg2: 'BSD-2-Clause', openmpt: 'BSD-3-Clause', opus: 'BSD-3-Clause',
  rubberband: 'GPL-2.0-or-later', SDL: 'Zlib', speex: 'BSD-3-Clause', srt: 'MPL-2.0', VAAPI: 'MIT', vidstab: 'GPL-2.0-or-later',
  vmaf: 'BSD-2-Clause-Patent', 'vo-amrwbenc': 'Apache-2.0', vorbis: 'BSD-3-Clause', VPL: 'MIT', vpx: 'BSD-3-Clause',
  x264: 'GPL-2.0-or-later', x265: 'GPL-2.0-or-later', xvid: 'GPL-2.0-or-later', zeromq: 'MPL-2.0', zimg: 'WTFPL',
};
/** Libraries that edimus actually relies on (the others are part of the build but unused). */
const USED = { lame: 'MP3 encoding', opus: 'Opus encoding', vorbis: 'OGG Vorbis encoding', rubberband: 'Speed and pitch' };
const section = ffmpegReadme.split(/external libraries' versions:\s*/)[1] ?? '';
const ffmpegLibraries = section
  .split(/\r?\n/)
  .map((line) => line.trim())
  .filter((line) => /^\S+ \S+/.test(line))
  .map((line) => {
    const [name, ...version] = line.split(' ');
    return {
      name: `${name} (in FFmpeg)`,
      version: version.join(' '),
      license: LIBRARY_LICENSES[name] ?? 'see the project',
      url: null,
      usage: USED[name] ?? 'Part of the FFmpeg build',
      text: null,
    };
  });

const notes = [
  {
    name: 'Material Symbols (icons, app icon)',
    version: npm.get('material-symbols')?.version ?? '',
    license: 'Apache-2.0',
    url: 'https://fonts.google.com/icons',
    usage: 'Icons of the interface; the app icon is drawn from the "graphic_eq" symbol',
    text: null,
  },
  {
    name: 'LAME (in wasm-media-encoders)',
    version: '',
    license: 'LGPL-2.0-or-later',
    url: 'https://lame.sourceforge.io',
    usage: 'MP3 encoding of the web version (WebAssembly)',
    text: null,
  },
  {
    name: 'libvorbis / libogg (in wasm-media-encoders)',
    version: '',
    license: 'BSD-3-Clause',
    url: 'https://xiph.org/vorbis/',
    usage: 'Ogg Vorbis encoding of the web version (WebAssembly)',
    text: null,
  },
  {
    name: 'Microsoft Edge WebView2 Runtime',
    version: '',
    license: 'Microsoft Software License Terms',
    url: 'https://developer.microsoft.com/microsoft-edge/webview2/',
    usage: 'System web view used by Neutralino on Windows (not bundled)',
    text: null,
  },
];

const entries = [...native, ...[...npm.values()].sort((a, b) => a.name.localeCompare(b.name)), ...notes, ...ffmpegLibraries];
writeFileSync(join(root, 'public/licenses.json'), JSON.stringify(entries, null, 1));

const md = [
  '# Third-party licenses',
  '',
  'Generated by `npm run licenses` (scripts/licenses.mjs): do not edit by hand.',
  '',
  '| Component | Version | License | Use |',
  '|---|---|---|---|',
  ...entries.map((e) => `| ${e.name} | ${e.version} | ${e.license} | ${e.usage} |`),
  '',
  ...entries
    .filter((e) => e.text)
    .flatMap((e) => [`## ${e.name} ${e.version} — ${e.license}`, '', e.url ? `<${e.url.split(' ')[0]}>` : '', '', '```text', e.text, '```', '']),
];
writeFileSync(join(root, 'THIRD_PARTY_LICENSES.md'), md.join('\n'));
console.log(`licenses: ${entries.length} components (${entries.filter((e) => e.text).length} with full text)`);
