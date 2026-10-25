import { CdkDrag, CdkDragDrop, CdkDragHandle, CdkDropList } from '@angular/cdk/drag-drop';
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDividerModule } from '@angular/material/divider';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PlaybackService } from '../../core/audio/playback.service';
import { EditService } from '../../core/edit.service';
import {
  EFFECTS,
  EffectDescriptor,
  EffectParam,
  NumberParam,
  TrackEffect,
  effectDescriptor,
  formatParam,
  paramValue,
  roundParam,
} from '../../core/effects/effects';
import { effectColor } from '../../core/effects/effect-colors';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ThemeColorsService } from '../../core/theme-colors.service';
import { MontageService } from '../../core/montage/montage.service';
import { TimelineService } from '../../core/timeline/timeline.service';
import { FaderComponent } from '../../shared/controls/fader.component';
import { KnobComponent } from '../../shared/controls/knob.component';
import { MeterComponent } from '../../shared/controls/meter.component';
import { PowerToggleComponent } from '../../shared/controls/power-toggle.component';
import { SelectorComponent } from '../../shared/controls/selector.component';
import { CompressorGraphComponent } from './compressor-graph.component';

/** Gain reduction shown full scale by the meter (dB). */
const METER_RANGE = 20;

/** Format and rounding of a number parameter, created once (stable inputs for the controls). */
interface ParamTools {
  format: (value: number) => string;
  round: (value: number) => number;
  /** Where the lit ring starts: 0 for the parameters that go both ways (e.g. ±15 dB). */
  origin?: number;
}

/**
 * Side panel of the effects of the selected track: the chain in order (drag to reorder), each
 * effect with its switch, presets and controls built from its descriptor, and the list of the
 * effects to add. Values change live while playing; a whole gesture on a control is one undo step.
 */
@Component({
  selector: 'app-effects-panel',
  imports: [
    NgTemplateOutlet,
    CdkDropList,
    CdkDrag,
    CdkDragHandle,
    MatButtonModule,
    MatDividerModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    TranslatePipe,
    KnobComponent,
    FaderComponent,
    SelectorComponent,
    PowerToggleComponent,
    MeterComponent,
    CompressorGraphComponent,
  ],
  template: `
    @if (track(); as track) {
      <header class="head">
        <mat-icon class="head-icon">tune</mat-icon>
        <div class="titles">
          <span class="title">{{ 'fx.title' | t }}</span>
          <span class="track">{{ track.name }}</span>
        </div>
        <button mat-icon-button class="small" (click)="close()" [matTooltip]="'fx.close' | t">
          <mat-icon>close</mat-icon>
        </button>
      </header>
      <div class="body">
        @if (!track.effects?.length) {
          <p class="empty">{{ 'fx.empty' | t }}</p>
        }
        <div class="chain" cdkDropList (cdkDropListDropped)="drop($event)">
          @for (fx of track.effects ?? []; track fx.id) {
            @let descriptor = descriptorOf(fx);
            <section class="card" cdkDrag cdkDragLockAxis="y" [class.bypassed]="fx.bypass">
              <div class="card-head">
                <app-power-toggle [on]="!fx.bypass" [label]="'fx.bypass' | t" (toggled)="edits.setEffectBypass(track.id, fx.id, !$event)" />
                <span class="mark" [style.background]="colorOf(fx)"></span>
                <span class="name">{{ descriptor.label | t }}</span>
                <button mat-icon-button class="small" [matMenuTriggerFor]="presets" [matTooltip]="'fx.presets' | t">
                  <mat-icon>auto_awesome</mat-icon>
                </button>
                <mat-menu #presets="matMenu">
                  @for (preset of descriptor.presets; track preset.name) {
                    <button mat-menu-item (click)="edits.applyEffectPreset(track.id, fx.id, preset)">{{ preset.name | t }}</button>
                  }
                  <mat-divider />
                  <button mat-menu-item (click)="edits.applyEffectPreset(track.id, fx.id, null)">{{ 'fx.defaults' | t }}</button>
                </mat-menu>
                <mat-icon class="handle" cdkDragHandle [matTooltip]="'fx.move' | t">drag_indicator</mat-icon>
                <button mat-icon-button class="small" (click)="edits.removeEffect(track.id, fx.id)" [matTooltip]="'fx.remove' | t">
                  <mat-icon>close</mat-icon>
                </button>
              </div>
              @if (descriptor.graph) {
                <!-- graph and meter side by side, the faders under the meter: a compact front -->
                <div class="graph-layout">
                  <app-compressor-graph class="graph" [effect]="fx" [label]="'fx.compressorGraph' | t" />
                  <div class="side">
                    <ng-container *ngTemplateOutlet="meter; context: { $implicit: fx, track: track, descriptor: descriptor }" />
                  </div>
                  <div class="params">
                    @for (param of mainParams(descriptor); track param.id) {
                      <ng-container *ngTemplateOutlet="control; context: { $implicit: param, fx: fx, track: track }" />
                    }
                  </div>
                  <div class="side">
                    @for (param of sideParams(descriptor); track param.id) {
                      <ng-container *ngTemplateOutlet="control; context: { $implicit: param, fx: fx, track: track }" />
                    }
                  </div>
                </div>
              } @else {
                <!-- the choices on a row of their own, centred above the knobs -->
                @if (choiceParams(descriptor).length) {
                  <div class="choices">
                    @for (param of choiceParams(descriptor); track param.id) {
                      <ng-container *ngTemplateOutlet="control; context: { $implicit: param, fx: fx, track: track }" />
                    }
                  </div>
                }
                <div class="params">
                  @for (param of valueParams(descriptor); track param.id) {
                    <ng-container *ngTemplateOutlet="control; context: { $implicit: param, fx: fx, track: track }" />
                  }
                  <ng-container *ngTemplateOutlet="meter; context: { $implicit: fx, track: track, descriptor: descriptor }" />
                </div>
              }
            </section>
          }
        </div>
        <button mat-stroked-button class="add" [matMenuTriggerFor]="add">
          <mat-icon>add</mat-icon>
          {{ 'fx.add' | t }}
        </button>
        <mat-menu #add="matMenu">
          @for (descriptor of catalog; track descriptor.type) {
            <button mat-menu-item (click)="edits.addEffect(track.id, descriptor.type)">{{ descriptor.label | t }}</button>
          }
        </mat-menu>
        <p class="hint">{{ 'fx.hint' | t }}</p>
      </div>
      <ng-template #control let-param let-fx="fx" let-track="track">
        @if (param.kind === 'choice') {
          <app-selector
            [label]="param.label | t"
            [options]="param.options"
            [value]="choiceValue(fx, param)"
            (changed)="edits.commitEffectParam(track.id, fx.id, param.id, $event)"
          />
        } @else if (param.fader) {
          <app-fader
            [label]="param.label | t"
            [min]="param.min"
            [max]="param.max"
            [log]="!!param.log"
            [default]="param.default"
            [format]="tools(param).format"
            [round]="tools(param).round"
            [value]="numberValue(fx, param)"
            (valueChange)="edits.previewEffectParam(track.id, fx.id, param.id, $event)"
            (committed)="edits.commitEffectParam(track.id, fx.id, param.id, $event)"
          />
        } @else {
          <app-knob
            [label]="param.label | t"
            [min]="param.min"
            [max]="param.max"
            [log]="!!param.log"
            [default]="param.default"
            [origin]="tools(param).origin"
            [format]="tools(param).format"
            [round]="tools(param).round"
            [value]="numberValue(fx, param)"
            (valueChange)="edits.previewEffectParam(track.id, fx.id, param.id, $event)"
            (committed)="edits.commitEffectParam(track.id, fx.id, param.id, $event)"
          />
        }
      </ng-template>
      <ng-template #meter let-fx let-track="track" let-descriptor="descriptor">
        @if (descriptor.meter === 'reduction') {
          @let reduction = reductionOf(track.id, fx.id);
          <app-meter [label]="'fx.reduction' | t" [level]="-reduction / meterRange" [text]="reduction.toFixed(1) + ' dB'" />
        }
      </ng-template>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      /* fixed: five controls fit in a row */
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
      padding: 8px 8px 8px 12px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .head-icon {
      color: var(--mat-sys-primary);
    }
    .titles {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-width: 0;
    }
    .title {
      font: var(--mat-sys-title-small);
    }
    .track {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .body {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
      padding: 8px;
    }
    .empty,
    .hint {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
      margin: 4px 4px 12px;
    }
    .hint {
      margin-top: 12px;
    }
    .card {
      background: var(--mat-sys-surface-container);
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: var(--mat-sys-corner-small);
      margin-bottom: 8px;
    }
    .card.bypassed .params,
    .card.bypassed .side,
    .card.bypassed .graph {
      opacity: 0.45;
    }
    .card-head {
      display: flex;
      align-items: center;
      gap: 2px;
      padding: 2px 2px 2px 4px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }
    .mark {
      width: 10px;
      height: 10px;
      border-radius: 3px;
      margin: 0 4px 0 2px;
      flex: none;
    }
    .name {
      flex: 1 1 auto;
      font: var(--mat-sys-label-large);
    }
    .handle {
      cursor: grab;
      color: var(--mat-sys-on-surface-variant);
      font-size: 20px;
      width: 20px;
      height: 20px;
    }
    .params {
      display: flex;
      flex-wrap: wrap;
      justify-content: space-around;
      align-items: flex-end;
      gap: 4px 0;
      padding: 8px 2px 6px;
    }
    .choices {
      display: flex;
      justify-content: center;
      gap: 12px;
      padding: 10px 4px 0;
    }
    .card.bypassed .choices {
      opacity: 0.45;
    }
    .graph-layout {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 56px;
      align-items: center;
      padding: 8px 4px 6px 0;
      .params {
        padding: 8px 0 0;
      }
    }
    .graph {
      padding: 0 4px 0 10px;
    }
    .side {
      display: flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      padding-top: 8px;
    }
    .add {
      width: 100%;
    }
    .small {
      --mat-icon-button-state-layer-size: 28px;
      --mat-icon-button-icon-size: 18px;
      --mat-icon-button-icon-color: var(--mat-sys-on-surface-variant);
    }
    .cdk-drag-preview {
      box-shadow: var(--mat-sys-level3);
    }
    .cdk-drag-placeholder {
      opacity: 0.3;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EffectsPanelComponent {
  protected readonly edits = inject(EditService);
  private readonly montages = inject(MontageService);
  private readonly timeline = inject(TimelineService);
  private readonly playback = inject(PlaybackService);
  private readonly theme = inject(ThemeColorsService);

  protected readonly catalog = EFFECTS;
  protected readonly meterRange = METER_RANGE;

  /** The selected track, null when the panel is closed (or the track was removed). */
  protected readonly track = computed(() => {
    const id = this.timeline.selectedTrackId();
    return this.montages.montage().tracks.find((t) => t.id === id) ?? null;
  });

  /** Animation frame counter while a meter has something to show (redraws the meters). */
  private readonly frame = signal(0);
  private readonly toolsCache = new WeakMap<NumberParam, ParamTools>();

  constructor() {
    let handle = 0;
    const loop = () => {
      this.frame.update((f) => f + 1);
      handle = requestAnimationFrame(loop);
    };
    effect(() => {
      const metered = this.playback.playing() && !!this.track()?.effects?.some((e) => effectDescriptor(e.type).meter);
      cancelAnimationFrame(handle);
      if (metered) handle = requestAnimationFrame(loop);
      else this.frame.update((f) => f + 1);
    });
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(handle));
  }

  /** Color of the effect type, as in the chain of the track header. */
  protected colorOf(effect: TrackEffect): string {
    return effectColor(effect.type, this.theme.colors().dark).fill;
  }

  protected descriptorOf(effect: TrackEffect): EffectDescriptor {
    return effectDescriptor(effect.type);
  }

  protected numberValue(effect: TrackEffect, param: EffectParam): number {
    return Number(paramValue(effect, param));
  }

  protected choiceValue(effect: TrackEffect, param: EffectParam): string {
    return String(paramValue(effect, param));
  }

  /** Choices among fixed values (e.g. the division of an echo): shown on their own row. */
  protected choiceParams(descriptor: EffectDescriptor): readonly EffectParam[] {
    return descriptor.params.filter((p) => p.kind === 'choice');
  }

  /** Knobs and faders. */
  protected valueParams(descriptor: EffectDescriptor): readonly EffectParam[] {
    return descriptor.params.filter((p) => p.kind !== 'choice');
  }

  /** Controls of the main area of a front with a graph: all but the faders. */
  protected mainParams(descriptor: EffectDescriptor): readonly EffectParam[] {
    return descriptor.params.filter((p) => !(p.kind === 'number' && p.fader));
  }

  /** Faders of a front with a graph: in the side column, under the meter. */
  protected sideParams(descriptor: EffectDescriptor): readonly EffectParam[] {
    return descriptor.params.filter((p) => p.kind === 'number' && p.fader);
  }

  protected tools(param: NumberParam): ParamTools {
    let tools = this.toolsCache.get(param);
    if (!tools) {
      tools = {
        format: (v) => formatParam(param, v),
        round: (v) => roundParam(param, v),
        origin: param.min < 0 && param.max > 0 ? 0 : undefined,
      };
      this.toolsCache.set(param, tools);
    }
    return tools;
  }

  protected reductionOf(trackId: string, effectId: string): number {
    this.frame();
    return this.playback.reduction(trackId, effectId);
  }

  protected drop(event: CdkDragDrop<unknown>): void {
    const track = this.track();
    const effect = track?.effects?.[event.previousIndex];
    if (track && effect && event.previousIndex !== event.currentIndex) this.edits.moveEffect(track.id, effect.id, event.currentIndex);
  }

  protected close(): void {
    this.timeline.selectedTrackId.set(null);
  }
}
