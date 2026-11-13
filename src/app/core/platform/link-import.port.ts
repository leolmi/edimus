/** What a link points to, as told by the downloader before downloading. */
export interface LinkMedia {
  title: string;
  /** Seconds, when known. */
  duration?: number;
}

/** Page of yt-dlp, the downloader used by the desktop app. */
export const YTDLP_PAGE = 'https://github.com/yt-dlp/yt-dlp';

/**
 * Audio of a web video (YouTube and the other sites of yt-dlp) saved as a local file, where the
 * platform allows it (`PlatformInfo.canImportLinks`). The downloader is not part of the app: it
 * is downloaded on request (`installTool`), and again to update it when the sites change.
 */
export abstract class LinkImportPort {
  /** Version of the installed downloader, null when it is not installed. */
  abstract toolVersion(): Promise<string | null>;
  /**
   * Downloads the latest downloader (checked against its published SHA-256) into the folder of
   * the app, replacing an older one. Returns its version; `onProgress`: fraction downloaded.
   */
  abstract installTool(onProgress: (fraction: number) => void): Promise<string>;
  /** Title and length of the video at `url`; throws when the link is not supported. */
  abstract info(url: string): Promise<LinkMedia>;
  /**
   * Saves the audio of `url` as `stem` plus the extension of the audio format (m4a or opus,
   * the audio of the video as it is, not re-encoded). Returns the path of the file.
   */
  abstract download(url: string, stem: string, onProgress: (fraction: number) => void): Promise<string>;
}
