import { ChangeDetectionStrategy, Component, computed, input } from '@angular/core';

/** Read-only vertical bar (e.g. the gain reduction of a compressor), filled from the top by `level` 0–1. */
@Component({
  selector: 'app-meter',
  template: `
    <div class="bar" role="meter" [attr.aria-label]="label()" aria-valuemin="0" aria-valuemax="1" [attr.aria-valuenow]="clamped()">
      <div class="fill" [style.height.%]="clamped() * 100"></div>
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
    }
    .bar {
      position: relative;
      width: 8px;
      height: 56px;
      margin: 4px 0;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 2px;
      overflow: hidden;
    }
    .fill {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      background: var(--mat-sys-tertiary);
      transition: height 60ms linear;
    }
    .value {
      font: var(--mat-sys-label-small);
      font-variant-numeric: tabular-nums;
      color: var(--mat-sys-on-surface);
    }
    .label {
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MeterComponent {
  readonly level = input.required<number>();
  readonly text = input('');
  readonly label = input('');
  protected readonly clamped = computed(() => Math.max(0, Math.min(1, this.level())));
}
