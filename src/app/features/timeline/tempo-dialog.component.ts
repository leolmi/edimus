import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { Tempo } from '../../core/audio/tempo';
import { isVariable, meanBpm } from '../../core/audio/tempo-map';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

export interface TempoDialogData {
  name: string;
  /** Tempo in use (set by hand or detected). */
  tempo: Tempo | null;
  /** Detected tempo, to go back to it. */
  detected: Tempo | null;
  /** The "detected" tempo comes from the bar file next to the audio. */
  fromFile?: boolean;
  manual: boolean;
  /** Source time under the playhead, null when the playhead is outside the clip. */
  playheadSourceTime: number | null;
  /** Speed of the clip, to show the tempo heard. */
  rate: number;
  /** Bar tracking of this source in progress. */
  tracking?: boolean;
}

/**
 * Tempo set by hand, null to go back to the detected one, or a request: mark the beats on the
 * clip, track the bars along the source, drop the bar map or its anchors.
 */
export type TempoDialogResult = {
  tempo: Tempo | null;
  mark?: { beatsPerBar: number; bpm: number };
  track?: boolean;
  steady?: boolean;
  /** Removes all the anchors, or only those of the bar tracking. */
  clear?: 'all' | 'auto';
  /** Saves the tempo in the bar file of the audio, or loads it from there. */
  file?: 'save' | 'load';
};

const MIN_BPM = 20;
const MAX_BPM = 400;
/** Taps further apart than this (ms) start a new measure. */
const TAP_RESET = 2000;

/** Tempo of a source: BPM (typed, halved/doubled, tapped) and position of the first beat. */
@Component({
  selector: 'app-tempo-dialog',
  imports: [MatButtonModule, MatButtonToggleModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, MatTooltipModule, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ 'tempo.title' | t }} — {{ data.name }}</h2>
    <mat-dialog-content class="content">
      <p class="state">
        @if (data.detected && data.fromFile) {
          {{ 'tempo.fromFile' | t }}
        } @else if (data.detected; as detected) {
          {{ 'tempo.detectedValue' | t: { bpm: detected.bpm.toFixed(2), confidence: (detected.confidence * 100).toFixed(0) } }}
        } @else {
          {{ 'tempo.unknown' | t }}
        }
        @if (data.manual) {
          · {{ 'tempo.manual' | t }}
        }
      </p>

      <div class="row meter">
        <span class="label">{{ 'tempo.meter' | t }}</span>
        <mat-button-toggle-group [value]="meter()" (change)="meter.set($event.value)">
          @for (m of meters; track m.beats) {
            <mat-button-toggle [value]="m.beats">{{ m.label }}</mat-button-toggle>
          }
        </mat-button-toggle-group>
      </div>
      <div class="mark">
        <button mat-flat-button (click)="mark()">
          <mat-icon>ads_click</mat-icon>
          {{ 'tempo.mark' | t }}
        </button>
        <span class="hint">{{ 'tempo.markHint' | t: { n: meter() } }}</span>
      </div>

      <div class="mark">
        <button mat-stroked-button [disabled]="!data.tempo || data.tracking" (click)="track()">
          <mat-icon>timeline</mat-icon>
          {{ 'tempo.track' | t }}
        </button>
        <span class="hint">
          @if (data.tracking) {
            {{ 'tempo.tracking' | t }}
          } @else if (variable()) {
            {{ 'tempo.mapState' | t: { n: anchors(), manual: manualAnchors(), bpm: meanBpm().toFixed(2) } }}
          } @else {
            {{ 'tempo.trackHint' | t }}
          }
        </span>
      </div>
      @if (anchors()) {
        <div class="anchors">
          <button mat-button (click)="clear('all')" [matTooltip]="'tempo.clearHint' | t">
            <mat-icon>restart_alt</mat-icon>
            {{ 'tempo.clear' | t }}
          </button>
          @if (autoAnchors() && manualAnchors()) {
            <button mat-button (click)="clear('auto')" [matTooltip]="'tempo.clearAutoHint' | t">
              <mat-icon>auto_fix_off</mat-icon>
              {{ 'tempo.clearAuto' | t }}
            </button>
          }
          @if (variable()) {
            <button mat-button (click)="steady()" [matTooltip]="'tempo.steadyHint' | t">
              <mat-icon>straighten</mat-icon>
              {{ 'tempo.steady' | t }}
            </button>
          }
        </div>
      }

      <div class="anchors">
        <button mat-stroked-button [disabled]="!data.tempo" (click)="file('save')" [matTooltip]="'bars.saveHint' | t">
          <mat-icon>save</mat-icon>
          {{ 'bars.save' | t }}
        </button>
        <button mat-stroked-button (click)="file('load')" [matTooltip]="'bars.loadHint' | t">
          <mat-icon>file_open</mat-icon>
          {{ 'bars.load' | t }}
        </button>
      </div>

      <div class="row">
        <mat-form-field class="bpm">
          <mat-label>BPM</mat-label>
          <input matInput type="number" step="0.01" [min]="minBpm" [max]="maxBpm" [value]="bpm().toFixed(2)" (change)="setBpm(+$any($event.target).value)" />
        </mat-form-field>
        <button mat-stroked-button (click)="setBpm(bpm() / 2)" [matTooltip]="'tempo.half' | t">÷2</button>
        <button mat-stroked-button (click)="setBpm(bpm() * 2)" [matTooltip]="'tempo.double' | t">×2</button>
        <button mat-flat-button class="tap" (click)="tap()" [matTooltip]="'tempo.tapHint' | t">
          <mat-icon>touch_app</mat-icon>
          Tap{{ taps() > 1 ? ' (' + taps() + ')' : '' }}
        </button>
      </div>
      @if (data.rate !== 1) {
        <p class="hint">{{ 'tempo.heard' | t: { bpm: (bpm() * data.rate).toFixed(2), rate: data.rate } }}</p>
      }

      <div class="row">
        <mat-form-field class="offset">
          <mat-label>{{ 'tempo.firstBeat' | t }}</mat-label>
          <input matInput type="number" step="0.001" min="0" [value]="offset().toFixed(3)" (change)="setOffset(+$any($event.target).value)" />
          <span matTextSuffix>s</span>
        </mat-form-field>
        <button mat-stroked-button (click)="nudge(-1)" [matTooltip]="'tempo.prevBeat' | t"><mat-icon>chevron_left</mat-icon></button>
        <button mat-stroked-button (click)="nudge(1)" [matTooltip]="'tempo.nextBeat' | t"><mat-icon>chevron_right</mat-icon></button>
        <button mat-stroked-button [disabled]="data.playheadSourceTime === null" (click)="atPlayhead()" [matTooltip]="'tempo.atPlayheadHint' | t">
          <mat-icon>vertical_align_center</mat-icon>
          {{ 'tempo.atPlayhead' | t }}
        </button>
      </div>
      <p class="hint">{{ 'tempo.beatLength' | t: { ms: (60000 / bpm()).toFixed(1), bar: ((60 * meter()) / bpm()).toFixed(3), n: meter() } }}</p>
    </mat-dialog-content>
    <mat-dialog-actions>
      <button mat-button [disabled]="!data.manual" (click)="useDetected()">
        <mat-icon>auto_fix_high</mat-icon>
        {{ 'tempo.useDetected' | t }}
      </button>
      <span class="spacer"></span>
      <button mat-button mat-dialog-close>{{ 'common.cancel' | t }}</button>
      <button mat-flat-button (click)="apply()">{{ 'timing.apply' | t }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    .content {
      width: min(680px, 85vw);
    }
    .state,
    .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      margin: 0 0 12px;
    }
    .row {
      display: flex;
      align-items: baseline;
      flex-wrap: wrap;
      gap: 8px;
    }
    // buttons never squeeze their label (any language): a row that does not fit wraps
    .row button {
      flex: 0 0 auto;
      white-space: nowrap;
    }
    .bpm,
    .offset {
      width: 150px;
    }
    .tap {
      min-width: 110px;
    }
    .meter {
      align-items: center;
      margin-bottom: 12px;
    }
    .label {
      min-width: 60px;
    }
    .mark {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
      // the button keeps its text on one line; the hint takes the remaining space
      button {
        flex: 0 0 auto;
        white-space: nowrap;
      }
      .hint {
        flex: 1 1 auto;
        min-width: 0;
        margin: 0;
      }
    }
    .anchors {
      display: flex;
      flex-wrap: wrap;
      gap: 8px;
      margin: -8px 0 16px;
      button {
        flex: 0 0 auto;
        white-space: nowrap;
      }
    }
    .spacer {
      flex: 1 1 auto;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '(keydown.t)': 'tap()' },
})
export class TempoDialogComponent {
  protected readonly data = inject<TempoDialogData>(MAT_DIALOG_DATA);
  private readonly dialog = inject(MatDialogRef<TempoDialogComponent, TempoDialogResult>);

  protected readonly minBpm = MIN_BPM;
  protected readonly maxBpm = MAX_BPM;
  protected readonly bpm = signal(this.data.tempo?.bpm ?? 120);
  protected readonly offset = signal(this.data.tempo?.offset ?? 0);
  protected readonly meters = [
    { beats: 2, label: '2/4' },
    { beats: 3, label: '3/4' },
    { beats: 4, label: '4/4' },
    { beats: 6, label: '6/8' },
  ];
  protected readonly meter = signal(this.data.tempo?.beatsPerBar ?? 4);
  /** Bar map of the tempo: anchors in all and set by hand. */
  protected readonly anchors = signal(this.data.tempo?.anchors?.length ?? 0);
  protected readonly manualAnchors = signal(this.data.tempo?.anchors?.filter((a) => !a.auto).length ?? 0);
  protected readonly autoAnchors = computed(() => this.anchors() - this.manualAnchors());
  protected readonly variable = signal(!!this.data.tempo && isVariable(this.data.tempo));
  protected readonly meanBpm = signal(this.data.tempo ? meanBpm(this.data.tempo) : 0);

  private tapTimes: number[] = [];
  protected readonly taps = signal(0);
  private readonly beat = computed(() => 60 / this.bpm());

  protected setBpm(bpm: number): void {
    if (Number.isFinite(bpm) && bpm > 0) this.bpm.set(Math.round(Math.min(MAX_BPM, Math.max(MIN_BPM, bpm)) * 100) / 100);
  }

  /** Tap tempo: average interval of the last taps. */
  protected tap(): void {
    const now = performance.now();
    if (this.tapTimes.length && now - this.tapTimes[this.tapTimes.length - 1] > TAP_RESET) this.tapTimes = [];
    this.tapTimes = [...this.tapTimes.slice(-8), now];
    this.taps.set(this.tapTimes.length);
    if (this.tapTimes.length < 2) return;
    const span = this.tapTimes[this.tapTimes.length - 1] - this.tapTimes[0];
    this.setBpm((60000 * (this.tapTimes.length - 1)) / span);
  }

  protected setOffset(offset: number): void {
    if (Number.isFinite(offset) && offset >= 0) this.offset.set(Math.round(offset * 1000) / 1000);
  }

  /** Moves the first beat by one beat (the bars shift accordingly). */
  protected nudge(beats: number): void {
    this.setOffset(Math.max(0, this.offset() + beats * this.beat()));
  }

  /** The beat under the playhead becomes the first beat of a bar. */
  protected atPlayhead(): void {
    const time = this.data.playheadSourceTime;
    if (time === null) return;
    // earliest beat of the grid through that time, keeping the bars aligned to it
    const bar = this.meter() * this.beat();
    this.setOffset(((time % bar) + bar) % bar);
  }

  protected useDetected(): void {
    this.dialog.close({ tempo: null });
  }

  /** Closes to let the user click the beats 1, 2, … on the waveform of the clip. */
  protected mark(): void {
    this.dialog.close({ tempo: null, mark: { beatsPerBar: this.meter(), bpm: this.bpm() } });
  }

  /** Closes to follow the bars along the whole source. */
  protected track(): void {
    this.dialog.close({ tempo: null, track: true });
  }

  protected file(action: 'save' | 'load'): void {
    this.dialog.close({ tempo: null, file: action });
  }

  protected clear(which: 'all' | 'auto'): void {
    this.dialog.close({ tempo: null, clear: which });
  }

  protected steady(): void {
    this.dialog.close({ tempo: null, steady: true });
  }

  protected apply(): void {
    const tempo = this.data.tempo;
    // nothing changed: the bar map stays; otherwise the tempo becomes steady
    if (tempo && this.data.manual && tempo.bpm === this.bpm() && tempo.offset === this.offset() && (tempo.beatsPerBar ?? 4) === this.meter()) {
      return this.dialog.close();
    }
    this.dialog.close({ tempo: { bpm: this.bpm(), offset: this.offset(), confidence: 1, beatsPerBar: this.meter() } });
  }
}
