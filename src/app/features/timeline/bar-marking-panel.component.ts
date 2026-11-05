import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { BarDoubt } from '../../core/audio/bar-doubts';
import { meterName } from '../../core/audio/tempo';
import { TempoService } from '../../core/audio/tempo.service';
import { EditService } from '../../core/edit.service';
import { I18nService } from '../../core/i18n/i18n.service';
import type { TranslationKey } from '../../core/i18n/it';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { TimelineService } from '../../core/timeline/timeline.service';

/**
 * Side panel of the marking of the 1s: what to mark, and the doubts the bar tracking left, each
 * one shown on the waveform with a click and settled with the readings it offers.
 */
@Component({
  selector: 'app-bar-marking-panel',
  imports: [MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule, TranslatePipe],
  template: `
    <header class="head">
      <mat-icon class="mark-icon">ads_click</mat-icon>
      <span class="name">{{ 'tempo.mark' | t }}</span>
      <button mat-icon-button class="small" (click)="edits.cancelBeatMarking()" [matTooltip]="'tempo.markClose' | t">
        <mat-icon>close</mat-icon>
      </button>
    </header>
    @if (edits.trackingSource()) {
      <mat-progress-bar mode="indeterminate" />
    }
    <div class="scroll">
      <section class="help">
        <p>{{ 'tempo.markWhat' | t }}</p>
        <ul>
          <li>{{ 'tempo.markWhereStart' | t }}</li>
          <li>{{ 'tempo.markWhereIntro' | t }}</li>
          <li>{{ 'tempo.markWhereChange' | t }}</li>
        </ul>
        <p class="hint">{{ 'tempo.markPrecision' | t }}</p>
        <p class="hint">{{ 'tempo.markGestures' | t }}</p>
      </section>

      <section class="doubts">
        <h3>{{ 'tempo.doubts' | t }}</h3>
        @if (!report()) {
          <p class="hint">{{ 'tempo.doubtsNone' | t }}</p>
        } @else {
          <p class="hint">{{ 'tempo.reportTitle' | t: { confidence: confidence() } }}</p>
          @for (item of items(); track item.key) {
            <div class="doubt" [class.active]="active() === item.key">
              <button class="doubt-text" [disabled]="!item.focusable" (click)="focus(item)">
                <mat-icon>{{ item.icon }}</mat-icon>
                <span>{{ item.text }}</span>
              </button>
              <div class="doubt-actions">
                @for (action of item.actions; track action.label) {
                  <button mat-stroked-button class="dense" [disabled]="!!edits.trackingSource()" (click)="action.run()">{{ action.label }}</button>
                }
              </div>
            </div>
          } @empty {
            <p class="hint">{{ 'tempo.doubtsDone' | t }}</p>
          }
        }
      </section>
    </div>
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      flex: 0 0 330px;
      width: 330px;
      min-height: 0;
      background: var(--mat-sys-surface-container-low);
      border-left: 1px solid var(--mat-sys-outline-variant);
    }
    .head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 4px 4px 12px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .mark-icon {
      color: var(--mat-sys-tertiary);
    }
    .name {
      flex: 1 1 auto;
      font: var(--mat-sys-title-small);
    }
    .small {
      --mat-icon-button-state-layer-size: 28px;
      --mat-icon-button-icon-size: 18px;
      --mat-icon-button-icon-color: var(--mat-sys-on-surface-variant);
    }
    .scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 8px 12px 12px;
    }
    p,
    ul {
      margin: 0 0 8px;
      font: var(--mat-sys-body-medium);
    }
    ul {
      padding-left: 20px;
    }
    .hint {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
    }
    h3 {
      margin: 12px 0 4px;
      font: var(--mat-sys-title-small);
    }
    .doubt {
      display: flex;
      flex-direction: column;
      gap: 4px;
      padding: 4px 0 8px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .doubt-text {
      display: flex;
      align-items: flex-start;
      gap: 6px;
      padding: 4px;
      border: none;
      border-radius: 4px;
      background: none;
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-body-medium);
      text-align: left;
      cursor: pointer;
      &:hover:not(:disabled) {
        background: var(--mat-sys-surface-container-high);
      }
      &:disabled {
        cursor: default;
      }
      mat-icon {
        flex: none;
        color: var(--mat-sys-tertiary);
      }
    }
    .doubt.active .doubt-text {
      background: var(--mat-sys-secondary-container);
      color: var(--mat-sys-on-secondary-container);
    }
    .doubt-actions {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      padding-left: 34px;
    }
    .dense {
      --mat-button-outlined-container-height: 28px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BarMarkingPanelComponent {
  protected readonly edits = inject(EditService);
  private readonly timeline = inject(TimelineService);
  private readonly tempos = inject(TempoService);
  private readonly i18n = inject(I18nService);

  /** Doubt shown last on the waveform. */
  protected readonly active = signal<string | null>(null);

  protected readonly report = computed(() => {
    const marking = this.timeline.beatMarking();
    return marking ? (this.tempos.reports()[marking.sourceId] ?? null) : null;
  });
  protected readonly confidence = computed(() => ((this.report()?.confidence ?? 0) * 100).toFixed(0));

  /** One line per doubt, with the readings that settle it. */
  protected readonly items = computed(() => this.edits.barDoubts().map((doubt) => this.item(doubt)));

  private item(doubt: BarDoubt) {
    const t = (key: TranslationKey, params?: Record<string, string | number>) => this.i18n.t(key, params);
    const bars = (from: number, to: number) => t('tempo.regionBars', { from: from + 1, to: to + 1 });
    switch (doubt.kind) {
      case 'meter':
        return {
          doubt,
          key: `meter-${doubt.bar}`,
          icon: 'straighten',
          focusable: true,
          text: t('tempo.doubtMeter', { bar: doubt.bar + 1, meter: meterName(doubt.meter), usual: meterName(doubt.usual) }),
          actions: [
            { label: t('tempo.doubtKeep'), run: () => this.edits.keepBar(doubt.bar) },
            { label: t('tempo.doubtMeterTo', { meter: meterName(doubt.usual) }), run: () => this.edits.setBarMeter(doubt.bar, doubt.usual) },
          ],
        };
      case 'uncertain':
        return {
          doubt,
          key: `uncertain-${doubt.bar}`,
          icon: 'help',
          focusable: true,
          text: t('tempo.doubtUncertain', { bar: doubt.bar + 1 }),
          actions: [{ label: t('tempo.doubtKeepOne'), run: () => this.edits.keepBar(doubt.bar, false) }],
        };
      case 'downbeat':
        return { doubt, key: `downbeat-${doubt.from}`, icon: 'swap_horiz', focusable: true, text: `${bars(doubt.from, doubt.to)} · ${t('tempo.doubtDownbeat')}`, actions: [] };
      case 'meterAlt':
        return {
          doubt,
          key: `meterAlt-${doubt.from}`,
          icon: 'straighten',
          focusable: true,
          text: `${bars(doubt.from, doubt.to)} · ${t('tempo.regionMeterAlt', { meter: meterName(doubt.meter) })}`,
          actions: [{ label: t('tempo.retryMeter', { meter: meterName(doubt.meter) }), run: () => this.edits.retryBars({ meter: doubt.meter }) }],
        };
      case 'bpmAlt':
        return {
          doubt,
          key: `bpm-${doubt.bpm}`,
          icon: 'speed',
          focusable: false,
          text: t('tempo.doubtBpm', { bpm: doubt.bpm.toFixed(0) }),
          actions: [{ label: t('tempo.retryBpm', { bpm: doubt.bpm.toFixed(0) }), run: () => this.edits.retryBars({ bpm: doubt.bpm }) }],
        };
    }
  }

  protected focus(item: { key: string; doubt: BarDoubt }): void {
    this.active.set(item.key);
    this.edits.focusDoubt(item.doubt);
  }
}
