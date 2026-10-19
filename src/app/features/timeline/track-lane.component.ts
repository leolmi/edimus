import { ChangeDetectionStrategy, Component, ElementRef, effect, inject, input, signal, viewChild } from '@angular/core';
import { AudioLibraryService } from '../../core/audio/audio-library.service';
import { rangePeak } from '../../core/audio/peaks';
import { MAX_GAIN, gainAt, gainToDb } from '../../core/montage/envelope';
import { Clip, Track, clipRate, isProcessed } from '../../core/montage/montage.model';
import { ProcessedAudioService } from '../../core/audio/processed-audio.service';
import { beatsPerBar } from '../../core/audio/tempo';
import { TempoService } from '../../core/audio/tempo.service';
import { sourceColors } from '../../core/source-colors';
import { CanvasColors, ThemeColorsService } from '../../core/theme-colors.service';
import { MontageService } from '../../core/montage/montage.service';
import { TimelineService } from '../../core/timeline/timeline.service';
import { observeSize, prepareCanvas } from './canvas';

/** Distance (px) from a clip edge within which the pointer grabs the edge to trim it. */
const EDGE_GRAB = 6;

export interface ClipHit {
  clip: Clip;
  /** Part of the clip under the pointer. */
  zone: 'start' | 'end' | 'body';
}

/** Distance (px) within which the pointer grabs an envelope point. */
const POINT_GRAB = 7;
/** Vertical margin (px) of the envelope area inside the lane. */
const ENVELOPE_MARGIN = 6;

/** Vertical gap between the channels of a stereo clip. */
const CHANNEL_GAP = 2;

/** Lane of a track: its clips with the waveform of their source (one row per channel). */
@Component({
  selector: 'app-track-lane',
  template: '<canvas #canvas></canvas>',
  styles: ':host { display: block; position: relative; overflow: hidden; } canvas { position: absolute; inset: 0; }',
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: { '[style.cursor]': 'cursor()', '(pointermove)': 'onHover($event)', '(pointerleave)': 'cursor.set(null)' },
})
export class TrackLaneComponent {
  readonly track = input.required<Track>();
  /** Muted or excluded by a solo: drawn dimmed. */
  readonly silent = input(false);
  /** Index of the envelope point being dragged: its value is shown next to it. */
  readonly activePoint = input<number | null>(null);

  protected readonly cursor = signal<string | null>(null);

  private readonly timeline = inject(TimelineService);
  private readonly library = inject(AudioLibraryService);
  private readonly processed = inject(ProcessedAudioService);
  private readonly tempos = inject(TempoService);
  private readonly montages = inject(MontageService);
  private readonly theme = inject(ThemeColorsService);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly size = observeSize();

  constructor() {
    effect(() => this.draw());
  }

  /** Clips in drawing order: the selected one last, on top of the others (so its edges stay reachable). */
  private stacked(): Clip[] {
    const selectedId = this.timeline.selectedClipId();
    const clips = this.track().clips;
    const selected = clips.find((c) => c.id === selectedId);
    return selected ? [...clips.filter((c) => c !== selected), selected] : clips;
  }

  /** Topmost clip under the x coordinate (px from the lane start), with the zone hit. */
  clipAt(x: number): ClipHit | undefined {
    const clips = this.stacked();
    for (let i = clips.length - 1; i >= 0; i--) {
      const clip = clips[i];
      const x0 = this.timeline.timeToX(clip.start);
      const x1 = this.timeline.timeToX(clip.start + this.timeline.clipLength(clip));
      if (x < x0 - EDGE_GRAB || x > x1 + EDGE_GRAB) continue;
      // narrow clips: the edges never cover the whole body
      const grab = Math.min(EDGE_GRAB, (x1 - x0) / 3);
      if (Math.abs(x - x0) <= grab) return { clip, zone: 'start' };
      if (Math.abs(x - x1) <= grab) return { clip, zone: 'end' };
      if (x >= x0 && x <= x1) return { clip, zone: 'body' };
    }
    return undefined;
  }

  /** Lane x of the edges of the bar being marked, when it is on this lane and placed. */
  private markedBar(): { clip: Clip; x0: number; x1: number } | undefined {
    const marking = this.timeline.beatMarking();
    const clip = marking && this.track().clips.find((c) => c.id === marking.clipId);
    if (!marking || !clip || marking.downbeat === null) return undefined;
    const rate = clipRate(clip);
    const toX = (sourceTime: number) => this.timeline.timeToX(clip.start + (sourceTime - clip.offset) / rate);
    const bar = (60 * marking.beatsPerBar) / marking.bpm;
    return { clip, x0: toX(marking.downbeat), x1: toX(marking.downbeat + bar) };
  }

  /** Part of the bar being marked under x on this lane, if any. */
  markedBarAt(x: number): ClipHit['zone'] | undefined {
    const bar = this.markedBar();
    if (!bar) return undefined;
    const grab = Math.min(EDGE_GRAB, (bar.x1 - bar.x0) / 3);
    if (Math.abs(x - bar.x0) <= grab) return 'start';
    if (Math.abs(x - bar.x1) <= grab) return 'end';
    return x > bar.x0 && x < bar.x1 ? 'body' : undefined;
  }

  /** Index of the segment whose bend handle is near (x, y), if any. */
  curveHandleAt(x: number, y: number): number | undefined {
    const points = this.track().envelope ?? [];
    for (let i = 0; i < points.length - 1; i++) {
      const handle = this.curveHandle(points, i);
      if (!handle) continue;
      const dx = handle.x - x;
      const dy = handle.y - y;
      if (dx * dx + dy * dy <= POINT_GRAB * POINT_GRAB) return i;
    }
    return undefined;
  }

  /** Position of the bend handle of a segment: its curve at half of its duration (none when flat). */
  private curveHandle(points: readonly { time: number; gain: number }[], index: number): { x: number; y: number } | null {
    const a = points[index];
    const b = points[index + 1];
    if (!b || Math.abs(b.gain - a.gain) < 0.01 || b.time <= a.time) return null;
    const x0 = this.timeline.timeToX(a.time);
    const x1 = this.timeline.timeToX(b.time);
    if (x1 - x0 < 4 * POINT_GRAB) return null;
    const time = (a.time + b.time) / 2;
    return { x: this.timeline.timeToX(time), y: this.gainToY(gainAt(this.track().envelope, time)) };
  }

  /** Index of the envelope point near (x, y), if any. */
  pointAt(x: number, y: number): number | undefined {
    const points = this.track().envelope ?? [];
    for (let i = 0; i < points.length; i++) {
      const dx = this.timeline.timeToX(points[i].time) - x;
      const dy = this.gainToY(points[i].gain) - y;
      if (dx * dx + dy * dy <= POINT_GRAB * POINT_GRAB) return i;
    }
    return undefined;
  }

  /** Gain at the vertical coordinate y of the lane. */
  yToGain(y: number): number {
    const height = this.size().height - 2 * ENVELOPE_MARGIN;
    return Math.min(MAX_GAIN, Math.max(0, (1 - (y - ENVELOPE_MARGIN) / height) * MAX_GAIN));
  }

  private gainToY(gain: number): number {
    const height = this.size().height - 2 * ENVELOPE_MARGIN;
    return ENVELOPE_MARGIN + (1 - gain / MAX_GAIN) * height;
  }

  protected onHover(event: PointerEvent): void {
    if (event.buttons) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    if (this.timeline.beatMarking()) {
      // precise pointer to place the 1, then move / stretch arrows on the bar
      const zone = this.markedBarAt(x);
      this.cursor.set(zone === 'body' ? 'grab' : zone ? 'ew-resize' : 'crosshair');
      return;
    }
    if (this.timeline.envelopeMode()) {
      const y = event.clientY - rect.top;
      this.cursor.set(this.pointAt(x, y) !== undefined ? 'move' : this.curveHandleAt(x, y) !== undefined ? 'ns-resize' : 'crosshair');
      return;
    }
    const zone = this.clipAt(x)?.zone;
    this.cursor.set(zone === 'body' ? 'grab' : zone ? 'ew-resize' : null);
  }

  private draw(): void {
    const size = this.size();
    const colors = this.theme.colors();
    const ctx = prepareCanvas(this.canvas().nativeElement, size);
    const selectedId = this.timeline.selectedClipId();
    ctx.globalAlpha = this.silent() ? 0.35 : 1;
    for (const clip of this.stacked()) {
      const selected = clip.id === selectedId;
      const source = this.library.ready(clip.sourceId);
      if (!source) continue;
      // each source has its own color (index of the source in the montage)
      const palette = sourceColors(this.montages.montage().sources.findIndex((s) => s.id === clip.sourceId), colors.dark);
      const processed = isProcessed(clip);
      const audio = processed ? this.processed.ready(clip) : source;
      const length = this.timeline.clipLength(clip);
      const x0 = this.timeline.timeToX(clip.start);
      const x1 = this.timeline.timeToX(clip.start + length);
      if (x1 < 0 || x0 > size.width) continue;

      const left = Math.max(0, Math.floor(x0));
      const right = Math.min(size.width, Math.ceil(x1));
      if (selected) this.drawSourceExtent(ctx, colors, clip, source.buffer.duration, size);
      const alpha = ctx.globalAlpha;
      ctx.fillStyle = palette.clip;
      ctx.globalAlpha = alpha * (selected ? 0.9 : 0.45);
      ctx.fillRect(left, 1, right - left, size.height - 2);
      ctx.globalAlpha = alpha;
      ctx.strokeStyle = palette.clipBorder;
      ctx.lineWidth = selected ? 2 : 1;
      ctx.strokeRect(Math.round(x0) + 0.5, 1.5, Math.round(x1 - x0) - 1, size.height - 3);
      ctx.lineWidth = 1;

      if (!audio) {
        // render in progress
        const state = this.processed.state(clip);
        ctx.fillStyle = colors.text;
        ctx.font = colors.font;
        ctx.textBaseline = 'middle';
        const label = state?.status === 'rendering' ? `⏳ ${Math.round(state.progress * 100)}%` : state?.status === 'error' ? '⚠' : '…';
        ctx.fillText(label, Math.max(left, x0) + 8, size.height / 2);
        continue;
      }
      const { buffer, peaks } = audio;
      // start of the clip inside the buffer: the rendered source runs at the clip speed
      const bufferOffset = processed ? clip.offset / clipRate(clip) : clip.offset;
      const channels = buffer.numberOfChannels;
      // the waveform shows the audio as heard: scaled by the volume envelope of the track
      const envelope = this.track().envelope;
      const gains = new Float32Array(right - left + 1);
      for (let x = left; x <= right; x++) gains[x - left] = gainAt(envelope, this.timeline.xToTime(x));
      const rowHeight = (size.height - 4 - CHANNEL_GAP * (channels - 1)) / channels;
      for (let c = 0; c < channels; c++) {
        const top = 2 + c * (rowHeight + CHANNEL_GAP);
        this.drawChannel(ctx, { ...colors, waveform: palette.waveform }, buffer.getChannelData(c), peaks[c], {
          left,
          right,
          top,
          height: rowHeight,
          // sample of the source at x = 0 and samples per pixel
          sampleAtZero: (bufferOffset + (this.timeline.scroll() - clip.start)) * buffer.sampleRate,
          samplesPerPx: buffer.sampleRate / this.timeline.pxPerSec(),
          offsetSample: bufferOffset * buffer.sampleRate,
          endSample: (bufferOffset + length) * buffer.sampleRate,
          gainAtX: (x) => gains[Math.min(gains.length - 1, Math.max(0, Math.round(x) - left))],
        });
      }
    }
    ctx.globalAlpha = 1;
    const markingId = this.timeline.beatMarking()?.clipId;
    if (this.timeline.beatGrid()) {
      // the clip being marked shows only the grid of its marking
      for (const clip of this.track().clips) if (clip.id !== markingId) this.drawBeats(ctx, colors, clip, size.width, size.height);
    }
    this.drawMarkedBar(ctx, colors, size.width, size.height);
    this.drawEnvelope(ctx, colors, size.width);
  }

  /**
   * Whole extent of the source of a (trimmed) clip, in light grey: where the original audio
   * would begin and end at the clip's position and speed.
   */
  private drawSourceExtent(ctx: CanvasRenderingContext2D, colors: CanvasColors, clip: Clip, sourceLength: number, size: { width: number; height: number }): void {
    const rate = clipRate(clip);
    const start = clip.start - clip.offset / rate;
    const x0 = this.timeline.timeToX(start);
    const x1 = this.timeline.timeToX(start + sourceLength / rate);
    if (x1 < 0 || x0 > size.width) return;
    const alpha = ctx.globalAlpha;
    ctx.globalAlpha = alpha * 0.08;
    ctx.fillStyle = colors.text;
    ctx.fillRect(Math.max(0, x0), 1, Math.min(size.width, x1) - Math.max(0, x0), size.height - 2);
    ctx.globalAlpha = alpha * 0.45;
    ctx.strokeStyle = colors.text;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(Math.round(x0) + 0.5, 1.5, Math.round(x1 - x0) - 1, size.height - 3);
    ctx.setLineDash([]);
    ctx.globalAlpha = alpha;
  }

  /**
   * Bar being marked: its columns (one per beat, numbered) between two strong edges, and the
   * grid it implies over the rest of the clip, faded.
   */
  private drawMarkedBar(ctx: CanvasRenderingContext2D, colors: CanvasColors, width: number, height: number): void {
    const marking = this.timeline.beatMarking();
    const bar = this.markedBar();
    if (!marking || marking.downbeat === null || !bar) return;
    const { clip, x0, x1 } = bar;
    const clipX0 = Math.max(0, this.timeline.timeToX(clip.start));
    const clipX1 = Math.min(width, this.timeline.timeToX(clip.start + this.timeline.clipLength(clip)));
    this.drawBarGrid(ctx, colors, clip, marking.bpm, marking.downbeat, marking.beatsPerBar, clipX0, clipX1, height, 0.6);
    if (x1 < 0 || x0 > width) return;
    ctx.fillStyle = colors.envelope;
    ctx.strokeStyle = colors.envelope;
    ctx.globalAlpha = 0.15;
    ctx.fillRect(x0, 0, x1 - x0, height);
    ctx.globalAlpha = 1;
    ctx.font = `bold 12px ${colors.font.split('px ')[1]}`;
    ctx.textBaseline = 'top';
    const column = (x1 - x0) / marking.beatsPerBar;
    for (let k = 0; k <= marking.beatsPerBar; k++) {
      const x = Math.round(x0 + k * column) + 0.5;
      const edge = k === 0 || k === marking.beatsPerBar;
      ctx.lineWidth = edge ? 2 : 1;
      ctx.globalAlpha = edge ? 1 : 0.6;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      if (k < marking.beatsPerBar && column >= 14) ctx.fillText(String(k + 1), x + 4, 4);
    }
    ctx.lineWidth = 1;
    ctx.globalAlpha = 1;
  }

  /** Bar grid of a clip, from the tempo of its source. */
  private drawBeats(ctx: CanvasRenderingContext2D, colors: CanvasColors, clip: Clip, width: number, height: number): void {
    const tempo = this.tempos.sourceTempo(clip.sourceId);
    if (!tempo) return;
    const x0 = Math.max(0, this.timeline.timeToX(clip.start));
    const x1 = Math.min(width, this.timeline.timeToX(clip.start + this.timeline.clipLength(clip)));
    this.drawBarGrid(ctx, colors, clip, tempo.bpm, tempo.offset, beatsPerBar(tempo), x0, x1, height, 1);
  }

  /**
   * Bars first: alternate bands, one per bar, with a strong line and its number on the
   * downbeat; then the beats inside the bar, lighter. Between x0 and x1 (lane px), faded by `alpha`.
   */
  private drawBarGrid(
    ctx: CanvasRenderingContext2D,
    colors: CanvasColors,
    clip: Clip,
    bpm: number,
    offset: number,
    meter: number,
    x0: number,
    x1: number,
    height: number,
    alpha: number,
  ): void {
    if (x1 <= x0) return;
    const rate = clipRate(clip);
    const beat = 60 / bpm; // source seconds
    const bar = beat * meter;
    const pxPerSec = this.timeline.pxPerSec();
    const barPx = (bar / rate) * pxPerSec;
    if (barPx < 6) return;
    const beatPx = barPx / meter;
    const sourceToX = (sourceTime: number) => this.timeline.timeToX(clip.start + (sourceTime - clip.offset) / rate);
    // bar holding the first visible pixel
    const fromSource = clip.offset + (this.timeline.xToTime(x0) - clip.start) * rate;
    const base = ctx.globalAlpha;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, x1 - x0, height);
    ctx.clip();
    ctx.fillStyle = colors.beat;
    ctx.strokeStyle = colors.beat;
    ctx.font = colors.font;
    ctx.textBaseline = 'top';
    for (let b = Math.floor((fromSource - offset) / bar); ; b++) {
      const left = sourceToX(offset + b * bar);
      if (left > x1) break;
      // alternate bands: the even bars (1, 3, …) shaded
      if (b % 2 === 0) {
        ctx.globalAlpha = base * alpha * 0.1;
        ctx.fillRect(left, 0, barPx, height);
      }
      const x = Math.round(left) + 0.5;
      ctx.globalAlpha = base * alpha * 0.6;
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
      if (barPx >= 28 && b >= 0) ctx.fillText(String(b + 1), x + 3, 3);
      // beats inside the bar, only when far enough apart
      if (beatPx >= 6) {
        ctx.globalAlpha = base * alpha * 0.18;
        ctx.beginPath();
        for (let k = 1; k < meter; k++) {
          const bx = Math.round(left + k * beatPx) + 0.5;
          ctx.moveTo(bx, height * 0.25);
          ctx.lineTo(bx, height * 0.75);
        }
        ctx.stroke();
      }
    }
    ctx.restore();
    ctx.globalAlpha = base;
  }

  /** Envelope polyline (shown when it has points or while editing), with its points when editing. */
  private drawEnvelope(ctx: CanvasRenderingContext2D, colors: CanvasColors, width: number): void {
    const points = this.track().envelope ?? [];
    const editing = this.timeline.envelopeMode();
    if (!points.length && !editing) return;
    ctx.strokeStyle = colors.envelope;
    ctx.fillStyle = colors.envelope;
    if (editing) {
      // unity gain reference
      ctx.setLineDash([3, 4]);
      ctx.globalAlpha = 0.5;
      ctx.beginPath();
      const unity = Math.round(this.gainToY(1)) + 0.5;
      ctx.moveTo(0, unity);
      ctx.lineTo(width, unity);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.globalAlpha = 1;
    }
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    // sampled every few pixels, plus the points themselves (sharp corners)
    const xs = new Set<number>();
    for (let x = 0; x <= width; x += 3) xs.add(x);
    for (const point of points) {
      const x = this.timeline.timeToX(point.time);
      if (x > 0 && x < width) xs.add(x);
    }
    xs.add(width);
    [...xs]
      .sort((a, b) => a - b)
      .forEach((x, i) => {
        const y = this.gainToY(gainAt(points, this.timeline.xToTime(x)));
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      });
    ctx.stroke();
    ctx.lineWidth = 1;
    if (!editing) return;
    // bend handles: hollow circles at half of each sloped segment
    for (let i = 0; i < points.length - 1; i++) {
      const handle = this.curveHandle(points, i);
      if (!handle || handle.x < 0 || handle.x > width) continue;
      ctx.beginPath();
      ctx.arc(handle.x, handle.y, 4, 0, Math.PI * 2);
      ctx.stroke();
    }
    const active = this.activePoint();
    ctx.font = colors.font;
    points.forEach((point, index) => {
      const x = this.timeline.timeToX(point.time);
      if (x < -POINT_GRAB || x > width + POINT_GRAB) return;
      const y = this.gainToY(point.gain);
      ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
      if (index === active) {
        ctx.textBaseline = y < 20 ? 'top' : 'bottom';
        ctx.fillText(gainToDb(point.gain), x + 7, y < 20 ? y + 4 : y - 4);
      }
    });
  }

  private drawChannel(
    ctx: CanvasRenderingContext2D,
    colors: CanvasColors,
    data: Float32Array,
    peaks: Parameters<typeof rangePeak>[1],
    area: {
      left: number;
      right: number;
      top: number;
      height: number;
      sampleAtZero: number;
      samplesPerPx: number;
      offsetSample: number;
      endSample: number;
      /** Volume envelope gain at a lane x. */
      gainAtX: (x: number) => number;
    },
  ): void {
    const mid = area.top + area.height / 2;
    const scale = area.height / 2;
    // gains above unity may exceed the row: clipped to it
    const clamp = (y: number) => Math.min(area.top + area.height, Math.max(area.top, y));
    ctx.fillStyle = colors.grid;
    ctx.fillRect(area.left, Math.round(mid), area.right - area.left, 1);
    ctx.fillStyle = colors.waveform;
    ctx.strokeStyle = colors.waveform;

    if (area.samplesPerPx < 1) {
      // zoomed in beyond the samples: polyline through them
      const first = Math.max(Math.floor(area.offsetSample), Math.floor(area.sampleAtZero + area.left * area.samplesPerPx));
      const last = Math.min(Math.ceil(area.endSample), Math.ceil(area.sampleAtZero + area.right * area.samplesPerPx) + 1);
      ctx.beginPath();
      for (let i = first; i < last && i < data.length; i++) {
        const x = (i - area.sampleAtZero) / area.samplesPerPx;
        const y = clamp(mid - data[i] * area.gainAtX(x) * scale);
        if (i === first) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.stroke();
      return;
    }

    for (let x = area.left; x < area.right; x++) {
      const from = Math.max(area.offsetSample, area.sampleAtZero + x * area.samplesPerPx);
      const to = Math.min(area.endSample, area.sampleAtZero + (x + 1) * area.samplesPerPx);
      if (to <= from) continue;
      const [lo, hi] = rangePeak(data, peaks, from, to);
      const gain = area.gainAtX(x);
      const y0 = clamp(mid - hi * gain * scale);
      const y1 = clamp(mid - lo * gain * scale);
      ctx.fillRect(x, y0, 1, Math.max(1, y1 - y0));
    }
  }
}
