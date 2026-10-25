import { ChangeDetectionStrategy, Component, booleanAttribute, computed, input, output } from '@angular/core';
import { ControlScale, fromPosition, keyPosition, toPosition } from './control-scale';

/** Pause after the last wheel or key step before it counts as done (one undo step). */
const SETTLE = 500;

/**
 * Vertical fader for levels: drag the thumb or click along the rail, wheel, arrows/PageUp/
 * PageDown/Home/End, double click back to the default. Same events as the knob. `slim`: as tall
 * as its container, no label (e.g. the track volume in the track header). Optional scale: ticks
 * at `marks` and the `origin` across the rail.
 */
@Component({
  selector: 'app-fader',
  host: { '[class.slim]': 'slim()' },
  template: `
    <div
      class="rail"
      role="slider"
      tabindex="0"
      aria-orientation="vertical"
      [attr.aria-label]="label()"
      [attr.aria-valuemin]="min()"
      [attr.aria-valuemax]="max()"
      [attr.aria-valuenow]="value()"
      [attr.aria-valuetext]="text()"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event)"
      (pointercancel)="onPointerUp($event)"
      (wheel)="onWheel($event)"
      (keydown)="onKey($event)"
      (dblclick)="reset()"
    >
      @for (mark of markPositions(); track mark) {
        <div class="mark" [style.bottom.%]="mark * 100"></div>
      }
      @if (originPosition() !== null) {
        <div class="mark origin" [style.bottom.%]="originPosition()! * 100"></div>
      }
      <div class="groove"></div>
      <div class="lit" [style.height.%]="position() * 100"></div>
      <div class="thumb" [style.bottom.%]="position() * 100"></div>
    </div>
    <span class="value">{{ text() }}</span>
    @if (!slim()) {
      <span class="label">{{ label() }}</span>
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 1px;
      width: 56px;
      user-select: none;
    }
    .rail {
      position: relative;
      width: 24px;
      height: 56px;
      margin: 4px 0;
      cursor: ns-resize;
      touch-action: none;
      outline: none;
      border-radius: 4px;
      &:focus-visible {
        box-shadow: 0 0 0 2px var(--mat-sys-primary);
      }
    }
    .groove,
    .lit {
      position: absolute;
      left: 50%;
      width: 4px;
      margin-left: -2px;
      bottom: 0;
      border-radius: 2px;
    }
    .groove {
      top: 0;
      background: var(--mat-sys-outline);
    }
    /* scale: short ticks on both sides of the groove, the origin (e.g. 0 dB) across it */
    .mark {
      position: absolute;
      left: 3px;
      right: 3px;
      height: 1px;
      margin-bottom: -0.5px;
      background: linear-gradient(to right, var(--mat-sys-on-surface-variant) 30%, transparent 30% 70%, var(--mat-sys-on-surface-variant) 70%);
      /* wider than the thumb: visible also when the value is on it */
      &.origin {
        left: -5px;
        right: -5px;
        height: 2px;
        margin-bottom: -1px;
        background: var(--mat-sys-on-surface);
      }
    }
    .lit {
      background: var(--mat-sys-primary);
    }
    .thumb {
      position: absolute;
      left: 2px;
      right: 2px;
      height: 8px;
      margin-bottom: -4px;
      border-radius: 2px;
      background: var(--mat-sys-surface-container-highest);
      border: 1px solid var(--mat-sys-outline);
    }
    :host(.slim) {
      width: 40px;
      height: 100%;
      .rail {
        flex: 1 1 auto;
        height: auto;
        min-height: 40px;
      }
    }
    .value {
      font: var(--mat-sys-label-small);
      font-variant-numeric: tabular-nums;
      color: var(--mat-sys-on-surface);
      white-space: nowrap;
    }
    .label {
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FaderComponent {
  readonly value = input.required<number>();
  readonly min = input.required<number>();
  readonly max = input.required<number>();
  readonly log = input(false);
  readonly default = input<number>();
  readonly label = input('');
  readonly slim = input(false, { transform: booleanAttribute });
  /** Values marked on the scale. */
  readonly marks = input<readonly number[]>([]);
  /** Neutral value marked across the rail (e.g. 0 dB). */
  readonly origin = input<number>();
  readonly format = input<(value: number) => string>((v) => String(v));
  readonly round = input<(value: number) => number>((v) => v);

  readonly valueChange = output<number>();
  readonly committed = output<number>();

  private readonly scale = computed<ControlScale>(() => ({ min: this.min(), max: this.max(), log: this.log() }));
  protected readonly position = computed(() => toPosition(this.scale(), this.value()));
  protected readonly text = computed(() => this.format()(this.value()));
  protected readonly markPositions = computed(() => this.marks().map((m) => toPosition(this.scale(), m)));
  protected readonly originPosition = computed(() => {
    const origin = this.origin();
    return origin === undefined ? null : toPosition(this.scale(), origin);
  });

  private dragging = false;
  private settle = 0;

  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    const rail = event.currentTarget as HTMLElement;
    rail.setPointerCapture(event.pointerId);
    rail.focus();
    this.dragging = true;
    this.moveTo(event);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (this.dragging) this.moveTo(event);
  }

  protected onPointerUp(event: PointerEvent): void {
    if (!this.dragging) return;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    this.dragging = false;
    this.committed.emit(this.value());
  }

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.step(this.position() + (event.deltaY < 0 ? 1 : -1) * (event.shiftKey ? 0.005 : 0.02));
  }

  protected onKey(event: KeyboardEvent): void {
    const position = keyPosition(event.key, this.position(), event.shiftKey);
    if (position === null) return;
    event.preventDefault();
    event.stopPropagation();
    this.step(position);
  }

  protected reset(): void {
    const def = this.default();
    if (def === undefined) return;
    this.valueChange.emit(def);
    this.committed.emit(def);
  }

  private moveTo(event: PointerEvent): void {
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    this.emit(1 - (event.clientY - rect.top) / rect.height);
  }

  private step(position: number): void {
    this.emit(position);
    clearTimeout(this.settle);
    this.settle = window.setTimeout(() => this.committed.emit(this.value()), SETTLE);
  }

  private emit(position: number): void {
    const value = this.round()(fromPosition(this.scale(), position));
    if (value !== this.value()) this.valueChange.emit(value);
  }
}
