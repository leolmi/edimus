import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatSelectModule } from '@angular/material/select';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatRadioModule } from '@angular/material/radio';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import type { AlignOptions, AlignTarget } from '../../core/montage/tempo-align';
import { FieldComponent } from '../../shared/controls/field.component';

/** Clip with a known tempo, as listed by the dialog. */
export interface AlignClip {
  id: string;
  label: string;
  /** Tempo heard (source BPM × speed). */
  bpm: number;
  confidence: number;
}

export interface AlignDialogData {
  clips: AlignClip[];
  referenceId: string;
}

/** Choice of the reference clip, of the clips to adapt and of how (target tempo, stretch mode, bars). */
@Component({
  selector: 'app-align-tempo-dialog',
  imports: [FieldComponent, 
    MatButtonModule,
    MatSelectModule,
    MatCheckboxModule,
    MatDialogModule,
    MatRadioModule,
    TranslatePipe,
  ],
  template: `
    <h2 mat-dialog-title>{{ 'align.title' | t }}</h2>
    <mat-dialog-content class="content">
      <table class="clips">
        <tr>
          <th>{{ 'align.reference' | t }}</th>
          <th>{{ 'align.adapt' | t }}</th>
          <th class="name">{{ 'align.clip' | t }}</th>
          <th class="num">BPM</th>
          <th class="num">{{ 'align.result' | t }}</th>
        </tr>
        @for (clip of data.clips; track clip.id) {
          <tr [class.reference]="clip.id === referenceId()">
            <td><mat-radio-button [checked]="clip.id === referenceId()" (change)="setReference(clip.id)" /></td>
            <td>
              <mat-checkbox
                [checked]="targets().has(clip.id)"
                [disabled]="clip.id === referenceId()"
                (change)="toggleTarget(clip.id, $event.checked)"
              />
            </td>
            <td class="name">{{ clip.label }}</td>
            <td class="num">{{ clip.bpm.toFixed(2) }} <span class="confidence">{{ (clip.confidence * 100).toFixed(0) }}%</span></td>
            <td class="num">{{ resultOf(clip) }}</td>
          </tr>
        }
      </table>

      <h3>{{ 'align.targetTempo' | t }}</h3>
      <app-field class="choice">
        <mat-select [value]="target()" (selectionChange)="target.set($event.value)">
          <mat-option value="reference">{{ 'align.toReference' | t }}</mat-option>
          <mat-option value="middle">{{ 'align.toMiddle' | t }}</mat-option>
          <mat-option value="custom">{{ 'align.toCustom' | t }}</mat-option>
        </mat-select>
      </app-field>
      @if (target() === 'custom') {
        <app-field class="custom">
          <span fieldLabel>BPM</span>
          <input type="number" step="0.01" min="20" max="400" [value]="customBpm()" (change)="customBpm.set(+$any($event.target).value)" />
        </app-field>
      }
      <p class="hint">{{ 'align.targetHint' | t: { bpm: bpm()?.toFixed(2) ?? '—' } }}</p>

      <h3>{{ 'align.how' | t }}</h3>
      <app-field class="choice">
        <mat-select [value]="varispeed()" (selectionChange)="varispeed.set($event.value)">
          <mat-option [value]="false">{{ 'timing.stretch' | t }}</mat-option>
          <mat-option [value]="true">{{ 'timing.varispeed' | t }}</mat-option>
        </mat-select>
      </app-field>
      <p class="hint">{{ (varispeed() ? 'timing.varispeedHint' : 'timing.stretchHint') | t }}</p>

      <mat-checkbox [checked]="alignBars()" (change)="alignBars.set($event.checked)">{{ 'align.bars' | t }}</mat-checkbox>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'common.cancel' | t }}</button>
      <button mat-flat-button [disabled]="!targets().size || !bpm()" (click)="apply()">{{ 'timing.apply' | t }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    .content {
      width: min(640px, 80vw);
      overflow-x: hidden;
    }
    .clips {
      width: 100%;
      border-collapse: collapse;
      font-variant-numeric: tabular-nums;
      th {
        font: var(--mat-sys-label-medium);
        color: var(--mat-sys-on-surface-variant);
        text-align: left;
        padding: 4px;
      }
      td {
        padding: 0 4px;
        border-top: 1px solid var(--mat-sys-outline-variant);
      }
      .num {
        text-align: right;
        white-space: nowrap;
      }
      .name {
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
        max-width: 220px;
      }
      tr.reference td {
        background: color-mix(in srgb, var(--mat-sys-primary) 8%, transparent);
      }
    }
    .confidence {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    h3 {
      font: var(--mat-sys-title-small);
      margin: 16px 0 8px;
    }
    .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      margin: 6px 0 0;
    }
    .choice {
      width: 260px;
    }
    .custom {
      margin-top: 8px;
      width: 160px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AlignTempoDialogComponent {
  protected readonly data = inject<AlignDialogData>(MAT_DIALOG_DATA);
  private readonly dialog = inject(MatDialogRef<AlignTempoDialogComponent, AlignOptions>);

  protected readonly referenceId = signal(this.data.referenceId);
  protected readonly targets = signal(new Set(this.data.clips.map((c) => c.id).filter((id) => id !== this.data.referenceId)));
  protected readonly target = signal<AlignTarget>('reference');
  protected readonly customBpm = signal(Math.round(this.reference()?.bpm ?? 120));
  protected readonly varispeed = signal(false);
  protected readonly alignBars = signal(true);

  /** Tempo that the clips will reach. */
  protected readonly bpm = computed(() => {
    const reference = this.data.clips.find((c) => c.id === this.referenceId());
    switch (this.target()) {
      case 'reference':
        return reference?.bpm ?? null;
      case 'custom':
        return this.customBpm() > 0 ? this.customBpm() : null;
      case 'middle': {
        const clips = this.data.clips.filter((c) => c.id === this.referenceId() || this.targets().has(c.id));
        return clips.length ? Math.exp(clips.reduce((sum, c) => sum + Math.log(c.bpm), 0) / clips.length) : null;
      }
    }
  });

  private reference() {
    return this.data.clips.find((c) => c.id === this.data.referenceId);
  }

  protected setReference(id: string): void {
    const old = this.referenceId();
    this.referenceId.set(id);
    this.targets.update((set) => {
      const next = new Set(set);
      next.delete(id);
      next.add(old);
      return next;
    });
  }

  protected toggleTarget(id: string, checked: boolean): void {
    this.targets.update((set) => {
      const next = new Set(set);
      if (checked) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  /** Speed change of a clip, as shown in the list. */
  protected resultOf(clip: AlignClip): string {
    const bpm = this.bpm();
    const changes = this.targets().has(clip.id) || (clip.id === this.referenceId() && this.target() !== 'reference');
    if (!bpm || !changes) return '—';
    const ratio = bpm / clip.bpm;
    return `${ratio.toFixed(4)}× (${ratio >= 1 ? '+' : ''}${((ratio - 1) * 100).toFixed(1)}%)`;
  }

  protected apply(): void {
    this.dialog.close({
      referenceId: this.referenceId(),
      targetIds: [...this.targets()],
      target: this.target(),
      customBpm: this.customBpm(),
      varispeed: this.varispeed(),
      alignBars: this.alignBars(),
    });
  }
}
