import { Injectable } from '@angular/core';
import { events, filesystem, os } from '@neutralinojs/lib';
import { appPath, nativePath } from '../app-paths';

export interface ProcessResult {
  exitCode: number;
  stdOut: string;
  stdErr: string;
}

interface RunningProcess {
  stdOut: string;
  stdErr: string;
  onStdOut?: (chunk: string) => void;
  done?: (result: ProcessResult) => void;
  /** Exit code received before `done` was registered. */
  exitCode?: number;
}

interface SpawnedProcessEvent {
  id: number;
  action: 'stdOut' | 'stdErr' | 'exit';
  data: string | number;
}

interface Binaries {
  ffmpeg: string;
  ffprobe: string;
}

/** Candidate folders of the ffmpeg binaries, relative to the app path. */
const BINARY_DIRS = ['', 'ffmpeg', 'tools/ffmpeg/bin'];

const quote = (arg: string) => `"${arg}"`;

/** Runs the bundled ffmpeg/ffprobe executables as child processes. */
@Injectable({ providedIn: 'root' })
export class FfmpegService {
  private readonly processes = new Map<number, RunningProcess>();
  private binaries?: Promise<Binaries>;

  constructor() {
    events.on('spawnedProcess', (e) => this.onProcessEvent((e as CustomEvent<SpawnedProcessEvent>).detail));
  }

  /** Runs ffmpeg with the given arguments. */
  async ffmpeg(args: string[], onStdOut?: (chunk: string) => void): Promise<ProcessResult> {
    return this.run((await this.locate()).ffmpeg, args, onStdOut);
  }

  /** Runs ffprobe with the given arguments. */
  async ffprobe(args: string[]): Promise<ProcessResult> {
    return this.run((await this.locate()).ffprobe, args);
  }

  private locate(): Promise<Binaries> {
    this.binaries ??= (async () => {
      const ext = window.NL_OS === 'Windows' ? '.exe' : '';
      const root = await appPath();
      for (const dir of BINARY_DIRS) {
        const base = dir ? `${root}/${dir}` : root;
        const ffmpeg = `${base}/ffmpeg${ext}`;
        try {
          await filesystem.getStats(ffmpeg);
          return { ffmpeg: nativePath(ffmpeg), ffprobe: nativePath(`${base}/ffprobe${ext}`) };
        } catch {
          // not in this folder
        }
      }
      throw new Error(`ffmpeg not found in ${root}`);
    })();
    return this.binaries;
  }

  private async run(binary: string, args: string[], onStdOut?: (chunk: string) => void): Promise<ProcessResult> {
    const { id } = await os.spawnProcess([binary, ...args].map(quote).join(' '));
    const process = this.processFor(id);
    process.onStdOut = onStdOut;
    if (process.stdOut) onStdOut?.(process.stdOut);
    return new Promise<ProcessResult>((resolve) => {
      process.done = resolve;
      if (process.exitCode !== undefined) this.finish(id, process.exitCode);
    });
  }

  private processFor(id: number): RunningProcess {
    let process = this.processes.get(id);
    if (!process) {
      process = { stdOut: '', stdErr: '' };
      this.processes.set(id, process);
    }
    return process;
  }

  private onProcessEvent({ id, action, data }: SpawnedProcessEvent): void {
    const process = this.processFor(id);
    switch (action) {
      case 'stdOut':
        process.stdOut += data;
        process.onStdOut?.(String(data));
        break;
      case 'stdErr':
        process.stdErr += data;
        break;
      case 'exit':
        process.exitCode = Number(data);
        if (process.done) this.finish(id, process.exitCode);
        break;
    }
  }

  private finish(id: number, exitCode: number): void {
    const process = this.processes.get(id)!;
    this.processes.delete(id);
    process.done!({ exitCode, stdOut: process.stdOut, stdErr: process.stdErr });
  }
}
