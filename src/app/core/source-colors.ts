/** Colors of the clips of one source. */
export interface SourceColors {
  waveform: string;
  clip: string;
  clipBorder: string;
}

const PALETTE_SIZE = 20;
/** First hue: the blue of the theme primary, so a single source looks as before. */
const FIRST_HUE = 212;
/** Golden angle: consecutive hues land far apart and never repeat within the palette. */
const HUE_STEP = 137.508;

/**
 * Colors of the source at `index` (order of the sources in the montage): a palette of 20 hues
 * stepping by the golden angle, with lightness tuned for the light or the dark theme.
 */
export function sourceColors(index: number, dark: boolean): SourceColors {
  const i = ((index % PALETTE_SIZE) + PALETTE_SIZE) % PALETTE_SIZE;
  const hue = (FIRST_HUE + i * HUE_STEP) % 360;
  // yellows and greens look brighter: darker in light theme to keep the contrast
  const bright = hue > 40 && hue < 170;
  return dark
    ? {
        waveform: `hsl(${hue.toFixed(1)} 75% ${bright ? 60 : 68}%)`,
        clip: `hsl(${hue.toFixed(1)} 40% 24%)`,
        clipBorder: `hsl(${hue.toFixed(1)} 70% 60%)`,
      }
    : {
        waveform: `hsl(${hue.toFixed(1)} 70% ${bright ? 32 : 42}%)`,
        clip: `hsl(${hue.toFixed(1)} 70% 92%)`,
        clipBorder: `hsl(${hue.toFixed(1)} 60% ${bright ? 34 : 44}%)`,
      };
}
