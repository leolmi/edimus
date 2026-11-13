import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FieldComponent } from '../../shared/controls/field.component';

export interface LinkImportDialogData {
  /** Version of the installed yt-dlp, null when it is still to be downloaded. */
  toolVersion: string | null;
}

/** The link to import, or `update` to download the latest yt-dlp. */
export type LinkImportChoice = { url: string } | 'update';

/** Link of a web video whose audio is imported. Closes with the choice, carried out by the caller. */
@Component({
  selector: 'app-link-import-dialog',
  imports: [FieldComponent, MatButtonModule, MatDialogModule, MatIconModule, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ 'link.title' | t }}</h2>
    <mat-dialog-content class="content">
      <app-field class="field">
        <span fieldLabel>{{ 'link.label' | t }}</span>
        <input #input cdkFocusInitial placeholder="https://www.youtube.com/watch?v=…" [value]="url()" (input)="url.set(input.value)" (keydown.enter)="confirm()" />
        @if (url().trim() && !valid()) {
          <span fieldHint class="error">{{ 'link.invalid' | t }}</span>
        } @else {
          <span fieldHint>{{ 'link.hint' | t }}</span>
        }
      </app-field>
      <p class="note">{{ 'link.rights' | t }}</p>
      <p class="note tool">
        @if (data.toolVersion; as version) {
          <span>{{ 'link.toolVersion' | t: { version } }}</span>
          <button mat-button (click)="dialog.close('update')">
            <mat-icon>update</mat-icon>
            {{ 'link.toolUpdate' | t }}
          </button>
        } @else {
          <span>{{ 'link.toolMissing' | t }}</span>
        }
      </p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'common.cancel' | t }}</button>
      <button mat-flat-button [disabled]="!valid()" (click)="confirm()">
        <mat-icon>download</mat-icon>
        {{ 'link.confirm' | t }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .content {
      width: min(520px, 85vw);
    }
    .field {
      width: 100%;
    }
    .error {
      color: var(--mat-sys-error);
    }
    .note {
      margin: 12px 0 0;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .tool {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      min-height: 40px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinkImportDialogComponent {
  protected readonly data = inject<LinkImportDialogData>(MAT_DIALOG_DATA);
  protected readonly dialog = inject(MatDialogRef<LinkImportDialogComponent, LinkImportChoice>);

  protected readonly url = signal('');
  /** A web address: the sites it may point to are told by yt-dlp itself. */
  protected readonly valid = computed(() => {
    try {
      return /^https?:$/.test(new URL(this.url().trim()).protocol);
    } catch {
      return false;
    }
  });

  protected confirm(): void {
    if (this.valid()) this.dialog.close({ url: this.url().trim() });
  }
}
