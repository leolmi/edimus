import { Injectable, inject } from '@angular/core';
import { automate, clipEnvelopeOnTimeline } from '../montage/envelope';
import { Clip, audibleTracks, clipRate, isProcessed, trackVolume } from '../montage/montage.model';
import { MontageService } from '../montage/montage.service';
import { TimelineService } from '../timeline/timeline.service';
import { AudioLibraryService } from './audio-library.service';
import { ProcessedAudioService } from './processed-audio.service';

/** Nodes of a scheduled mix, to stop and release them. */
export interface ScheduledMix {
  sources: AudioBufferSourceNode[];
  gains: GainNode[];
}

/**
 * Builds the audio graph of the montage on a context: one gain node per audible track (its
 * volume) fed by one buffer source per clip, through a gain automated by the clip's envelope
 * when it has one. Used by both the live
 * playback and the offline render of the export, so they sound the same.
 */
@Injectable({ providedIn: 'root' })
export class MixService {
  private readonly montages = inject(MontageService);
  private readonly library = inject(AudioLibraryService);
  private readonly timeline = inject(TimelineService);
  private readonly processed = inject(ProcessedAudioService);

  /**
   * Schedules the montage from montage time `from` (up to `until`, default the end), played at
   * context time `when`.
   */
  schedule(ctx: BaseAudioContext, destination: AudioNode, from: number, when: number, until = Infinity): ScheduledMix {
    const mix: ScheduledMix = { sources: [], gains: [] };
    for (const track of audibleTracks(this.montages.montage())) {
      const gain = ctx.createGain();
      gain.connect(destination);
      gain.gain.value = trackVolume(track);
      mix.gains.push(gain);
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
          fades.connect(gain);
          mix.gains.push(fades);
          node.connect(fades);
        } else {
          node.connect(gain);
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
}

