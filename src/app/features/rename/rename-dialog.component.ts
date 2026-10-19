import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

export interface RenameDialogData {
  name: string;
  /** The montage was never saved: the dialog is the first step of the first save. */
  firstSave: boolean;
}

/** Characters not allowed in file names (Windows rules, the strictest). */
const INVALID = /[\\/:*?"<>|]/;
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i;

/** Name of the montage (= name of its .edimus file). Closes with the name, or nothing when cancelled. */
@Component({
  selector: 'app-rename-dialog',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatInputModule, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ (data.firstSave ? 'rename.firstSaveTitle' : 'rename.title') | t }}</h2>
    <mat-dialog-content class="content">
      <mat-form-field class="field">
        <mat-label>{{ 'rename.label' | t }}</mat-label>
        <input
          #input
          matInput
          cdkFocusInitial
          [value]="name()"
          (input)="name.set(input.value)"
          (keydown.enter)="confirm()"
          (focus)="input.select()"
        />
        <span matTextSuffix>.edimus</span>
        @if (error(); as key) {
          <mat-hint class="error">{{ key | t }}</mat-hint>
        } @else {
          <mat-hint>{{ (data.firstSave ? 'rename.firstSaveHint' : 'rename.hint') | t }}</mat-hint>
        }
      </mat-form-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'common.cancel' | t }}</button>
      <button mat-flat-button [disabled]="!!error()" (click)="confirm()">
        {{ (data.firstSave ? 'rename.continue' : 'rename.confirm') | t }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .content {
      width: min(440px, 85vw);
    }
    .field {
      width: 100%;
    }
    .error {
      color: var(--mat-sys-error);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RenameDialogComponent {
  protected readonly data = inject<RenameDialogData>(MAT_DIALOG_DATA);
  private readonly dialog = inject(MatDialogRef<RenameDialogComponent, string>);

  protected readonly name = signal(this.data.name);

  protected readonly error = computed(() => {
    const name = this.name().trim();
    if (!name) return 'rename.empty' as const;
    if (INVALID.test(name)) return 'rename.invalid' as const;
    if (RESERVED.test(name) || /[. ]$/.test(name)) return 'rename.reserved' as const;
    return null;
  });

  protected confirm(): void {
    if (!this.error()) this.dialog.close(this.name().trim());
  }
}
