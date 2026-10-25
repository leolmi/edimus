import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, input, output, signal, viewChild } from '@angular/core';
import { ControlScale, fromPosition, keyPosition, toPosition } from './control-scale';

/** Pixels of vertical drag for the whole range (Shift: ten times finer). */
const DRAG_RANGE = 150;
/** Pause after the last wheel or key step before it counts as done (one undo step). */
const SETTLE = 500;
/** Angle of the ends of the knob (degrees from the top). */
const SWEEP = 135;

const polar = (angle: number, radius: number) => {
  const t = ((angle - 90) * Math.PI) / 180;
  return { x: 18 + radius * Math.cos(t), y: 18 + radius * Math.sin(t) };
};

/** Arc of the knob ring between two angles. */
function arc(from: number, to: number, radius: number): string {
  if (Math.abs(to - from) < 0.5) return '';
  const [a, b] = from < to ? [from, to] : [to, from];
  const s = polar(a, radius);
  const e = polar(b, radius);
  return `M ${s.x} ${s.y} A ${radius} ${radius} 0 ${b - a > 180 ? 1 : 0} 1 ${e.x} ${e.y}`;
}

/**
 * Rotary control of the effects: vertical drag (Shift = fine), wheel, arrows/PageUp/PageDown/
 * Home/End, double click back to the default; a click on the value lets it be typed. The ring
 * is lit from the origin (e.g. 0 dB) to the value. `valueChange` while it moves, `committed`
 * once at the end of the gesture.
 */
@Component({
  selector: 'app-knob',
  template: `
    <div
      class="dial"
      role="slider"
      tabindex="0"
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
      <svg width="36" height="36" viewBox="0 0 36 36" aria-hidden="true">
        <path class="ring" [attr.d]="ringPath" />
        <path class="lit" [attr.d]="litPath()" />
        <circle class="body" cx="18" cy="18" r="10" />
        <line class="pointer" x1="18" y1="18" [attr.x2]="tip().x" [attr.y2]="tip().y" />
      </svg>
    </div>
    @if (editing()) {
      <input
        #field
        class="field"
        [value]="value()"
        (keydown.enter)="field.blur()"
        (keydown.escape)="editing.set(false)"
        (blur)="typed(field.value)"
        (keydown)="$event.stopPropagation()"
      />
    } @else {
      <span class="value" role="button" tabindex="-1" (click)="startEditing()">{{ text() }}</span>
    }
    <span class="label">{{ label() }}</span>
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
    .dial {
      cursor: ns-resize;
      touch-action: none;
      border-radius: 50%;
      outline: none;
      &:focus-visible {
        box-shadow: 0 0 0 2px var(--mat-sys-primary);
      }
    }
    svg {
      display: block;
    }
    .ring,
    .lit {
      fill: none;
      stroke-width: 3;
      stroke-linecap: round;
    }
    .ring {
      stroke: var(--mat-sys-outline-variant);
    }
    .lit {
      stroke: var(--mat-sys-primary);
    }
    .body {
      fill: var(--mat-sys-surface-container-highest);
      stroke: var(--mat-sys-outline);
      stroke-width: 0.5;
    }
    .pointer {
      stroke: var(--mat-sys-on-surface);
      stroke-width: 1.5;
      stroke-linecap: round;
    }
    .value,
    .field {
      font: var(--mat-sys-label-small);
      font-variant-numeric: tabular-nums;
      color: var(--mat-sys-on-surface);
      white-space: nowrap;
    }
    .value {
      cursor: text;
    }
    .field {
      width: 48px;
      text-align: center;
      background: var(--mat-sys-surface-container-highest);
      border: 1px solid var(--mat-sys-primary);
      border-radius: 4px;
      outline: none;
      padding: 0;
    }
    .label {
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      max-width: 100%;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class KnobComponent {
  readonly value = input.required<number>();
  readonly min = input.required<number>();
  readonly max = input.required<number>();
  readonly log = input(false);
  /** Value of the double click; also where the ring starts lighting when `origin` is not set. */
  readonly default = input<number>();
  /** Neutral value the lit ring starts from (e.g. 0 dB); default the minimum. */
  readonly origin = input<number>();
  readonly label = input('');
  readonly format = input<(value: number) => string>((v) => String(v));
  /** Rounds the values produced (to the precision of the unit). */
  readonly round = input<(value: number) => number>((v) => v);

  readonly valueChange = output<number>();
  readonly committed = output<number>();

  protected readonly editing = signal(false);
  protected readonly ringPath = arc(-SWEEP, SWEEP, 15);

  private readonly scale = computed<ControlScale>(() => ({ min: this.min(), max: this.max(), log: this.log() }));
  private readonly position = computed(() => toPosition(this.scale(), this.value()));
  private readonly angle = (position: number) => -SWEEP + 2 * SWEEP * position;
  protected readonly text = computed(() => this.format()(this.value()));
  protected readonly tip = computed(() => polar(this.angle(this.position()), 9));
  protected readonly litPath = computed(() => {
    const origin = this.origin();
    const from = origin === undefined ? 0 : toPosition(this.scale(), origin);
    return arc(this.angle(from), this.angle(this.position()), 15);
  });

  private readonly field = viewChild<ElementRef<HTMLInputElement>>('field');
  private drag?: { y: number; position: number; moved: boolean };
  private settle = 0;

  constructor() {
    // the field appears with its text selected, ready to be typed over
    effect(() => this.field()?.nativeElement.select());
  }

  protected onPointerDown(event: PointerEvent): void {
    if (event.button !== 0) return;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
    (event.currentTarget as HTMLElement).focus();
    this.drag = { y: event.clientY, position: this.position(), moved: false };
  }

  protected onPointerMove(event: PointerEvent): void {
    if (!this.drag) return;
    const range = event.shiftKey ? DRAG_RANGE * 10 : DRAG_RANGE;
    this.drag.position += (this.drag.y - event.clientY) / range;
    this.drag.y = event.clientY;
    this.drag.moved = true;
    this.emit(this.drag.position);
  }

  protected onPointerUp(event: PointerEvent): void {
    if (!this.drag) return;
    (event.currentTarget as HTMLElement).releasePointerCapture(event.pointerId);
    const moved = this.drag.moved;
    this.drag = undefined;
    if (moved) this.committed.emit(this.value());
  }

  protected onWheel(event: WheelEvent): void {
    event.preventDefault();
    this.step(this.position() + (event.deltaY < 0 ? 1 : -1) * (event.shiftKey ? 0.005 : 0.02));
  }

  protected onKey(event: KeyboardEvent): void {
    const position = keyPosition(event.key, this.position(), event.shiftKey);
    if (position === null) return;
    // not to the shortcuts of the app (arrows move the clips)
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

  protected startEditing(): void {
    this.editing.set(true);
  }

  /** Value typed under the knob ("1.5k" = 1500); anything else keeps the current one. */
  protected typed(text: string): void {
    if (!this.editing()) return;
    this.editing.set(false);
    const number = parseFloat(text.replace(',', '.'));
    if (!Number.isFinite(number)) return;
    const value = this.round()(Math.min(this.max(), Math.max(this.min(), /k/i.test(text) ? number * 1000 : number)));
    this.valueChange.emit(value);
    this.committed.emit(value);
  }

  /** A wheel or key step: committed once the steps pause. */
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
