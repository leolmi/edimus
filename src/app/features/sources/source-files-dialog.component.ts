import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import type { TranslationKey } from '../../core/i18n/it';
import { SourceFilesService } from '../../core/montage/source-files.service';
import type { FileAccess } from '../../core/platform/file-system.port';

const ICONS: Record<FileAccess, string> = { ready: 'check_circle', permission: 'lock', missing: 'help' };
const STATES: Record<FileAccess, TranslationKey> = {
  ready: 'sourceFiles.ready',
  permission: 'sourceFiles.permission',
  missing: 'sourceFiles.missing',
};

/**
 * Audio files of the montage that cannot be read: permission of the browser to give again
 * (one click), files to choose (several at once, or a whole folder) or one file to find.
 * Closes by itself when every file is ready.
 */
@Component({
  selector: 'app-source-files-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule, MatProgressBarModule, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ 'sourceFiles.title' | t }}</h2>
    <mat-dialog-content class="content">
      <p>{{ 'sourceFiles.intro' | t }}</p>
      @if (files.needPermission()) {
        <p class="hint">{{ 'sourceFiles.permissionHint' | t }}</p>
      }
      <div class="list">
        @for (file of files.sources(); track file.source.id) {
          <div class="row" [class]="file.access">
            <mat-icon>{{ icons[file.access] }}</mat-icon>
            <span class="name" [title]="file.source.path">{{ file.name }}</span>
            <span class="state">{{ states[file.access] | t }}</span>
            @if (file.access !== 'ready') {
              <button mat-button [disabled]="busy()" (click)="find(file.source.id)">{{ 'sourceFiles.find' | t }}</button>
            }
          </div>
        }
      </div>
      @if (busy()) {
        <mat-progress-bar mode="indeterminate" />
      } @else if (message(); as text) {
        <p class="hint">{{ text }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions>
      @if (files.needPermission()) {
        <button mat-flat-button [disabled]="busy()" (click)="allow()">
          <mat-icon>lock_open</mat-icon>
          {{ 'sourceFiles.allow' | t }}
        </button>
      }
      <button mat-stroked-button [disabled]="busy()" (click)="chooseFiles()">
        <mat-icon>library_music</mat-icon>
        {{ 'sourceFiles.choose' | t }}
      </button>
      <button mat-stroked-button [disabled]="busy()" (click)="searchFolder()">
        <mat-icon>folder_open</mat-icon>
        {{ 'sourceFiles.folder' | t }}
      </button>
      <span class="spacer"></span>
      <button mat-button mat-dialog-close>{{ 'sourceFiles.skip' | t }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    .content {
      width: min(560px, 85vw);
    }
    .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .list {
      display: flex;
      flex-direction: column;
      gap: 4px;
      margin-bottom: 8px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 40px;
    }
    .row.ready mat-icon {
      color: var(--mat-sys-primary);
    }
    .row.permission mat-icon {
      color: var(--mat-sys-tertiary);
    }
    .row.missing mat-icon {
      color: var(--mat-sys-error);
    }
    .name {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .state {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .spacer {
      flex: 1 1 auto;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SourceFilesDialogComponent {
  protected readonly files = inject(SourceFilesService);
  private readonly dialog = inject(MatDialogRef<SourceFilesDialogComponent>);
  private readonly i18n = inject(I18nService);

  protected readonly icons = ICONS;
  protected readonly states = STATES;
  protected readonly busy = signal(false);
  protected readonly message = signal<string | null>(null);

  constructor() {
    void this.run(() => this.files.check());
    effect(() => {
      // every file found: nothing left to ask
      if (!this.busy() && this.files.sources().length && !this.files.pending().length) this.dialog.close();
    });
  }

  protected allow(): Promise<void> {
    return this.run(() => this.files.allow());
  }

  protected chooseFiles(): Promise<void> {
    return this.run(async () => this.report(await this.files.chooseFiles(this.i18n.t('sourceFiles.choose'), this.i18n.t('filter.audio'))));
  }

  protected searchFolder(): Promise<void> {
    return this.run(async () => this.report(await this.files.searchFolder(this.i18n.t('sourceFiles.folder'))));
  }

  protected find(sourceId: string): Promise<void> {
    return this.run(() => this.files.find(sourceId, this.i18n.t('sourceFiles.find'), this.i18n.t('filter.audio')));
  }

  private report(count: number): void {
    const key: TranslationKey = count ? 'sourceFiles.relinked' : 'sourceFiles.noMatch';
    this.message.set(this.i18n.t(key, { n: count }));
  }

  private async run(action: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.message.set(null);
    try {
      await action();
    } catch (err) {
      this.message.set(String((err as { message?: string })?.message ?? err));
    } finally {
      this.busy.set(false);
    }
  }
}
