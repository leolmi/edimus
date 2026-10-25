import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { MontageService } from '../montage/montage.service';
import { SettingsService } from '../settings.service';
import { TimelineService } from '../timeline/timeline.service';
import { AudioLibraryService } from './audio-library.service';
import { MixService, ScheduledMix, differsOnlyLive, releaseMix } from './mix.service';
import { ProcessedAudioService } from './processed-audio.service';

/** Distance (s) from the start point within which the playhead counts as on it. */
const CUE_TOLERANCE = 0.001;
/** Shortest range (s) the loop repeats. */
const MIN_LOOP = 0.05;

/** Plays the montage, scheduling its mix (see MixService) on a shared AudioContext. */
@Injectable({ providedIn: 'root' })
export class PlaybackService {
  private readonly montages = inject(MontageService);
  private readonly library = inject(AudioLibraryService);
  private readonly timeline = inject(TimelineService);
  private readonly processed = inject(ProcessedAudioService);
  private readonly mixer = inject(MixService);
  private readonly settings = inject(SettingsService);

  readonly playing = signal(false);
  /** Playhead position (seconds). */
  readonly position = signal(0);

  private context?: AudioContext;
  private master?: GainNode;
  /** Scheduled mixes: one, or the passes of the loop queued ahead. */
  private mixes: ScheduledMix[] = [];
  /** Context time and montage time at the start of the playback. */
  private startedAt = { context: 0, position: 0 };
  /** Loop of the running playback, with the context time of the last pass scheduled. */
  private looping: { start: number; end: number; lastPassAt: number } | null = null;
  /** Repeats the selected time range (when there is one). */
  readonly loop = signal(false);
  /** Start point fixed by a click on the ruler: every stop goes back there (see stop). */
  readonly cue = signal<number | null>(null);
  private frame = 0;

  constructor() {
    // edits or sources decoded while playing: reschedule; volumes and effect values change live
    let previous = this.montages.montage();
    effect(() => {
      const montage = this.montages.montage();
      this.library.sources();
      this.processed.renders();
      untracked(() => {
        const before = previous;
        previous = montage;
        if (!this.playing()) return;
        if (montage !== before && differsOnlyLive(before, montage)) {
          for (const mix of this.mixes) this.mixer.update(mix, montage);
        } else {
          this.play(this.currentPosition());
        }
      });
    });
    // loop switched or range changed while playing: reschedule
    effect(() => {
      this.loop();
      this.timeline.range();
      untracked(() => {
        if (this.playing()) this.play(this.currentPosition());
      });
    });
    // output device chosen in the settings
    effect(() => {
      const id = this.settings.audioOutput()?.id ?? '';
      untracked(() => {
        if (this.context) void this.applyOutput(this.context, id);
      });
    });
    // listening volume on the master gain (short ramp to avoid clicks)
    effect(() => {
      const gain = this.settings.muted() ? 0 : this.settings.volume();
      if (this.master && this.context) this.master.gain.setTargetAtTime(gain, this.context.currentTime, 0.015);
    });
    // a new montage resets the playback
    effect(() => {
      this.montages.generation();
      untracked(() => {
        this.cue.set(null);
        this.stop();
      });
    });
  }

  toggle(): void {
    if (this.playing()) this.pause();
    else this.play();
  }

  /**
   * Starts playing from `from` (default: the playhead; from the start when it is at the end).
   * In loop, a playhead outside the range starts from the range start.
   */
  play(from = this.position()): void {
    const duration = this.timeline.duration();
    if (duration <= 0) return;
    if (from >= duration) from = 0;
    this.stopNodes();
    const ctx = this.audioContext();
    void ctx.resume();
    const when = ctx.currentTime + 0.03;
    const range = this.loopRange();
    if (range) {
      if (from < range.start || from >= range.end) from = range.start;
      // this pass up to the end of the range, and the next whole one already queued
      const next = when + (range.end - from);
      this.mixes = [
        this.mixer.schedule(ctx, this.master!, from, when, range.end),
        this.mixer.schedule(ctx, this.master!, range.start, next, range.end),
      ];
      this.looping = { ...range, lastPassAt: next };
    } else {
      this.mixes = [this.mixer.schedule(ctx, this.master!, from, when)];
      this.looping = null;
    }
    this.startedAt = { context: when, position: from };
    this.position.set(from);
    this.playing.set(true);
    cancelAnimationFrame(this.frame);
    this.frame = requestAnimationFrame(() => this.tick());
  }

  pause(): void {
    if (!this.playing()) return;
    this.position.set(this.currentPosition());
    this.halt();
  }

  /**
   * Stops and brings the playhead back to the start point; when it is already there, the
   * start point is dropped and the playhead goes to the start of the montage.
   */
  stop(): void {
    this.halt();
    const cue = this.cue();
    if (cue !== null && Math.abs(this.position() - cue) > CUE_TOLERANCE) {
      this.position.set(cue);
    } else {
      this.cue.set(null);
      this.position.set(0);
    }
  }

  /** Fixes the start point the stops go back to. */
  setCue(time: number): void {
    this.cue.set(Math.max(0, Math.min(this.timeline.duration(), time)));
  }

  /** Moves the playhead; playback, if running, continues from there. */
  seek(time: number): void {
    const position = Math.max(0, Math.min(this.timeline.duration(), time));
    if (this.playing()) this.play(position);
    else this.position.set(position);
  }

  /** Gain reduction (dB, ≤ 0) of an effect of a track at this moment of the playback; 0 when stopped. */
  reduction(trackId: string, effectId: string): number {
    return this.playing() ? (this.mixes[0]?.tracks.get(trackId)?.effects.reduction(effectId) ?? 0) : 0;
  }

  /** Selected range the playback repeats, when the loop is on and the range is long enough. */
  private loopRange(): { start: number; end: number } | null {
    const range = this.timeline.range();
    return this.loop() && range && range.end - range.start >= MIN_LOOP ? range : null;
  }

  private tick(): void {
    if (!this.playing()) return;
    const ctx = this.context!;
    const looping = this.looping;
    if (looping && ctx.currentTime >= looping.lastPassAt) {
      // the last queued pass has begun: drop the finished one and queue the following
      const next = looping.lastPassAt + (looping.end - looping.start);
      const done = this.mixes.shift();
      if (done) releaseMix(done);
      this.mixes.push(this.mixer.schedule(ctx, this.master!, looping.start, next, looping.end));
      looping.lastPassAt = next;
    }
    const position = this.currentPosition();
    if (!looping && position >= this.timeline.duration()) {
      this.halt();
      this.position.set(this.timeline.duration());
      return;
    }
    this.position.set(position);
    this.frame = requestAnimationFrame(() => this.tick());
  }

  private currentPosition(): number {
    const ctx = this.context;
    if (!ctx) return this.position();
    const elapsed = Math.max(0, ctx.currentTime - this.startedAt.context);
    const looping = this.looping;
    if (!looping) return this.startedAt.position + elapsed;
    // first (partial) pass, then whole passes of the range
    const first = looping.end - this.startedAt.position;
    if (elapsed < first) return this.startedAt.position + elapsed;
    return looping.start + ((elapsed - first) % (looping.end - looping.start));
  }

  private halt(): void {
    cancelAnimationFrame(this.frame);
    this.stopNodes();
    this.playing.set(false);
  }

  private stopNodes(): void {
    for (const mix of this.mixes) releaseMix(mix);
    this.mixes = [];
    this.looping = null;
  }

  private audioContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.master.gain.value = this.settings.muted() ? 0 : this.settings.volume();
      this.master.connect(this.context.destination);
      const id = this.settings.audioOutput()?.id;
      if (id) void this.applyOutput(this.context, id);
    }
    return this.context;
  }

  /** Sends the playback to an output device ('' = system default); a missing device falls back to the default. */
  private async applyOutput(ctx: AudioContext, id: string): Promise<void> {
    const sink = ctx as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    if (!sink.setSinkId) return;
    try {
      await sink.setSinkId(id);
    } catch (err) {
      console.warn('Audio output not available, using the default one', err);
      await sink.setSinkId('').catch(() => undefined);
    }
  }
}
