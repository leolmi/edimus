import { filesystem } from '@neutralinojs/lib';

let appDir: Promise<string> | undefined;

/** Absolute folder of the app (NL_PATH can be relative, e.g. "." in development). */
export function appPath(): Promise<string> {
  appDir ??= filesystem.getAbsolutePath(window.NL_PATH);
  return appDir;
}

/** Converts a path to the native separators of the OS. */
export function nativePath(path: string): string {
  return window.NL_OS === 'Windows' ? path.replaceAll('/', '\\') : path;
}
