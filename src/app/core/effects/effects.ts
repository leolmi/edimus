import type { TranslationKey } from '../i18n/it';
import type { Montage, Track } from '../montage/montage.model';

/**
 * Audio effects of a track, applied in order to the sum of its clips before the track volume.
 * Each type is described by an `EffectDescriptor` (its parameters with range, unit and scale,
 * and its presets): the panel builds its controls from it, the montage file is validated with
 * it, the MCP tool takes its parameter ids. The audio nodes are in `effect-nodes.ts`.
 */
export type EffectType = 'eq' | 'compressor' | 'echo' | 'reverb' | 'saturation';
export type EffectValue = number | string;

/** An effect in the chain of a track. */
export interface TrackEffect {
  /** Unique in the track. */
  id: string;
  type: EffectType;
  /** Switched off: the audio goes through unchanged, the settings stay. */
  bypass?: boolean;
  /** Values by parameter id (in the units of the descriptor); missing = default. */
  params: Record<string, EffectValue>;
}

export type ParamUnit = 'dB' | 'Hz' | '%' | 'ms' | 'ratio';

export interface NumberParam {
  kind: 'number';
  id: string;
  label: TranslationKey;
  min: number;
  max: number;
  default: number;
  unit: ParamUnit;
  /** Logarithmic scale (frequencies, times, ratios). */
  log?: boolean;
  /** Shown as a vertical fader instead of a knob (output levels). */
  fader?: boolean;
}

export interface ChoiceParam {
  kind: 'choice';
  id: string;
  label: TranslationKey;
  options: readonly string[];
  default: string;
}

export type EffectParam = NumberParam | ChoiceParam;

export interface EffectPreset {
  name: TranslationKey;
  /** Values of the preset; the parameters left out go back to their default. */
  params: Record<string, EffectValue>;
}

export interface EffectDescriptor {
  type: EffectType;
  label: TranslationKey;
  /** One or two letters shown in the chain of the track header. */
  short: TranslationKey;
  params: readonly EffectParam[];
  presets: readonly EffectPreset[];
  /** Shows how much the effect is reducing the level, while playing (compressor). */
  meter?: 'reduction';
  /** Picture of the settings above the controls (compressor: transfer curve and attack/release). */
  graph?: 'compressor';
}

/** Echo divisions, as fractions of a whole note ("1/8." = dotted eighth), in beats (quarter notes). */
export const ECHO_DIVISIONS: Record<string, number> = { '1/2': 2, '1/4': 1, '1/8.': 0.75, '1/8': 0.5, '1/16': 0.25 };

const db = (id: string, label: TranslationKey, min: number, max: number, def: number, fader = false): NumberParam => ({
  kind: 'number',
  id,
  label,
  min,
  max,
  default: def,
  unit: 'dB',
  fader,
});
const hz = (id: string, label: TranslationKey, min: number, max: number, def: number): NumberParam => ({
  kind: 'number',
  id,
  label,
  min,
  max,
  default: def,
  unit: 'Hz',
  log: true,
});
const pct = (id: string, label: TranslationKey, def: number, max = 100): NumberParam => ({ kind: 'number', id, label, min: 0, max, default: def, unit: '%' });
const ms = (id: string, label: TranslationKey, min: number, max: number, def: number, log = true): NumberParam => ({
  kind: 'number',
  id,
  label,
  min,
  max,
  default: def,
  unit: 'ms',
  log,
});

export const EFFECTS: readonly EffectDescriptor[] = [
  {
    type: 'eq',
    label: 'fx.eq',
    short: 'fx.short.eq',
    params: [
      hz('lowCut', 'fx.lowCut', 20, 1000, 20),
      db('low', 'fx.low', -15, 15, 0),
      db('mid', 'fx.mid', -15, 15, 0),
      hz('midFreq', 'fx.midFreq', 200, 8000, 1000),
      db('high', 'fx.high', -15, 15, 0),
    ],
    presets: [
      { name: 'fx.preset.voice', params: { lowCut: 100, low: -2, mid: 2, midFreq: 3000, high: 3 } },
      { name: 'fx.preset.radio', params: { lowCut: 500, low: -15, mid: 6, midFreq: 1500, high: -15 } },
      { name: 'fx.preset.warm', params: { low: 4, mid: -1, midFreq: 800, high: -3 } },
      { name: 'fx.preset.bright', params: { lowCut: 60, mid: 1, midFreq: 5000, high: 5 } },
    ],
  },
  {
    type: 'compressor',
    label: 'fx.compressor',
    short: 'fx.short.compressor',
    meter: 'reduction',
    graph: 'compressor',
    params: [
      db('threshold', 'fx.threshold', -60, 0, -18),
      { kind: 'number', id: 'ratio', label: 'fx.ratio', min: 1, max: 20, default: 4, unit: 'ratio', log: true },
      ms('attack', 'fx.attack', 1, 200, 10),
      ms('release', 'fx.release', 20, 1000, 200),
      db('makeup', 'fx.makeup', 0, 24, 0, true),
    ],
    presets: [
      { name: 'fx.preset.voice', params: { threshold: -20, ratio: 3, attack: 5, release: 150, makeup: 4 } },
      { name: 'fx.preset.gentle', params: { threshold: -14, ratio: 2, attack: 20, release: 250, makeup: 2 } },
      { name: 'fx.preset.punchy', params: { threshold: -28, ratio: 6, attack: 3, release: 120, makeup: 8 } },
      { name: 'fx.preset.limiter', params: { threshold: -3, ratio: 20, attack: 1, release: 100 } },
    ],
  },
  {
    type: 'echo',
    label: 'fx.echo',
    short: 'fx.short.echo',
    params: [
      { kind: 'choice', id: 'time', label: 'fx.time', options: Object.keys(ECHO_DIVISIONS), default: '1/8' },
      pct('feedback', 'fx.feedback', 35, 90),
      hz('tone', 'fx.tone', 500, 12000, 4000),
      pct('mix', 'fx.mix', 25),
    ],
    presets: [
      { name: 'fx.preset.slapback', params: { time: '1/16', feedback: 0, tone: 6000, mix: 25 } },
      { name: 'fx.preset.rhythmic', params: { time: '1/8', feedback: 40, tone: 4000, mix: 30 } },
      { name: 'fx.preset.dotted', params: { time: '1/8.', feedback: 45, tone: 3500, mix: 30 } },
      { name: 'fx.preset.wide', params: { time: '1/4', feedback: 55, tone: 2500, mix: 30 } },
    ],
  },
  {
    type: 'reverb',
    label: 'fx.reverb',
    short: 'fx.short.reverb',
    params: [pct('size', 'fx.size', 40), pct('damping', 'fx.damping', 50), ms('predelay', 'fx.predelay', 0, 150, 10, false), pct('mix', 'fx.mix', 20)],
    presets: [
      { name: 'fx.preset.room', params: { size: 25, damping: 60, predelay: 5, mix: 20 } },
      { name: 'fx.preset.voice', params: { size: 35, damping: 40, predelay: 15, mix: 15 } },
      { name: 'fx.preset.hall', params: { size: 55, damping: 45, predelay: 20, mix: 25 } },
      { name: 'fx.preset.cathedral', params: { size: 90, damping: 30, predelay: 40, mix: 30 } },
    ],
  },
  {
    type: 'saturation',
    label: 'fx.saturation',
    short: 'fx.short.saturation',
    params: [db('drive', 'fx.drive', 0, 30, 6), hz('tone', 'fx.tone', 1000, 20000, 12000), pct('mix', 'fx.mix', 100), db('output', 'fx.output', -24, 6, 0, true)],
    presets: [
      { name: 'fx.preset.warm', params: { drive: 6, tone: 9000, mix: 60, output: -1 } },
      { name: 'fx.preset.lofi', params: { drive: 14, tone: 3500, output: -5 } },
      { name: 'fx.preset.distorted', params: { drive: 24, tone: 6000, output: -8 } },
    ],
  },
];

const BY_TYPE = new Map(EFFECTS.map((d) => [d.type, d]));

export const effectDescriptor = (type: EffectType): EffectDescriptor => BY_TYPE.get(type)!;

/** Default values of all the parameters of a type. */
export function defaultParams(type: EffectType): Record<string, EffectValue> {
  return Object.fromEntries(effectDescriptor(type).params.map((p) => [p.id, p.default]));
}

export function newEffect(type: EffectType): TrackEffect {
  return { id: crypto.randomUUID(), type, params: defaultParams(type) };
}

/** Rounds a value to the precision shown for its unit. */
export function roundParam(param: NumberParam, value: number): number {
  const v = Math.min(param.max, Math.max(param.min, value));
  switch (param.unit) {
    case 'dB':
    case 'ratio':
      return Math.round(v * 10) / 10;
    case 'Hz':
      return v >= 1000 ? Math.round(v / 10) * 10 : Math.round(v);
    default:
      return Math.round(v);
  }
}

/** Valid value of a parameter: the one of the effect when valid, otherwise the default. */
export function paramValue(effect: TrackEffect, param: EffectParam): EffectValue {
  const value = effect.params[param.id];
  if (param.kind === 'choice') return typeof value === 'string' && param.options.includes(value) ? value : param.default;
  return typeof value === 'number' && Number.isFinite(value) ? roundParam(param, value) : param.default;
}

/** Number value of a parameter (for the audio nodes). */
export function numberParam(effect: TrackEffect, id: string): number {
  const param = effectDescriptor(effect.type).params.find((p) => p.id === id);
  return param ? Number(paramValue(effect, param)) : 0;
}

/** Text of a value with its unit ("-3.0 dB", "1.2 kHz", "4.0:1"). */
export function formatParam(param: EffectParam, value: EffectValue): string {
  if (param.kind === 'choice') return String(value);
  const v = Number(value);
  switch (param.unit) {
    case 'dB':
      return `${v > 0 ? '+' : ''}${v.toFixed(1)} dB`;
    case 'Hz':
      return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 1 : 2)} kHz` : `${Math.round(v)} Hz`;
    case 'ratio':
      return `${v.toFixed(1)}:1`;
    case '%':
      return `${Math.round(v)}%`;
    case 'ms':
      return `${Math.round(v)} ms`;
  }
}

/** Effects read from a file or given by the AI: unknown types dropped, values checked. */
export function sanitizeEffects(raw: unknown): TrackEffect[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const effects: TrackEffect[] = [];
  const ids = new Set<string>();
  for (const item of raw as Partial<TrackEffect>[]) {
    if (!item || !BY_TYPE.has(item.type as EffectType)) continue;
    const type = item.type as EffectType;
    let id = typeof item.id === 'string' && item.id ? item.id : crypto.randomUUID();
    if (ids.has(id)) id = crypto.randomUUID();
    ids.add(id);
    const draft: TrackEffect = { id, type, params: { ...(item.params ?? {}) } };
    const params = Object.fromEntries(effectDescriptor(type).params.map((p) => [p.id, paramValue(draft, p)]));
    effects.push({ id, type, ...(item.bypass ? { bypass: true } : {}), params });
  }
  return effects.length ? effects : undefined;
}

// --- edits (pure: a new montage, the track's other fields untouched) -------------------------

function withEffects(montage: Montage, trackId: string, edit: (effects: TrackEffect[]) => TrackEffect[]): Montage {
  return {
    ...montage,
    tracks: montage.tracks.map((t): Track => {
      if (t.id !== trackId) return t;
      const effects = edit(t.effects ?? []);
      const { effects: _, ...rest } = t;
      return effects.length ? { ...rest, effects } : rest;
    }),
  };
}

const mapEffect = (montage: Montage, trackId: string, effectId: string, edit: (effect: TrackEffect) => TrackEffect) =>
  withEffects(montage, trackId, (effects) => effects.map((e) => (e.id === effectId ? edit(e) : e)));

/** Appends an effect (with default values) to the chain of a track. */
export function addEffect(montage: Montage, trackId: string, effect: TrackEffect): Montage {
  return withEffects(montage, trackId, (effects) => [...effects, effect]);
}

export function removeEffect(montage: Montage, trackId: string, effectId: string): Montage {
  return withEffects(montage, trackId, (effects) => effects.filter((e) => e.id !== effectId));
}

/** Moves an effect to position `index` of the chain. */
export function moveEffect(montage: Montage, trackId: string, effectId: string, index: number): Montage {
  return withEffects(montage, trackId, (effects) => {
    const from = effects.findIndex((e) => e.id === effectId);
    if (from < 0) return effects;
    const next = effects.filter((e) => e.id !== effectId);
    next.splice(Math.max(0, Math.min(next.length, index)), 0, effects[from]);
    return next;
  });
}

export function setEffectParams(montage: Montage, trackId: string, effectId: string, params: Record<string, EffectValue>): Montage {
  return mapEffect(montage, trackId, effectId, (e) => ({ ...e, params: { ...e.params, ...params } }));
}

export function setEffectBypass(montage: Montage, trackId: string, effectId: string, bypass: boolean): Montage {
  return mapEffect(montage, trackId, effectId, ({ bypass: _, ...e }) => (bypass ? { ...e, bypass: true } : e));
}

/** Sets all the parameters of an effect to a preset (the ones it leaves out to their default). */
export function applyPreset(montage: Montage, trackId: string, effectId: string, preset: EffectPreset | null): Montage {
  return mapEffect(montage, trackId, effectId, (e) => ({ ...e, params: { ...defaultParams(e.type), ...(preset?.params ?? {}) } }));
}

/** Replaces the whole chain of a track. */
export function setTrackEffects(montage: Montage, trackId: string, effects: TrackEffect[]): Montage {
  return withEffects(montage, trackId, () => effects);
}

// --- tails ------------------------------------------------------------------------------------

/** Longest tail kept after the end of the montage (s). */
const MAX_TAIL = 15;

/** Delay of an echo at a tempo (s). */
export function echoDelay(effect: TrackEffect, bpm: number): number {
  const beats = ECHO_DIVISIONS[String(effect.params['time'])] ?? ECHO_DIVISIONS['1/8'];
  return Math.min(4, (beats * 60) / bpm);
}

/** Decay of a reverb to -60 dB (s), from its size. */
export const reverbDecay = (effect: TrackEffect) => 0.3 + Math.pow(numberParam(effect, 'size') / 100, 1.5) * 5.7;

/**
 * How long the active effects of a chain keep sounding after the audio stops (echo repeats,
 * reverb decay), so that the export does not cut them.
 */
export function effectsTail(effects: readonly TrackEffect[] | undefined, bpm: number): number {
  let tail = 0;
  for (const effect of effects ?? []) {
    if (effect.bypass) continue;
    if (effect.type === 'echo') {
      const delay = echoDelay(effect, bpm);
      const feedback = numberParam(effect, 'feedback') / 100;
      // repeats until they fall under -60 dB
      const repeats = feedback > 0 ? Math.min(60, Math.ceil(Math.log(0.001) / Math.log(feedback))) : 0;
      tail += delay * (repeats + 1);
    } else if (effect.type === 'reverb') {
      tail += numberParam(effect, 'predelay') / 1000 + reverbDecay(effect);
    }
  }
  return Math.min(MAX_TAIL, tail);
}
