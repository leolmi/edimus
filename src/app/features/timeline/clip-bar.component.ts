import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ProcessedAudioService } from '../../core/audio/processed-audio.service';
import { TempoService } from '../../core/audio/tempo.service';
import { EditService } from '../../core/edit.service';
import { formatDuration } from '../../core/format';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { clipRate } from '../../core/montage/montage.model';
import { MontageService } from '../../core/montage/montage.service';
import { TimelineService } from '../../core/timeline/timeline.service';

/** Properties of the selected clip: speed and pitch. */
@Component({
  selector: 'app-clip-bar',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, TranslatePipe],
  template: `
    @if (marking(); as m) {
      <mat-icon class="marking-icon">ads_click</mat-icon>
      <span class="marking">
        @if (m.downbeat === null) {
          {{ 'tempo.markNext' | t }}
        } @else {
          {{ 'tempo.markDone' | t: { bpm: m.bpm.toFixed(2) } }}
        }
      </span>
      <span class="spacer"></span>
      <button mat-button [disabled]="m.downbeat === null" (click)="edits.undoBeatMark()">{{ 'tempo.markUndo' | t }}</button>
      <button mat-button (click)="edits.cancelBeatMarking()">{{ 'common.cancel' | t }}</button>
      <button mat-flat-button [disabled]="m.downbeat === null" (click)="edits.confirmBeatMarking()">{{ 'tempo.markConfirm' | t }}</button>
    } @else if (selection(); as sel) {
      <span class="name">{{ sel.track.name }}</span>
      <span class="length">{{ length() }}</span>
      <button mat-stroked-button (click)="edits.editTempo(sel.clip.id)" [matTooltip]="'tempo.clipHint' | t">
        <mat-icon>music_note</mat-icon>
        {{ bpm() ? bpm() + ' BPM' : ('tempo.title' | t) }}
      </button>

      <button mat-stroked-button (click)="edits.editTiming(sel.clip.id)">
        <mat-icon>speed</mat-icon>
        {{ 'timing.title' | t }}
      </button>
      <span class="value" [class.changed]="sel.rate !== 1 || sel.pitch !== 0">
        {{ speedLabel(sel.rate) }} · {{ pitchLabel(sel.pitch) }}
      </span>

      @if (rendering(); as progress) {
        <span class="rendering">{{ 'clip.rendering' | t: { p: progress } }}</span>
      }
    } @else if (count() > 1) {
      <span class="name">{{ 'clip.many' | t: { n: count() } }}</span>
      <span class="placeholder">{{ 'clip.manyHint' | t }}</span>
    } @else {
      <span class="placeholder">{{ 'clip.none' | t }}</span>
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 0 12px;
      min-height: 44px;
      background: var(--mat-sys-surface-container-low);
      border-top: 1px solid var(--mat-sys-outline-variant);
      flex: 0 0 44px;
      height: 44px;
      box-sizing: border-box;
      font: var(--mat-sys-body-medium);
    }
    .name {
      font: var(--mat-sys-title-small);
    }
    .length,
    .value {
      color: var(--mat-sys-on-surface-variant);
      font-variant-numeric: tabular-nums;
    }
    .length {
      margin-right: 8px;
    }
    .value {
      min-width: 56px;
    }
    .label {
      margin-left: 8px;
    }
    .changed {
      color: var(--mat-sys-primary);
    }
    .marking,
    .marking-icon {
      color: var(--mat-sys-tertiary);
    }
    .spacer {
      flex: 1 1 auto;
    }
    .placeholder {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .rendering {
      color: var(--mat-sys-tertiary);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ClipBarComponent {
  protected readonly edits = inject(EditService);
  private readonly montages = inject(MontageService);
  private readonly timeline = inject(TimelineService);
  private readonly processed = inject(ProcessedAudioService);
  private readonly tempos = inject(TempoService);

  protected readonly selection = computed(() => {
    const id = this.timeline.selectedClipId();
    for (const track of this.montages.montage().tracks) {
      const clip = track.clips.find((c) => c.id === id);
      if (clip) return { track, clip, rate: clipRate(clip), pitch: clip.pitch ?? 0 };
    }
    return null;
  });

  protected readonly count = computed(() => this.timeline.selectedClipIds().length);

  protected readonly length = computed(() => {
    const sel = this.selection();
    return sel ? formatDuration(this.timeline.clipLength(sel.clip)) : '';
  });

  protected readonly marking = this.timeline.beatMarking;

  /** Tempo heard in the selected clip (source tempo × speed). */
  protected readonly bpm = computed(() => {
    const sel = this.selection();
    const bpm = sel ? this.tempos.clipBpm(sel.clip) : null;
    return bpm ? bpm.toFixed(1) : null;
  });

  /** Render progress (%) of the selected clip, null when not rendering. */
  protected readonly rendering = computed(() => {
    const sel = this.selection();
    const state = sel ? this.processed.state(sel.clip) : undefined;
    return state?.status === 'rendering' ? Math.round(state.progress * 100) : null;
  });

  protected readonly speedLabel = (rate: number) => `${rate.toFixed(2)}×`;
  protected readonly pitchLabel = (pitch: number) => `${pitch > 0 ? '+' : ''}${pitch} st`;

}
