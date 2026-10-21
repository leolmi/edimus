import { Injectable } from '@angular/core';
import { app, events, os, window as appWindow, type Icon, type MessageBoxChoice } from '@neutralinojs/lib';
import { AskChoice, ShellPort } from '../../app/core/platform/shell.port';
import { revealFile } from './reveal';

/** Command line option carrying a file to open at startup. */
const OPEN_ARG = '--edimus-open=';

@Injectable()
export class NeutralinoShell extends ShellPort {
  /** Files passed on the command line (`--edimus-open=` options or plain paths, e.g. "Open with"). */
  startupFiles(): string[] {
    return window.NL_ARGS.slice(1).flatMap((arg) => {
      if (arg.startsWith(OPEN_ARG)) return [arg.slice(OPEN_ARG.length)];
      return arg.startsWith('-') ? [] : [arg];
    });
  }

  async setTitle(title: string): Promise<void> {
    await appWindow.setTitle(title);
  }

  onCloseRequest(handler: () => void): void {
    void events.on('windowClose', handler);
  }

  async exit(): Promise<void> {
    await app.exit();
  }

  async ask(title: string, message: string, cancellable = false): Promise<AskChoice> {
    const choice = await os.showMessageBox(
      title,
      message,
      (cancellable ? 'YES_NO_CANCEL' : 'YES_NO') as MessageBoxChoice,
      'QUESTION' as Icon,
    );
    return choice === 'YES' ? 'yes' : choice === 'NO' ? 'no' : 'cancel';
  }

  async openUrl(url: string): Promise<void> {
    await os.open(url);
  }

  revealFile(path: string): Promise<void> {
    return revealFile(path);
  }
}
