import { Injectable, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { UpdateDialogComponent, UpdateDialogData, UpdateChoice } from '../features/update/update-dialog.component';
import { DocumentService } from './document.service';
import { I18nService } from './i18n/i18n.service';
import { PlatformInfo } from './platform/platform-info';
import { AppRelease, UpdaterPort } from './platform/updater.port';
import { SettingsService } from './settings.service';
import { compareVersions } from './version';

/** Pause after the start before looking for updates: the app opens first. */
const STARTUP_DELAY = 3000;

const errorMessage = (err: unknown) => String((err as { message?: string })?.message ?? err);

/**
 * Updates of the installed app from the GitHub releases (`UpdaterPort`): looked for at startup
 * (when the setting is on) or on request, installed only after the user confirms.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly platform = inject(PlatformInfo);
  private readonly updater = inject(UpdaterPort);
  private readonly settings = inject(SettingsService);
  private readonly documents = inject(DocumentService);
  private readonly i18n = inject(I18nService);
  private readonly dialogs = inject(MatDialog);

  /** Looking for a release or downloading one. */
  readonly busy = signal(false);

  /** At startup: completes the last update and, with the setting on, looks for a newer version. */
  async startup(): Promise<void> {
    if (!this.platform.canUpdate) return;
    const done = await this.updater.finish().catch(() => null);
    if (done) this.documents.notify({ key: 'update.installed', params: { version: done.to } });
    if (this.settings.checkUpdates()) setTimeout(() => void this.check(false), STARTUP_DELAY);
  }

  /**
   * Looks for a newer version and offers it. `manual`: asked by the user, who is told the
   * outcome even when there is nothing new, and is offered a version skipped before.
   */
  async check(manual: boolean): Promise<void> {
    if (this.busy()) return;
    this.busy.set(true);
    try {
      const release = await this.updater.latest(this.settings.updateRepo());
      if (!release || compareVersions(release.version, this.platform.version) <= 0) {
        if (manual) this.documents.notify({ key: 'update.none', params: { version: this.platform.version } });
        return;
      }
      if (!manual && this.settings.skippedVersion() === release.version) return;
      const [blocker, others] = await Promise.all([this.updater.blocker(release), this.updater.otherInstances().catch(() => 0)]);
      this.busy.set(false);
      const data: UpdateDialogData = { release, current: this.platform.version, blocker, others };
      const choice = await firstValueFrom(
        this.dialogs.open<UpdateDialogComponent, UpdateDialogData, UpdateChoice>(UpdateDialogComponent, { data, autoFocus: 'dialog', maxWidth: '95vw' }).afterClosed(),
      );
      if (choice === 'skip') this.settings.setSkippedVersion(release.version);
      if (choice === 'install') await this.install(release);
    } catch (err) {
      // at startup a failure (e.g. offline) is not worth a message
      if (manual) this.documents.notify({ key: 'update.error', params: { message: errorMessage(err) } });
      else console.warn('Update check failed', err);
    } finally {
      this.busy.set(false);
    }
  }

  private async install(release: AppRelease): Promise<void> {
    if (!(await this.documents.confirmDiscard())) return;
    this.busy.set(true);
    this.documents.notify({ key: 'update.downloading', params: { version: release.version } });
    try {
      await this.updater.install(release, {
        title: this.i18n.t('update.title'),
        waitOthers: this.i18n.t('update.waitOthers'),
        failed: this.i18n.t('update.failed'),
      });
    } catch (err) {
      // asked by the user even at startup: always told
      this.documents.notify({ key: 'update.installError', params: { message: errorMessage(err) } });
    }
  }
}
