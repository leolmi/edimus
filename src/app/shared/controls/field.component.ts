import { ChangeDetectionStrategy, Component, ViewEncapsulation } from '@angular/core';

/**
 * Text field of the dialogs (in place of mat-form-field): the label above, outside the box; a
 * box only around what is edited, set apart from the dialog, with no underline and a soft
 * border when focused; a hint (or an error, `class="error"`) under it. The control is projected:
 * `<input>` or `<mat-select>`, plus optional `[fieldLabel]`, `[fieldSuffix]` (e.g. a unit) and
 * `[fieldHint]` elements. A click on the label focuses the input.
 */
@Component({
  selector: 'app-field',
  host: { class: 'app-field' },
  template: `
    <label class="app-field-wrap">
      <span class="app-field-label"><ng-content select="[fieldLabel]" /></span>
      <span class="app-field-box">
        <ng-content />
        <ng-content select="[fieldSuffix]" />
      </span>
    </label>
    <span class="app-field-hint"><ng-content select="[fieldHint]" /></span>
  `,
  // not encapsulated: the styles reach the projected input and mat-select
  encapsulation: ViewEncapsulation.None,
  styles: `
    .app-field {
      display: inline-flex;
      flex-direction: column;
      gap: 3px;
      min-width: 0;
      vertical-align: top;
    }
    .app-field-wrap {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .app-field-label {
      font: var(--mat-sys-label-medium);
      color: var(--mat-sys-on-surface-variant);
      &:empty {
        display: none;
      }
    }
    .app-field-box {
      display: flex;
      align-items: center;
      gap: 6px;
      min-height: 34px;
      padding: 0 10px;
      box-sizing: border-box;
      border: 1px solid transparent;
      border-radius: 3px;
      /* one step below the Material filled field (container-highest): set apart from the dialog, not glaring */
      background: var(--mat-sys-surface-container-high);
      cursor: text;
      &:focus-within {
        border-color: color-mix(in srgb, var(--mat-sys-primary) 45%, transparent);
      }
      input {
        flex: 1 1 auto;
        min-width: 0;
        padding: 0;
        border: none;
        outline: none;
        background: none;
        color: var(--mat-sys-on-surface);
        font: var(--mat-sys-body-large);
        color-scheme: inherit;
        &::placeholder {
          color: var(--mat-sys-on-surface-variant);
          opacity: 0.7;
        }
        &::selection {
          background: color-mix(in srgb, var(--mat-sys-primary) 25%, transparent);
        }
      }
      .mat-mdc-select {
        flex: 1 1 auto;
        min-width: 0;
        font: var(--mat-sys-body-large);
        cursor: pointer;
      }
      &:has(.mat-mdc-select) {
        cursor: pointer;
      }
    }
    [fieldSuffix] {
      flex: none;
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-medium);
    }
    .app-field-hint {
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
      &:empty {
        display: none;
      }
      .error {
        color: var(--mat-sys-error);
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class FieldComponent {}
