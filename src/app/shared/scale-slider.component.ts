import { ChangeDetectionStrategy, Component, booleanAttribute, ElementRef, computed, input, model, output, signal, viewChild } from '@angular/core';

/** Graduation mark of the scale. */
interface Tick {
  value: number;
  /** Position along the track, 0–100 (%). */
  position: number;
  major: boolean;
  label?: string;
}

/**
 * Slider with a readable scale: major and minor graduations with labels, the stretch from the
 * origin (the neutral value) to the current value highlighted, and the current value shown on
 * the thumb. Linear or logarithmic (for ratios, e.g. speed). Keyboard: arrows (Shift = ×10),
 * PageUp/PageDown, Home/End; mouse wheel; double click goes back to the origin.
 */
@Component({
  selector: 'app-scale-slider',
  template: `
    <div
      #track
      class="track"
      role="slider"
      tabindex="0"
      [attr.aria-valuemin]="min()"
      [attr.aria-valuemax]="max()"
      [attr.aria-valuenow]="value()"
      [attr.aria-valuetext]="valueText()"
      [attr.aria-label]="ariaLabel()"
      [attr.aria-disabled]="disabled()"
      (pointerdown)="onPointerDown($event)"
      (pointermove)="onPointerMove($event)"
      (pointerup)="onPointerUp($event)"
      (pointercancel)="onPointerUp($event)"
      (keydown)="onKey($event)"
      (wheel)="onWheel($event)"
      (dblclick)="reset()"
    >
      <div class="rail"></div>
      <div class="fill" [style.left.%]="fill().left" [style.width.%]="fill().width"></div>
      @for (tick of ticks(); track tick.value) {
        <div class="tick" [class.major]="tick.major" [style.left.%]="tick.position"></div>
        @if (tick.label && !compact()) {
          <div class="tick-label" [style.left.%]="tick.position">{{ tick.label }}</div>
        }
      }
      @if (origin() !== undefined) {
        <div class="origin" [style.left.%]="toPosition(originValue())"></div>
      }
      <div class="thumb" [class.active]="dragging()" [style.left.%]="toPosition(value())">
        @if (dragging() || compact()) {
          <div class="bubble">{{ valueText() }}</div>
        }
      </div>
    </div>
    @if (!compact()) {
      <div class="value">{{ valueText() }}</div>
    }
  `,
  styles: `
    :host {
      display: flex;
      align-items: center;
      gap: 12px;
      min-width: 120px;
      --scale-height: 34px;
      user-select: none;
    }
    :host(.compact) {
      --scale-height: 22px;
    }
    .track {
      position: relative;
      flex: 1 1 auto;
      height: var(--scale-height);
      cursor: pointer;
      outline: none;
      touch-action: none;
      /* room for the thumb at the ends */
      margin: 0 8px;
    }
    .track[aria-disabled='true'] {
      opacity: 0.45;
      cursor: default;
    }
    .rail,
    .fill {
      position: absolute;
      top: 8px;
      height: 4px;
      border-radius: 2px;
    }
    .rail {
      left: 0;
      right: 0;
      background: var(--mat-sys-surface-container-highest);
    }
    .fill {
      background: var(--mat-sys-primary);
    }
    .tick {
      position: absolute;
      top: 14px;
      width: 1px;
      height: 4px;
      background: var(--mat-sys-outline);
      transform: translateX(-0.5px);
    }
    .tick.major {
      height: 7px;
      background: var(--mat-sys-on-surface-variant);
    }
    .tick-label {
      position: absolute;
      top: 21px;
      transform: translateX(-50%);
      font: 10px/1 var(--mat-sys-body-small-font, sans-serif);
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
      font-variant-numeric: tabular-nums;
    }
    .origin {
      position: absolute;
      top: 3px;
      width: 2px;
      height: 14px;
      background: var(--mat-sys-tertiary);
      transform: translateX(-1px);
      border-radius: 1px;
    }
    .thumb {
      position: absolute;
      top: 2px;
      width: 16px;
      height: 16px;
      border-radius: 50%;
      background: var(--mat-sys-primary);
      border: 2px solid var(--mat-sys-surface);
      box-shadow: 0 1px 3px rgb(0 0 0 / 0.35);
      transform: translateX(-50%);
      transition: transform 80ms;
    }
    .track:focus-visible .thumb,
    .thumb.active {
      transform: translateX(-50%) scale(1.2);
      outline: 2px solid var(--mat-sys-primary);
      outline-offset: 2px;
    }
    .bubble {
      position: absolute;
      bottom: 22px;
      left: 50%;
      transform: translateX(-50%);
      padding: 2px 6px;
      border-radius: 4px;
      background: var(--mat-sys-inverse-surface);
      color: var(--mat-sys-inverse-on-surface);
      font: 11px/1.4 var(--mat-sys-body-small-font, sans-serif);
      white-space: nowrap;
      pointer-events: none;
      font-variant-numeric: tabular-nums;
    }
    :host(.compact) .bubble {
      bottom: auto;
      top: 20px;
      opacity: 0;
      transition: opacity 120ms;
    }
    :host(.compact) .track:hover .bubble,
    :host(.compact) .thumb.active .bubble,
    :host(.compact) .track:focus-visible .bubble {
      opacity: 1;
    }
    .value {
      min-width: 64px;
      text-align: right;
      font-variant-numeric: tabular-nums;
      color: var(--mat-sys-on-surface);
    }
  `,
  host: { '[class.compact]': 'compact()' },
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ScaleSliderComponent {
  readonly value = model.required<number>();
  readonly min = input.required<number>();
  readonly max = input.required<number>();
  readonly step = input(1);
  /** Neutral value: start of the highlighted stretch and target of the double click. */
  readonly origin = input<number | undefined>(undefined);
  /** Distance between major graduations (linear) or their values (logarithmic). */
  readonly majorTicks = input<number | number[]>(10);
  /** Minor graduations per major interval (linear scale). */
  readonly minorTicks = input(4);
  readonly logarithmic = input(false, { transform: booleanAttribute });
  readonly format = input<(value: number) => string>((v) => String(v));
  /** Small version for toolbars: no labels, value shown on hover. */
  readonly compact = input(false, { transform: booleanAttribute });
  readonly disabled = input(false, { transform: booleanAttribute });
  readonly ariaLabel = input<string | null>(null);

  /** Emitted when a change is complete (pointer released, key or wheel), to persist or apply it. */
  readonly committed = output<number>();

  private readonly track = viewChild.required<ElementRef<HTMLElement>>('track');
  protected readonly dragging = signal(false);

  protected readonly valueText = computed(() => this.format()(this.value()));

  protected readonly originValue = computed(() => this.origin() ?? this.min());

  protected readonly fill = computed(() => {
    const a = this.toPosition(this.originValue());
    const b = this.toPosition(this.value());
    return { left: Math.min(a, b), width: Math.abs(b - a) };
  });

  protected readonly ticks = computed<Tick[]>(() => {
    const min = this.min();
    const max = this.max();
    const majors = this.majorTicks();
    const format = this.format();
    const ticks: Tick[] = [];
    if (Array.isArray(majors)) {
      for (const value of majors) ticks.push({ value, position: this.toPosition(value), major: true, label: format(value) });
      return ticks;
    }
    const minor = majors / (this.minorTicks() + 1);
    const count = Math.round((max - min) / minor);
    for (let i = 0; i <= count; i++) {
      const value = min + i * minor;
      const major = Math.abs((value - min) / majors - Math.round((value - min) / majors)) < 1e-6;
      ticks.push({ value, position: this.toPosition(value), major, label: major ? format(round(value, 6)) : undefined });
    }
    return ticks;
  });

  /** Position (%) of a value along the track. */
  protected toPosition(value: number): number {
    const min = this.min();
    const max = this.max();
    const v = Math.min(max, Math.max(min, value));
    const fraction = this.logarithmic() ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
    return fraction * 100;
  }

  private fromFraction(fraction: number): number {
    const min = this.min();
    const max = this.max();
    const f = Math.min(1, Math.max(0, fraction));
    const raw = this.logarithmic() ? min * Math.pow(max / min, f) : min + f * (max - min);
    return this.snap(raw);
  }

  private snap(value: number): number {
    const step = this.step();
    const snapped = Math.round(value / step) * step;
    return round(Math.min(this.max(), Math.max(this.min(), snapped)), 6);
  }

  protected reset(): void {
    if (this.disabled() || this.origin() === undefined) return;
    this.set(this.origin()!, true);
  }

  protected onPointerDown(event: PointerEvent): void {
    if (this.disabled() || event.button !== 0) return;
    const track = this.track().nativeElement;
    track.focus();
    track.setPointerCapture(event.pointerId);
    this.dragging.set(true);
    this.set(this.valueAt(event), false);
  }

  protected onPointerMove(event: PointerEvent): void {
    if (this.dragging()) this.set(this.valueAt(event), false);
  }

  protected onPointerUp(event: PointerEvent): void {
    if (!this.dragging()) return;
    this.dragging.set(false);
    this.track().nativeElement.releasePointerCapture(event.pointerId);
    this.committed.emit(this.value());
  }

  protected onKey(event: KeyboardEvent): void {
    if (this.disabled()) return;
    const step = this.step() * (event.shiftKey ? 10 : 1);
    const big = (this.max() - this.min()) / 10;
    const moves: Record<string, () => number> = {
      ArrowRight: () => this.value() + step,
      ArrowUp: () => this.value() + step,
      ArrowLeft: () => this.value() - step,
      ArrowDown: () => this.value() - step,
      PageUp: () => this.value() + big,
      PageDown: () => this.value() - big,
      Home: () => this.min(),
      End: () => this.max(),
    };
    const move = moves[event.key];
    if (!move) return;
    event.preventDefault();
    event.stopPropagation();
    this.set(this.snap(move()), true);
  }

  protected onWheel(event: WheelEvent): void {
    if (this.disabled()) return;
    event.preventDefault();
    const step = this.step() * (event.shiftKey ? 10 : 1);
    this.set(this.snap(this.value() + (event.deltaY < 0 ? step : -step)), true);
  }

  private valueAt(event: PointerEvent): number {
    const rect = this.track().nativeElement.getBoundingClientRect();
    return this.fromFraction((event.clientX - rect.left) / rect.width);
  }

  private set(value: number, commit: boolean): void {
    if (value !== this.value()) this.value.set(value);
    if (commit) this.committed.emit(value);
  }
}

function round(value: number, decimals: number): number {
  const f = Math.pow(10, decimals);
  return Math.round(value * f) / f;
}
