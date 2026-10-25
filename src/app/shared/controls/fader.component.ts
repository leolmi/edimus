import { ChangeDetectionStrategy, Component, computed, input, output } from '@angular/core';
import { ControlScale, fromPosition, keyPosition, toPosition } from './control-scale';

/** Pause after the last wheel or key step before it counts as done (one undo step). */
const SETTLE = 500;

/**
 * Vertical fader for levels: drag the thumb or click along the rail, wheel, arrows/PageUp/
 * PageDown/Home/End, double click back to the default. Same events as the knob.
 */
@Component({
  selector: 'app-fader',
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
      <div class="groove"></div>
      <div class="lit" [style.height.%]="position() * 100"></div>
      <div class="thumb" [style.bottom.%]="position() * 100"></div>
    </div>
    <span class="value">{{ text() }}</span>
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
      background: var(--mat-sys-outline-variant);
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
  readonly format = input<(value: number) => string>((v) => String(v));
  readonly round = input<(value: number) => number>((v) => v);

  readonly valueChange = output<number>();
  readonly committed = output<number>();

  private readonly scale = computed<ControlScale>(() => ({ min: this.min(), max: this.max(), log: this.log() }));
  protected readonly position = computed(() => toPosition(this.scale(), this.value()));
  protected readonly text = computed(() => this.format()(this.value()));

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
