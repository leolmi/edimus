import { ChangeDetectionStrategy, Component, input, model } from '@angular/core';

/**
 * Plain on/off switch (in place of mat-slide-toggle): a small squared track with a square knob,
 * filled with the primary colour when on, and the projected label beside it. The whole row is
 * clickable; Space and Enter toggle it as on a button.
 */
@Component({
  selector: 'app-switch',
  template: `
    <button
      type="button"
      role="switch"
      class="switch"
      [class.on]="checked()"
      [attr.aria-checked]="checked()"
      [disabled]="disabled()"
      (click)="checked.set(!checked())"
    >
      <span class="track"><span class="knob"></span></span>
      <span class="label"><ng-content /></span>
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .switch {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      padding: 2px 0;
      border: none;
      background: none;
      color: var(--mat-sys-on-surface);
      font: var(--mat-sys-body-medium);
      text-align: left;
      cursor: pointer;
      &:disabled {
        cursor: default;
        opacity: 0.38;
      }
      &:focus-visible {
        outline: none;
        .track {
          outline: 2px solid color-mix(in srgb, var(--mat-sys-primary) 60%, transparent);
          outline-offset: 2px;
        }
      }
    }
    .track {
      flex: none;
      position: relative;
      width: 30px;
      height: 16px;
      box-sizing: border-box;
      border: 1px solid var(--mat-sys-outline);
      border-radius: 3px;
      background: var(--mat-sys-surface-container-high);
      transition:
        background 0.12s,
        border-color 0.12s;
    }
    .knob {
      position: absolute;
      top: 2px;
      left: 2px;
      width: 10px;
      height: 10px;
      border-radius: 2px;
      background: var(--mat-sys-outline);
      transition:
        left 0.12s,
        background 0.12s;
    }
    .on {
      .track {
        border-color: var(--mat-sys-primary);
        background: var(--mat-sys-primary);
      }
      .knob {
        left: 16px;
        background: var(--mat-sys-on-primary);
      }
    }
    .switch:not(:disabled):hover .track {
      border-color: var(--mat-sys-primary);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SwitchComponent {
  readonly checked = model(false);
  readonly disabled = input(false);
}
