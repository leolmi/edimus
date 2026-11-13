import { Injectable, inject, isDevMode } from '@angular/core';
import { filesystem, os } from '@neutralinojs/lib';
import { LinkImportPort, LinkMedia } from '../../app/core/platform/link-import.port';
import { dirName } from '../../app/core/montage/montage.model';
import { appPath, nativePath } from './app-paths';
import { FfmpegService, ProcessResult } from './ffmpeg.service';

/** Latest release of yt-dlp: it must follow the sites, so the newest one is always taken. */
const RELEASE_API = 'https://api.github.com/repos/yt-dlp/yt-dlp/releases/latest';
const EXE = 'yt-dlp.exe';
/** Candidate folders of yt-dlp, relative to the app path (from the sources: tools/yt-dlp, not in git). */
const TOOL_DIRS = ['', 'tools/yt-dlp'];
/** Extensions the downloaded audio may end with (the format of the video, not re-encoded). */
const AUDIO_OUT = ['m4a', 'opus', 'mp3', 'ogg', 'aac', 'wav', 'flac'];
/** Marks the progress lines of the download, written by yt-dlp with `--progress-template`. */
const PROGRESS_TAG = 'edimus-progress';

const slashes = (path: string) => path.replaceAll('\\', '/');
const fileExists = (path: string) =>
  filesystem.getStats(path).then(
    () => true,
    () => false,
  );

/** Runs a command, returns its output; throws when it fails. */
async function run(command: string): Promise<string> {
  const { stdOut, stdErr, exitCode } = await os.execCommand(command);
  if (exitCode !== 0) throw new Error(stdErr.trim() || `${command.split(' ')[0]} exit code ${exitCode}`);
  return stdOut;
}

/** The error told by yt-dlp (its ERROR lines), or the exit code. */
function failure(result: ProcessResult): Error {
  const errors = result.stdErr
    .split(/\r?\n/)
    .filter((line) => line.startsWith('ERROR:'))
    .map((line) => line.slice(6).trim());
  return new Error(errors.join(' ') || result.stdErr.trim().split(/\r?\n/).pop() || `yt-dlp exit code ${result.exitCode}`);
}

interface ReleaseAsset {
  name: string;
  size: number;
  browser_download_url: string;
}

/**
 * yt-dlp run as a child process (as ffmpeg), which also uses the ffmpeg of the app to take the
 * audio out of the video. Downloaded with curl.exe from the GitHub releases of yt-dlp.
 */
@Injectable()
export class NeutralinoLinkImport extends LinkImportPort {
  private readonly ffmpeg = inject(FfmpegService);

  async toolVersion(): Promise<string | null> {
    const exe = await this.locate();
    if (!exe) return null;
    try {
      const { stdOut, exitCode } = await this.ffmpeg.execute(exe, ['--version']);
      return exitCode === 0 ? stdOut.trim() : null;
    } catch {
      return null;
    }
  }

  async installTool(onProgress: (fraction: number) => void): Promise<string> {
    const response = await fetch(RELEASE_API, { headers: { Accept: 'application/vnd.github+json' }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(`GitHub: ${response.status} ${response.statusText}`);
    const release = (await response.json()) as { tag_name: string; assets: ReleaseAsset[] };
    const exe = release.assets.find((a) => a.name === EXE);
    const sums = release.assets.find((a) => a.name === 'SHA2-256SUMS');
    if (!exe || !sums) throw new Error(`yt-dlp ${release.tag_name}: ${EXE} not found in the release`);
    // the downloads of GitHub do not allow pages of other origins: curl.exe, as the updater
    const sha256 = (await run(`curl.exe -sSfL --max-time 20 "${sums.browser_download_url}"`))
      .split(/\r?\n/)
      .map((line) => line.trim().split(/\s+/))
      .find(([, name]) => name === EXE)?.[0]
      ?.toLowerCase();
    if (!sha256) throw new Error(`yt-dlp ${release.tag_name}: no checksum for ${EXE}`);

    const work = `${slashes(await os.getEnv('TEMP'))}/edimus-yt-dlp`;
    await filesystem.remove(work).catch(() => undefined);
    await filesystem.createDirectory(work);
    const download = `${work}/${EXE}`;
    // curl prints no progress to a pipe: the size of the file so far tells it
    const timer = setInterval(() => {
      filesystem.getStats(download).then(
        (stats) => onProgress(Math.min(1, stats.size / exe.size)),
        () => undefined,
      );
    }, 500);
    try {
      await run(`curl.exe -sSfL --max-time 900 -o "${nativePath(download)}" "${exe.browser_download_url}"`);
    } finally {
      clearInterval(timer);
    }
    onProgress(1);
    const hash = await run(`powershell.exe -NoProfile -Command "(Get-FileHash -LiteralPath '${nativePath(download)}' -Algorithm SHA256).Hash"`);
    if (hash.trim().toLowerCase() !== sha256) throw new Error('checksum mismatch of the downloaded yt-dlp');

    const root = slashes(await appPath());
    // from the sources the app folder is the repository: kept apart, out of git
    const dir = isDevMode() ? `${root}/tools/yt-dlp` : root;
    await filesystem.createDirectory(dir).catch(() => undefined);
    const target = `${dir}/${EXE}`;
    // never running while it is replaced (the app waits for it): the old copy goes at once
    if (await fileExists(target)) await filesystem.remove(target);
    await filesystem.copy(download, target);
    await filesystem.remove(work).catch(() => undefined);
    return (await this.toolVersion()) ?? release.tag_name;
  }

  async info(url: string): Promise<LinkMedia> {
    const result = await this.ytDlp(['--no-playlist', '--no-warnings', '--encoding', 'utf-8', '--print', '%(.{title,duration})j', url]);
    if (result.exitCode !== 0) throw failure(result);
    const line = result.stdOut.trim().split(/\r?\n/).pop() ?? '';
    const data = JSON.parse(line) as { title?: string; duration?: number | null };
    return { title: data.title?.trim() || 'audio', duration: data.duration ?? undefined };
  }

  async download(url: string, stem: string, onProgress: (fraction: number) => void): Promise<string> {
    // the audio track of the video as it is (m4a, else opus): ffmpeg only takes it out, no re-encoding
    const ffmpegDir = dirName(slashes(await this.ffmpeg.ffmpegPath()));
    let buffer = '';
    const onOutput = (chunk: string) => {
      buffer += chunk;
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? '';
      for (const line of lines) {
        const match = new RegExp(`${PROGRESS_TAG}\\s+([\\d.]+)%`).exec(line);
        if (match) onProgress(Math.min(1, Number(match[1]) / 100));
      }
    };
    const result = await this.ytDlp(
      [
        '--no-playlist',
        '--no-warnings',
        '--encoding',
        'utf-8',
        '--newline',
        '--progress',
        '--progress-template',
        `download:${PROGRESS_TAG} %(progress._percent_str)s`,
        '-f',
        'bestaudio[ext=m4a]/bestaudio',
        '-x',
        '--ffmpeg-location',
        nativePath(ffmpegDir),
        '--force-overwrites',
        '--no-mtime',
        '--print',
        'after_move:filepath',
        '-o',
        `${nativePath(stem)}.%(ext)s`,
        url,
      ],
      onOutput,
      onOutput,
    );
    if (result.exitCode !== 0) throw failure(result);
    const printed = slashes(result.stdOut.split(/\r?\n/).filter((line) => line.trim() && !line.includes(PROGRESS_TAG)).pop()?.trim() ?? '');
    if (printed && (await fileExists(printed))) return printed;
    // the path printed in another code page: the file is found by its extension
    for (const ext of AUDIO_OUT) {
      if (await fileExists(`${stem}.${ext}`)) return `${stem}.${ext}`;
    }
    throw new Error('yt-dlp ended without writing the audio file');
  }

  private async ytDlp(args: string[], onStdOut?: (chunk: string) => void, onStdErr?: (chunk: string) => void): Promise<ProcessResult> {
    const exe = await this.locate();
    if (!exe) throw new Error('yt-dlp is not installed');
    return this.ffmpeg.execute(exe, args, onStdOut, onStdErr);
  }

  /** Native path of yt-dlp.exe, null when it is in none of the folders of the app. */
  private async locate(): Promise<string | null> {
    const root = slashes(await appPath());
    for (const dir of TOOL_DIRS) {
      const path = dir ? `${root}/${dir}/${EXE}` : `${root}/${EXE}`;
      if (await fileExists(path)) return nativePath(path);
    }
    return null;
  }
}
