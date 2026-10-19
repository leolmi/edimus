import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ScaleSliderComponent } from '../../shared/scale-slider.component';

export interface ClipTimingData {
  name: string;
  /** Length of the clip at its original speed (seconds of source). */
  originalLength: number;
  rate: number;
  pitch: number;
  varispeed: boolean;
}

export interface ClipTiming {
  rate: number;
  pitch: number;
  varispeed: boolean;
}

const MIN_RATE = 0.25;
const MAX_RATE = 4;
const MAX_PITCH = 24;

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

/** Formats seconds as `m:ss.mmm`. */
function formatTime(seconds: number): string {
  const sign = seconds < 0 ? '-' : '';
  const abs = Math.abs(seconds);
  const m = Math.floor(abs / 60);
  return `${sign}${m}:${(abs - m * 60).toFixed(3).padStart(6, '0')}`;
}

/** Parses `m:ss.mmm`, `h:mm:ss.mmm` or plain seconds (comma or dot as decimal separator). */
function parseTime(text: string): number | null {
  const parts = text.trim().replace(',', '.').split(':');
  if (parts.some((p) => p === '' || isNaN(Number(p)))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}

/** Speed and pitch of a clip with their real values: lengths, difference from the original, ratios. */
@Component({
  selector: 'app-clip-timing-dialog',
  imports: [MatButtonModule, MatButtonToggleModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, ScaleSliderComponent, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ 'timing.title' | t }} — {{ data.name }}</h2>
    <mat-dialog-content class="content">
      <section>
        <h3>{{ 'timing.speed' | t }}</h3>
        <mat-button-toggle-group class="mode" [value]="varispeed()" (change)="varispeed.set($event.value)">
          <mat-button-toggle [value]="false">{{ 'timing.stretch' | t }}</mat-button-toggle>
          <mat-button-toggle [value]="true">{{ 'timing.varispeed' | t }}</mat-button-toggle>
        </mat-button-toggle-group>
        <p class="mode-hint">{{ (varispeed() ? 'timing.varispeedHint' : 'timing.stretchHint') | t }}</p>
        <div class="fields">
          <mat-form-field>
            <mat-label>{{ 'timing.rate' | t }}</mat-label>
            <input matInput type="number" [min]="minRate" [max]="maxRate" step="0.01" [value]="rate().toFixed(4)" (change)="setRate(+$any($event.target).value)" />
            <span matTextSuffix>×</span>
          </mat-form-field>
          <mat-form-field>
            <mat-label>{{ 'timing.percent' | t }}</mat-label>
            <input matInput type="number" step="0.1" [value]="percent().toFixed(2)" (change)="setRate(1 + +$any($event.target).value / 100)" />
            <span matTextSuffix>%</span>
          </mat-form-field>
          <mat-form-field>
            <mat-label>{{ 'timing.length' | t }}</mat-label>
            <input matInput [value]="lengthText()" (change)="setLength($any($event.target))" />
            <mat-hint>m:ss.mmm</mat-hint>
          </mat-form-field>
        </div>
        <app-scale-slider
          class="slider"
          logarithmic
          [min]="minRate"
          [max]="maxRate"
          [step]="0.01"
          [origin]="1"
          [majorTicks]="speedTicks"
          [format]="speedLabel"
          [ariaLabel]="'timing.speed' | t"
          [value]="rate()"
          (valueChange)="setRate($event)"
        />
        <table class="facts">
          <tr><td>{{ 'timing.originalLength' | t }}</td><td>{{ format(data.originalLength) }}</td></tr>
          <tr><td>{{ 'timing.newLength' | t }}</td><td>{{ format(length()) }}</td></tr>
          <tr>
            <td>{{ 'timing.difference' | t }}</td>
            <td [class.changed]="rate() !== 1">{{ difference() }}</td>
          </tr>
        </table>
      </section>

      <section>
        <h3>{{ (varispeed() ? 'timing.extraPitch' : 'timing.pitch') | t }}</h3>
        @if (varispeed()) {
          <p class="mode-hint">{{ 'timing.varispeedPitch' | t: { st: speedSemitones() } }}</p>
        }
        <div class="fields">
          <mat-form-field>
            <mat-label>{{ 'timing.semitones' | t }}</mat-label>
            <input matInput type="number" [min]="-maxPitch" [max]="maxPitch" step="0.01" [value]="pitch()" (change)="setPitch(+$any($event.target).value)" />
            <span matTextSuffix>st</span>
          </mat-form-field>
          <mat-form-field>
            <mat-label>{{ 'timing.cents' | t }}</mat-label>
            <input matInput type="number" step="1" [value]="Math.round(pitch() * 100)" (change)="setPitch(+$any($event.target).value / 100)" />
            <span matTextSuffix>¢</span>
          </mat-form-field>
        </div>
        <app-scale-slider
          class="slider"
          [min]="-maxPitch"
          [max]="maxPitch"
          [step]="0.5"
          [origin]="0"
          [majorTicks]="12"
          [minorTicks]="11"
          [format]="pitchLabel"
          [ariaLabel]="'timing.pitch' | t"
          [value]="pitch()"
          (valueChange)="setPitch($event)"
        />
        <table class="facts">
          <tr><td>{{ 'timing.frequencyRatio' | t }}</td><td>× {{ pitchRatio().toFixed(4) }}</td></tr>
          <tr><td>{{ 'timing.example' | t }}</td><td>440 Hz → {{ (440 * pitchRatio()).toFixed(1) }} Hz</td></tr>
        </table>
      </section>
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-button (click)="reset()" [disabled]="rate() === 1 && pitch() === 0">
        <mat-icon>restart_alt</mat-icon>
        {{ 'timing.original' | t }}
      </button>
      <span class="spacer"></span>
      <button mat-button mat-dialog-close>{{ 'common.cancel' | t }}</button>
      <button mat-flat-button (click)="apply()">{{ 'timing.apply' | t }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    .content {
      width: min(560px, 90vw);
    }
    h3 {
      font: var(--mat-sys-title-small);
      margin: 8px 0;
    }
    .fields {
      display: flex;
      gap: 12px;
      mat-form-field {
        flex: 1 1 0;
        min-width: 0;
      }
    }
    .slider {
      margin: 14px 0 8px;
    }
    .facts {
      width: 100%;
      border-collapse: collapse;
      font-variant-numeric: tabular-nums;
      td {
        padding: 2px 0;
      }
      td:last-child {
        text-align: right;
      }
    }
    .changed {
      color: var(--mat-sys-primary);
    }
    .spacer {
      flex: 1 1 auto;
    }
    .mode {
      margin-bottom: 4px;
    }
    .mode-hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      margin: 4px 0 12px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClipTimingDialogComponent {
  protected readonly data = inject<ClipTimingData>(MAT_DIALOG_DATA);
  private readonly dialog = inject(MatDialogRef<ClipTimingDialogComponent, ClipTiming>);

  protected readonly Math = Math;
  protected readonly minRate = MIN_RATE;
  protected readonly maxRate = MAX_RATE;
  protected readonly maxPitch = MAX_PITCH;
  protected readonly format = formatTime;
  protected readonly speedTicks = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];
  protected readonly speedLabel = (rate: number) => `${+rate.toFixed(2)}×`;
  protected readonly pitchLabel = (pitch: number) => `${pitch > 0 ? '+' : ''}${pitch} st`;

  protected readonly rate = signal(this.data.rate);
  protected readonly pitch = signal(this.data.pitch);
  protected readonly varispeed = signal(this.data.varispeed);
  /** Pitch change caused by the speed in varispeed mode (semitones). */
  protected readonly speedSemitones = computed(() => {
    const st = 12 * Math.log2(this.rate());
    return `${st >= 0 ? '+' : ''}${st.toFixed(2)}`;
  });

  protected readonly length = computed(() => this.data.originalLength / this.rate());
  protected readonly lengthText = computed(() => formatTime(this.length()));
  protected readonly percent = computed(() => (this.rate() - 1) * 100);
  protected readonly pitchRatio = computed(() => Math.pow(2, this.pitch() / 12));
  protected readonly difference = computed(() => {
    const delta = this.length() - this.data.originalLength;
    const percent = (delta / this.data.originalLength) * 100;
    return `${delta >= 0 ? '+' : '-'}${formatTime(Math.abs(delta))} (${percent >= 0 ? '+' : ''}${percent.toFixed(2)}%)`;
  });

  protected setRate(rate: number): void {
    if (Number.isFinite(rate) && rate > 0) this.rate.set(clamp(Math.round(rate * 10000) / 10000, MIN_RATE, MAX_RATE));
  }

  /** Speed that gives the clip the typed length. */
  protected setLength(input: HTMLInputElement): void {
    const length = parseTime(input.value);
    if (length && length > 0) this.setRate(this.data.originalLength / length);
    input.value = this.lengthText(); // normalized, or restored when invalid
  }

  protected setPitch(pitch: number): void {
    if (Number.isFinite(pitch)) this.pitch.set(clamp(Math.round(pitch * 100) / 100, -MAX_PITCH, MAX_PITCH));
  }

  protected reset(): void {
    this.rate.set(1);
    this.pitch.set(0);
  }

  protected apply(): void {
    this.dialog.close({ rate: this.rate(), pitch: this.pitch(), varispeed: this.varispeed() });
  }
}
