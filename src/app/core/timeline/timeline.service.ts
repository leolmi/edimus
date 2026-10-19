import { Injectable, computed, inject, signal } from '@angular/core';
import { AudioLibraryService } from '../audio/audio-library.service';
import { Clip, clipRate } from '../montage/montage.model';
import { MontageService } from '../montage/montage.service';

const MIN_PX_PER_SEC = 0.05;
const MAX_PX_PER_SEC = 50000;

/**
 * Bar marking: the user clicks the 1 of a bar, then moves and stretches the grid of that one
 * bar (beatsPerBar columns) over the waveform. Times in source seconds.
 */
export interface BarMarking {
  clipId: string;
  sourceId: string;
  beatsPerBar: number;
  bpm: number;
  /** Start of the marked bar; null until the user clicks it. */
  downbeat: number | null;
}

/** Zoom and horizontal scroll of the timeline, shared by the ruler and all the tracks. */
@Injectable({ providedIn: 'root' })
export class TimelineService {
  private readonly montages = inject(MontageService);
  private readonly library = inject(AudioLibraryService);

  /** Zoom: pixels per second. */
  readonly pxPerSec = signal(100);
  /** Time (seconds) at the left edge of the lanes. */
  readonly scroll = signal(0);
  /** Width (px) of the lanes viewport. */
  readonly viewWidth = signal(0);
  /** Selected clip. */
  readonly selectedClipId = signal<string | null>(null);
  /** Bar marking in progress, to set the tempo of the clip's source by hand. */
  readonly beatMarking = signal<BarMarking | null>(null);
  /** Shows the beat grid of the clips with a known tempo. */
  readonly beatGrid = signal(false);
  /** When on, pointer gestures on the lanes edit the volume envelopes. */
  readonly envelopeMode = signal(false);
  /** Selected time range (seconds), across all the tracks. */
  readonly range = signal<{ start: number; end: number } | null>(null);

  /** End of the last clip of the montage (seconds). */
  readonly duration = computed(() => {
    let end = 0;
    for (const track of this.montages.montage().tracks) {
      for (const clip of track.clips) end = Math.max(end, clip.start + this.clipLength(clip));
    }
    return end;
  });

  /** Visible length when scrolled to the end: the montage plus some room after it. */
  readonly extent = computed(() => Math.max(this.duration() * 1.05, this.viewWidth() / this.pxPerSec()));

  /** Length of the source of a clip (seconds), 0 while not decoded. */
  sourceLength(clip: Clip): number {
    return this.library.ready(clip.sourceId)?.buffer.duration ?? 0;
  }

  /** Length of a clip on the timeline: its source portion divided by its speed, or the rest of the source when 0. */
  clipLength(clip: Clip): number {
    if (clip.duration > 0) return clip.duration / clipRate(clip);
    const source = this.library.ready(clip.sourceId);
    return source ? Math.max(0, source.buffer.duration - clip.offset) / clipRate(clip) : 0;
  }

  timeToX(time: number): number {
    return (time - this.scroll()) * this.pxPerSec();
  }

  xToTime(x: number): number {
    return this.scroll() + x / this.pxPerSec();
  }

  setScroll(time: number): void {
    const max = Math.max(0, this.extent() - this.viewWidth() / this.pxPerSec());
    this.scroll.set(Math.min(max, Math.max(0, time)));
  }

  /** Scrolls so that `time` is in the middle of the view (as close as the ends allow). */
  centerOn(time: number): void {
    this.setScroll(time - this.viewWidth() / 2 / this.pxPerSec());
  }

  /** Multiplies the zoom keeping the time under `anchorX` (default: center) still. */
  zoomBy(factor: number, anchorX = this.viewWidth() / 2): void {
    const anchor = this.xToTime(anchorX);
    const px = Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, this.pxPerSec() * factor));
    this.pxPerSec.set(px);
    this.setScroll(anchor - anchorX / px);
  }

  /** Fits the whole montage in the viewport. */
  fit(): void {
    const duration = this.duration();
    const width = this.viewWidth();
    if (duration <= 0 || width <= 0) return;
    this.pxPerSec.set(Math.min(MAX_PX_PER_SEC, Math.max(MIN_PX_PER_SEC, width / (duration * 1.02))));
    this.scroll.set(0);
  }
}
