import type { EffectType } from './effects';

/** Hue of each effect type: far apart, so the order of a chain reads at a glance. */
const HUES: Record<EffectType, number> = { eq: 205, compressor: 32, echo: 275, reverb: 165, saturation: 355 };

/** Color of an effect type and of the text on it. */
export interface EffectColor {
  fill: string;
  ink: string;
}

/** Color of an effect type (chain in the track header, mark in the panel), for the light or the dark theme. */
export function effectColor(type: EffectType, dark: boolean): EffectColor {
  const hue = HUES[type];
  return dark ? { fill: `hsl(${hue} 70% 64%)`, ink: `hsl(${hue} 60% 14%)` } : { fill: `hsl(${hue} 65% 44%)`, ink: '#fff' };
}
