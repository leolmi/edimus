import { ChangeDetectionStrategy, Component, ElementRef, computed, effect, inject, input, signal, viewChild } from '@angular/core';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AudioLibraryService } from '../../core/audio/audio-library.service';
import { rangePeak } from '../../core/audio/peaks';
import { MAX_GAIN, clipGainAt, gainAt, gainToDb } from '../../core/montage/envelope';
import { Clip, Track, clipRate, fileName, isProcessed, toSource, toTimeline, trackVolume } from '../../core/montage/montage.model';
import { ProcessedAudioService } from '../../core/audio/processed-audio.service';
import { Tempo, meterName } from '../../core/audio/tempo';
import { anchorOf, barAt, barMeter, barTime } from '../../core/audio/tempo-map';
import { UNCERTAIN_BAR } from '../../core/audio/rhythm';
import { I18nService } from '../../core/i18n/i18n.service';
import { TempoService } from '../../core/audio/tempo.service';
import { sourceColors } from '../../core/source-colors';
import { CanvasColors, ThemeColorsService } from '../../core/theme-colors.service';
import { MontageService } from '../../core/montage/montage.service';
import { SourceSummaryService } from '../../core/source-summary.service';
import { EditService } from '../../core/edit.service';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { envelopeAnchors } from '../../core/timeline/edge-snap';
import { TimelineService } from '../../core/timeline/timeline.service';
import { observeSize, prepareCanvas } from './canvas';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/** Distance (px) from a clip edge within which the pointer grabs the edge to trim it. */
const EDGE_GRAB = 6;

export interface ClipHit {
  clip: Clip;
  /** Part of the clip under the pointer. */
  zone: 'start' | 'end' | 'body';
}

/** Envelope point (or segment starting at it) of a clip. */
export interface EnvelopeHit {
  clip: Clip;
  index: number;
}

/** Distance (px) within which the pointer grabs an envelope point. */
const POINT_GRAB = 7;
/** Vertical margin (px) of the envelope area inside the lane. */
const ENVELOPE_MARGIN = 6;

/** Vertical gap between the channels of a stereo clip. */
const CHANNEL_GAP = 2;

/** Size (px) of the padlock of a clip, and narrowest clip (in view) showing it. */
const LOCK_SIZE = 20;
const LOCK_ROOM = 32;
/** Dash of the border of a locked clip. */
const LOCKED_DASH = [6, 3];

/** Room (px) the clip names may take beyond the view: they stay pinned to its left edge anyway. */
const NAME_ROOM = 1000;

/**
 * Lane of a track: its clips with the waveform of their source (one row per channel) and the
 * name of the file at the bottom left of each clip, with its details in a tooltip.
 */
@Component({
  selector: 'app-track-lane',
  imports: [MatButtonModule, MatIconModule, MatTooltipModule, TranslatePipe],
  template: `
    <canvas #canvas></canvas>
    @for (name of names(); track name.id) {
      <!-- as wide as the clip: the name sticks to the left edge of the view while the clip runs past it, and stays inside the clip -->
      <div class="clip-name" [style.left.px]="name.left" [style.width.px]="name.width">
        <span [matTooltip]="name.summary" matTooltipShowDelay="400">{{ name.text }}</span>
      </div>
    }
    @for (lock of locks(); track lock.id) {
      <!-- the padlock in the top right corner, kept in view: closed on a locked clip, open on the clip under the pointer -->
      <button
        mat-icon-button
        class="clip-lock"
        [class.locked]="lock.locked"
        [style.left.px]="lock.x"
        [matTooltip]="(lock.locked ? 'clipLock.locked' : 'clipLock.unlocked') | t"
        matTooltipShowDelay="400"
        (pointerdown)="$event.stopPropagation()"
        (dblclick)="$event.stopPropagation()"
        (click)="edits.toggleClipLock(lock.id)"
      >
        <mat-icon>{{ lock.locked ? 'lock' : 'lock_open' }}</mat-icon>
      </button>
    }
  `,
  styles: `
    :host {
      display: block;
      position: relative;
      overflow: hidden;
    }
    canvas {
      position: absolute;
      inset: 0;
    }
    .clip-name {
      position: absolute;
      bottom: 3px;
      display: flex;
      /* clip, not hidden: no scroll container, so that the sticky name follows the lane */
      overflow: clip;
      pointer-events: none;
    }
    .clip-name span {
      position: sticky;
      left: 4px;
      margin: 0 4px;
      padding: 0 4px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      border-radius: 3px;
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface);
      background: color-mix(in srgb, var(--mat-sys-surface) 60%, transparent);
      pointer-events: auto;
    }
    .clip-lock {
      --mat-icon-button-state-layer-size: 20px;
      --mat-icon-button-icon-size: 14px;
      --mat-icon-button-icon-color: var(--mat-sys-on-surface-variant);
      --mat-icon-button-container-shape: 3px;
      position: absolute;
      top: 3px;
      padding: 0;
      border-radius: 3px;
      background: color-mix(in srgb, var(--mat-sys-surface) 60%, transparent);
      &.locked {
        --mat-icon-button-icon-color: var(--mat-sys-error);
      }
    }
    :host(.silent) .clip-name {
      opacity: 0.5;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
  host: {
    '[style.cursor]': 'cursor()',
    '[class.silent]': 'silent()',
    '(pointermove)': 'onHover($event)',
    '(pointerleave)': 'cursor.set(null); hovered.set(null)',
  },
})
export class TrackLaneComponent {
  readonly track = input.required<Track>();
  /** Muted or excluded by a solo: drawn dimmed. */
  readonly silent = input(false);
  /** Envelope point being dragged (clip id and index): its value is shown next to it. */
  readonly activePoint = input<{ clipId: string; index: number } | null>(null);

  protected readonly cursor = signal<string | null>(null);
  /** Clip under the pointer: its open padlock shows, to lock it. */
  protected readonly hovered = signal<string | null>(null);

  private readonly timeline = inject(TimelineService);
  private readonly library = inject(AudioLibraryService);
  private readonly processed = inject(ProcessedAudioService);
  private readonly tempos = inject(TempoService);
  private readonly montages = inject(MontageService);
  private readonly theme = inject(ThemeColorsService);
  private readonly i18n = inject(I18nService);
  private readonly summaries = inject(SourceSummaryService);
  protected readonly edits = inject(EditService);
  private readonly canvas = viewChild.required<ElementRef<HTMLCanvasElement>>('canvas');
  private readonly size = observeSize();

  constructor() {
    effect(() => this.draw());
  }

  /** Name of the file of each clip in view (only of the clips whose audio is there). */
  protected readonly names = computed(() => {
    const width = this.size().width;
    const sources = this.montages.montage().sources;
    return this.track().clips.flatMap((clip) => {
      if (!this.library.ready(clip.sourceId)) return [];
      const span = this.clipSpan(clip);
      if (span.x1 <= 0 || span.x0 >= width) return [];
      const left = Math.max(span.x0, -NAME_ROOM);
      const right = Math.min(span.x1, width + NAME_ROOM);
      const path = sources.find((s) => s.id === clip.sourceId)?.path ?? '';
      return [{ id: clip.id, left, width: right - left, text: fileName(path), summary: this.summaries.summary(clip.sourceId) ?? '' }];
    });
  });

  /** Padlocks shown: of the locked clips and of the clip under the pointer, in its top right corner inside the view. */
  protected readonly locks = computed(() => {
    const width = this.size().width;
    const hovered = this.hovered();
    return this.track().clips.flatMap((clip) => {
      if (!clip.locked && clip.id !== hovered) return [];
      const span = this.clipSpan(clip);
      const x0 = Math.max(span.x0, 0);
      const x1 = Math.min(span.x1, width);
      // too narrow (or out of view): no room for it
      if (x1 - x0 < LOCK_ROOM) return [];
      return [{ id: clip.id, locked: !!clip.locked, x: x1 - LOCK_SIZE - 4 }];
    });
  });

  /** Clips in drawing order: the selected ones last, on top of the others (so their edges stay reachable). */
  private stacked(): Clip[] {
    const selected = this.timeline.selectedClips();
    const clips = this.track().clips;
    return [...clips.filter((c) => !selected.has(c.id)), ...clips.filter((c) => selected.has(c.id))];
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

  /**
   * Bar line of the grid near x (topmost clip first, only with the grid shown), to stretch the
   * bar map of the clip's source there.
   */
  barLineAt(x: number): { clip: Clip; bar: number; anchored: boolean } | undefined {
    if (!this.timeline.beatGrid() || this.timeline.beatMarking()) return undefined;
    const clips = this.stacked();
    for (let i = clips.length - 1; i >= 0; i--) {
      const clip = clips[i];
      const span = this.clipSpan(clip);
      const tempo = this.tempos.sourceTempo(clip.sourceId);
      if (!tempo || x < span.x0 || x > span.x1) continue;
      const bar = Math.round(barAt(tempo, toSource(clip, this.timeline.xToTime(x))));
      if (Math.abs(this.sourceX(clip, barTime(tempo, bar)) - x) <= EDGE_GRAB) return { clip, bar, anchored: !!anchorOf(tempo, bar) };
      return undefined;
    }
    return undefined;
  }

  /** Lane x of a source time of a clip. */
  private sourceX(clip: Clip, source: number): number {
    return this.timeline.timeToX(toTimeline(clip, source));
  }

  /** Lane x range of a clip. */
  private clipSpan(clip: Clip): { x0: number; x1: number } {
    return { x0: this.timeline.timeToX(clip.start), x1: this.timeline.timeToX(clip.start + this.timeline.clipLength(clip)) };
  }

  /** Envelope segment whose bend handle is near (x, y), if any (topmost clip first). */
  curveHandleAt(x: number, y: number): EnvelopeHit | undefined {
    const clips = this.stacked();
    for (let c = clips.length - 1; c >= 0; c--) {
      const points = clips[c].envelope ?? [];
      for (let i = 0; i < points.length - 1; i++) {
        const handle = this.curveHandle(clips[c], i);
        if (!handle) continue;
        const dx = handle.x - x;
        const dy = handle.y - y;
        if (dx * dx + dy * dy <= POINT_GRAB * POINT_GRAB) return { clip: clips[c], index: i };
      }
    }
    return undefined;
  }

  /** Position of the bend handle of a segment: its curve at half of its duration (none when flat or hidden). */
  private curveHandle(clip: Clip, index: number): { x: number; y: number } | null {
    const points = clip.envelope ?? [];
    const a = points[index];
    const b = points[index + 1];
    if (!b || Math.abs(b.gain - a.gain) < 0.01 || b.time <= a.time) return null;
    const x0 = this.sourceX(clip, a.time);
    const x1 = this.sourceX(clip, b.time);
    if (x1 - x0 < 4 * POINT_GRAB) return null;
    const x = (x0 + x1) / 2;
    const span = this.clipSpan(clip);
    if (x < span.x0 || x > span.x1) return null;
    return { x, y: this.gainToY(gainAt(points, (a.time + b.time) / 2)) };
  }

  /** Envelope point near (x, y), if any (topmost clip first; only the points inside the clip). */
  pointAt(x: number, y: number): EnvelopeHit | undefined {
    const clips = this.stacked();
    for (let c = clips.length - 1; c >= 0; c--) {
      const clip = clips[c];
      const span = this.clipSpan(clip);
      const points = clip.envelope ?? [];
      for (let i = 0; i < points.length; i++) {
        const px = this.sourceX(clip, points[i].time);
        if (px < span.x0 - 1 || px > span.x1 + 1) continue;
        const dx = px - x;
        const dy = this.gainToY(points[i].gain) - y;
        if (dx * dx + dy * dy <= POINT_GRAB * POINT_GRAB) return { clip, index: i };
      }
    }
    return undefined;
  }

  /** Topmost clip whose body covers x (for adding envelope points). */
  clipBodyAt(x: number): Clip | undefined {
    const clips = this.stacked();
    for (let i = clips.length - 1; i >= 0; i--) {
      const span = this.clipSpan(clips[i]);
      if (x >= span.x0 && x <= span.x1) return clips[i];
    }
    return undefined;
  }

  /** Gain at the vertical coordinate y of the lane. */
  yToGain(y: number): number {
    const height = this.size().height - 2 * ENVELOPE_MARGIN;
    return Math.min(MAX_GAIN, Math.max(0, (1 - (y - ENVELOPE_MARGIN) / height) * MAX_GAIN));
  }

  /** Vertical coordinate of a gain in the lane. */
  gainToY(gain: number): number {
    const height = this.size().height - 2 * ENVELOPE_MARGIN;
    return ENVELOPE_MARGIN + (1 - gain / MAX_GAIN) * height;
  }

  protected onHover(event: PointerEvent): void {
    if (event.buttons) return;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const x = event.clientX - rect.left;
    this.hovered.set(this.clipAt(x)?.clip.id ?? null);
    // a drag inside the selected range moves it
    const range = this.timeline.range();
    const time = this.timeline.xToTime(x);
    const inRange = !!range && time >= range.start && time <= range.end;
    // locked: the clips cannot be grabbed
    if (this.montages.locked()) return this.cursor.set(inRange || !this.track().clips.length ? 'grab' : null);
    if (this.timeline.beatMarking()) {
      // precise pointer to place the 1, then move / stretch arrows on the bar
      const zone = this.markedBarAt(x);
      this.cursor.set(zone === 'body' ? 'grab' : zone ? 'ew-resize' : 'crosshair');
      return;
    }
    if (this.timeline.envelopeMode()) {
      const y = event.clientY - rect.top;
      // points are added only on a clip
      this.cursor.set(this.pointAt(x, y) ? 'move' : this.curveHandleAt(x, y) ? 'ns-resize' : this.clipBodyAt(x) ? 'crosshair' : null);
      return;
    }
    // an empty track pans the view
    if (!this.track().clips.length) return this.cursor.set('grab');
    // Shift on a bar line: the bar map is stretched there
    if (event.shiftKey && this.barLineAt(x)) return this.cursor.set('col-resize');
    // only a selected clip is dragged: from the others (and from a selection with a locked clip) a drag selects a range
    const hit = this.clipAt(x);
    if (hit && hit.zone !== 'body' && !hit.clip.locked) return this.cursor.set('ew-resize');
    const selected = this.timeline.selectedClips();
    const still = this.montages.montage().tracks.some((t) => t.clips.some((c) => c.locked && selected.has(c.id)));
    this.cursor.set((hit && selected.has(hit.clip.id) && !still) || inRange ? 'grab' : null);
  }

  private draw(): void {
    const size = this.size();
    const colors = this.theme.colors();
    const ctx = prepareCanvas(this.canvas().nativeElement, size);
    const selection = this.timeline.selectedClips();
    ctx.globalAlpha = this.silent() ? 0.35 : 1;
    for (const clip of this.stacked()) {
      const selected = selection.has(clip.id);
      const source = this.library.ready(clip.sourceId);
      if (!source) {
        this.drawPlaceholder(ctx, colors, clip, size);
        continue;
      }
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
      // a locked clip has a dashed border: it stands out from the others also at a glance
      if (clip.locked) ctx.setLineDash(LOCKED_DASH);
      ctx.strokeRect(Math.round(x0) + 0.5, 1.5, Math.round(x1 - x0) - 1, size.height - 3);
      ctx.setLineDash([]);
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
      // the waveform shows the audio as heard: scaled by the clip envelope and the track volume
      const volume = trackVolume(this.track());
      const gains = new Float32Array(right - left + 1);
      for (let x = left; x <= right; x++) gains[x - left] = volume * clipGainAt(clip, this.timeline.xToTime(x));
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
    this.drawRecording(ctx, colors, size);
    this.drawEnvelopeGuides(ctx, colors, size.width, size.height);
    this.drawMarkedBar(ctx, colors, size.width, size.height);
    this.drawEnvelope(ctx, colors, size.width);
  }

  /**
   * Clip whose audio is not there (file missing, or still loading): an outline with the file
   * name, so that the space it takes on the timeline is visible. Its length is known only
   * when saved in the clip.
   */
  private drawPlaceholder(ctx: CanvasRenderingContext2D, colors: CanvasColors, clip: Clip, size: { width: number; height: number }): void {
    const length = this.timeline.clipLength(clip);
    const x0 = this.timeline.timeToX(clip.start);
    const x1 = this.timeline.timeToX(clip.start + length);
    if (length <= 0 || x1 < 0 || x0 > size.width) return;
    const failed = this.library.sources()[clip.sourceId]?.status === 'error';
    const color = failed ? colors.error : colors.axis;
    ctx.save();
    ctx.strokeStyle = color;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(Math.round(x0) + 0.5, 1.5, Math.round(x1 - x0) - 1, size.height - 3);
    ctx.setLineDash([]);
    ctx.beginPath();
    ctx.rect(Math.max(0, x0), 0, Math.min(size.width, x1) - Math.max(0, x0), size.height);
    ctx.clip();
    const path = this.montages.montage().sources.find((s) => s.id === clip.sourceId)?.path ?? '';
    ctx.fillStyle = color;
    ctx.font = colors.font;
    ctx.textBaseline = 'middle';
    ctx.fillText(`${failed ? '⚠' : '…'} ${fileName(path)}`, Math.max(0, x0) + 8, size.height / 2);
    ctx.restore();
  }

  /** Clip being recorded on this track: it grows from where the recording started up to the playhead. */
  private drawRecording(ctx: CanvasRenderingContext2D, colors: CanvasColors, size: { width: number; height: number }): void {
    const clip = this.timeline.recordingClip();
    if (clip?.trackId !== this.track().id) return;
    const x0 = this.timeline.timeToX(clip.start);
    const x1 = Math.max(x0 + 1, this.timeline.timeToX(clip.end));
    if (x1 < 0 || x0 > size.width) return;
    const left = Math.max(0, Math.floor(x0));
    const right = Math.min(size.width, Math.ceil(x1));
    ctx.save();
    ctx.fillStyle = colors.error;
    ctx.globalAlpha = 0.18;
    ctx.fillRect(left, 1, right - left, size.height - 2);
    ctx.globalAlpha = 1;
    ctx.strokeStyle = colors.error;
    ctx.strokeRect(Math.round(x0) + 0.5, 1.5, Math.round(x1 - x0) - 1, size.height - 3);
    ctx.beginPath();
    ctx.rect(left, 0, right - left, size.height);
    ctx.clip();
    ctx.fillStyle = colors.error;
    ctx.font = colors.font;
    ctx.textBaseline = 'top';
    ctx.fillText('● REC', Math.max(0, x0) + 6, 6);
    ctx.restore();
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
    const steady: Tempo = { bpm: marking.bpm, offset: marking.downbeat, confidence: 1, beatsPerBar: marking.beatsPerBar };
    this.drawBarGrid(ctx, colors, clip, steady, clipX0, clipX1, height, 0.6);
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

  /**
   * A vertical line on the envelope points of every clip of the montage, across all the lanes:
   * they are snap anchors for the clips moved on the other tracks.
   */
  private drawEnvelopeGuides(ctx: CanvasRenderingContext2D, colors: CanvasColors, width: number, height: number): void {
    const xs = this.montages
      .montage()
      .tracks.flatMap((t) => t.clips)
      .flatMap((clip) => envelopeAnchors(clip, this.timeline.clipLength(clip)))
      .map((time) => Math.round(this.timeline.timeToX(time)) + 0.5)
      .filter((x) => x >= 0 && x <= width);
    if (!xs.length) return;
    ctx.save();
    ctx.strokeStyle = colors.envelope;
    ctx.globalAlpha = 0.6;
    ctx.setLineDash([3, 3]);
    ctx.beginPath();
    for (const x of xs) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
    }
    ctx.stroke();
    ctx.restore();
  }

  /** Bar grid of a clip, from the tempo of its source. */
  private drawBeats(ctx: CanvasRenderingContext2D, colors: CanvasColors, clip: Clip, width: number, height: number): void {
    const tempo = this.tempos.sourceTempo(clip.sourceId);
    if (!tempo) return;
    const x0 = Math.max(0, this.timeline.timeToX(clip.start));
    const x1 = Math.min(width, this.timeline.timeToX(clip.start + this.timeline.clipLength(clip)));
    this.drawBarGrid(ctx, colors, clip, tempo, x0, x1, height, 1);
  }

  /**
   * Bars first: alternate bands, one per bar, with a strong line and its number on the
   * downbeat (and the meter where it changes); then the beats inside the bar, lighter, where the
   * tracking found them. Bars pinned by hand have a mark on top, those placed by the bar tracking
   * a small one at the bottom; doubtful bars have a dashed line in the error color. No grid in
   * the free regions, a hatched band instead. Between x0 and x1 (lane px), faded by `alpha`.
   */
  private drawBarGrid(ctx: CanvasRenderingContext2D, colors: CanvasColors, clip: Clip, tempo: Tempo, x0: number, x1: number, height: number, alpha: number): void {
    if (x1 <= x0) return;
    const sourceToX = (sourceTime: number) => this.sourceX(clip, sourceTime);
    // source times of the first and last visible pixels
    const fromSource = toSource(clip, this.timeline.xToTime(x0));
    const toSourceTime = toSource(clip, this.timeline.xToTime(x1));
    const firstBar = Math.floor(barAt(tempo, fromSource));
    const lastBar = Math.ceil(barAt(tempo, toSourceTime));
    // too dense on average: no grid
    if ((x1 - x0) / Math.max(1, lastBar - firstBar) < 6) return;
    const base = ctx.globalAlpha;
    const free = (tempo.regions ?? []).map((r) => [sourceToX(r.from), sourceToX(r.to)]).filter(([a, b]) => b > x0 && a < x1);
    ctx.save();
    ctx.beginPath();
    // the grid only outside the free regions
    let open = x0;
    for (const [a, b] of free) {
      if (a > open) ctx.rect(open, 0, Math.min(a, x1) - open, height);
      open = Math.max(open, b);
    }
    if (open < x1) ctx.rect(open, 0, x1 - open, height);
    ctx.clip();
    ctx.fillStyle = colors.beat;
    ctx.strokeStyle = colors.beat;
    ctx.font = colors.font;
    ctx.textBaseline = 'top';
    let left = sourceToX(barTime(tempo, firstBar));
    for (let b = firstBar; b <= lastBar && left <= x1; b++) {
      const meter = barMeter(tempo, b);
      const anchor = anchorOf(tempo, b);
      const doubtful = !!anchor?.auto && anchor.confidence !== undefined && anchor.confidence < UNCERTAIN_BAR;
      const right = sourceToX(barTime(tempo, b + 1));
      const barPx = right - left;
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
      if (doubtful) {
        ctx.save();
        ctx.strokeStyle = colors.error;
        ctx.setLineDash([3, 3]);
        ctx.stroke();
        ctx.restore();
      } else ctx.stroke();
      if (barPx >= 28 && b >= 0) {
        // the meter where it changes, when it fits
        const withMeter = `${b + 1}  ${meterName(meter)}`;
        const changed = meter !== barMeter(tempo, b - 1) && ctx.measureText(withMeter).width + 6 <= barPx;
        ctx.fillText(changed ? withMeter : String(b + 1), x + 3, 3);
      }
      if (anchor) {
        ctx.globalAlpha = base * alpha * (anchor.auto && !doubtful ? 0.5 : 1);
        ctx.save();
        if (doubtful) ctx.fillStyle = colors.error;
        ctx.beginPath();
        if (anchor.auto) ctx.rect(x - 1.5, height - 4, 3, 3);
        else {
          ctx.moveTo(x - 5, 0);
          ctx.lineTo(x + 5, 0);
          ctx.lineTo(x, 7);
        }
        ctx.fill();
        ctx.restore();
      }
      // beats inside the bar, only when far enough apart
      if (barPx / meter >= 6) {
        ctx.globalAlpha = base * alpha * 0.18;
        ctx.beginPath();
        for (let k = 1; k < meter; k++) {
          const bx = Math.round(sourceToX(barTime(tempo, b + k / meter))) + 0.5;
          ctx.moveTo(bx, height * 0.25);
          ctx.lineTo(bx, height * 0.75);
        }
        ctx.stroke();
      }
      left = right;
    }
    ctx.restore();
    if (free.length) this.drawFree(ctx, colors, free, x0, x1, height, alpha);
    ctx.globalAlpha = base;
  }

  /** Free regions of the grid (no pulse): a light hatched band with its name. */
  private drawFree(ctx: CanvasRenderingContext2D, colors: CanvasColors, free: number[][], x0: number, x1: number, height: number, alpha: number): void {
    const base = ctx.globalAlpha;
    ctx.save();
    ctx.beginPath();
    ctx.rect(x0, 0, x1 - x0, height);
    ctx.clip();
    ctx.strokeStyle = colors.beat;
    ctx.fillStyle = colors.beat;
    ctx.font = colors.font;
    ctx.textBaseline = 'top';
    const label = this.i18n.t('grid.free');
    for (const [a, b] of free) {
      ctx.globalAlpha = base * alpha * 0.12;
      ctx.beginPath();
      for (let x = Math.floor(a / 12) * 12 - height; x < b; x += 12) {
        ctx.moveTo(Math.max(a, x), Math.max(a, x) - x);
        ctx.lineTo(Math.min(b, x + height), Math.min(b, x + height) - x);
      }
      ctx.stroke();
      ctx.globalAlpha = base * alpha * 0.7;
      const at = Math.max(a, x0) + 4;
      if (Math.min(b, x1) - at >= ctx.measureText(label).width + 4) ctx.fillText(label, at, 3);
    }
    ctx.restore();
  }

  /**
   * Envelope of each clip, inside the clip (shown when it has points or while editing), with
   * its points and bend handles when editing.
   */
  private drawEnvelope(ctx: CanvasRenderingContext2D, colors: CanvasColors, width: number): void {
    const editing = this.timeline.envelopeMode();
    const clips = this.stacked().filter((c) => editing || c.envelope?.length);
    if (!clips.length) return;
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
    const active = this.activePoint();
    ctx.font = colors.font;
    for (const clip of clips) {
      const span = this.clipSpan(clip);
      const x0 = Math.max(0, span.x0);
      const x1 = Math.min(width, span.x1);
      if (x1 <= x0) continue;
      const points = clip.envelope ?? [];
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      // sampled every few pixels, plus the points themselves (sharp corners)
      const xs = new Set<number>([x0, x1]);
      for (let x = Math.ceil(x0); x < x1; x += 3) xs.add(x);
      for (const point of points) {
        const x = this.sourceX(clip, point.time);
        if (x > x0 && x < x1) xs.add(x);
      }
      [...xs]
        .sort((a, b) => a - b)
        .forEach((x, i) => {
          const y = this.gainToY(clipGainAt(clip, this.timeline.xToTime(x)));
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });
      ctx.stroke();
      ctx.lineWidth = 1;
      if (!editing) continue;
      // bend handles: hollow circles at half of each sloped segment
      for (let i = 0; i < points.length - 1; i++) {
        const handle = this.curveHandle(clip, i);
        if (!handle || handle.x < 0 || handle.x > width) continue;
        ctx.beginPath();
        ctx.arc(handle.x, handle.y, 4, 0, Math.PI * 2);
        ctx.stroke();
      }
      points.forEach((point, index) => {
        const x = this.sourceX(clip, point.time);
        // points hidden by a trim stay hidden
        if (x < span.x0 - 1 || x > span.x1 + 1 || x < -POINT_GRAB || x > width + POINT_GRAB) return;
        const y = this.gainToY(point.gain);
        ctx.fillRect(x - 3.5, y - 3.5, 7, 7);
        if (active?.clipId === clip.id && index === active.index) {
          ctx.textBaseline = y < 20 ? 'top' : 'bottom';
          ctx.fillText(gainToDb(point.gain), x + 7, y < 20 ? y + 4 : y - 4);
        }
      });
    }
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
