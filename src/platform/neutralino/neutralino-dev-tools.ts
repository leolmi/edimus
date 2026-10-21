import { Injectable, inject, isDevMode } from '@angular/core';
import { app, os } from '@neutralinojs/lib';
import { SettingsService } from '../../app/core/settings.service';
import { DevToolsPort } from '../../app/core/platform/dev-tools.port';

/** Command line options of the Neutralino window that enable the developer tools and open them. */
const FLAGS = ['--window-enable-inspector=true', '--window-open-inspector-on-startup=true'];
/** Options that must not be carried over to a relaunched process. */
const DROPPED = [/^--window-enable-inspector/, /^--window-open-inspector-on-startup/, /^--edimus-open=/];

/**
 * Developer tools of the window (web inspector): off by default (neutralino.config.json), opened
 * at startup when the setting is on. The window takes them only from its command line, so turning
 * them on or off needs a restart of the process.
 */
@Injectable()
export class NeutralinoDevTools extends DevToolsPort {
  private readonly settings = inject(SettingsService);

  readonly active = window.NL_ARGS?.includes(FLAGS[1]) ?? false;

  async startupCheck(): Promise<void> {
    // in development the window belongs to "neu run": leave it alone
    if (isDevMode() || !this.settings.devTools() || this.active) return;
    await app.restartProcess({ args: FLAGS.join(' ') });
  }

  async relaunch(open: boolean): Promise<void> {
    const [exe, ...args] = window.NL_ARGS ?? [];
    if (!exe) return;
    const kept = args.filter((arg) => !DROPPED.some((pattern) => pattern.test(arg)));
    const command = [exe, ...kept, ...(open ? FLAGS : [])].map((part) => `"${part}"`).join(' ');
    await os.execCommand(command, { background: true });
    await app.exit();
  }
}
