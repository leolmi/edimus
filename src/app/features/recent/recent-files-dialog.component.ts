import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatRippleModule } from '@angular/material/core';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { dirName, fileName } from '../../core/montage/montage.model';
import { PlatformInfo } from '../../core/platform/platform-info';
import { RECENT_LIMIT, RecentFilesService } from '../../core/recent-files.service';

/** What to open: a file of the list, or `browse` for the system dialog. */
export type RecentFilesChoice = { path: string } | 'browse';

/**
 * Open dialog: the montages opened lately (pin, remove, reopen) and the button to choose other
 * files. Closes with the choice, carried out by the caller.
 */
@Component({
  selector: 'app-recent-files-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule, MatRippleModule, MatTooltipModule, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ 'recent.title' | t }}</h2>
    <mat-dialog-content class="content">
      <p class="hint">{{ 'recent.intro' | t: { n: limit } }}</p>
      <div class="list" role="list">
        @for (file of files(); track file.path) {
          <div class="row" role="listitem">
            <div
              class="open"
              matRipple
              role="button"
              tabindex="0"
              (click)="dialog.close({ path: file.path })"
              (keydown.enter)="dialog.close({ path: file.path })"
              [title]="file.path"
            >
              <span class="name">{{ file.name }}</span>
              @if (file.folder) {
                <span class="folder">{{ file.folder }}</span>
              }
            </div>
            <button mat-icon-button [class.pinned]="file.pinned" (click)="recent.togglePin(file.path)" [matTooltip]="(file.pinned ? 'recent.unpin' : 'recent.pin') | t">
              <mat-icon>keep</mat-icon>
            </button>
            <button mat-icon-button (click)="recent.remove(file.path)" [matTooltip]="'recent.remove' | t">
              <mat-icon>close</mat-icon>
            </button>
          </div>
        } @empty {
          <p class="hint">{{ 'recent.empty' | t }}</p>
        }
      </div>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'common.cancel' | t }}</button>
      <button mat-flat-button (click)="dialog.close('browse')">
        <mat-icon>folder_open</mat-icon>
        {{ 'recent.browse' | t }}
      </button>
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
      gap: 2px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .open {
      display: flex;
      flex: 1 1 auto;
      flex-direction: column;
      justify-content: center;
      min-width: 0;
      min-height: 48px;
      padding: 4px 12px;
      border-radius: var(--mat-sys-corner-small);
      color: var(--mat-sys-on-surface);
      line-height: 1.3;
      cursor: pointer;
      outline: none;
    }
    .open:hover,
    .open:focus-visible {
      background: var(--mat-sys-surface-container-highest);
    }
    .name,
    .folder {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .folder {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .pinned mat-icon {
      color: var(--mat-sys-primary);
      font-variation-settings: 'FILL' 1;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RecentFilesDialogComponent {
  protected readonly recent = inject(RecentFilesService);
  protected readonly dialog = inject(MatDialogRef<RecentFilesDialogComponent, RecentFilesChoice>);
  private readonly platform = inject(PlatformInfo);

  protected readonly limit = RECENT_LIMIT;
  /** Name and folder of each file (the browser has no real folders to show). */
  protected readonly files = computed(() =>
    this.recent.files().map((file) => ({
      ...file,
      name: fileName(file.path),
      folder: this.platform.kind === 'desktop' ? dirName(file.path) : '',
    })),
  );
}
