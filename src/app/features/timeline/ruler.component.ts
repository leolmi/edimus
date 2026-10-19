import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, viewChild } from '@angular/core';
import { ThemeColorsService } from '../../core/theme-colors.service';
import { TimelineService } from '../../core/timeline/timeline.service';
import { observeSize, prepareCanvas } from './canvas';

/** Candidate tick steps (seconds). */
const STEPS = [0.001, 0.002, 0.005, 0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600];
/** Minimum distance (px) between two labelled ticks. */
const MIN_LABEL_SPACING = 70;

/** Formats a tick time with the precision required by the step. */
function tickLabel(time: number, step: number): string {
  const decimals = step >= 1 ? 0 : step >= 0.1 ? 1 : step >= 0.01 ? 2 : 3;
  const m = Math.floor(time / 60);
  const s = (time - m * 60).toFixed(decimals).padStart(decimals ? 3 + decimals : 2, '0');
  return `${m}:${s}`;
}

/** Time ruler above the lanes. */
@Component({
  selector: 'app-ruler',
  template: '<canvas #canvas></canvas>',
  styles: ':host { display: block; position: relative; overflow: hidden; } canvas { position: absolute; inset: 0; }',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class RulerComponent {
  private readonly timeline = inject(TimelineService);
  private readonly theme = inject(ThemeColorsService);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly size = observeSize();

  constructor() {
    effect(() => this.draw());
  }

  private draw(): void {
    const size = this.size();
    const colors = this.theme.colors();
    const px = this.timeline.pxPerSec();
    const scroll = this.timeline.scroll();
    const ctx = prepareCanvas(this.canvas().nativeElement, size);

    const step = STEPS.find((s) => s * px >= MIN_LABEL_SPACING) ?? STEPS[STEPS.length - 1];
    const minor = step / (String(step).startsWith('5') || step === 15 ? 5 : 2);
    const end = scroll + size.width / px;

    ctx.strokeStyle = colors.axis;
    ctx.fillStyle = colors.text;
    ctx.font = colors.font;
    ctx.textBaseline = 'top';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let t = Math.floor(scroll / minor) * minor; t <= end; t += minor) {
      const x = Math.round((t - scroll) * px) + 0.5;
      const major = Math.abs(t / step - Math.round(t / step)) < 1e-6;
      ctx.moveTo(x, size.height);
      ctx.lineTo(x, size.height - (major ? 10 : 4));
      if (major) ctx.fillText(tickLabel(Math.round(t / step) * step, step), x + 3, 3);
    }
    ctx.moveTo(0, size.height - 0.5);
    ctx.lineTo(size.width, size.height - 0.5);
    ctx.stroke();
  }
}
