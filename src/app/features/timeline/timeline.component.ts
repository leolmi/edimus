import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  afterNextRender,
  effect,
  inject,
  computed,
  signal,
  untracked,
  viewChild,
} from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { os, type Icon, type MessageBoxChoice } from '@neutralinojs/lib';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import type { AudioInfo } from '../../core/audio/audio-decoder.service';
import { AudioLibraryService, SourceState } from '../../core/audio/audio-library.service';
import { PlaybackService } from '../../core/audio/playback.service';
import { TempoService } from '../../core/audio/tempo.service';
import { DocumentService } from '../../core/document.service';
import { EditService } from '../../core/edit.service';
import { formatDuration } from '../../core/format';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { trimClip } from '../../core/montage/edits';
import { EnvelopePoint, curveThroughMidpoint, insertPoint, movePoint, setCurve } from '../../core/montage/envelope';
import { Clip, Montage, Track, audibleTracks, copyName, fileName } from '../../core/montage/montage.model';
import { MontageService } from '../../core/montage/montage.service';
import { SettingsService } from '../../core/settings.service';
import { BarMarking, TimelineService } from '../../core/timeline/timeline.service';
import { sourceColors } from '../../core/source-colors';
import { ThemeColorsService } from '../../core/theme-colors.service';
import { RulerComponent } from './ruler.component';
import { TrackInfoData, TrackInfoDialogComponent, TrackInfoResult, TrackInfoSource } from './track-info-dialog.component';
import { ClipHit, TrackLaneComponent } from './track-lane.component';

/** Replaces the envelope of a track (none when empty). */
function withEnvelope(montage: Montage, trackId: string, points: EnvelopePoint[]): Montage {
  return {
    ...montage,
    tracks: montage.tracks.map((t) => (t.id === trackId ? { ...t, envelope: points.length ? points : undefined } : t)),
  };
}

/** Moves a clip to the given start time on the track at `trackIndex`. */
function moveClip(montage: Montage, clipId: string, trackIndex: number, start: number, newTrack?: Track): Montage {
  const clip = montage.tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
  if (!clip) return montage;
  const tracks = montage.tracks.map((track, index) => {
    const clips = track.clips.filter((c) => c.id !== clipId);
    if (index === trackIndex) clips.push({ ...clip, start });
    return clips.length === track.clips.length && index !== trackIndex ? track : { ...track, clips };
  });
  // below the last track (on the empty strips): a new track for the clip
  if (newTrack && trackIndex >= montage.tracks.length) tracks.push({ ...newTrack, clips: [{ ...clip, start }] });
  return { ...montage, tracks };
}

/** Browsers cap the size of an element: the scrollbar content never exceeds this width. */
const MAX_SCROLL_WIDTH = 10_000_000;
const WHEEL_ZOOM_STEP = 1.15;
/** Pointer movement (px) that turns a click on a lane into a range selection. */
const RANGE_THRESHOLD = 3;

/** Multitrack view: time ruler, track headers and lanes with the waveforms. */
@Component({
  selector: 'app-timeline',
  imports: [
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatTooltipModule,
    TranslatePipe,
    RulerComponent,
    TrackLaneComponent,
  ],
  templateUrl: './timeline.component.html',
  styleUrl: './timeline.component.scss',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TimelineComponent {
  protected readonly montages = inject(MontageService);
  protected readonly timeline = inject(TimelineService);
  protected readonly playback = inject(PlaybackService);
  protected readonly documents = inject(DocumentService);
  private readonly edits = inject(EditService);
  private readonly library = inject(AudioLibraryService);
  private readonly tempos = inject(TempoService);
  private readonly dialogs = inject(MatDialog);
  private readonly theme = inject(ThemeColorsService);
  private readonly settings = inject(SettingsService);
  private readonly i18n = inject(I18nService);

  private readonly lanes = viewChild.required<ElementRef<HTMLElement>>('lanes');
  private readonly scroller = viewChild.required<ElementRef<HTMLElement>>('scroller');

  /** Selected range in lanes coordinates (clipped to the view), null when none or out of view. */
  protected readonly rangeBox = computed(() => {
    const range = this.timeline.range();
    if (!range) return null;
    const width = this.timeline.viewWidth();
    const x0 = Math.max(0, this.timeline.timeToX(range.start));
    const x1 = Math.min(width, this.timeline.timeToX(range.end));
    return x1 > x0 ? { left: Math.round(x0), width: Math.round(x1 - x0) } : null;
  });

  /** Playhead x inside the lanes, null when out of view. */
  protected readonly playheadX = computed(() => {
    const x = this.timeline.timeToX(this.playback.position());
    return x >= 0 && x <= this.timeline.viewWidth() ? Math.round(x) : null;
  });
  /** Playing state at the start of a scrub on the ruler. */
  private scrubResume = false;
  /** Gesture in progress on a lane. */
  private gesture?:
    | {
        kind: 'move';
        from: Montage;
        clipId: string;
        trackIndex: number;
        clipStart: number;
        pointerTime: number;
        pointerY: number;
        rowHeight: number;
        /** Track created when the clip is dragged on the empty strips (same id for the whole gesture). */
        newTrack: Track;
      }
    | { kind: 'trim'; from: Montage; clip: Clip; edge: 'start' | 'end' }
    | { kind: 'range'; anchor: number; anchorX: number }
    | { kind: 'envelope'; from: Montage; trackId: string; points: EnvelopePoint[]; index: number; lane: TrackLaneComponent }
    | { kind: 'mark'; from: BarMarking; zone: ClipHit['zone']; pointerTime: number }
    | { kind: 'curve'; from: Montage; trackId: string; points: EnvelopePoint[]; index: number; lane: TrackLaneComponent };

  /** Envelope point being dragged. */
  protected readonly activePoint = signal<{ trackId: string; index: number } | null>(null);


  /** Ids of the tracks heard in the mix. */
  protected readonly audible = computed(() => new Set(audibleTracks(this.montages.montage()).map((t) => t.id)));

  /** Width of the scrollbar content (px). */
  protected readonly scrollWidth = signal(0);
  /** Set when a montage is opened: the view fits it once all its sources are decoded. */
  private fitPending = true;

  constructor() {
    // lanes viewport width (the probe has the same width as the lanes)
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      const probe = this.lanes().nativeElement;
      const observer = new ResizeObserver(() => this.timeline.viewWidth.set(probe.clientWidth));
      observer.observe(probe);
      destroyRef.onDestroy(() => observer.disconnect());
    });
    effect(() => {
      this.montages.generation();
      this.fitPending = true;
    });
    effect(() => {
      const sources = Object.values(this.library.sources());
      const loaded = sources.length > 0 && sources.every((s) => s.status === 'ready' || s.status === 'error');
      if (loaded && this.timeline.viewWidth() > 0 && this.fitPending) {
        this.fitPending = false;
        untracked(() => this.timeline.fit());
      }
    });
    // while playing, the view follows the playhead page by page
    effect(() => {
      const position = this.playback.position();
      if (!this.playback.playing()) return;
      untracked(() => {
        const x = this.timeline.timeToX(position);
        const width = this.timeline.viewWidth();
        if (x > width * 0.95 || x < 0) this.timeline.setScroll(position - (width * 0.05) / this.timeline.pxPerSec());
      });
    });
    // native scrollbar <-> timeline scroll
    effect(() => {
      const view = this.timeline.viewWidth();
      const content = this.timeline.extent() * this.timeline.pxPerSec();
      this.scrollWidth.set(Math.min(MAX_SCROLL_WIDTH, Math.max(view, content)));
      const el = this.scroller().nativeElement;
      const left = this.scrollToLeft(this.timeline.scroll(), view, content);
      queueMicrotask(() => {
        if (Math.abs(el.scrollLeft - left) > 1) el.scrollLeft = left;
      });
    });
  }

  protected onScrollbar(): void {
    const el = this.scroller().nativeElement;
    const view = this.timeline.viewWidth();
    const content = this.timeline.extent() * this.timeline.pxPerSec();
    const range = this.scrollWidth() - view;
    const fraction = range > 0 ? el.scrollLeft / range : 0;
    const time = (fraction * Math.max(0, content - view)) / this.timeline.pxPerSec();
    if (Math.abs(time - this.timeline.scroll()) * this.timeline.pxPerSec() > 1) this.timeline.setScroll(time);
  }

  /**
   * On a clip: selects it and moves it (or trims it when grabbed on an edge);
   * elsewhere: moves the playhead there and, dragging, selects a time range.
   */
  protected onLaneDown(event: PointerEvent, lane: TrackLaneComponent, trackIndex: number): void {
    const target = event.currentTarget as HTMLElement;
    const marking = this.timeline.beatMarking();
    if (marking) {
      // marking a bar: dragging it moves it, its edges stretch it, a click elsewhere on the clip places the 1
      if (event.button !== 0) return;
      const zone = lane.markedBarAt(this.xAt(event));
      if (zone) {
        target.setPointerCapture(event.pointerId);
        if (zone === 'body') target.style.cursor = 'grabbing';
        this.gesture = { kind: 'mark', from: marking, zone, pointerTime: this.timeAt(event) };
      } else {
        void this.edits.placeDownbeat(this.timeAt(event));
      }
      return;
    }
    if (this.timeline.envelopeMode()) return this.onEnvelopeDown(event, lane, target);
    if (event.button !== 0) return;
    target.setPointerCapture(event.pointerId);
    const hit = lane.clipAt(this.xAt(event));
    const from = this.montages.montage();
    if (!hit) {
      const time = this.timeAt(event);
      this.timeline.selectedClipId.set(null);
      this.timeline.range.set(null);
      this.playback.seek(time);
      this.gesture = { kind: 'range', anchor: time, anchorX: event.clientX };
      return;
    }
    this.timeline.selectedClipId.set(hit.clip.id);
    if (hit.zone !== 'body') {
      this.gesture = { kind: 'trim', from, clip: hit.clip, edge: hit.zone };
      return;
    }
    target.style.cursor = 'grabbing';
    this.gesture = {
      kind: 'move',
      from,
      clipId: hit.clip.id,
      trackIndex,
      clipStart: hit.clip.start,
      pointerTime: this.timeAt(event),
      pointerY: event.clientY,
      rowHeight: (target.parentElement as HTMLElement).offsetHeight,
      newTrack: {
        id: crypto.randomUUID(),
        name: copyName(lane.track().name, from.tracks.map((t) => t.name)),
        clips: [],
      },
    };
  }

  protected onLaneMove(event: PointerEvent): void {
    const gesture = this.gesture;
    if (!gesture) return;
    const time = this.timeAt(event);
    switch (gesture.kind) {
      case 'move': {
        const start = Math.max(0, gesture.clipStart + time - gesture.pointerTime);
        const rows = Math.round((event.clientY - gesture.pointerY) / gesture.rowHeight);
        // one row past the last track = a new track, unless the clip is alone on its track
        // (the new track would just replace the one left empty)
        const alone = gesture.from.tracks[gesture.trackIndex].clips.length === 1;
        const last = gesture.from.tracks.length - (alone ? 1 : 0);
        const trackIndex = Math.min(last, Math.max(0, gesture.trackIndex + rows));
        return this.montages.preview(moveClip(gesture.from, gesture.clipId, trackIndex, start, gesture.newTrack));
      }
      case 'trim': {
        const length = (clip: Clip) => this.timeline.clipLength(clip);
        const sourceLength = this.timeline.sourceLength(gesture.clip);
        return this.montages.preview(
          trimClip(gesture.from, gesture.clip.id, gesture.edge, Math.max(0, time), length, sourceLength),
        );
      }
      case 'envelope': {
        const y = event.clientY - (event.currentTarget as HTMLElement).getBoundingClientRect().top;
        const points = movePoint(gesture.points, gesture.index, Math.max(0, time), gesture.lane.yToGain(y));
        return this.montages.preview(withEnvelope(gesture.from, gesture.trackId, points));
      }
      case 'mark':
        return this.edits.dragBar(gesture.from, gesture.zone, time - gesture.pointerTime);
      case 'curve': {
        // the handle follows the pointer: the bend that puts the curve's midpoint there
        const y = event.clientY - (event.currentTarget as HTMLElement).getBoundingClientRect().top;
        const a = gesture.points[gesture.index];
        const b = gesture.points[gesture.index + 1];
        const fraction = (gesture.lane.yToGain(y) - a.gain) / (b.gain - a.gain);
        const points = setCurve(gesture.points, gesture.index, curveThroughMidpoint(fraction));
        return this.montages.preview(withEnvelope(gesture.from, gesture.trackId, points));
      }
      case 'range': {
        if (Math.abs(event.clientX - gesture.anchorX) < RANGE_THRESHOLD) return this.timeline.range.set(null);
        const end = Math.max(0, time);
        this.timeline.range.set({ start: Math.min(gesture.anchor, end), end: Math.max(gesture.anchor, end) });
        return this.playback.seek(Math.min(gesture.anchor, end));
      }
    }
  }

  protected onLaneUp(event: PointerEvent): void {
    const gesture = this.gesture;
    const target = event.currentTarget as HTMLElement;
    if (target.hasPointerCapture(event.pointerId)) target.releasePointerCapture(event.pointerId);
    target.style.cursor = '';
    this.gesture = undefined;
    this.activePoint.set(null);
    if (gesture && gesture.kind !== 'range' && gesture.kind !== 'mark') this.montages.commit(gesture.from);
  }


  /**
   * Envelope editing: dragging a point moves it, clicking elsewhere adds a point (and drags it),
   * right click on a point removes it.
   */
  private onEnvelopeDown(event: PointerEvent, lane: TrackLaneComponent, target: HTMLElement): void {
    // current state of the track (the lane input is refreshed only at the next render)
    const id = lane.track().id;
    const track = this.montages.montage().tracks.find((t) => t.id === id) ?? lane.track();
    const y = event.clientY - target.getBoundingClientRect().top;
    const hit = lane.pointAt(this.xAt(event), y);
    const from = this.montages.montage();
    let points = track.envelope ?? [];
    const handle = hit === undefined ? lane.curveHandleAt(this.xAt(event), y) : undefined;
    if (handle !== undefined && event.button === 0) {
      target.setPointerCapture(event.pointerId);
      this.gesture = { kind: 'curve', from, trackId: track.id, points, index: handle, lane };
      return;
    }
    if (event.button === 2) {
      if (hit !== undefined) this.montages.update((m) => withEnvelope(m, track.id, points.filter((_, i) => i !== hit)));
      return;
    }
    if (event.button !== 0) return;
    let index = hit;
    if (index === undefined) {
      [points, index] = insertPoint(points, { time: Math.max(0, this.timeAt(event)), gain: lane.yToGain(y) });
      this.montages.preview(withEnvelope(from, track.id, points));
    }
    target.setPointerCapture(event.pointerId);
    this.activePoint.set({ trackId: track.id, index });
    this.gesture = { kind: 'envelope', from, trackId: track.id, points, index, lane };
  }

  /** Double click on a clip: speed and pitch dialog; on an envelope bend handle: straight segment. */
  protected onLaneDoubleClick(event: MouseEvent, lane: TrackLaneComponent): void {
    if (this.timeline.envelopeMode()) {
      const y = event.clientY - (event.currentTarget as HTMLElement).getBoundingClientRect().top;
      const handle = lane.curveHandleAt(event.clientX - this.lanes().nativeElement.getBoundingClientRect().left, y);
      const track = lane.track();
      if (handle !== undefined && track.envelope) {
        this.montages.update((m) => withEnvelope(m, track.id, setCurve(track.envelope!, handle, 0)));
      }
      return;
    }
    const hit = lane.clipAt(event.clientX - this.lanes().nativeElement.getBoundingClientRect().left);
    if (hit?.zone === 'body') void this.edits.editTiming(hit.clip.id);
  }

  /** Details of the track and of its files, with its name editable. */
  protected showInfo(track: Track): void {
    const sources = new Map<string, TrackInfoSource>();
    for (const clip of track.clips) {
      const existing = sources.get(clip.sourceId);
      if (existing) {
        existing.clips++;
        continue;
      }
      const source = this.montages.montage().sources.find((s) => s.id === clip.sourceId);
      const state = this.library.sources()[clip.sourceId];
      const info = state && 'info' in state ? state.info : undefined;
      const tempo = this.tempos.sourceTempo(clip.sourceId);
      sources.set(clip.sourceId, {
        path: source?.path ?? '',
        ...info,
        bpm: tempo?.bpm,
        bpmManual: !!source?.tempo,
        clips: 1,
      });
    }
    const start = Math.min(...track.clips.map((c) => c.start));
    const end = Math.max(...track.clips.map((c) => c.start + this.timeline.clipLength(c)));
    const data: TrackInfoData = {
      name: track.name,
      clips: track.clips.length,
      length: track.clips.length ? end - start : 0,
      muted: !!track.muted,
      solo: !!track.solo,
      envelopePoints: track.envelope?.length ?? 0,
      sources: [...sources.values()],
    };
    const ref = this.dialogs.open<TrackInfoDialogComponent, TrackInfoData, TrackInfoResult>(TrackInfoDialogComponent, {
      data,
      autoFocus: 'first-tabbable',
    });
    ref.afterClosed().subscribe((result) => {
      if (result && result.name !== track.name) this.montages.updateTrack(track.id, (t) => ({ ...t, name: result.name }));
    });
  }

  /** Removes a track after a confirmation. */
  protected async removeTrack(track: Track): Promise<void> {
    const choice = await os.showMessageBox(
      this.i18n.t('track.remove'),
      this.i18n.t('track.removeConfirm', { name: track.name, n: track.clips.length }),
      'YES_NO' as MessageBoxChoice,
      'QUESTION' as Icon,
    );
    if (choice === 'YES') this.montages.removeTrack(track.id);
  }

  protected toggleMute(track: Track): void {
    this.montages.updateTrack(track.id, (t) => ({ ...t, muted: !t.muted }));
  }

  protected toggleSolo(track: Track): void {
    this.montages.updateTrack(track.id, (t) => ({ ...t, solo: !t.solo }));
  }

  /** Click or drag on the ruler (or on a lane) moves the playhead. */
  protected onScrubStart(event: PointerEvent): void {
    if (event.button !== 0) return;
    const target = event.currentTarget as HTMLElement;
    target.setPointerCapture(event.pointerId);
    this.scrubResume = this.playback.playing();
    this.playback.pause();
    this.playback.seek(this.timeAt(event));
  }

  protected onScrubMove(event: PointerEvent): void {
    if ((event.currentTarget as HTMLElement).hasPointerCapture(event.pointerId)) this.playback.seek(this.timeAt(event));
  }

  protected onScrubEnd(event: PointerEvent): void {
    const target = event.currentTarget as HTMLElement;
    if (!target.hasPointerCapture(event.pointerId)) return;
    target.releasePointerCapture(event.pointerId);
    if (this.scrubResume) this.playback.play();
  }

  private xAt(event: PointerEvent): number {
    return event.clientX - this.lanes().nativeElement.getBoundingClientRect().left;
  }

  private timeAt(event: PointerEvent): number {
    return this.timeline.xToTime(this.xAt(event));
  }

  /** Ctrl+wheel zooms around the pointer, Shift+wheel (or horizontal wheel) scrolls the time. */
  protected onWheel(event: WheelEvent): void {
    const x = event.clientX - this.lanes().nativeElement.getBoundingClientRect().left;
    if (event.ctrlKey) {
      event.preventDefault();
      this.timeline.zoomBy(event.deltaY < 0 ? WHEEL_ZOOM_STEP : 1 / WHEEL_ZOOM_STEP, Math.max(0, x));
      return;
    }
    const dx = event.shiftKey ? event.deltaY : event.deltaX;
    if (dx) {
      event.preventDefault();
      this.timeline.setScroll(this.timeline.scroll() + dx / this.timeline.pxPerSec());
    }
  }

  /** State of the source played by the first clip of the track. */
  protected sourceOf(track: Track): SourceState | undefined {
    const sourceId = track.clips[0]?.sourceId;
    return sourceId ? this.library.sources()[sourceId] : undefined;
  }

  /** Color of the source of the track's first clip (the clips of each source share a color). */
  protected colorOf(track: Track): string | null {
    const sourceId = track.clips[0]?.sourceId;
    const index = this.montages.montage().sources.findIndex((s) => s.id === sourceId);
    return index < 0 ? null : sourceColors(index, this.theme.colors().dark).clipBorder;
  }

  /** Tempo of the source of the track's first clip, for the header. */
  protected tempoLabel(track: Track): string | null {
    const sourceId = track.clips[0]?.sourceId;
    if (!sourceId) return null;
    if (this.tempos.isDetecting(sourceId)) return this.i18n.t('tempo.detecting');
    const tempo = this.tempos.sourceTempo(sourceId);
    if (tempo === undefined) return null;
    if (tempo === null) return this.i18n.t('tempo.unknown');
    return this.i18n.t('tempo.value', { bpm: tempo.bpm.toFixed(1), confidence: Math.round(tempo.confidence * 100) });
  }

  protected describe(info: AudioInfo): string {
    const parts = [
      info.codec,
      `${(info.sampleRate / 1000).toLocaleString(this.settings.language())} kHz`,
      this.i18n.t(`channels.${info.channels}`),
    ];
    if (info.bitRate) parts.push(`${Math.round(info.bitRate / 1000)} kbps`);
    parts.push(formatDuration(info.duration));
    return parts.join(' Â· ');
  }

  protected readonly fileName = fileName;

  private scrollToLeft(time: number, view: number, content: number): number {
    const range = this.scrollWidth() - view;
    const max = Math.max(0, content - view);
    return max > 0 ? ((time * this.timeline.pxPerSec()) / max) * range : 0;
  }
}
