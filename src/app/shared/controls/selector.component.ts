import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';

/** Compact segmented choice among a few fixed values (e.g. the division of an echo); arrows move it. */
@Component({
  selector: 'app-selector',
  template: `
    <div class="segments" role="radiogroup" [attr.aria-label]="label()" (keydown)="onKey($event)">
      @for (option of options(); track option) {
        <button
          type="button"
          class="segment"
          role="radio"
          [class.on]="option === value()"
          [attr.aria-checked]="option === value()"
          [attr.tabindex]="option === value() ? 0 : -1"
          (click)="choose(option)"
        >
          {{ option }}
        </button>
      }
    </div>
    <span class="label">{{ label() }}</span>
  `,
  styles: `
    :host {
      display: inline-flex;
      flex-direction: column;
      align-items: center;
      gap: 6px;
      user-select: none;
    }
    .segments {
      display: flex;
      border: 1px solid var(--mat-sys-outline-variant);
      border-radius: 6px;
      overflow: hidden;
    }
    .segment {
      font: var(--mat-sys-label-small);
      font-variant-numeric: tabular-nums;
      padding: 3px 5px;
      border: none;
      background: none;
      color: var(--mat-sys-on-surface-variant);
      cursor: pointer;
      outline: none;
      & + .segment {
        border-left: 1px solid var(--mat-sys-outline-variant);
      }
      &.on {
        background: var(--mat-sys-secondary-container);
        color: var(--mat-sys-on-secondary-container);
      }
      &:focus-visible {
        box-shadow: inset 0 0 0 2px var(--mat-sys-primary);
      }
    }
    .label {
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface-variant);
      white-space: nowrap;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SelectorComponent {
  readonly value = input.required<string>();
  readonly options = input.required<readonly string[]>();
  readonly label = input('');

  readonly changed = output<string>();

  protected choose(option: string): void {
    if (option !== this.value()) this.changed.emit(option);
  }

  protected onKey(event: KeyboardEvent): void {
    const delta = event.key === 'ArrowRight' || event.key === 'ArrowDown' ? 1 : event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 0;
    if (!delta) return;
    event.preventDefault();
    event.stopPropagation();
    const options = this.options();
    const next = options[Math.max(0, Math.min(options.length - 1, options.indexOf(this.value()) + delta))];
    this.choose(next);
    // the focus follows the chosen segment
    setTimeout(() => ((event.currentTarget as HTMLElement | null)?.querySelector('.on') as HTMLElement | null)?.focus());
  }
}
