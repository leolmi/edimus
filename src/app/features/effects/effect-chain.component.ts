import { ChangeDetectionStrategy, Component, inject, input } from '@angular/core';
import { MatTooltip } from '@angular/material/tooltip';
import { EffectColor, effectColor } from '../../core/effects/effect-colors';
import { TrackEffect, effectDescriptor, formatParam, paramValue } from '../../core/effects/effects';
import { I18nService } from '../../core/i18n/i18n.service';
import { ThemeColorsService } from '../../core/theme-colors.service';

/**
 * The effects of a track as a chain of small squares, in order: one color and letter per type,
 * hollow when bypassed; the tooltip gives the name and the values of each one.
 */
@Component({
  selector: 'app-effect-chain',
  imports: [MatTooltip],
  template: `
    @for (fx of effects(); track fx.id; let last = $last) {
      @let color = colorOf(fx);
      <span class="square" [class.off]="fx.bypass" [style.--fx-fill]="color.fill" [style.--fx-ink]="color.ink" [matTooltip]="describe(fx)">
        {{ shortOf(fx) }}
      </span>
      @if (!last) {
        <span class="link"></span>
      }
    }
  `,
  styles: `
    :host {
      display: inline-flex;
      align-items: center;
      cursor: pointer;
    }
    .square {
      min-width: 16px;
      height: 16px;
      padding: 0 3px;
      border-radius: 4px;
      box-sizing: border-box;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font: 600 10px/1 var(--mat-sys-label-small-font);
      letter-spacing: 0;
      color: var(--fx-ink);
      background: var(--fx-fill);
      border: 1.5px solid var(--fx-fill);
      &.off {
        color: var(--fx-fill);
        background: transparent;
      }
    }
    .link {
      width: 6px;
      height: 2px;
      background: var(--mat-sys-outline);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EffectChainComponent {
  readonly effects = input.required<readonly TrackEffect[]>();

  private readonly theme = inject(ThemeColorsService);
  private readonly i18n = inject(I18nService);

  protected colorOf(effect: TrackEffect): EffectColor {
    return effectColor(effect.type, this.theme.colors().dark);
  }

  protected shortOf(effect: TrackEffect): string {
    return this.i18n.t(effectDescriptor(effect.type).short);
  }

  /** Name (and bypass) with the values: "Compressore · Soglia -18.0 dB · Rapporto 4.0:1 · …". */
  protected describe(effect: TrackEffect): string {
    const descriptor = effectDescriptor(effect.type);
    const name = this.i18n.t(descriptor.label) + (effect.bypass ? ` (${this.i18n.t('fx.bypassed')})` : '');
    const values = descriptor.params.map((p) => `${this.i18n.t(p.label)} ${formatParam(p, paramValue(effect, p))}`);
    return [name, ...values].join(' · ');
  }
}
