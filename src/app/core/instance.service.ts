import { Injectable } from '@angular/core';

/** Command line option carrying a file to open at startup. */
const OPEN_ARG = '--edimus-open=';

/** Startup arguments of the instance (each instance governs a single montage). */
@Injectable({ providedIn: 'root' })
export class InstanceService {
  /** Files passed on the command line (`--edimus-open=` options or plain paths, e.g. "Open with"). */
  startupFiles(): string[] {
    return window.NL_ARGS.slice(1).flatMap((arg) => {
      if (arg.startsWith(OPEN_ARG)) return [arg.slice(OPEN_ARG.length)];
      return arg.startsWith('-') ? [] : [arg];
    });
  }
}
