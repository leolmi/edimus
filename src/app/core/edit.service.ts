import { Injectable, computed, effect, inject, untracked } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { ClipTiming, ClipTimingData, ClipTimingDialogComponent } from '../features/timeline/clip-timing-dialog.component';
import { TempoDialogComponent, TempoDialogData, TempoDialogResult } from '../features/timeline/tempo-dialog.component';
import { TempoService } from './audio/tempo.service';
import { snapToOnsets } from './audio/tempo';
import { AlignClip, AlignDialogData, AlignTempoDialogComponent } from '../features/timeline/align-tempo-dialog.component';
import { AlignContext, AlignOptions, alignTempo } from './montage/tempo-align';
import { PlaybackService } from './audio/playback.service';
import { applyCrossfade, findCrossfade } from './montage/crossfade';
import { cropToRange, deleteRange, setClipTiming, splitAt } from './montage/edits';
import { Clip, clipRate } from './montage/montage.model';
import { MontageService } from './montage/montage.service';
import { BarMarking, TimelineService } from './timeline/timeline.service';

/** Tempo range of a bar stretched by hand. */
const MIN_MARK_BPM = 20;
const MAX_MARK_BPM = 400;

/** Editing commands on the selection (clip or time range) and at the playhead. */
@Injectable({ providedIn: 'root' })
export class EditService {
  private readonly montages = inject(MontageService);
  private readonly timeline = inject(TimelineService);
  private readonly playback = inject(PlaybackService);
  private readonly dialogs = inject(MatDialog);
  private readonly tempos = inject(TempoService);

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
        clips.push({ id: clip.id, label, bpm: tempo.bpm * clipRate(clip), confidence: tempo.confidence });
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

  /** Deletes the selected range (closing the gap) or else the selected clips. */
  delete(): void {
    const range = this.timeline.range();
    if (range) {
      this.montages.edit((m) => deleteRange(m, range.start, range.end, this.length));
      this.timeline.range.set(null);
      return this.playback.seek(range.start);
    }
    const ids = this.timeline.selectedClipIds();
    if (!ids.length) return;
    this.timeline.selectClip(null);
    this.montages.removeClips(ids);
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
      manual: !!source?.tempo,
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
    const bar = (60 * marking.beatsPerBar) / marking.bpm;
    // earliest downbeat of the grid: the bars are numbered from the start of the source
    const offset = ((marking.downbeat % bar) + bar) % bar;
    this.timeline.beatMarking.set(null);
    this.montages.setSourceTempo(marking.sourceId, {
      bpm: Math.round(marking.bpm * 100) / 100,
      offset,
      confidence: 1,
      beatsPerBar: marking.beatsPerBar,
    });
    this.timeline.beatGrid.set(true);
  }

  clearSelection(): void {
    this.timeline.range.set(null);
    this.timeline.selectClip(null);
  }
}
