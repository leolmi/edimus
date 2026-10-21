/** Filter of an open or save dialog. */
export interface FileFilter {
  name: string;
  extensions: string[];
}

/**
 * Files of the user. Paths are '/'-separated: real paths on the desktop, identifiers given by
 * the platform where there are no paths.
 */
export abstract class FileSystemPort {
  abstract exists(path: string): Promise<boolean>;
  /** Size in bytes, undefined when the file cannot be read. */
  abstract size(path: string): Promise<number | undefined>;
  abstract readText(path: string): Promise<string>;
  abstract writeText(path: string, text: string): Promise<void>;
  /** The whole file, or `length` bytes from `start`. */
  abstract readBinary(path: string, range?: { start: number; length: number }): Promise<ArrayBuffer>;
  abstract writeBinary(path: string, data: ArrayBuffer): Promise<void>;
  abstract move(from: string, to: string): Promise<void>;
  abstract remove(path: string): Promise<void>;
  /** Path of `path` relative to the folder `dir`, undefined when there is none. */
  abstract relativePath(path: string, dir: string): Promise<string | undefined>;
  /** Absolute path of `relative` resolved from the folder `dir`. */
  abstract resolvePath(dir: string, relative: string): Promise<string>;
  /** Files chosen by the user (empty when cancelled). */
  abstract showOpenDialog(title: string, filters: FileFilter[]): Promise<string[]>;
  /** Where to save, undefined when cancelled. */
  abstract showSaveDialog(title: string, filters: FileFilter[], defaultPath?: string): Promise<string | undefined>;
  /**
   * Makes `data` available as a file named `name`, for the montage `near` (a bundle being opened):
   * on the desktop in a folder next to it, in the browser in memory. Returns its path.
   */
  abstract importFile(name: string, data: ArrayBuffer, near: string): Promise<string>;
  /** Paths of files dropped on the page; `imported` counts the ones that had to be copied to be read. */
  abstract resolveDropped(files: File[]): Promise<{ paths: string[]; imported: number }>;
}
