import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ClipTiming, ClipTimingData, ClipTimingDialogComponent } from '../features/timeline/clip-timing-dialog.component';
import { TempoDialogComponent, TempoDialogData, TempoDialogResult } from '../features/timeline/tempo-dialog.component';
import { BarFileService } from './audio/bar-file.service';
import { TempoService } from './audio/tempo.service';
import { snapToOnsets } from './audio/tempo';
import { clearAnchors, meanBpm, steadyTempo, trackBars, unpinBar } from './audio/tempo-map';
import { AlignClip, AlignDialogData, AlignTempoDialogComponent } from '../features/timeline/align-tempo-dialog.component';
import { AlignContext, AlignOptions, alignTempo } from './montage/tempo-align';
import { PlaybackService } from './audio/playback.service';
import { applyCrossfade, findCrossfade } from './montage/crossfade';
import { cropToRange, deleteRange, moveClips, setClipTiming, splitAt } from './montage/edits';
import { Clip, Montage, clipRate } from './montage/montage.model';
import { nextAnchorShift } from './timeline/edge-snap';
import { MontageService } from './montage/montage.service';
import { BarMarking, TimelineService } from './timeline/timeline.service';
import { I18nService } from './i18n/i18n.service';
import { ShellPort } from './platform/shell.port';

/** Tempo range of a bar stretched by hand. */
const MIN_MARK_BPM = 20;
const MAX_MARK_BPM = 400;

/** Pause (ms) after which the next arrow press starts a new undo step. */
const NUDGE_PAUSE = 800;

/** Editing commands on the selection (clip or time range) and at the playhead. */
@Injectable({ providedIn: 'root' })
export class EditService {
  private readonly montages = inject(MontageService);
  private readonly timeline = inject(TimelineService);
  private readonly playback = inject(PlaybackService);
  private readonly dialogs = inject(MatDialog);
  private readonly tempos = inject(TempoService);
  private readonly i18n = inject(I18nService);
  private readonly shell = inject(ShellPort);
  private readonly barFiles = inject(BarFileService);

  private readonly length = (clip: Clip) => this.timeline.clipLength(clip);

  readonly hasRange = computed(() => this.timeline.range() !== null);
  /** Clips with a known tempo, as offered by the alignment dialog. */
  readonly tempoClips = computed<AlignClip[]>(() => {
    const clips: AlignClip[] = [];
    for (const track of this.montages.montage().tracks) {
      track.clips.forEach((clip, index) => {
        const tempo = this.tempos.sourceTempo(clip.sourceId);
        if (!tempo) return;
        const label = track.clips.length > 1 ? `${track.name} #${index + 1}` : track.name;
        clips.push({ id: clip.id, label, bpm: meanBpm(tempo) * clipRate(clip), confidence: tempo.confidence });
      });
    }
    return clips;
  });
  readonly canAlign = computed(() => this.tempoClips().length >= 2);
  /**
   * Crossfade possible: between the selected clips (two or more), within the range when there is
   * one; with fewer clips selected, any clip ending in the range over one starting there.
   */
  readonly crossfadeAt = computed(() => {
    const range = this.timeline.range();
    const clips = this.timeline.selectedClips();
    if (clips.size >= 2) return findCrossfade(this.montages.montage(), range?.start ?? 0, range?.end ?? Infinity, this.length, clips);
    return range ? findCrossfade(this.montages.montage(), range.start, range.end, this.length) : null;
  });
  /** Something to delete: a range or some clips. */
  readonly canDelete = computed(() => this.hasRange() || this.timeline.selectedClipIds().length > 0);

  constructor() {
    // a new montage clears the selection
    effect(() => {
      this.montages.generation();
      untracked(() => {
        this.timeline.range.set(null);
        this.timeline.selectClip(null);
      });
    });
    // clips removed (undo, delete, crop...) leave the selection
    effect(() => {
      const ids = new Set(this.montages.montage().tracks.flatMap((t) => t.clips.map((c) => c.id)));
      untracked(() => {
        const selected = this.timeline.selectedClipIds();
        if (selected.some((id) => !ids.has(id))) this.timeline.selectedClipIds.set(selected.filter((id) => ids.has(id)));
      });
    });
  }

  /** Splits at the playhead the selected clips or, with no clip selected, every clip crossing it. */
  split(): void {
    const selected = this.timeline.selectedClips();
    this.montages.edit((m) => splitAt(m, this.playback.position(), this.length, selected.size ? selected : undefined));
  }

  /** Keeps only the selected range of every track, moved to the start. */
  crop(): void {
    const range = this.timeline.range();
    if (!range) return;
    this.montages.edit((m) => cropToRange(m, range.start, range.end, this.length));
    this.timeline.range.set(null);
    this.playback.seek(0);
  }

  /** Fades out the clip that ends in the selected range and fades in the one that starts there. */
  crossfade(): void {
    const crossfade = this.crossfadeAt();
    if (crossfade) this.montages.update((m) => applyCrossfade(m, crossfade));
  }

  /**
   * Deletes the selected range (closing the gap) or else the selected clips; when these are all
   * the clips of a track, the track goes too: asked first, as with the remove button of a track.
   */
  async delete(): Promise<void> {
    const range = this.timeline.range();
    if (range) {
      this.montages.edit((m) => deleteRange(m, range.start, range.end, this.length));
      this.timeline.range.set(null);
      return this.playback.seek(range.start);
    }
    const ids = this.timeline.selectedClipIds();
    if (!ids.length) return;
    const selected = new Set(ids);
    const emptied = this.montages.montage().tracks.filter((t) => t.clips.length && t.clips.every((c) => selected.has(c.id)));
    if (emptied.length) {
      const [track] = emptied;
      const message =
        emptied.length === 1
          ? this.i18n.t('track.removeConfirm', { name: track.name, n: track.clips.length })
          : this.i18n.t('track.removeManyConfirm', { names: emptied.map((t) => `"${t.name}"`).join(', ') });
      if ((await this.shell.ask(this.i18n.t('track.remove'), message)) !== 'yes') return;
    }
    this.timeline.selectClip(null);
    this.montages.removeClips(ids);
  }

  /** Montage before a run of nudges (arrow key held, or pressed again soon): one undo step for all. */
  private nudgeFrom: Montage | null = null;
  private nudgeTimer?: ReturnType<typeof setTimeout>;

  /**
   * Moves the selected clips with the keyboard: by one pixel at the current zoom, or
   * (`toAnchor`) to the next edge or envelope point of the other clips, or the playhead.
   */
  nudge(direction: 1 | -1, toAnchor: boolean): void {
    const ids = this.timeline.selectedClips();
    if (!ids.size) return;
    const montage = this.montages.montage();
    const earliest = Math.min(...montage.tracks.flatMap((t) => t.clips.filter((c) => ids.has(c.id)).map((c) => c.start)));
    const shift = toAnchor
      ? nextAnchorShift(montage, ids, direction, this.length, [this.playback.position()])
      : direction / this.timeline.pxPerSec();
    if (shift === null) return;
    const delta = Math.max(-earliest, shift);
    if (!delta) return;
    clearTimeout(this.nudgeTimer);
    this.nudgeFrom ??= montage;
    this.montages.preview(moveClips(montage, ids, delta, 0));
  }

  /**
   * Ends a run of nudges with one undo step: at once (another action), or (`soon`, an arrow
   * released) after a pause, so that quick presses make a single step.
   */
  endNudge(soon = false): void {
    clearTimeout(this.nudgeTimer);
    if (!this.nudgeFrom) return;
    if (soon) {
      this.nudgeTimer = setTimeout(() => this.endNudge(), NUDGE_PAUSE);
      return;
    }
    this.montages.commit(this.nudgeFrom);
    this.nudgeFrom = null;
  }

  /** Selects every clip of the montage. */
  selectAll(): void {
    this.timeline.selectedClipIds.set(this.montages.montage().tracks.flatMap((t) => t.clips.map((c) => c.id)));
  }

  /** Sets speed and pitch (semitones) of a clip. */
  setTiming(clipId: string, rate: number, pitch: number, varispeed?: boolean): void {
    const clip = this.montages.montage().tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
    if (!clip) return;
    const sourceLength = this.timeline.sourceLength(clip);
    const mode = varispeed ?? !!clip.varispeed;
    this.montages.update((m) => setClipTiming(m, clipId, rate, pitch, sourceLength, mode));
  }

  /** Speed and pitch dialog of a clip, applying the values chosen. */
  async editTiming(clipId: string): Promise<void> {
    const track = this.montages.montage().tracks.find((t) => t.clips.some((c) => c.id === clipId));
    const clip = track?.clips.find((c) => c.id === clipId);
    if (!track || !clip) return;
    const rate = clipRate(clip);
    const data: ClipTimingData = {
      name: track.name,
      originalLength: this.timeline.clipLength(clip) * rate,
      rate,
      pitch: clip.pitch ?? 0,
      varispeed: !!clip.varispeed,
    };
    const ref = this.dialogs.open<ClipTimingDialogComponent, ClipTimingData, ClipTiming>(ClipTimingDialogComponent, {
      data,
      autoFocus: 'dialog',
    });
    const result = await firstValueFrom(ref.afterClosed());
    if (result && (result.rate !== data.rate || result.pitch !== data.pitch || result.varispeed !== data.varispeed)) {
      this.setTiming(clipId, result.rate, result.pitch, result.varispeed);
    }
  }

  /** Tempo dialog of the source of a clip; the values set are saved on the source. */
  async editTempo(clipId: string): Promise<void> {
    const track = this.montages.montage().tracks.find((t) => t.clips.some((c) => c.id === clipId));
    const clip = track?.clips.find((c) => c.id === clipId);
    if (!track || !clip) return;
    const source = this.montages.montage().sources.find((s) => s.id === clip.sourceId);
    const state = this.tempos.detected()[clip.sourceId];
    const rate = clipRate(clip);
    const position = this.playback.position();
    const inside = position >= clip.start && position <= clip.start + this.timeline.clipLength(clip);
    const data: TempoDialogData = {
      name: track.name,
      tempo: this.tempos.sourceTempo(clip.sourceId) ?? null,
      detected: state?.status === 'ready' ? state.tempo : null,
      fromFile: state?.status === 'ready' && !!state.fromFile,
      manual: !!source?.tempo,
      tracking: this.trackingSource() === clip.sourceId,
      playheadSourceTime: inside ? clip.offset + (position - clip.start) * rate : null,
      rate,
    };
    const ref = this.dialogs.open<TempoDialogComponent, TempoDialogData, TempoDialogResult>(TempoDialogComponent, {
      data,
      autoFocus: 'dialog',
    });
    const result = await firstValueFrom(ref.afterClosed());
    if (!result) return;
    if (result.mark) return this.startBeatMarking(clipId, result.mark.beatsPerBar, result.mark.bpm);
    if (result.track) return void this.trackBars(clip.sourceId);
    if (result.steady) return this.steadyTempo(clip.sourceId);
    if (result.clear) return this.clearAnchors(clip.sourceId, result.clear === 'auto');
    if (result.file === 'save') return void this.barFiles.save(clip.sourceId);
    if (result.file === 'load') return void this.barFiles.load(clip.sourceId);
    this.montages.setSourceTempo(clip.sourceId, result.tempo);
    // the grid shows the result
    this.timeline.beatGrid.set(true);
  }

  /** Alignment of the tempo of several clips (speed and, optionally, position on the bars). */
  async alignTempo(): Promise<void> {
    const clips = this.tempoClips();
    if (clips.length < 2) return;
    // reference: the first selected clip with a tempo
    const selected = this.timeline.selectedClipIds().find((id) => clips.some((c) => c.id === id));
    const data: AlignDialogData = { clips, referenceId: selected ?? clips[0].id };
    const ref = this.dialogs.open<AlignTempoDialogComponent, AlignDialogData, AlignOptions>(AlignTempoDialogComponent, {
      data,
      autoFocus: 'dialog',
    });
    const options = await firstValueFrom(ref.afterClosed());
    if (!options) return;
    const context: AlignContext = {
      tempoOf: (sourceId) => this.tempos.sourceTempo(sourceId),
      length: this.length,
      sourceLength: (clip) => this.timeline.sourceLength(clip),
    };
    this.montages.update((m) => alignTempo(m, options, context));
    this.timeline.beatGrid.set(true);
  }

  /** Starts marking a bar of a clip (see placeDownbeat and dragBar). */
  startBeatMarking(clipId: string, beatsPerBar: number, bpm: number): void {
    const clip = this.markingClip(clipId);
    if (!clip) return;
    this.timeline.selectClip(clipId);
    this.timeline.beatMarking.set({ clipId, sourceId: clip.sourceId, beatsPerBar, bpm, downbeat: null });
  }

  private markingClip(clipId: string): Clip | undefined {
    return this.montages.montage().tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
  }

  /** The 1 of the bar at a timeline time inside the clip being marked, moved to the nearest attack. */
  async placeDownbeat(time: number): Promise<void> {
    const marking = this.timeline.beatMarking();
    const clip = marking && this.markingClip(marking.clipId);
    if (!marking || !clip || time < clip.start || time > clip.start + this.length(clip)) return;
    const sourceTime = clip.offset + (time - clip.start) * clipRate(clip);
    this.timeline.beatMarking.set({ ...marking, downbeat: sourceTime });
    const curve = await this.tempos.onsetCurve(marking.sourceId);
    // the user may have moved on in the meantime
    const current = this.timeline.beatMarking();
    if (curve && current?.downbeat === sourceTime) this.timeline.beatMarking.set({ ...current, downbeat: snapToOnsets(curve, [sourceTime])[0] });
  }

  /**
   * Moves (body) or stretches (start / end edge) the marked bar by `delta` timeline seconds from
   * the state `from` it had when the drag began; stretching keeps the opposite edge still.
   */
  dragBar(from: BarMarking, zone: 'start' | 'end' | 'body', delta: number): void {
    const clip = this.markingClip(from.clipId);
    if (!clip || from.downbeat === null) return;
    const shift = delta * clipRate(clip);
    const bar = (60 * from.beatsPerBar) / from.bpm;
    const bpmOf = (length: number) => (60 * from.beatsPerBar) / length;
    // shortest and longest bar allowed by the tempo range
    const minBar = bar * (from.bpm / MAX_MARK_BPM);
    const maxBar = bar * (from.bpm / MIN_MARK_BPM);
    let { downbeat, bpm } = from;
    if (zone === 'body') downbeat = from.downbeat + shift;
    else if (zone === 'end') bpm = bpmOf(Math.min(maxBar, Math.max(minBar, bar + shift)));
    else {
      const length = Math.min(maxBar, Math.max(minBar, bar - shift));
      downbeat = from.downbeat + bar - length;
      bpm = bpmOf(length);
    }
    this.timeline.beatMarking.set({ ...from, downbeat, bpm });
  }

  /** Starts the marking again from the click on the 1. */
  undoBeatMark(): void {
    const marking = this.timeline.beatMarking();
    if (marking?.downbeat !== null && marking) this.timeline.beatMarking.set({ ...marking, downbeat: null });
  }

  cancelBeatMarking(): void {
    this.timeline.beatMarking.set(null);
  }

  /** Ends the marking: the bar gives BPM and downbeat of the source. */
  confirmBeatMarking(): void {
    const marking = this.timeline.beatMarking();
    if (marking?.downbeat == null) return this.cancelBeatMarking();
    const bpm = Math.round(marking.bpm * 100) / 100;
    const bar = (60 * marking.beatsPerBar) / bpm;
    // earliest downbeat of the grid: the bars are numbered from the start of the source
    const offset = ((marking.downbeat % bar) + bar) % bar;
    this.timeline.beatMarking.set(null);
    this.montages.setSourceTempo(marking.sourceId, {
      bpm,
      offset,
      confidence: 1,
      beatsPerBar: marking.beatsPerBar,
      // the marked bar stays pinned: a stretch of the bar map starts from there
      anchors: [{ bar: Math.round((marking.downbeat - offset) / bar), time: marking.downbeat }],
    });
    this.timeline.beatGrid.set(true);
  }

  /** Source whose bars are being tracked, if any. */
  readonly trackingSource = signal<string | null>(null);

  /**
   * Follows the bars along the whole source (tempo not steady): an anchor on every bar, found on
   * the attacks starting from the bars pinned by hand, which stay. Returns the share of beats
   * found on an attack, null when the tempo or the audio is not known.
   */
  async trackBars(sourceId: string): Promise<number | null> {
    const tempo = this.tempos.sourceTempo(sourceId);
    const length = this.timeline.sourceLength({ sourceId });
    if (!tempo || !length || this.trackingSource()) return null;
    this.trackingSource.set(sourceId);
    try {
      const curve = await this.tempos.onsetCurve(sourceId);
      if (!curve) return null;
      const result = trackBars(tempo, curve, length);
      this.montages.setSourceTempo(sourceId, result.tempo);
      this.timeline.beatGrid.set(true);
      return result.confidence;
    } finally {
      this.trackingSource.set(null);
    }
  }

  /** Unpins a bar of the map of a source: it goes back between the anchors around it. */
  unpinBar(sourceId: string, bar: number): void {
    const tempo = this.montages.montage().sources.find((s) => s.id === sourceId)?.tempo;
    if (tempo?.anchors?.some((a) => a.bar === bar)) this.montages.setSourceTempo(sourceId, unpinBar(tempo, bar));
  }

  /**
   * Removes the anchors of the bar map of a source (only those of the bar tracking with
   * `onlyAuto`): without anchors the grid is again the steady one the map started from.
   */
  clearAnchors(sourceId: string, onlyAuto = false): void {
    const tempo = this.montages.montage().sources.find((s) => s.id === sourceId)?.tempo;
    if (tempo?.anchors?.length) this.montages.setSourceTempo(sourceId, clearAnchors(tempo, onlyAuto));
  }

  /** Drops the bar map of a source: back to the steady tempo that best follows it. */
  steadyTempo(sourceId: string): void {
    const tempo = this.montages.montage().sources.find((s) => s.id === sourceId)?.tempo;
    if (tempo?.anchors) this.montages.setSourceTempo(sourceId, steadyTempo(tempo));
  }

  clearSelection(): void {
    this.timeline.range.set(null);
    this.timeline.selectClip(null);
  }
}
