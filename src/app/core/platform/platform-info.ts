/** What the running platform can do: the UI hides what it cannot. */
export abstract class PlatformInfo {
  abstract readonly kind: 'desktop' | 'web';
  /** Version of the app. */
  abstract readonly version: string;
  /** Runtime hosting the app (shown in the information), when there is one. */
  abstract readonly runtime?: string;
  /** Files can be shown in the file manager of the OS. */
  abstract readonly canRevealFiles: boolean;
  /** AI clients can be configured by the app, which also finds the MCP bridge by itself. */
  abstract readonly canSetupAi: boolean;
  /**
   * Files can be read and written next to the audio sources (the bar files of the sources):
   * found by themselves on opening and saved without asking where.
   */
  abstract readonly filesBesideSources: boolean;
  /** The developer tools of the window can be turned on and off. */
  abstract readonly hasDevTools: boolean;
}
