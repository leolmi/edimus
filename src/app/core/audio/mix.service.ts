import { Injectable, computed, inject } from '@angular/core';
import { EffectChain } from '../effects/effect-nodes';
import { TrackEffect, effectsTail } from '../effects/effects';
import { automate, clipEnvelopeOnTimeline, clipGainAt } from '../montage/envelope';
import { Clip, Montage, Track, audibleTracks, clipRate, isProcessed, trackVolume } from '../montage/montage.model';
import { MontageService } from '../montage/montage.service';
import { TimelineService } from '../timeline/timeline.service';
import { AudioLibraryService } from './audio-library.service';
import { ProcessedAudioService } from './processed-audio.service';
import { TempoService } from './tempo.service';

/** Level under which the mix counts as silence (-60 dBFS). */
const SILENCE = 0.001;
/** Length of the blocks scanned for the audible span (10 ms). */
const BLOCK = 0.01;

/** Span of the mix that is heard, in timeline seconds. */
export interface AudibleRange {
  start: number;
  end: number;
}

/** Tempo the echoes follow when the track has none. */
const DEFAULT_BPM = 120;

/** Nodes of a track in a scheduled mix, changed live (volume, effect values). */
interface ScheduledTrack {
  volume: GainNode;
  effects: EffectChain;
}

/** Nodes of a scheduled mix, to stop and release them. */
export interface ScheduledMix {
  sources: AudioBufferSourceNode[];
  gains: GainNode[];
  tracks: Map<string, ScheduledTrack>;
}

const sameChain = (a: readonly TrackEffect[] = [], b: readonly TrackEffect[] = []) =>
  a.length === b.length && a.every((e, i) => e.id === b[i].id && e.type === b[i].type);

/**
 * True when `b` differs from `a` only in what a scheduled mix changes live (track volumes,
 * values and bypass of the effects): no need to schedule it again.
 */
export function differsOnlyLive(a: Montage, b: Montage): boolean {
  if (a.sources !== b.sources || a.channels !== b.channels || a.tracks.length !== b.tracks.length) return false;
  return a.tracks.every((t, i) => {
    const u = b.tracks[i];
    return t.id === u.id && t.clips === u.clips && !!t.muted === !!u.muted && !!t.solo === !!u.solo && sameChain(t.effects, u.effects);
  });
}

/**
 * Builds the audio graph of the montage on a context: for each audible track, one buffer source
 * per clip (through a gain automated by the clip's envelope when it has one) into the chain of
 * its effects, then a gain node with its volume. Used by both the live
 * playback and the offline render of the export, so they sound the same.
 */
@Injectable({ providedIn: 'root' })
export class MixService {
  private readonly montages = inject(MontageService);
  private readonly library = inject(AudioLibraryService);
  private readonly timeline = inject(TimelineService);
  private readonly processed = inject(ProcessedAudioService);
  private readonly tempos = inject(TempoService);

  /**
   * Schedules the montage from montage time `from` (up to `until`, default the end), played at
   * context time `when`.
   */
  schedule(ctx: BaseAudioContext, destination: AudioNode, from: number, when: number, until = Infinity): ScheduledMix {
    const mix: ScheduledMix = { sources: [], gains: [], tracks: new Map() };
    for (const track of audibleTracks(this.montages.montage())) {
      const volume = ctx.createGain();
      volume.connect(destination);
      volume.gain.value = trackVolume(track);
      mix.gains.push(volume);
      const effects = new EffectChain(ctx, track.effects ?? [], this.trackBpm(track));
      effects.output.connect(volume);
      mix.tracks.set(track.id, { volume, effects });
      const input = effects.input;
      for (const clip of track.clips) {
        const buffer = this.bufferOf(clip);
        const length = this.timeline.clipLength(clip);
        if (!buffer || clip.start + length <= from || clip.start >= until) continue;
        const node = ctx.createBufferSource();
        node.buffer = buffer;
        if (clip.envelope?.length) {
          // the fades of the clip, on its own gain
          const fades = ctx.createGain();
          automate(fades.gain, clipEnvelopeOnTimeline(clip), from, when);
          fades.connect(input);
          mix.gains.push(fades);
          node.connect(fades);
        } else {
          node.connect(input);
        }
        const delay = Math.max(0, clip.start - from);
        const skip = Math.max(0, from - clip.start);
        const play = Math.min(length, until - clip.start) - skip;
        // processed clips play their portion of the rendered source (rendered time = source time / rate)
        node.start(when + delay, clip.offset / clipRate(clip) + skip, play);
        mix.sources.push(node);
      }
    }
    return mix;
  }

  /** Applies to a scheduled mix the live changes of `montage` (see `differsOnlyLive`). */
  update(mix: ScheduledMix, montage: Montage): void {
    for (const track of audibleTracks(montage)) {
      const scheduled = mix.tracks.get(track.id);
      if (!scheduled) continue;
      scheduled.volume.gain.setTargetAtTime(trackVolume(track), scheduled.volume.context.currentTime, 0.015);
      scheduled.effects.update(track.effects ?? [], this.trackBpm(track));
    }
  }

  /** Seconds the effects of the audible tracks keep sounding after the end of the montage. */
  tail(): number {
    return Math.max(0, ...audibleTracks(this.montages.montage()).map((t) => effectsTail(t.effects, this.trackBpm(t))));
  }

  /** Tempo the echoes of a track follow: the one heard in its first clip. */
  trackBpm(track: Track): number {
    const first = track.clips.reduce<Clip | undefined>((a, c) => (!a || c.start < a.start ? c : a), undefined);
    return (first && this.tempos.clipBpm(first)) || DEFAULT_BPM;
  }

  /**
   * Span of the mix that is heard: from the first to the last 10 ms block above -60 dBFS of the
   * audible clips, envelopes and track volumes included (the leading and trailing silences
   * left out, as a trim would). Null when nothing is heard or some audio is not ready yet.
   */
  readonly audibleRange = computed<AudibleRange | null>(() => {
    const tracks = audibleTracks(this.montages.montage());
    let start = Infinity;
    let end = -Infinity;
    for (const track of tracks) {
      for (const clip of track.clips) {
        const buffer = this.bufferOf(clip);
        if (!buffer) return null;
        const length = this.timeline.clipLength(clip);
        const level = (t: number) => this.blockPeak(buffer, clip, t) * trackVolume(track) * clipGainAt(clip, t + BLOCK / 2);
        // from each end towards the middle, stopping where another clip already did better
        for (let t = clip.start; t < Math.min(clip.start + length, start); t += BLOCK) {
          if (level(t) >= SILENCE) {
            start = t;
            break;
          }
        }
        for (let t = clip.start + length - BLOCK; t >= clip.start && t + BLOCK > end; t -= BLOCK) {
          if (level(t) >= SILENCE) {
            end = Math.min(clip.start + length, t + BLOCK);
            break;
          }
        }
      }
    }
    return end > start ? { start, end } : null;
  });

  /** Peak of the samples of a clip in the block starting at timeline time `t`. */
  private blockPeak(buffer: AudioBuffer, clip: Clip, t: number): number {
    // position in the buffer as played (see schedule): rendered time for processed clips
    const from = Math.max(0, Math.floor((clip.offset / clipRate(clip) + t - clip.start) * buffer.sampleRate));
    const to = Math.min(buffer.length, from + Math.ceil(BLOCK * buffer.sampleRate));
    let peak = 0;
    for (let c = 0; c < buffer.numberOfChannels; c++) {
      const data = buffer.getChannelData(c);
      for (let i = from; i < to; i++) {
        const v = Math.abs(data[i]);
        if (v > peak) peak = v;
      }
    }
    return peak;
  }

  /** True when every clip has its audio ready (decoded, and rendered when processed). */
  isComplete(): boolean {
    return this.montages.montage().tracks.every((t) => t.clips.every((c) => this.bufferOf(c) !== undefined));
  }

  /** Highest sample rate among the sources (the natural rate of the mixdown). */
  sampleRate(): number {
    const rates = this.montages
      .montage()
      .sources.map((s) => this.library.ready(s.id)?.buffer.sampleRate ?? 0)
      .filter((r) => r > 0);
    return rates.length ? Math.max(...rates) : 44100;
  }

  private bufferOf(clip: Clip): AudioBuffer | undefined {
    return isProcessed(clip) ? this.processed.ready(clip)?.buffer : this.library.ready(clip.sourceId)?.buffer;
  }
}

/** Stops and disconnects the nodes of a mix. */
export function releaseMix(mix: ScheduledMix): void {
  for (const node of mix.sources) {
    try {
      node.stop();
    } catch {
      // never started
    }
    node.disconnect();
  }
  for (const gain of mix.gains) gain.disconnect();
  for (const track of mix.tracks.values()) track.effects.disconnect();
}

