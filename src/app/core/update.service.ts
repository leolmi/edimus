import { Injectable, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { UpdateDialogComponent, UpdateDialogData, UpdateChoice } from '../features/update/update-dialog.component';
import { DocumentService } from './document.service';
import { I18nService } from './i18n/i18n.service';
import { PlatformInfo } from './platform/platform-info';
import { ShellPort } from './platform/shell.port';
import { AppRelease, FFMPEG_PAGE, FfmpegBuild, UpdaterPort } from './platform/updater.port';
import { SettingsService } from './settings.service';
import { compareVersions } from './version';

/** Pause after the start before looking for updates: the app opens first. */
const STARTUP_DELAY = 3000;

const errorMessage = (err: unknown) => String((err as { message?: string })?.message ?? err);

/**
 * Updates of the installed app from the GitHub releases (`UpdaterPort`): looked for at startup
 * (when the setting is on) or on request, installed only after the user confirms. Also offers
 * ffmpeg when the folder of the app has none, or when a release needs a newer one.
 */
@Injectable({ providedIn: 'root' })
export class UpdateService {
  private readonly platform = inject(PlatformInfo);
  private readonly updater = inject(UpdaterPort);
  private readonly settings = inject(SettingsService);
  private readonly documents = inject(DocumentService);
  private readonly i18n = inject(I18nService);
  private readonly dialogs = inject(MatDialog);
  private readonly shell = inject(ShellPort);

  /** Looking for a release or downloading one. */
  readonly busy = signal(false);
  /** The user asked for the running check (possibly started at startup): told its outcome. */
  private asked = false;

  /** At startup: completes the last update and, with the setting on, looks for a newer version. */
  async startup(): Promise<void> {
    if (!this.platform.canUpdate) return;
    const done = await this.updater.finish().catch(() => null);
    if (done) this.documents.notify({ key: 'update.installed', params: { version: done.to } });
    if (await this.updater.ffmpegMissing().catch(() => false)) await this.offerFfmpeg();
    if (this.settings.checkUpdates()) setTimeout(() => void this.check(false), STARTUP_DELAY);
  }

  /** ffmpeg is not in the folder of the app (first start of a downloaded app): asks to download it. */
  private async offerFfmpeg(): Promise<void> {
    const build = this.updater.ffmpegBuild;
    const message = this.i18n.t('ffmpeg.missing', { version: build.version, size: (build.size / 1048576).toFixed(0), page: FFMPEG_PAGE });
    if ((await this.shell.ask(this.i18n.t('ffmpeg.title'), message)) === 'yes') await this.installFfmpeg(build);
  }

  /** Downloads `build` of ffmpeg into the folder of the app, showing the progress; true when done. */
  private async installFfmpeg(build: FfmpegBuild): Promise<boolean> {
    const { version } = build;
    this.busy.set(true);
    try {
      await this.updater.installFfmpeg(build, (fraction) =>
        this.documents.notify(
          fraction < 1 ? { key: 'ffmpeg.downloading', params: { version, p: Math.round(fraction * 100) } } : { key: 'ffmpeg.installing', params: { version } },
        ),
      );
      this.documents.notify({ key: 'ffmpeg.installed', params: { version } });
      return true;
    } catch (err) {
      this.documents.notify({ key: 'ffmpeg.error', params: { message: errorMessage(err) } });
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  /**
   * Looks for a newer version and offers it. `manual`: asked by the user, who sees the check
   * running and its outcome even when there is nothing new, and is offered a version skipped before.
   */
  async check(manual: boolean): Promise<void> {
    if (manual) {
      this.asked = true;
      this.documents.notify({ key: 'update.checking' });
    }
    // a check already running (e.g. the one at startup) answers this request too
    if (this.busy()) return;
    this.busy.set(true);
    let retry = false;
    try {
      const release = await this.updater.latest(this.settings.updateRepo());
      if (!release || compareVersions(release.version, this.platform.version) <= 0) {
        if (this.asked) this.documents.notify({ key: 'update.none', params: { version: this.platform.version } });
        return;
      }
      if (!this.asked && this.settings.skippedVersion() === release.version) return;
      const [blocker, others] = await Promise.all([this.updater.blocker(release), this.updater.otherInstances().catch(() => 0)]);
      this.busy.set(false);
      const data: UpdateDialogData = { release, current: this.platform.version, blocker, others };
      const choice = await firstValueFrom(
        this.dialogs.open<UpdateDialogComponent, UpdateDialogData, UpdateChoice>(UpdateDialogComponent, { data, autoFocus: 'dialog', maxWidth: '95vw' }).afterClosed(),
      );
      if (choice === 'skip') this.settings.setSkippedVersion(release.version);
      if (choice === 'install') await this.install(release);
      // the release needs a newer ffmpeg: once installed, the release is offered again
      if (choice === 'ffmpeg' && release.ffmpeg) retry = await this.installFfmpeg(release.ffmpeg);
    } catch (err) {
      // at startup a failure (e.g. offline) is not worth a message
      if (this.asked) this.documents.notify({ key: 'update.error', params: { message: errorMessage(err) } });
      else console.warn('Update check failed', err);
    } finally {
      this.busy.set(false);
      this.asked = false;
    }
    if (retry) await this.check(true);
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
