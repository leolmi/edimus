import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { FieldComponent } from '../../shared/controls/field.component';

export interface MarkerDialogData {
  name: string;
  /** Time of the marker, as shown. */
  time: string;
  /** A marker being created (otherwise renamed). */
  create: boolean;
}

/** Name of a marker of the timeline. Closes with the name, or nothing when cancelled. */
@Component({
  selector: 'app-marker-dialog',
  imports: [FieldComponent, MatButtonModule, MatDialogModule, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ (data.create ? 'marker.newTitle' : 'marker.renameTitle') | t }}</h2>
    <mat-dialog-content class="content">
      <app-field class="field">
        <span fieldLabel>{{ 'marker.name' | t }}</span>
        <input
          #input
          cdkFocusInitial
          [value]="name()"
          (input)="name.set(input.value)"
          (keydown.enter)="confirm()"
          (focus)="input.select()"
        />
        <span fieldHint>{{ 'marker.at' | t: { t: data.time } }}</span>
      </app-field>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'common.cancel' | t }}</button>
      <button mat-flat-button [disabled]="!name().trim()" (click)="confirm()">{{ 'common.ok' | t }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    .content {
      width: min(360px, 85vw);
    }
    .field {
      width: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MarkerDialogComponent {
  protected readonly data = inject<MarkerDialogData>(MAT_DIALOG_DATA);
  private readonly dialog = inject(MatDialogRef<MarkerDialogComponent, string>);

  protected readonly name = signal(this.data.name);

  protected confirm(): void {
    const name = this.name().trim();
    if (name) this.dialog.close(name);
  }
}
