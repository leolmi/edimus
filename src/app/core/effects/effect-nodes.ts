import { TrackEffect, echoDelay, numberParam, reverbDecay } from './effects';

/** Time constant of the ramps of the live changes (s): smooth, no clicks. */
const RAMP = 0.015;

const dbToGain = (db: number) => Math.pow(10, db / 20);

/** Sets an audio parameter: at once while building, with a short ramp while playing. */
function setParam(param: AudioParam, value: number, ctx: BaseAudioContext, immediate: boolean): void {
  if (immediate) param.value = value;
  else param.setTargetAtTime(value, ctx.currentTime, RAMP);
}

/** Equal-power dry/wet levels of a mix percentage. */
function dryWet(mix: number): [number, number] {
  const m = (Math.max(0, Math.min(100, mix)) / 100) * (Math.PI / 2);
  return [Math.cos(m), Math.sin(m)];
}

/** Audio core of an effect: from `input` to `output`, updated in place when its values change. */
interface EffectCore {
  input: AudioNode;
  output: AudioNode;
  update(effect: TrackEffect, bpm: number, immediate: boolean): void;
  reduction?(): number;
}

function eqCore(ctx: BaseAudioContext): EffectCore {
  const lowCut = new BiquadFilterNode(ctx, { type: 'highpass', Q: Math.SQRT1_2 });
  const low = new BiquadFilterNode(ctx, { type: 'lowshelf', frequency: 200 });
  const mid = new BiquadFilterNode(ctx, { type: 'peaking', Q: 0.9 });
  const high = new BiquadFilterNode(ctx, { type: 'highshelf', frequency: 4000 });
  lowCut.connect(low).connect(mid).connect(high);
  return {
    input: lowCut,
    output: high,
    update(effect, _bpm, now) {
      setParam(lowCut.frequency, numberParam(effect, 'lowCut'), ctx, now);
      setParam(low.gain, numberParam(effect, 'low'), ctx, now);
      setParam(mid.gain, numberParam(effect, 'mid'), ctx, now);
      setParam(mid.frequency, numberParam(effect, 'midFreq'), ctx, now);
      setParam(high.gain, numberParam(effect, 'high'), ctx, now);
    },
  };
}

function compressorCore(ctx: BaseAudioContext): EffectCore {
  const compressor = new DynamicsCompressorNode(ctx, { knee: 6 });
  const makeup = new GainNode(ctx);
  compressor.connect(makeup);
  return {
    input: compressor,
    output: makeup,
    update(effect, _bpm, now) {
      setParam(compressor.threshold, numberParam(effect, 'threshold'), ctx, now);
      setParam(compressor.ratio, numberParam(effect, 'ratio'), ctx, now);
      setParam(compressor.attack, numberParam(effect, 'attack') / 1000, ctx, now);
      setParam(compressor.release, numberParam(effect, 'release') / 1000, ctx, now);
      setParam(makeup.gain, dbToGain(numberParam(effect, 'makeup')), ctx, now);
    },
    reduction: () => compressor.reduction,
  };
}

/** Echo: the dry signal plus repeats through a filtered feedback loop, at a division of the tempo. */
function echoCore(ctx: BaseAudioContext): EffectCore {
  const input = new GainNode(ctx);
  const output = new GainNode(ctx);
  const delay = new DelayNode(ctx, { maxDelayTime: 4 });
  const tone = new BiquadFilterNode(ctx, { type: 'lowpass' });
  const feedback = new GainNode(ctx);
  const wet = new GainNode(ctx);
  input.connect(output);
  input.connect(delay).connect(tone).connect(feedback).connect(delay);
  tone.connect(wet).connect(output);
  return {
    input,
    output,
    update(effect, bpm, now) {
      setParam(delay.delayTime, echoDelay(effect, bpm), ctx, now);
      setParam(tone.frequency, numberParam(effect, 'tone'), ctx, now);
      setParam(feedback.gain, numberParam(effect, 'feedback') / 100, ctx, now);
      setParam(wet.gain, numberParam(effect, 'mix') / 100, ctx, now);
    },
  };
}

/**
 * Impulse response of a room: decorrelated noise per channel decaying to -60 dB in `decay`
 * seconds, darker and darker with time by the damping. The noise is seeded: the live playback
 * and the export get the same reverb.
 */
function roomResponse(ctx: BaseAudioContext, decay: number, damping: number): AudioBuffer {
  const rate = ctx.sampleRate;
  const length = Math.max(1, Math.floor(decay * rate));
  const buffer = ctx.createBuffer(2, length, rate);
  let seed = 0x2f6b;
  const noise = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return (seed / 0x3fffffff) - 1;
  };
  for (let c = 0; c < 2; c++) {
    const data = buffer.getChannelData(c);
    let smooth = 0;
    for (let i = 0; i < length; i++) {
      const t = i / length;
      // one-pole low-pass closing with time: the high frequencies die first
      const open = 1 - damping * 0.97 * Math.min(1, t * 2);
      smooth += open * (noise() - smooth);
      data[i] = smooth * Math.exp(-6.9 * t);
    }
  }
  return buffer;
}

function reverbCore(ctx: BaseAudioContext): EffectCore {
  const input = new GainNode(ctx);
  const output = new GainNode(ctx);
  const dry = new GainNode(ctx);
  const predelay = new DelayNode(ctx, { maxDelayTime: 0.5 });
  const convolver = new ConvolverNode(ctx);
  const wet = new GainNode(ctx);
  input.connect(dry).connect(output);
  input.connect(predelay).connect(convolver).connect(wet).connect(output);
  let room = '';
  return {
    input,
    output,
    update(effect, _bpm, now) {
      const decay = reverbDecay(effect);
      const damping = numberParam(effect, 'damping') / 100;
      // the response is rebuilt only when the room changes
      const key = `${decay}:${damping}`;
      if (key !== room) {
        room = key;
        convolver.buffer = roomResponse(ctx, decay, damping);
      }
      setParam(predelay.delayTime, numberParam(effect, 'predelay') / 1000, ctx, now);
      const [d, w] = dryWet(numberParam(effect, 'mix'));
      setParam(dry.gain, d, ctx, now);
      setParam(wet.gain, w, ctx, now);
    },
  };
}

/** Saturation curve: tanh with `drive` (linear gain), normalized so that full scale stays full scale. */
function saturationCurve(drive: number): Float32Array<ArrayBuffer> {
  const curve = new Float32Array(2048);
  const norm = Math.tanh(drive);
  for (let i = 0; i < curve.length; i++) {
    const x = (i / (curve.length - 1)) * 2 - 1;
    curve[i] = Math.tanh(drive * x) / norm;
  }
  return curve;
}

function saturationCore(ctx: BaseAudioContext): EffectCore {
  const input = new GainNode(ctx);
  const output = new GainNode(ctx);
  const dry = new GainNode(ctx);
  const shaper = new WaveShaperNode(ctx, { oversample: '2x' });
  const tone = new BiquadFilterNode(ctx, { type: 'lowpass' });
  const wet = new GainNode(ctx);
  input.connect(dry).connect(output);
  input.connect(shaper).connect(tone).connect(wet).connect(output);
  let drive = NaN;
  return {
    input,
    output,
    update(effect, _bpm, now) {
      const d = dbToGain(numberParam(effect, 'drive'));
      if (d !== drive) {
        drive = d;
        shaper.curve = saturationCurve(d);
      }
      setParam(tone.frequency, numberParam(effect, 'tone'), ctx, now);
      const [dr, w] = dryWet(numberParam(effect, 'mix'));
      setParam(dry.gain, dr, ctx, now);
      setParam(wet.gain, w, ctx, now);
      setParam(output.gain, dbToGain(numberParam(effect, 'output')), ctx, now);
    },
  };
}

const CORES: Record<TrackEffect['type'], (ctx: BaseAudioContext) => EffectCore> = {
  eq: eqCore,
  compressor: compressorCore,
  echo: echoCore,
  reverb: reverbCore,
  saturation: saturationCore,
};

/** An effect of the chain: its core, with a bypass path switched by crossfade. */
class EffectInstance {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly core: EffectCore;
  private readonly through: GainNode;
  private readonly processed: GainNode;

  constructor(
    private readonly ctx: BaseAudioContext,
    readonly id: string,
    effect: TrackEffect,
    bpm: number,
  ) {
    this.input = new GainNode(ctx);
    this.output = new GainNode(ctx);
    this.core = CORES[effect.type](ctx);
    this.through = new GainNode(ctx);
    this.processed = new GainNode(ctx);
    this.input.connect(this.through).connect(this.output);
    this.input.connect(this.core.input);
    this.core.output.connect(this.processed).connect(this.output);
    this.update(effect, bpm, true);
  }

  update(effect: TrackEffect, bpm: number, immediate = false): void {
    this.core.update(effect, bpm, immediate);
    setParam(this.through.gain, effect.bypass ? 1 : 0, this.ctx, immediate);
    setParam(this.processed.gain, effect.bypass ? 0 : 1, this.ctx, immediate);
  }

  reduction(): number {
    return this.core.reduction?.() ?? 0;
  }

  disconnect(): void {
    this.input.disconnect();
    this.output.disconnect();
    this.core.output.disconnect();
  }
}

/**
 * The effects of a track as audio nodes: `input` (the sum of the clips) through each effect in
 * order to `output`. Changes of values and bypass apply live (`update`); adding, removing or
 * reordering effects needs a new chain.
 */
export class EffectChain {
  readonly input: GainNode;
  readonly output: GainNode;
  private readonly effects: EffectInstance[];

  constructor(ctx: BaseAudioContext, effects: readonly TrackEffect[], bpm: number) {
    this.input = new GainNode(ctx);
    this.output = new GainNode(ctx);
    this.effects = effects.map((e) => new EffectInstance(ctx, e.id, e, bpm));
    let last: AudioNode = this.input;
    for (const effect of this.effects) {
      last.connect(effect.input);
      last = effect.output;
    }
    last.connect(this.output);
  }

  /** Applies new values of the same effects (same ids, same order). */
  update(effects: readonly TrackEffect[], bpm: number): void {
    for (const effect of effects) this.effects.find((e) => e.id === effect.id)?.update(effect, bpm);
  }

  /** Gain reduction (dB, ≤ 0) of an effect at this moment: 0 for the effects that do not reduce. */
  reduction(effectId: string): number {
    return this.effects.find((e) => e.id === effectId)?.reduction() ?? 0;
  }

  disconnect(): void {
    this.input.disconnect();
    this.output.disconnect();
    for (const effect of this.effects) effect.disconnect();
  }
}
