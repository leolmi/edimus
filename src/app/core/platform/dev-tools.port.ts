/** Developer tools of the window, where the platform has them (`PlatformInfo.hasDevTools`). */
export abstract class DevToolsPort {
  /** The running window was started with the developer tools open. */
  abstract readonly active: boolean;
  /** At startup, with the setting on and the tools not open: restarts once with them. */
  abstract startupCheck(): Promise<void>;
  /** Starts a new process with (or without) the developer tools and closes this one. */
  abstract relaunch(open: boolean): Promise<void>;
}
