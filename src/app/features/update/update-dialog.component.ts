import { ChangeDetectionStrategy, Component, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ShellPort } from '../../core/platform/shell.port';
import { AppRelease, UpdateBlocker } from '../../core/platform/updater.port';

export interface UpdateDialogData {
  release: AppRelease;
  /** Running version. */
  current: string;
  blocker: UpdateBlocker | null;
  /** Other windows of the app open. */
  others: number;
}

/**
 * `install`: download and restart now; `skip`: do not offer this version again at startup;
 * `ffmpeg`: first install the ffmpeg build of the release (the installed one is too old).
 */
export type UpdateChoice = 'install' | 'skip' | 'ffmpeg';

/** A newer version is available: what changes, what the update does, and the choice. */
@Component({
  selector: 'app-update-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ 'update.title' | t }}</h2>
    <mat-dialog-content class="content">
      <p>{{ 'update.available' | t: { version: data.release.version, current: data.current } }}</p>
      @if (data.release.notes) {
        <div class="notes">{{ data.release.notes }}</div>
      }
      <p class="hint">
        {{ 'update.how' | t: { size: size } }}
        <a href="" (click)="$event.preventDefault(); openPage()">{{ 'update.page' | t }}</a>
      </p>
      @switch (data.blocker?.reason) {
        @case ('dev') {
          <p class="warn"><mat-icon>block</mat-icon>{{ 'update.blocked.dev' | t }}</p>
        }
        @case ('readonly') {
          <p class="warn"><mat-icon>block</mat-icon>{{ 'update.blocked.readonly' | t: { dir: blockerDir } }}</p>
        }
        @case ('ffmpeg') {
          <p class="warn">
            <mat-icon>block</mat-icon>{{ 'update.blocked.ffmpeg' | t: { min: data.release.minFfmpeg ?? '', installed: blockerFfmpeg } }}
          </p>
        }
        @default {
          @if (data.others) {
            <p class="warn"><mat-icon>warning</mat-icon>{{ 'update.others' | t: { n: data.others } }}</p>
          }
          <p class="hint">{{ 'update.mcp' | t }}</p>
        }
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button [mat-dialog-close]="'skip'">{{ 'update.skip' | t }}</button>
      <button mat-button mat-dialog-close>{{ 'update.later' | t }}</button>
      @if (data.blocker?.reason === 'ffmpeg' && data.release.ffmpeg) {
        <button mat-flat-button [mat-dialog-close]="'ffmpeg'">
          <mat-icon>download</mat-icon>
          {{ 'update.installFfmpeg' | t: { version: data.release.ffmpeg.version } }}
        </button>
      } @else {
        <button mat-flat-button [disabled]="!!data.blocker" [mat-dialog-close]="'install'">
          <mat-icon>system_update_alt</mat-icon>
          {{ 'update.install' | t }}
        </button>
      }
    </mat-dialog-actions>
  `,
  styles: `
    .content {
      width: min(520px, 85vw);
    }
    .notes {
      white-space: pre-wrap;
      max-height: 200px;
      overflow: auto;
      padding: 8px 12px;
      border-radius: var(--mat-sys-corner-small);
      background: var(--mat-sys-surface-container);
      font: var(--mat-sys-body-small);
    }
    .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    a {
      color: var(--mat-sys-primary);
    }
    .warn {
      display: flex;
      align-items: flex-start;
      gap: 8px;
      color: var(--mat-sys-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UpdateDialogComponent {
  protected readonly data = inject<UpdateDialogData>(MAT_DIALOG_DATA);
  private readonly shell = inject(ShellPort);

  protected readonly size = (this.data.release.download.size / 1048576).toFixed(1);
  protected readonly blockerDir = this.data.blocker?.reason === 'readonly' ? this.data.blocker.dir : '';
  protected readonly blockerFfmpeg = this.data.blocker?.reason === 'ffmpeg' ? this.data.blocker.installed : '';

  protected openPage(): void {
    void this.shell.openUrl(this.data.release.page);
  }
}
