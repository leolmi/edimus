/** A version of the app published in the update repository. */
export interface AppRelease {
  version: string;
  /** Release notes, as written on GitHub. */
  notes: string;
  /** Page of the release, to read it (or download it by hand) in the browser. */
  page: string;
  /** Lowest ffmpeg version the release works with, when it asks for one. */
  minFfmpeg?: string;
  /** The update package. */
  download: { url: string; size: number; sha256: string };
}

/**
 * Why a release cannot be installed here: running from the sources (`dev`), folder of the app
 * not writable (`readonly`), ffmpeg on the PC older than the release needs (`ffmpeg`).
 */
export type UpdateBlocker = { reason: 'dev' } | { reason: 'readonly'; dir: string } | { reason: 'ffmpeg'; installed: string };

/** Texts shown by the installer once the app is closed (in the language of the app). */
export interface UpdateTexts {
  title: string;
  /** Other windows of the app still open: retry, close them by force or give up. */
  waitOthers: string;
  /** The update failed and the previous version is back; `{message}` is the error. */
  failed: string;
}

/** An update installed at the last start. */
export interface InstalledUpdate {
  from: string;
  to: string;
}

/**
 * Updates of the app from the releases of a GitHub repository, where the platform allows it
 * (`PlatformInfo.canUpdate`): the package replaces the files of the app (ffmpeg excluded) once
 * every window is closed, then the new version starts.
 */
export abstract class UpdaterPort {
  /** Latest release of `repo` ("owner/name") with an update package, null when there is none; throws when unreachable. */
  abstract latest(repo: string): Promise<AppRelease | null>;
  /** Why `release` cannot be installed here, null when it can. */
  abstract blocker(release: AppRelease): Promise<UpdateBlocker | null>;
  /** Other windows of the app open on this PC (they must close before the files are replaced). */
  abstract otherInstances(): Promise<number>;
  /** Downloads the package, starts the installer and closes this window (unsaved changes must be dealt with first). */
  abstract install(release: AppRelease, texts: UpdateTexts): Promise<void>;
  /** At startup: removes what the last update left behind; the update when it has just happened. */
  abstract finish(): Promise<InstalledUpdate | null>;
}
