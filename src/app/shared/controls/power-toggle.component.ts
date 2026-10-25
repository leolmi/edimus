import { ChangeDetectionStrategy, Component, input, output } from '@angular/core';
import { MatIconButton } from '@angular/material/button';
import { MatIcon } from '@angular/material/icon';
import { MatTooltip } from '@angular/material/tooltip';

/** On/off switch of an effect: lit when on, dimmed when bypassed. */
@Component({
  selector: 'app-power-toggle',
  imports: [MatIconButton, MatIcon, MatTooltip],
  template: `
    <button mat-icon-button class="power" [class.on]="on()" [attr.aria-pressed]="on()" [attr.aria-label]="label()" [matTooltip]="label()" (click)="toggled.emit(!on())">
      <mat-icon>power_settings_new</mat-icon>
    </button>
  `,
  styles: `
    :host {
      display: inline-flex;
    }
    .power {
      --mat-icon-button-state-layer-size: 28px;
      padding: 0;
      color: var(--mat-sys-outline);
      &.on {
        color: var(--mat-sys-primary);
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PowerToggleComponent {
  readonly on = input.required<boolean>();
  readonly label = input('');
  readonly toggled = output<boolean>();
}
