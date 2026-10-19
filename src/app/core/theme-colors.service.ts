import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';
import { SettingsService } from './settings.service';

/** Theme colors resolved for canvas drawing. */
export interface CanvasColors {
  waveform: string;
  clip: string;
  clipBorder: string;
  axis: string;
  grid: string;
  text: string;
  envelope: string;
  beat: string;
  font: string;
  /** The theme in use is dark. */
  dark: boolean;
}

const TOKENS: Record<Exclude<keyof CanvasColors, 'font' | 'dark'>, string> = {
  waveform: '--mat-sys-primary',
  clip: '--mat-sys-primary-container',
  clipBorder: '--mat-sys-primary',
  axis: '--mat-sys-outline',
  grid: '--mat-sys-outline-variant',
  text: '--mat-sys-on-surface-variant',
  envelope: '--mat-sys-tertiary',
  beat: '--mat-sys-on-surface',
};

/**
 * Material tokens resolved to concrete colors (they use `light-dark()`, which canvas
 * cannot read), recomputed when the theme or the system preference changes.
 */
@Injectable({ providedIn: 'root' })
export class ThemeColorsService {
  private readonly document = inject(DOCUMENT);
  private readonly settings = inject(SettingsService);

  readonly colors = signal<CanvasColors>(this.resolve());

  constructor() {
    effect(() => {
      this.settings.theme();
      // the theme class is applied by another effect: resolve after it
      queueMicrotask(() => this.colors.set(this.resolve()));
    });
    matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => this.colors.set(this.resolve()));
  }

  private resolve(): CanvasColors {
    const probe = this.document.createElement('span');
    probe.style.display = 'none';
    this.document.body.appendChild(probe);
    const colors = {} as CanvasColors;
    for (const [name, token] of Object.entries(TOKENS)) {
      probe.style.color = `var(${token})`;
      colors[name as keyof typeof TOKENS] = getComputedStyle(probe).color;
    }
    probe.remove();
    colors.font = `11px ${getComputedStyle(this.document.body).fontFamily}`;
    // dark when the page background is dark
    const [r, g, b] = (getComputedStyle(this.document.body).backgroundColor.match(/\d+(\.\d+)?/g) ?? ['255', '255', '255']).map(Number);
    colors.dark = 0.2126 * r + 0.7152 * g + 0.0722 * b < 128;
    return colors;
  }
}
