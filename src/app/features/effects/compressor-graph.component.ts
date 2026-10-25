import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';
import { TrackEffect, numberParam } from '../../core/effects/effects';

/** Range of the transfer curve (dB). */
const FLOOR = -60;
const CEIL = 6;
/** Soft knee of the compressor node (dB), as set in effect-nodes.ts. */
const KNEE = 6;
/** Level of the test hit of the time response, above the threshold (dB). */
const HIT = 18;

/** Size of the two plots in the view box. */
const T = { x: 0, y: 0, w: 72, h: 72 };
const R = { x: 84, y: 0, w: 196, h: 72 };

/** Output level of the compressor for an input level (dB), soft knee included. */
function transfer(input: number, threshold: number, ratio: number): number {
  const over = input - threshold;
  if (over <= -KNEE / 2) return input;
  if (over >= KNEE / 2) return threshold + over / ratio;
  // quadratic knee between the two straight lines
  return input + ((1 / ratio - 1) * Math.pow(over + KNEE / 2, 2)) / (2 * KNEE);
}

/**
 * Picture of the compressor settings, redrawn as the values change: on the left the transfer
 * curve (input → output level: threshold, ratio, knee, makeup) against the unchanged diagonal;
 * on the right the time response to a hit 18 dB over the threshold lasting 250 ms: the gain
 * reduction growing with the attack while the hit lasts, and going back with the release in the
 * 1.25 s after it.
 */
@Component({
  selector: 'app-compressor-graph',
  template: `
    <svg viewBox="0 0 280 72" preserveAspectRatio="none" role="img" [attr.aria-label]="label()">
      <rect class="plot" [attr.x]="T.x" [attr.y]="T.y" [attr.width]="T.w" [attr.height]="T.h" />
      <line class="ref" [attr.x1]="T.x" [attr.y1]="ty(FLOOR)" [attr.x2]="tx(0)" [attr.y2]="ty(0)" />
      <line class="threshold" [attr.x1]="tx(threshold())" [attr.y1]="T.y" [attr.x2]="tx(threshold())" [attr.y2]="T.y + T.h" />
      <polyline class="curve" [attr.points]="curve()" />

      <rect class="plot" [attr.x]="R.x" [attr.y]="R.y" [attr.width]="R.w" [attr.height]="R.h" />
      <rect class="hit" [attr.x]="hit().x" [attr.y]="R.y" [attr.width]="hit().w" [attr.height]="R.h" />
      <polygon class="reduction" [attr.points]="response()" />
      <polyline class="curve" [attr.points]="responseLine()" />
    </svg>
  `,
  styles: `
    :host {
      display: block;
      padding: 8px 10px 0;
    }
    svg {
      display: block;
      width: 100%;
      height: 64px;
      overflow: visible;
    }
    .plot {
      fill: var(--mat-sys-surface-container-lowest);
      stroke: var(--mat-sys-outline-variant);
      stroke-width: 1;
      vector-effect: non-scaling-stroke;
    }
    .ref,
    .threshold {
      stroke: var(--mat-sys-outline);
      stroke-width: 1;
      stroke-dasharray: 2 2;
      vector-effect: non-scaling-stroke;
    }
    .curve {
      fill: none;
      stroke: var(--mat-sys-primary);
      stroke-width: 1.5;
      stroke-linejoin: round;
      vector-effect: non-scaling-stroke;
    }
    .hit {
      fill: var(--mat-sys-surface-container-highest);
    }
    .reduction {
      fill: var(--mat-sys-primary);
      opacity: 0.25;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class CompressorGraphComponent {
  readonly effect = input.required<TrackEffect>();
  readonly label = input('');

  protected readonly T = T;
  protected readonly R = R;
  protected readonly FLOOR = FLOOR;

  protected readonly threshold = computed(() => numberParam(this.effect(), 'threshold'));
  private readonly ratio = computed(() => numberParam(this.effect(), 'ratio'));
  private readonly makeup = computed(() => numberParam(this.effect(), 'makeup'));
  private readonly attack = computed(() => numberParam(this.effect(), 'attack') / 1000);
  private readonly release = computed(() => numberParam(this.effect(), 'release') / 1000);

  protected tx(db: number): number {
    return T.x + ((db - FLOOR) / (0 - FLOOR)) * T.w;
  }

  protected ty(db: number): number {
    const clamped = Math.max(FLOOR, Math.min(CEIL, db));
    return T.y + T.h - ((clamped - FLOOR) / (CEIL - FLOOR)) * T.h;
  }

  protected readonly curve = computed(() => {
    const points: string[] = [];
    for (let db = FLOOR; db <= 0; db += 0.5) {
      points.push(`${this.tx(db).toFixed(1)},${this.ty(transfer(db, this.threshold(), this.ratio()) + this.makeup()).toFixed(1)}`);
    }
    return points.join(' ');
  });

  /**
   * Time axis of the response: a short lead-in, the hit (250 ms) and the time after it (1.25 s),
   * each part with its own fixed scale: a longer attack or release shows as a slower slope.
   */
  private readonly timeline = computed(() => {
    const lead = R.w * 0.1;
    const hitWidth = R.w * 0.4;
    return { hit: 0.25, after: 1.25, lead, hitWidth, afterWidth: R.w - lead - hitWidth };
  });

  protected readonly hit = computed(() => {
    const t = this.timeline();
    return { x: R.x + t.lead, w: t.hitWidth };
  });

  /** Gain reduction along the response, as points (x, dB of reduction ≤ 0). */
  private readonly reduction = computed(() => {
    const t = this.timeline();
    const target = HIT * (1 - 1 / this.ratio());
    const points: [number, number][] = [
      [R.x, 0],
      [R.x + t.lead, 0],
    ];
    const steps = 60;
    let end = 0;
    for (let i = 1; i <= steps; i++) {
      const time = (t.hit * i) / steps;
      end = target * (1 - Math.exp(-time / this.attack()));
      points.push([R.x + t.lead + (t.hitWidth * i) / steps, -end]);
    }
    for (let i = 1; i <= steps; i++) {
      const time = (t.after * i) / steps;
      points.push([R.x + t.lead + t.hitWidth + (t.afterWidth * i) / steps, -end * Math.exp(-time / this.release())]);
    }
    return points;
  });

  /** y of a reduction: 0 at the top, the deepest possible (the hit with ratio ∞) at the bottom. */
  private ry(db: number): number {
    return R.y + 6 + (-db / HIT) * (R.h - 12);
  }

  protected readonly responseLine = computed(() =>
    this.reduction()
      .map(([x, db]) => `${x.toFixed(1)},${this.ry(db).toFixed(1)}`)
      .join(' '),
  );

  protected readonly response = computed(() => `${this.responseLine()} ${R.x + R.w},${this.ry(0)}`);
}
