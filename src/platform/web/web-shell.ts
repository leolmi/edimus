import { Injectable } from '@angular/core';
import { AskChoice, ShellPort } from '../../app/core/platform/shell.port';

/** The browser tab as the window of the app. */
@Injectable()
export class WebShell extends ShellPort {
  startupFiles(): string[] {
    return [];
  }

  async setTitle(title: string): Promise<void> {
    document.title = title;
  }

  onCloseRequest(): void {
    // a tab closes without asking the page: unsaved changes are guarded elsewhere
  }

  async exit(): Promise<void> {
    // a page cannot close the tab it was not opened by
  }

  // provisional: browser dialog, without the cancel choice
  async ask(title: string, message: string, cancellable = false): Promise<AskChoice> {
    if (confirm(`${title}\n\n${message}`)) return 'yes';
    return cancellable ? 'cancel' : 'no';
  }

  async openUrl(url: string): Promise<void> {
    window.open(url, '_blank', 'noopener');
  }

  async revealFile(): Promise<void> {
    throw new Error('Files cannot be shown from the browser');
  }
}
