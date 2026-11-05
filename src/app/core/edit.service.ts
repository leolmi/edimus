import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ClipTiming, ClipTimingData, ClipTimingDialogComponent } from '../features/timeline/clip-timing-dialog.component';
import { MarkerDialogComponent, MarkerDialogData } from '../features/timeline/marker-dialog.component';
import { TempoDialogComponent, TempoDialogData, TempoDialogResult } from '../features/timeline/tempo-dialog.component';
import { TrackFile, TrackFilesData, TrackFilesDialogComponent } from '../features/timeline/track-files-dialog.component';
import { AudioLibraryService } from './audio/audio-library.service';
import { BarFileService } from './audio/bar-file.service';
import { TempoService } from './audio/tempo.service';
import { type Tempo, snapToOnsets } from './audio/tempo';
import { barAt, barMeter, barTime, clearAnchors, meanBpm, steadyTempo, unpinBar } from './audio/tempo-map';
import { RhythmReport, TrackOptions, trackRhythm } from './audio/rhythm';
import { BarDoubt, barDoubts, beatsFrom } from './audio/bar-doubts';
import { AlignClip, AlignDialogData, AlignTempoDialogComponent } from '../features/timeline/align-tempo-dialog.component';
import { AlignContext, AlignOptions, alignTempo } from './montage/tempo-align';
import { PlaybackService } from './audio/playback.service';
import { applyCrossfade, findCrossfade } from './montage/crossfade';
import { cropToRange, deleteRange, moveClips, setClipTiming, splitAt, withClipLocked } from './montage/edits';
import { addMarker, removeMarker, renameMarker, sortedMarkers, withMarkers } from './montage/markers';
import { formatDuration } from './format';
import { EffectPreset, EffectType, EffectValue, addEffect, applyPreset, moveEffect, newEffect, removeEffect, setEffectBypass, setEffectParams } from './effects/effects';
import { Clip, Montage, TrackInput, clipRate, toSource, toTimeline } from './montage/montage.model';
import { nextAnchorShift } from './timeline/edge-snap';
import { MontageService } from './montage/montage.service';
import { TimelineService, TrackPanelTab } from './timeline/timeline.service';
import { I18nService } from './i18n/i18n.service';
import { ShellPort } from './platform/shell.port';

/** Seconds within which a 1 put by hand lands on an attack (the tracking looks further anyway). */
const MARK_ONSET_SNAP = 0.07;
/** Two 1s closer than this (seconds) are the same one. */
const MARK_MIN_GAP = 0.2;

/** Seconds after a marker within which Back, while playing, goes to the marker before it. */
const PASSED_MARKER = 0.5;

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
  private readonly library = inject(AudioLibraryService);
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
  readonly locked = this.montages.locked;

  constructor() {
    // a new montage clears the selection
    effect(() => {
      this.montages.generation();
      untracked(() => {
        this.timeline.range.set(null);
        this.timeline.selectClip(null);
      });
    });
    // the open effects panel follows the track of the clip selected last, also when the clip moves to another
    // track; only then (any other edit, e.g. to the effects of the track shown, leaves the panel where it is)
    const clipTrack = computed(
      () => {
        const ids = this.timeline.selectedClipIds();
        const last = ids[ids.length - 1];
        return { ids, trackId: last ? this.montages.montage().tracks.find((t) => t.clips.some((c) => c.id === last))?.id : undefined };
      },
      // a new selection, or the clip on another track
      { equal: (a, b) => a.ids === b.ids && a.trackId === b.trackId },
    );
    effect(() => {
      const { trackId } = clipTrack();
      untracked(() => {
        if (trackId && this.timeline.selectedTrackId()) this.timeline.selectedTrackId.set(trackId);
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

  /**
   * Locks or unlocks the montage against edits; locking leaves the editing modes (envelope, bar
   * marking) and closes the effects panel, whose controls would do nothing.
   */
  toggleLock(): void {
    const locked = !this.locked();
    this.endNudge();
    this.locked.set(locked);
    if (!locked) return;
    this.timeline.envelopeMode.set(false);
    this.timeline.beatMarking.set(null);
    // the details of a track stay readable; the effects would do nothing
    if (this.timeline.panelTab() === 'fx') this.timeline.selectedTrackId.set(null);
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
    if (this.locked()) return;
    const range = this.timeline.range();
    if (range) {
      this.montages.edit((m) => deleteRange(m, range.start, range.end, this.length));
      this.timeline.range.set(null);
      return this.playback.seek(range.start);
    }
    const ids = this.timeline.selectedClipIds();
    if (!ids.length || this.montages.refusesLocked({ clips: ids })) return;
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
    if (!ids.size || (!this.nudgeFrom && this.montages.refusesLocked({ clips: ids }))) return;
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

  /**
   * Locks a clip against accidental edits, or unlocks it: the selected clips with it when it is
   * among them. Allowed on a locked montage too: it only protects.
   */
  toggleClipLock(clipId: string): void {
    const clips = this.montages.montage().tracks.flatMap((t) => t.clips);
    const locked = !clips.find((c) => c.id === clipId)?.locked;
    const selected = this.timeline.selectedClips();
    const ids = selected.has(clipId) ? [...selected] : [clipId];
    this.montages.update((m) => ids.reduce((acc, id) => withClipLocked(acc, id, locked), m), true);
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
    if (this.locked()) return;
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
    if (this.locked()) return;
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
      report: this.tempos.reports()[clip.sourceId] ?? null,
      playheadSourceTime: inside ? clip.offset + (position - clip.start) * rate : null,
      rate,
    };
    const ref = this.dialogs.open<TempoDialogComponent, TempoDialogData, TempoDialogResult>(TempoDialogComponent, {
      data,
      autoFocus: 'dialog',
    });
    const result = await firstValueFrom(ref.afterClosed());
    if (!result) return;
    if (result.mark) return this.startBeatMarking(clipId, result.mark);
    // what the tracking found, with its doubts, in the marking of the 1s
    if (result.track) return void this.trackBars(clip.sourceId, result.track).then((report) => report && this.startBeatMarking(clipId, result.track));
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
    if (this.locked() || clips.length < 2) return;
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

  /**
   * Starts marking the 1s of a clip, from those already set by hand on its source: a few
   * downbeats put by the user, the bar tracking follows the rest (see detectBars).
   */
  startBeatMarking(clipId: string, options: TrackOptions = {}): void {
    const clip = this.markingClip(clipId);
    if (!clip || this.locked()) return;
    this.timeline.selectClip(clipId);
    this.timeline.beatGrid.set(true);
    this.timeline.beatMarking.set({ clipId, sourceId: clip.sourceId, marks: this.handMarks(clip.sourceId), selected: null, options, focus: null });
  }

  private markingClip(clipId: string): Clip | undefined {
    return this.montages.montage().tracks.flatMap((t) => t.clips).find((c) => c.id === clipId);
  }

  /** Downbeats set by hand in the bar map of a source. */
  private handMarks(sourceId: string): number[] {
    return (this.tempos.sourceTempo(sourceId)?.anchors ?? [])
      .filter((a) => !a.auto)
      .map((a) => a.time)
      .sort((a, b) => a - b);
  }

  /** Replaces the 1s being marked, in time order, `selected` the one at that time. */
  private setMarks(marks: number[], selected: number | null = null): void {
    const marking = this.timeline.beatMarking();
    if (!marking) return;
    const sorted = [...marks].sort((a, b) => a - b);
    this.timeline.beatMarking.set({ ...marking, marks: sorted, selected: selected === null ? null : sorted.indexOf(selected) });
  }

  /** A 1 at a timeline time inside the clip being marked, on the nearest attack. */
  async addMark(time: number): Promise<void> {
    const marking = this.timeline.beatMarking();
    const clip = marking && this.markingClip(marking.clipId);
    if (!marking || !clip || time < clip.start || time > clip.start + this.length(clip)) return;
    let at = toSource(clip, time);
    const curve = await this.tempos.onsetCurve(marking.sourceId);
    if (curve) at = snapToOnsets(curve, [at], MARK_ONSET_SNAP)[0];
    // the user may have moved on in the meantime
    const current = this.timeline.beatMarking();
    if (current?.clipId !== marking.clipId) return;
    // on a 1 already there: that one is selected
    const near = current.marks.findIndex((m) => Math.abs(m - at) < MARK_MIN_GAP);
    if (near >= 0) return this.timeline.beatMarking.set({ ...current, selected: near });
    this.setMarks([...current.marks, at], at);
  }

  /** Moves the 1 `index` of `from` (the marks as the drag began) to a timeline time, inside the clip. */
  moveMark(from: number[], index: number, time: number): void {
    const clip = this.timeline.beatMarking() && this.markingClip(this.timeline.beatMarking()!.clipId);
    if (!clip || index < 0 || index >= from.length) return;
    const at = toSource(clip, Math.min(clip.start + this.length(clip), Math.max(clip.start, time)));
    this.setMarks(
      from.map((m, i) => (i === index ? at : m)),
      at,
    );
  }

  /** The 1 just dropped onto the nearest attack (two 1s on the same beat become one). */
  async settleMark(): Promise<void> {
    const marking = this.timeline.beatMarking();
    const index = marking?.selected ?? null;
    if (!marking || index === null) return;
    const time = marking.marks[index];
    const curve = await this.tempos.onsetCurve(marking.sourceId);
    const current = this.timeline.beatMarking();
    if (!current || current.marks[index] !== time) return;
    const at = curve ? snapToOnsets(curve, [time], MARK_ONSET_SNAP)[0] : time;
    const others = current.marks.filter((_, i) => i !== index && Math.abs(current.marks[i] - at) >= MARK_MIN_GAP);
    this.setMarks([...others, at], at);
  }

  /** Removes a 1 (default: the selected one). */
  removeMark(index = this.timeline.beatMarking()?.selected ?? -1): void {
    const marking = this.timeline.beatMarking();
    if (!marking || index < 0 || index >= marking.marks.length) return;
    this.setMarks(marking.marks.filter((_, i) => i !== index));
  }

  /** Removes all the 1s being marked (the map changes only with the next detection). */
  clearMarks(): void {
    this.setMarks([]);
  }

  cancelBeatMarking(): void {
    this.timeline.beatMarking.set(null);
  }

  /**
   * Follows the bars along the source with the 1s marked: each one is looked for on the audio
   * near where it was put and forced to be a downbeat. The marking goes on, with the 1s where the
   * tracking found them and the doubts it left (barDoubts).
   */
  async detectBars(): Promise<void> {
    const marking = this.timeline.beatMarking();
    if (!marking || this.trackingSource()) return;
    const tempo: Tempo = this.tempos.sourceTempo(marking.sourceId) ?? { bpm: 120, offset: 0, confidence: 0 };
    // numbers of the current grid, kept increasing: the tracking counts them again anyway
    let last = -Infinity;
    const anchors = marking.marks.map((time) => {
      const bar = Math.max(Math.round(barAt(tempo, time)), last + 1);
      last = bar;
      return { bar, time };
    });
    const { anchors: _, ...rest } = tempo;
    const result = await this.analyzeBars(marking.sourceId, marking.options, anchors.length ? { ...rest, anchors } : rest);
    if (!result) return;
    this.montages.setSourceTempo(marking.sourceId, result.tempo);
    const current = this.timeline.beatMarking();
    if (current?.sourceId !== marking.sourceId) return;
    // the 1s where the tracking put them; those it could not place stay where the user put them
    const found = this.handMarks(marking.sourceId);
    const lost = marking.marks.filter((m) => !found.some((f) => Math.abs(f - m) < MARK_MIN_GAP));
    this.timeline.beatMarking.set({ ...current, marks: [...found, ...lost].sort((a, b) => a - b), selected: null, focus: null });
  }

  /** Tracks again with another reading (meter of the whole piece, tempo of the beat). */
  retryBars(options: TrackOptions): void {
    const marking = this.timeline.beatMarking();
    if (!marking) return;
    this.timeline.beatMarking.set({ ...marking, options: { ...marking.options, ...options } });
    void this.detectBars();
  }

  /** Doubts of the last tracking of the source being marked, still open. */
  readonly barDoubts = computed<BarDoubt[]>(() => {
    const marking = this.timeline.beatMarking();
    const tempo = marking && this.tempos.sourceTempo(marking.sourceId);
    const report = marking && this.tempos.reports()[marking.sourceId];
    return tempo && report ? barDoubts(tempo, report) : [];
  });

  /** Shows the bars of a doubt on the timeline, highlighted on the waveform. */
  focusDoubt(doubt: BarDoubt): void {
    const marking = this.timeline.beatMarking();
    const clip = marking && this.markingClip(marking.clipId);
    const tempo = marking && this.tempos.sourceTempo(marking.sourceId);
    if (!marking || !clip || !tempo || doubt.kind === 'bpmAlt') return;
    const [first, end] = 'bar' in doubt ? [doubt.bar, doubt.bar + 1] : [doubt.from, doubt.to + 1];
    const focus = { from: barTime(tempo, first), to: barTime(tempo, end) };
    this.timeline.beatMarking.set({ ...marking, focus });
    // a bar before and after it, to see where it sits
    this.timeline.showSpan(toTimeline(clip, barTime(tempo, first - 1)), toTimeline(clip, barTime(tempo, end + 1)));
  }

  /** The 1s put (and those within reach of them, or of `remove`, taken away), then the tracking again. */
  private markAndDetect(add: number[], remove: number[] = []): void {
    const marking = this.timeline.beatMarking();
    if (!marking) return;
    const near = (m: number, list: number[]) => list.some((t) => Math.abs(t - m) < MARK_MIN_GAP);
    this.setMarks([...marking.marks.filter((m) => !near(m, add) && !near(m, remove)), ...add]);
    void this.detectBars();
  }

  /** Bar `bar` of the grid has `meter` beats: its 1 and the one `meter` beats later become marks. */
  setBarMeter(bar: number, meter: number): void {
    const tempo = this.markingTempo();
    if (!tempo) return;
    const beats = beatsFrom(tempo, bar, meter + 1);
    this.markAndDetect([beats[0], beats[meter]]);
  }

  /** The 1 of bar `bar` is one beat later (1) or earlier (-1) than the grid puts it. */
  shiftDownbeat(bar: number, by: 1 | -1): void {
    const tempo = this.markingTempo();
    if (!tempo) return;
    const old = barTime(tempo, bar);
    const previous = barMeter(tempo, bar - 1);
    const at = by > 0 ? beatsFrom(tempo, bar, 2)[1] : barTime(tempo, bar - 1 + (previous - 1) / previous);
    this.markAndDetect([at], [old]);
  }

  /** The bar is right as the tracking found it: its 1 and the next become marks. */
  keepBar(bar: number, whole = true): void {
    const tempo = this.markingTempo();
    if (tempo) this.markAndDetect(whole ? [barTime(tempo, bar), barTime(tempo, bar + 1)] : [barTime(tempo, bar)]);
  }

  private markingTempo(): Tempo | undefined {
    const marking = this.timeline.beatMarking();
    return (marking && this.tempos.sourceTempo(marking.sourceId)) || undefined;
  }

  /** Source whose bars are being tracked, if any. */
  readonly trackingSource = signal<string | null>(null);

  /**
   * Follows the bars along the whole source, beat by beat (see rhythm.ts): an anchor on every
   * downbeat with the beats of its bar, the free regions without grid, the bars pinned by hand
   * kept. Returns what the tracking found, null when the tempo or the audio is not known.
   */
  async trackBars(sourceId: string, options: TrackOptions = {}): Promise<RhythmReport | null> {
    const result = await this.analyzeBars(sourceId, options);
    if (!result) return null;
    this.montages.setSourceTempo(sourceId, result.tempo);
    this.timeline.beatGrid.set(true);
    return result.report;
  }

  /** The tracking of the bars of a source without applying it (the map it would give, and its report). */
  async analyzeBars(sourceId: string, options: TrackOptions = {}, base?: Tempo): Promise<{ tempo: Tempo; report: RhythmReport } | null> {
    const tempo = base ?? this.tempos.sourceTempo(sourceId);
    const length = this.timeline.sourceLength({ sourceId });
    if (!tempo || !length || this.trackingSource()) return null;
    this.trackingSource.set(sourceId);
    try {
      const features = await this.tempos.onsetCurve(sourceId);
      if (!features) return null;
      // the heavy part runs after the spinner is shown
      await new Promise((resolve) => setTimeout(resolve));
      const result = trackRhythm(tempo, features, length, options);
      this.tempos.reports.update((all) => ({ ...all, [sourceId]: result.report }));
      return result;
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
    this.timeline.selectedTrackId.set(null);
  }

  // --- markers -------------------------------------------------------------------------------
  // they only help finding passages: they can be set also on a locked montage

  /** Markers of the timeline, in time order. */
  readonly markers = computed(() => sortedMarkers(this.montages.montage()));

  /**
   * Back: the playhead to the nearest marker on its left (the edges of the selected range count as
   * markers), or to the start when there is none. While playing, a marker just passed is skipped
   * (pressing again goes further back, as on players).
   */
  previousMarker(): void {
    const position = this.playback.position();
    const before = position - (this.playback.playing() ? PASSED_MARKER : 0.001);
    const range = this.timeline.range();
    const stops = [...this.markers().map((m) => m.time), ...(range ? [range.start, range.end] : [])];
    this.playback.seek(Math.max(0, ...stops.filter((t) => t < before)));
  }

  /** New marker at a timeline time, named in a dialog ("Marker n" proposed). */
  async addMarker(time: number): Promise<void> {
    const at = Math.max(0, time);
    const names = new Set(this.markers().map((m) => m.name));
    let n = this.markers().length + 1;
    while (names.has(this.i18n.t('marker.newName', { n }))) n++;
    const name = await this.askMarkerName({ name: this.i18n.t('marker.newName', { n }), time: formatDuration(at), create: true });
    if (name) this.montages.update((m) => addMarker(m, { id: crypto.randomUUID(), time: at, name }), true);
  }

  async renameMarker(id: string): Promise<void> {
    const marker = this.markers().find((m) => m.id === id);
    if (!marker) return;
    const name = await this.askMarkerName({ name: marker.name, time: formatDuration(marker.time), create: false });
    if (name) this.montages.update((m) => renameMarker(m, id, name), true);
  }

  removeMarker(id: string): void {
    this.montages.update((m) => removeMarker(m, id), true);
  }

  /** Removes every marker, after a confirmation. */
  async clearMarkers(): Promise<void> {
    const n = this.markers().length;
    if (!n || (await this.shell.ask(this.i18n.t('marker.clear'), this.i18n.t('marker.clearConfirm', { n }))) !== 'yes') return;
    this.montages.update((m) => withMarkers(m, []), true);
  }

  private async askMarkerName(data: MarkerDialogData): Promise<string | undefined> {
    const ref = this.dialogs.open<MarkerDialogComponent, MarkerDialogData, string>(MarkerDialogComponent, { data, autoFocus: 'dialog' });
    return firstValueFrom(ref.afterClosed());
  }

  // --- effects of a track ---------------------------------------------------------------------

  /** State before the effect value being dragged, for one undo step per gesture. */
  private effectFrom?: Montage;

  /** Opens the effects panel of a track, or closes it when it already shows them. */
  toggleEffectsPanel(trackId: string): void {
    if (!this.locked()) this.togglePanel(trackId, 'fx');
  }

  /** Opens the side panel of a track on a tab, or closes it when it already shows that tab of that track. */
  togglePanel(trackId: string, tab: TrackPanelTab): void {
    const open = this.timeline.selectedTrackId() === trackId && this.timeline.panelTab() === tab;
    this.timeline.panelTab.set(tab);
    this.timeline.selectedTrackId.set(open ? null : trackId);
  }

  /** Opens the side panel of a track on a tab (left open when it already shows it). */
  showPanel(trackId: string, tab: TrackPanelTab): void {
    if (tab === 'fx' && this.locked()) return;
    this.timeline.panelTab.set(tab);
    this.timeline.selectedTrackId.set(trackId);
  }

  renameTrack(trackId: string, name: string): void {
    const trimmed = name.trim();
    const track = this.montages.montage().tracks.find((t) => t.id === trackId);
    if (!trimmed || !track || track.name === trimmed) return;
    this.montages.updateTrack(trackId, (t) => ({ ...t, name: trimmed }));
  }

  /** Shows the files used by a track or, with a clip, only the file of that clip. */
  showTrackFiles(trackId: string, clipId?: string): void {
    const track = this.montages.montage().tracks.find((t) => t.id === trackId);
    if (!track) return;
    const only = clipId ? track.clips.find((c) => c.id === clipId)?.sourceId : undefined;
    const files = new Map<string, TrackFile>();
    for (const clip of track.clips) {
      if (only && clip.sourceId !== only) continue;
      const existing = files.get(clip.sourceId);
      if (existing) {
        existing.clips++;
        continue;
      }
      const source = this.montages.montage().sources.find((s) => s.id === clip.sourceId);
      const state = this.library.sources()[clip.sourceId];
      const info = state && 'info' in state ? state.info : undefined;
      const tempo = this.tempos.sourceTempo(clip.sourceId);
      files.set(clip.sourceId, { path: source?.path ?? '', ...info, bpm: tempo ? meanBpm(tempo) : undefined, bpmManual: !!source?.tempo, clips: 1 });
    }
    this.dialogs.open<TrackFilesDialogComponent, TrackFilesData>(TrackFilesDialogComponent, {
      data: { track: track.name, clip: !!only, sources: [...files.values()] },
      autoFocus: 'dialog',
    });
  }

  /** Sets the audio input of a track (none: the one of the Settings). */
  setTrackInput(trackId: string, input: TrackInput | undefined): void {
    this.montages.updateTrack(trackId, ({ input: _, ...track }) => (input ? { ...track, input } : track));
  }

  addEffect(trackId: string, type: EffectType): void {
    this.montages.update((m) => addEffect(m, trackId, newEffect(type)));
  }

  removeEffect(trackId: string, effectId: string): void {
    this.montages.update((m) => removeEffect(m, trackId, effectId));
  }

  moveEffect(trackId: string, effectId: string, index: number): void {
    this.montages.update((m) => moveEffect(m, trackId, effectId, index));
  }

  setEffectBypass(trackId: string, effectId: string, bypass: boolean): void {
    this.montages.update((m) => setEffectBypass(m, trackId, effectId, bypass));
  }

  /** Sets the effect to a preset, or to its default values with null. */
  applyEffectPreset(trackId: string, effectId: string, preset: EffectPreset | null): void {
    this.montages.update((m) => applyPreset(m, trackId, effectId, preset));
  }

  /** Changes a value of an effect while a control moves: heard at once, not yet an undo step. */
  previewEffectParam(trackId: string, effectId: string, param: string, value: EffectValue): void {
    this.effectFrom ??= this.montages.montage();
    this.montages.preview(setEffectParams(this.montages.montage(), trackId, effectId, { [param]: value }));
  }

  /** Ends the gesture on a control: one undo step from where it started. */
  commitEffectParam(trackId: string, effectId: string, param: string, value: EffectValue): void {
    const from = this.effectFrom ?? this.montages.montage();
    this.effectFrom = undefined;
    this.montages.preview(setEffectParams(this.montages.montage(), trackId, effectId, { [param]: value }));
    this.montages.commit(from);
  }
}
