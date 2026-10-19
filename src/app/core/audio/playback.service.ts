import { Injectable, effect, inject, signal, untracked } from '@angular/core';
import { MontageService } from '../montage/montage.service';
import { SettingsService } from '../settings.service';
import { TimelineService } from '../timeline/timeline.service';
import { AudioLibraryService } from './audio-library.service';
import { MixService, ScheduledMix, releaseMix } from './mix.service';
import { ProcessedAudioService } from './processed-audio.service';

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
  private mix?: ScheduledMix;
  /** Context time and montage time at the start of the playback. */
  private startedAt = { context: 0, position: 0 };
  private frame = 0;

  constructor() {
    // edits or sources decoded while playing: reschedule
    effect(() => {
      this.montages.montage();
      this.library.sources();
      this.processed.renders();
      untracked(() => {
        if (this.playing()) this.play(this.currentPosition());
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
      untracked(() => this.stop());
    });
  }

  toggle(): void {
    if (this.playing()) this.pause();
    else this.play();
  }

  /** Starts playing from `from` (default: the playhead; from the start when it is at the end). */
  play(from = this.position()): void {
    const duration = this.timeline.duration();
    if (duration <= 0) return;
    if (from >= duration) from = 0;
    this.stopNodes();
    const ctx = this.audioContext();
    void ctx.resume();
    const when = ctx.currentTime + 0.03;
    this.mix = this.mixer.schedule(ctx, this.master!, from, when);
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

  /** Stops and brings the playhead back to the start. */
  stop(): void {
    this.halt();
    this.position.set(0);
  }

  /** Moves the playhead; playback, if running, continues from there. */
  seek(time: number): void {
    const position = Math.max(0, Math.min(this.timeline.duration(), time));
    if (this.playing()) this.play(position);
    else this.position.set(position);
  }

  private tick(): void {
    if (!this.playing()) return;
    const position = this.currentPosition();
    if (position >= this.timeline.duration()) {
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
    return this.startedAt.position + Math.max(0, ctx.currentTime - this.startedAt.context);
  }

  private halt(): void {
    cancelAnimationFrame(this.frame);
    this.stopNodes();
    this.playing.set(false);
  }

  private stopNodes(): void {
    if (this.mix) releaseMix(this.mix);
    this.mix = undefined;
  }

  private audioContext(): AudioContext {
    if (!this.context) {
      this.context = new AudioContext({ latencyHint: 'interactive' });
      this.master = this.context.createGain();
      this.master.gain.value = this.settings.muted() ? 0 : this.settings.volume();
      this.master.connect(this.context.destination);
    }
    return this.context;
  }
}
