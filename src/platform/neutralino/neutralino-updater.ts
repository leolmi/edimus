import { Injectable, inject, isDevMode } from '@angular/core';
import { app, filesystem, os } from '@neutralinojs/lib';
import { config } from '../../../package.json';
import { AppRelease, FfmpegBuild, InstalledUpdate, UpdateBlocker, UpdateTexts, UpdaterPort } from '../../app/core/platform/updater.port';
import { compareVersions } from '../../app/core/version';
import { appPath, nativePath } from './app-paths';
import { FfmpegService } from './ffmpeg.service';
import { UPDATE_SCRIPT } from './update-script';

/** Written by the installer before starting the new version, removed by it at startup. */
const MARKER = 'edimus-update.json';

/** Download of an ffmpeg build: the GitHub mirror of gyan.dev keeps every version, gyan.dev only the latest. */
const ffmpegUrl = (version: string) => `https://github.com/GyanD/codexffmpeg/releases/download/${version}/ffmpeg-${version}-essentials_build.zip`;
/** Files taken from the build, and where they go in the app folder (as in the portable folder). */
const FFMPEG_FILES = [
  ['bin/ffmpeg.exe', 'ffmpeg.exe'],
  ['bin/ffprobe.exe', 'ffprobe.exe'],
  ['LICENSE', 'licenses/FFMPEG-LICENSE.txt'],
  ['README.txt', 'licenses/FFMPEG-README.txt'],
] as const;

/** Runs a command, returns its output; throws when it fails. */
async function run(command: string): Promise<string> {
  const { stdOut, stdErr, exitCode } = await os.execCommand(command);
  if (exitCode !== 0) throw new Error(stdErr.trim() || `${command.split(' ')[0]} exit code ${exitCode}`);
  return stdOut;
}

/** Asset of a GitHub release, as given by the REST API. */
interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

/** Description of the update package published with the release (scripts/package.mjs). */
interface ReleaseManifest {
  version: string;
  minFfmpeg?: string;
  ffmpeg?: FfmpegBuild;
  package: { name: string; size: number; sha256: string };
}

const slashes = (path: string) => path.replaceAll('\\', '/');
const baseName = (path: string) => slashes(path).split('/').pop() ?? path;
const fileExists = (path: string) =>
  filesystem.getStats(path).then(
    () => true,
    () => false,
  );

/**
 * Updates from the GitHub releases of the portable folder (Windows): the release is read with
 * the REST API (open to the page), its manifest with curl.exe (the downloads of GitHub do not
 * allow pages of other origins); the files are replaced by a PowerShell script started as the app
 * exits (see UPDATE_SCRIPT). Downloads use curl.exe, part of Windows 10 and later.
 */
@Injectable()
export class NeutralinoUpdater extends UpdaterPort {
  private readonly ffmpeg = inject(FfmpegService);

  // pinned in package.json (config.ffmpeg)
  readonly ffmpegBuild: FfmpegBuild = config.ffmpeg;

  async latest(repo: string): Promise<AppRelease | null> {
    const response = await fetch(`https://api.github.com/repos/${repo}/releases/latest`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(15000),
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new Error(`GitHub: ${response.status} ${response.statusText}`);
    const release = (await response.json()) as { tag_name: string; body?: string; html_url: string; assets: ReleaseAsset[] };
    const manifestAsset = release.assets.find((a) => a.name === 'manifest.json');
    if (!manifestAsset) return null;
    const manifest = JSON.parse(await this.download(manifestAsset.browser_download_url)) as ReleaseManifest;
    const zip = release.assets.find((a) => a.name === manifest.package.name);
    if (!zip) return null;
    return {
      version: manifest.version,
      notes: release.body ?? '',
      page: release.html_url,
      minFfmpeg: manifest.minFfmpeg,
      ffmpeg: manifest.ffmpeg,
      download: { url: zip.browser_download_url, size: zip.size, sha256: manifest.package.sha256 },
    };
  }

  async blocker(release: AppRelease): Promise<UpdateBlocker | null> {
    // from the sources the folder is the repository: nothing to replace
    if (isDevMode()) return { reason: 'dev' };
    const dir = slashes(await appPath());
    const probe = `${dir}/.edimus-write-test`;
    try {
      await filesystem.writeFile(probe, '');
      await filesystem.remove(probe);
    } catch {
      return { reason: 'readonly', dir: nativePath(dir) };
    }
    if (release.minFfmpeg) {
      const installed = await this.ffmpegVersion();
      if (installed && compareVersions(installed, release.minFfmpeg) < 0) return { reason: 'ffmpeg', installed };
    }
    return null;
  }

  async otherInstances(): Promise<number> {
    const exe = baseName(window.NL_ARGS[0] ?? 'edimus.exe');
    const { stdOut } = await os.execCommand(`tasklist /FI "IMAGENAME eq ${exe}" /FO CSV /NH`);
    const running = stdOut.split(/\r?\n/).filter((line) => line.toLowerCase().startsWith(`"${exe.toLowerCase()}"`)).length;
    return Math.max(0, running - 1);
  }

  async install(release: AppRelease, texts: UpdateTexts): Promise<void> {
    const work = `${slashes(await os.getEnv('TEMP'))}/edimus-update`;
    await filesystem.createDirectory(work).catch(() => undefined);
    // downloaded with the app still open: a failure is shown here, with nothing closed yet
    const zip = nativePath(`${work}/package.zip`);
    await run(`curl.exe -sSfL --max-time 900 -o "${zip}" "${release.download.url}"`);
    const settings = {
      ...texts,
      appDir: nativePath(slashes(await appPath())),
      exe: baseName(window.NL_ARGS[0] ?? 'edimus.exe'),
      pid: window.NL_PID,
      zip,
      sha256: release.download.sha256,
      from: window.NL_APPVERSION,
      to: release.version,
    };
    await filesystem.writeFile(`${work}/update.ps1`, UPDATE_SCRIPT);
    await filesystem.writeFile(`${work}/update.json`, JSON.stringify(settings));
    const script = nativePath(`${work}/update.ps1`);
    const json = nativePath(`${work}/update.json`);
    await os.execCommand(`powershell.exe -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "${script}" -Config "${json}"`, {
      background: true,
    });
    await app.exit();
  }

  async finish(): Promise<InstalledUpdate | null> {
    if (isDevMode()) return null;
    const dir = slashes(await appPath());
    let done: InstalledUpdate | null = null;
    const marker = `${dir}/${MARKER}`;
    if (await fileExists(marker)) {
      try {
        done = JSON.parse((await filesystem.readFile(marker)).replace(/^﻿/, '')) as InstalledUpdate;
      } catch {
        // unreadable: the update happened anyway
      }
      // removed first: the installer, still watching, takes it as the sign of a good start
      await filesystem.remove(marker).catch(() => undefined);
    }
    // the folders of the package (the app folder also holds the imported files: not walked)
    const entries = (await Promise.all([dir, `${dir}/licenses`].map((d) => filesystem.readDirectory(d).catch(() => [])))).flat();
    for (const entry of entries) {
      // the MCP server may still be running from its old file: removed at a later start
      if (entry.type === 'FILE' && entry.entry.endsWith('.old')) await filesystem.remove(entry.path).catch(() => undefined);
    }
    return done;
  }

  async ffmpegMissing(): Promise<boolean> {
    // from the sources ffmpeg goes in tools/ffmpeg/bin by hand (README)
    if (isDevMode()) return false;
    return !(await this.ffmpeg.available());
  }

  async installFfmpeg(build: FfmpegBuild, onProgress: (fraction: number) => void): Promise<void> {
    const work = `${slashes(await os.getEnv('TEMP'))}/edimus-ffmpeg`;
    await filesystem.remove(work).catch(() => undefined);
    await filesystem.createDirectory(work);
    const zip = `${work}/ffmpeg.zip`;
    // curl prints no progress to a pipe: the size of the file so far tells it
    const timer = setInterval(() => {
      filesystem.getStats(zip).then(
        (stats) => onProgress(Math.min(1, stats.size / build.size)),
        () => undefined,
      );
    }, 500);
    try {
      await run(`curl.exe -sSfL --max-time 1800 -o "${nativePath(zip)}" "${ffmpegUrl(build.version)}"`);
    } finally {
      clearInterval(timer);
    }
    onProgress(1);
    const hash = await run(`powershell.exe -NoProfile -Command "(Get-FileHash -LiteralPath '${nativePath(zip)}' -Algorithm SHA256).Hash"`);
    if (hash.trim().toLowerCase() !== build.sha256) throw new Error('checksum mismatch of the downloaded ffmpeg');
    await run(`tar.exe -xf "${nativePath(zip)}" -C "${nativePath(work)}"`);
    const extracted = `${work}/ffmpeg-${build.version}-essentials_build`;
    const dir = slashes(await appPath());
    await filesystem.createDirectory(`${dir}/licenses`).catch(() => undefined);
    for (const [from, to] of FFMPEG_FILES) {
      const target = `${dir}/${to}`;
      // an older ffmpeg may be running (a decode): renamed, removed at a later start (finish)
      if (await fileExists(target)) await filesystem.move(target, `${target}.${Date.now()}.old`);
      await filesystem.copy(`${extracted}/${from}`, target);
    }
    await filesystem.remove(work).catch(() => undefined);
  }

  /** Version of the installed ffmpeg ("7.1.1"), null when it cannot be told (e.g. builds from git). */
  private async ffmpegVersion(): Promise<string | null> {
    try {
      const { stdOut } = await this.ffmpeg.ffmpeg(['-version']);
      return /ffmpeg version (\d+(?:\.\d+)*)/.exec(stdOut)?.[1] ?? null;
    } catch {
      return null;
    }
  }

  private download(url: string): Promise<string> {
    return run(`curl.exe -sSfL --max-time 20 "${url}"`);
  }
}
