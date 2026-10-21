export type AskChoice = 'yes' | 'no' | 'cancel';

/** Window of the app and integration with the OS. */
export abstract class ShellPort {
  /** Files to open at startup (e.g. from the command line or "Open with"). */
  abstract startupFiles(): string[];
  abstract setTitle(title: string): Promise<void>;
  /** Called when the user asks to close the window (the app decides whether to exit). */
  abstract onCloseRequest(handler: () => void): void;
  abstract exit(): Promise<void>;
  /** Yes/no question, with a cancel option when `cancellable`. */
  abstract ask(title: string, message: string, cancellable?: boolean): Promise<AskChoice>;
  /** Opens a link in the browser of the user. */
  abstract openUrl(url: string): Promise<void>;
  /** Shows a file in the file manager of the OS (see `PlatformInfo.canRevealFiles`). */
  abstract revealFile(path: string): Promise<void>;
}
