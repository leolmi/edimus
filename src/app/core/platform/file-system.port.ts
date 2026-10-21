/**
 * Whether a file can be read now: `permission` when the browser knows the file but wants the
 * user to allow reading it again (see `requestAccess`), `missing` when it must be found again.
 */
export type FileAccess = 'ready' | 'permission' | 'missing';

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
  abstract access(path: string): Promise<FileAccess>;
  /**
   * Asks the user to allow reading the files in state `permission`; to be called from a click
   * (the browser requires a user gesture). Returns the paths now readable.
   */
  abstract requestAccess(paths: string[]): Promise<string[]>;
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
  /** Files with the given extensions in a folder chosen by the user and its subfolders (empty when cancelled). */
  abstract showFolderDialog(title: string, extensions: readonly string[]): Promise<string[]>;
  /**
   * Paths of files dropped on the page; `imported` counts the ones that had to be copied to be
   * read. `handles`: the handles of the dropped items, asked during the drop event (where the
   * browser gives them), so that the files can be reached again in later sessions.
   */
  abstract resolveDropped(files: File[], handles?: Promise<FileSystemHandle | null>[]): Promise<{ paths: string[]; imported: number }>;
}
