import { Injectable, inject } from '@angular/core';
import { AudioLibraryService } from '../audio/audio-library.service';
import { ExportOptions, ExportService } from '../audio/export.service';
import { MixService } from '../audio/mix.service';
import { PlaybackService } from '../audio/playback.service';
import { ProcessedAudioService } from '../audio/processed-audio.service';
import { BarFileService } from '../audio/bar-file.service';
import { TempoService } from '../audio/tempo.service';
import { beatsPerBar } from '../audio/tempo';
import { anchorOf, gridPoints, isVariable, meanBpm, pinBar } from '../audio/tempo-map';
import { applyCrossfade, findCrossfade } from '../montage/crossfade';
import { cropToRange, deleteRange, setClipTiming, splitAt, trimClip } from '../montage/edits';
import { EnvelopePoint, clipGainAt, withFade } from '../montage/envelope';
import {
  MONTAGE_EXTENSION,
  Montage,
  Track,
  audibleTracks,
  clipRate,
  copyName,
  fileName,
  isMontageFile,
  isProcessed,
  toSource,
  toTimeline,
  trackVolume,
  type Clip,
} from '../montage/montage.model';
import { MontageService } from '../montage/montage.service';
import { EditService } from '../edit.service';
import { SourceFilesService } from '../montage/source-files.service';
import { FileSystemPort } from '../platform/file-system.port';
import { AlignOptions, alignTempo } from '../montage/tempo-align';
import { TimelineService } from '../timeline/timeline.service';

type Params = Record<string, unknown>;
type Handler = (params: Params) => Promise<unknown>;

/** Gains at or below this level (dB) are silence. */
const SILENCE_DB = -100;
const READY_TIMEOUT = 90_000;

const round = (value: number, decimals = 3) => Math.round(value * 10 ** decimals) / 10 ** decimals;
const toDb = (gain: number) => (gain <= 1e-5 ? SILENCE_DB : round(20 * Math.log10(gain), 2));
const fromDb = (db: number) => (db <= SILENCE_DB ? 0 : Math.min(2, Math.pow(10, db / 20)));
const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Bends of the fade shapes (see envelope curve). */
const FADE_CURVES = { linear: 0, exponential: 4, logarithmic: -4, smooth: 2 } as const;

/**
 * Commands executed for the AI (through the MCP bridge): each one reads or edits the montage of
 * this window with the same services as the interface, so edits are undoable and visible.
 */
@Injectable({ providedIn: 'root' })
export class AiCommandsService {
  private readonly montages = inject(MontageService);
  private readonly files = inject(FileSystemPort);
  private readonly sourceFiles = inject(SourceFilesService);
  private readonly edits = inject(EditService);
  private readonly timeline = inject(TimelineService);
  private readonly library = inject(AudioLibraryService);
  private readonly processed = inject(ProcessedAudioService);
  private readonly tempos = inject(TempoService);
  private readonly barFiles = inject(BarFileService);
  private readonly playback = inject(PlaybackService);
  private readonly mixer = inject(MixService);
  private readonly exporter = inject(ExportService);

  private readonly length = (clip: Clip) => this.timeline.clipLength(clip);
  private stopTimer?: ReturnType<typeof setTimeout>;

  private readonly handlers: Record<string, Handler> = {
    get_state: async () => this.state(),

    // --- project
    new_montage: async (p) => {
      this.ensureDiscardable(p);
      this.montages.reset();
      return this.state();
    },
    open: async (p) => {
      let paths = this.strings(p, 'paths');
      const montagePath = paths.find(isMontageFile);
      // files of missing sources relink them, as in the window
      const relinked = montagePath ? [] : await this.sourceFiles.relink(paths);
      paths = paths.filter((path) => !relinked.includes(path));
      if (montagePath) {
        this.ensureDiscardable(p);
        await this.montages.openMontage(montagePath);
      } else if (!paths.length) {
        // only relinked files
      } else if (p['trackId'] !== undefined) {
        const track = this.track(String(p['trackId']));
        const lengths = await Promise.all(paths.map(() => 0));
        this.montages.addAudioToTrack(track.id, paths, Number(p['start'] ?? 0), lengths);
      } else if (!this.montages.addAudio(paths)) {
        throw new Error('None of the paths is an audio file or a .edimus montage');
      }
      await this.waitReady();
      await this.waitTempo();
      if (p['trackId'] !== undefined && !montagePath && paths.length) this.placeInSequence(String(p['trackId']), Number(p['start'] ?? 0), paths.length);
      return this.state();
    },
    save: async (p) => {
      let path = (p['path'] as string | undefined) ?? this.montages.path();
      if (!path) throw new Error('The montage was never saved: give a path');
      if (!isMontageFile(path)) path = `${path}.${MONTAGE_EXTENSION}`;
      if (path !== this.montages.path() && !p['overwrite'] && (await this.files.exists(path))) {
        throw new Error(`${path} exists: pass overwrite true to replace it`);
      }
      return { saved: await this.montages.saveAs(path) };
    },
    export: async (p) => {
      const format = String(p['format']) as ExportOptions['format'];
      let path = String(p['path']);
      const extension = format === 'ogg' ? 'ogg' : format;
      if (!path.toLowerCase().endsWith(`.${extension}`)) path = `${path}.${extension}`;
      if (!p['overwrite'] && (await this.files.exists(path))) throw new Error(`${path} exists: pass overwrite true to replace it`);
      await this.waitReady();
      const options: ExportOptions = {
        format,
        channels: (p['channels'] as 1 | 2) ?? this.montages.montage().channels,
        sampleRate: format === 'opus' ? 48000 : ((p['sampleRate'] as number) ?? this.mixer.sampleRate()),
        bitDepth: (p['bitDepth'] as 16 | 24 | 32) ?? 16,
        bitrate: (p['bitrate'] as number) ?? 192,
        quality: (p['quality'] as number) ?? 6,
        normalize: !!p['normalize'],
        trailingSilence: (p['trailingSilence'] as number | undefined) || undefined,
      };
      await this.exporter.export(path, options);
      return { exported: path, duration: round(this.timeline.duration() + (options.trailingSilence ?? 0)), options };
    },

    // --- transport and history
    play: async (p) => {
      clearTimeout(this.stopTimer);
      const from = p['from'] !== undefined ? Number(p['from']) : this.playback.position();
      this.playback.play(from);
      if (p['to'] !== undefined) {
        const to = Number(p['to']);
        if (to <= from) throw new Error('to must be after from');
        this.stopTimer = setTimeout(() => this.playback.pause(), (to - from) * 1000);
      }
      return { playing: true, from: round(from) };
    },
    stop: async () => {
      clearTimeout(this.stopTimer);
      this.playback.pause();
      return { playing: false, playhead: round(this.playback.position()) };
    },
    seek: async (p) => {
      this.playback.seek(Number(p['time']));
      return { playhead: round(this.playback.position()) };
    },
    select: async (p) => {
      const ids = (p['clipIds'] as string[] | undefined) ?? [];
      ids.forEach((id) => this.clip(id));
      this.timeline.selectedClipIds.set([...new Set(ids)]);
      if (p['from'] === undefined && p['to'] === undefined) this.timeline.range.set(null);
      else {
        const [start, end] = this.range(p);
        this.timeline.range.set({ start, end });
      }
      return this.selection();
    },
    undo: async () => {
      if (!this.montages.canUndo()) throw new Error('Nothing to undo');
      this.montages.undo();
      return this.state();
    },
    redo: async () => {
      if (!this.montages.canRedo()) throw new Error('Nothing to redo');
      this.montages.redo();
      return this.state();
    },

    // --- clips and tracks
    move_clip: async (p) => {
      const { clip, track } = this.clip(String(p['clipId']));
      const start = p['start'] !== undefined ? Number(p['start']) : clip.start;
      const target = p['newTrack'] ? null : p['trackId'] !== undefined ? this.track(String(p['trackId'])) : track;
      this.montages.update((m) => {
        const moved = { ...clip, start };
        const tracks = m.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => c.id !== clip.id) }));
        if (target) {
          return { ...m, tracks: tracks.map((t) => (t.id === target.id ? { ...t, clips: [...t.clips, moved] } : t)) };
        }
        const name = copyName(track.name, m.tracks.map((t) => t.name));
        return { ...m, tracks: [...tracks, { id: crypto.randomUUID(), name, clips: [moved] }] };
      });
      return this.clipState(clip.id);
    },
    trim_clip: async (p) => {
      const { clip } = this.clip(String(p['clipId']));
      const sourceLength = this.timeline.sourceLength(clip);
      if (p['start'] !== undefined) {
        this.montages.update((m) => trimClip(m, clip.id, 'start', Number(p['start']), this.length, sourceLength));
      }
      if (p['end'] !== undefined) {
        this.montages.update((m) => trimClip(m, clip.id, 'end', Number(p['end']), this.length, sourceLength));
      }
      return this.clipState(clip.id);
    },
    split: async (p) => {
      const time = Number(p['time']);
      const ids = p['clipIds'] ? new Set(this.strings(p, 'clipIds')) : undefined;
      const before = new Set(this.allClips().map((c) => c.id));
      this.montages.edit((m) => splitAt(m, time, this.length, ids));
      const created = this.allClips().filter((c) => !before.has(c.id));
      if (!created.length) throw new Error(`No clip crosses ${time} s`);
      return { created: created.map((c) => this.clipState(c.id)) };
    },
    delete_clip: async (p) => {
      const { clip } = this.clip(String(p['clipId']));
      this.montages.removeClip(clip.id);
      return { deleted: clip.id, duration: round(this.timeline.duration()) };
    },
    delete_range: async (p) => {
      const [from, to] = this.range(p);
      this.montages.edit((m) => deleteRange(m, from, to, this.length));
      return this.state();
    },
    crop: async (p) => {
      const [from, to] = this.range(p);
      this.montages.edit((m) => cropToRange(m, from, to, this.length));
      return this.state();
    },
    set_track: async (p) => {
      const track = this.track(String(p['trackId']));
      this.montages.updateTrack(track.id, (t) => ({
        ...t,
        name: p['name'] !== undefined ? String(p['name']) : t.name,
        muted: p['muted'] !== undefined ? !!p['muted'] : t.muted,
        solo: p['solo'] !== undefined ? !!p['solo'] : t.solo,
        volume: p['volumeDb'] !== undefined ? (Number(p['volumeDb']) === 0 ? undefined : fromDb(Number(p['volumeDb']))) : t.volume,
      }));
      return this.trackState(this.track(track.id));
    },
    delete_track: async (p) => {
      const track = this.track(String(p['trackId']));
      this.montages.removeTrack(track.id);
      return { deleted: track.id };
    },

    // --- volume
    set_envelope: async (p) => {
      const { clip } = this.clip(String(p['clipId']));
      // timeline seconds from the AI, source seconds in the clip
      const points = ((p['points'] as { time: number; gainDb: number; curve?: number }[]) ?? [])
        .map((point) => ({ time: toSource(clip, point.time), gain: fromDb(point.gainDb), curve: point.curve || undefined }))
        .sort((a, b) => a.time - b.time);
      this.setClipEnvelope(clip.id, points);
      return this.clipState(clip.id);
    },
    fade: async (p) => {
      const { clip } = this.clip(String(p['clipId']));
      const inward = p['type'] === 'in';
      const end = clip.start + this.length(clip);
      let from: number;
      let to: number;
      if (p['length'] !== undefined) {
        // at the start (in) or at the end (out) of the clip
        const length = Math.min(end - clip.start, Number(p['length']));
        [from, to] = inward ? [clip.start, clip.start + length] : [end - length, end];
      } else {
        [from, to] = this.range(p);
      }
      const shape = (p['shape'] as keyof typeof FADE_CURVES) ?? 'linear';
      this.setClipEnvelope(clip.id, withFade(clip.envelope, toSource(clip, from), toSource(clip, to), inward, FADE_CURVES[shape]));
      return this.clipState(clip.id);
    },
    crossfade: async (p) => {
      const ids = p['clipIds'] as string[] | undefined;
      if (ids) ids.forEach((id) => this.clip(id));
      const [from, to] = ids && p['from'] === undefined && p['to'] === undefined ? [0, Infinity] : this.range(p);
      const crossfade = findCrossfade(this.montages.montage(), from, to, this.length, ids && new Set(ids));
      if (!crossfade) throw new Error('No clip ends in [from, to] over another clip starting there (among clipIds when given)');
      this.montages.update((m) => applyCrossfade(m, crossfade));
      return {
        from: round(crossfade.from),
        to: round(crossfade.to),
        fadeOut: this.clipState(crossfade.outClip.id),
        fadeIn: this.clipState(crossfade.inClip.id),
      };
    },

    // --- speed, pitch, tempo
    set_clip_timing: async (p) => {
      const { clip } = this.clip(String(p['clipId']));
      let rate = clipRate(clip);
      if (p['rate'] !== undefined) rate = Number(p['rate']);
      else if (p['length'] !== undefined) rate = (this.length(clip) * clipRate(clip)) / Number(p['length']);
      else if (p['bpm'] !== undefined) {
        await this.waitTempo([clip.sourceId]);
        const tempo = this.tempos.sourceTempo(clip.sourceId);
        if (!tempo) throw new Error('The tempo of this clip is unknown: set it with set_tempo first');
        rate = Number(p['bpm']) / meanBpm(tempo);
      }
      rate = Math.min(4, Math.max(0.25, Math.round(rate * 10000) / 10000));
      const pitch = p['pitch'] !== undefined ? Number(p['pitch']) : (clip.pitch ?? 0);
      const varispeed = p['mode'] !== undefined ? p['mode'] === 'varispeed' : !!clip.varispeed;
      const sourceLength = this.timeline.sourceLength(clip);
      this.montages.update((m) => setClipTiming(m, clip.id, rate, pitch, sourceLength, varispeed));
      await this.waitReady();
      return this.clipState(clip.id);
    },
    set_tempo: async (p) => {
      const { clip } = this.clip(String(p['clipId']));
      await this.waitTempo([clip.sourceId]);
      if (p['reset']) {
        this.montages.setSourceTempo(clip.sourceId, null);
      } else {
        const current = this.tempos.sourceTempo(clip.sourceId);
        const bpm = p['bpm'] !== undefined ? Number(p['bpm']) : current?.bpm;
        if (!bpm) throw new Error('No tempo known for this source: give bpm');
        const offset = p['firstBeat'] !== undefined ? Number(p['firstBeat']) : (current?.offset ?? 0);
        this.montages.setSourceTempo(clip.sourceId, { bpm, offset, confidence: 1 });
      }
      this.timeline.beatGrid.set(true);
      return this.sourceState(clip.sourceId);
    },
    align_tempo: async (p) => {
      const options: AlignOptions = {
        referenceId: this.clip(String(p['referenceClipId'])).clip.id,
        targetIds: this.strings(p, 'targetClipIds').map((id) => this.clip(id).clip.id),
        target: (p['target'] as AlignOptions['target']) ?? 'reference',
        customBpm: p['bpm'] !== undefined ? Number(p['bpm']) : undefined,
        varispeed: p['mode'] === 'varispeed',
        alignBars: p['alignBars'] !== false,
      };
      await this.waitTempo();
      for (const id of [options.referenceId, ...options.targetIds]) {
        const { clip } = this.clip(id);
        if (!this.tempos.sourceTempo(clip.sourceId)) throw new Error(`Tempo of clip ${id} unknown: set it with set_tempo`);
      }
      this.montages.update((m) =>
        alignTempo(m, options, {
          tempoOf: (sourceId) => this.tempos.sourceTempo(sourceId),
          length: this.length,
          sourceLength: (clip) => this.timeline.sourceLength(clip),
        }),
      );
      this.timeline.beatGrid.set(true);
      await this.waitReady();
      return { clips: [options.referenceId, ...options.targetIds].map((id) => this.clipState(id)) };
    },

    // --- analysis
    analyze_levels: async (p) => {
      const { samples, start, sampleRate } = await this.signal(p);
      const windows = Math.min(500, Math.max(1, Number(p['windows'] ?? 40)));
      const size = Math.max(1, Math.floor(samples[0].length / windows));
      const result = [];
      for (let w = 0; w < windows && w * size < samples[0].length; w++) {
        let peak = 0;
        let sum = 0;
        let count = 0;
        for (const channel of samples) {
          for (let i = w * size; i < Math.min(channel.length, (w + 1) * size); i++) {
            const v = Math.abs(channel[i]);
            if (v > peak) peak = v;
            sum += v * v;
            count++;
          }
        }
        result.push({
          from: round(start + (w * size) / sampleRate),
          to: round(start + ((w + 1) * size) / sampleRate),
          peakDb: toDb(peak),
          rmsDb: toDb(Math.sqrt(sum / Math.max(1, count))),
        });
      }
      return { windows: result };
    },
    find_silence: async (p) => {
      const { samples, start, sampleRate } = await this.signal(p);
      const threshold = fromDb(Number(p['thresholdDb'] ?? -45));
      const minDuration = Number(p['minDuration'] ?? 0.5);
      // 10 ms blocks: silent when their peak stays under the threshold
      const block = Math.max(1, Math.round(sampleRate / 100));
      const silences: { from: number; to: number; duration: number }[] = [];
      let silentFrom: number | null = null;
      const total = samples[0].length;
      for (let b = 0; b * block < total; b++) {
        let peak = 0;
        for (const channel of samples) {
          for (let i = b * block; i < Math.min(total, (b + 1) * block); i++) peak = Math.max(peak, Math.abs(channel[i]));
        }
        const at = b * block;
        if (peak < threshold) silentFrom ??= at;
        else if (silentFrom !== null) {
          this.pushSilence(silences, silentFrom, at, start, sampleRate, minDuration);
          silentFrom = null;
        }
      }
      if (silentFrom !== null) this.pushSilence(silences, silentFrom, total, start, sampleRate, minDuration);
      return { thresholdDb: Number(p['thresholdDb'] ?? -45), silences };
    },
    get_beats: async (p) => {
      const { clip } = this.clip(String(p['clipId']));
      await this.waitTempo([clip.sourceId]);
      const tempo = this.tempos.sourceTempo(clip.sourceId);
      if (!tempo) throw new Error('The tempo of this clip is unknown (not detected yet, or not rhythmic): use set_tempo');
      const rate = clipRate(clip);
      const end = clip.start + this.length(clip);
      const from = Math.max(clip.start, Number(p['from'] ?? clip.start));
      const to = Math.min(end, Number(p['to'] ?? end));
      const beats: { time: number; bar?: number; anchor?: 'manual' | 'auto' }[] = [];
      for (const point of gridPoints(tempo, beatsPerBar(tempo), toSource(clip, from), toSource(clip, to))) {
        const time = toTimeline(clip, point.time);
        if (time >= to || beats.length >= 400) break;
        if (point.index) {
          beats.push({ time: round(time) });
          continue;
        }
        // downbeats carry the bar number shown on the grid (from 1) and whether they are pinned
        const anchor = anchorOf(tempo, point.bar);
        beats.push({ time: round(time), bar: point.bar + 1, ...(anchor ? { anchor: anchor.auto ? 'auto' : 'manual' } : {}) });
      }
      return { bpm: round(meanBpm(tempo) * rate, 2), variable: isVariable(tempo), beats };
    },
    set_bar_map: async (p) => {
      const { clip } = this.clip(String(p['clipId']));
      await this.waitTempo([clip.sourceId]);
      const tempo = this.tempos.sourceTempo(clip.sourceId);
      if (!tempo) throw new Error('The tempo of this clip is unknown: set it with set_tempo first');
      const bar = p['bar'] !== undefined ? Math.round(Number(p['bar'])) - 1 : undefined;
      switch (p['action']) {
        case 'track':
          return { ...this.sourceState(clip.sourceId), beatsOnAttacks: round((await this.edits.trackBars(clip.sourceId)) ?? 0, 2) };
        case 'pin': {
          if (bar === undefined || p['time'] === undefined) throw new Error('pin needs bar and time');
          const minBar = (60 / 400) * beatsPerBar(tempo);
          this.montages.setSourceTempo(clip.sourceId, pinBar(tempo, bar, toSource(clip, Number(p['time'])), minBar));
          break;
        }
        case 'unpin':
          if (bar === undefined) throw new Error('unpin needs bar');
          this.edits.unpinBar(clip.sourceId, bar);
          break;
        case 'steady':
          this.edits.steadyTempo(clip.sourceId);
          break;
        case 'reset':
          this.edits.clearAnchors(clip.sourceId);
          break;
        case 'clearAuto':
          this.edits.clearAnchors(clip.sourceId, true);
          break;
        case 'save': {
          const path = await this.barFiles.save(clip.sourceId);
          if (!path) throw new Error('The bar file was not saved');
          return { ...this.sourceState(clip.sourceId), barFile: path };
        }
        case 'load': {
          const path = await this.barFiles.load(clip.sourceId);
          if (!path) throw new Error('No bar file was loaded');
          return { ...this.sourceState(clip.sourceId), barFile: path };
        }
        default:
          throw new Error('action must be track, pin, unpin, reset, clearAuto, steady, save or load');
      }
      this.timeline.beatGrid.set(true);
      return this.sourceState(clip.sourceId);
    },
    snapshot: async () => this.snapshot(),
  };

  /** Executes a command; throws with a message meant for the AI. */
  async execute(method: string, params: Params): Promise<unknown> {
    const handler = this.handlers[method];
    if (!handler) throw new Error(`Unknown command ${method}`);
    // a run of arrow moves in progress becomes its own undo step first
    this.edits.endNudge();
    return handler(params ?? {});
  }

  // -------------------------------------------------------------------------------------------
  // state

  private state() {
    const montage = this.montages.montage();
    const audible = new Set(audibleTracks(montage).map((t) => t.id));
    const heard = this.mixer.audibleRange();
    return {
      file: this.montages.path(),
      dirty: this.montages.dirty(),
      channels: montage.channels,
      duration: round(this.timeline.duration()),
      // the mix without its leading and trailing silences (null while some audio is not ready)
      audible: heard && { start: round(heard.start), end: round(heard.end), duration: round(heard.end - heard.start) },
      playhead: round(this.playback.position()),
      playing: this.playback.playing(),
      selection: this.selection(),
      canUndo: this.montages.canUndo(),
      canRedo: this.montages.canRedo(),
      sources: montage.sources.map((s) => this.sourceState(s.id)),
      tracks: montage.tracks.map((t) => ({ ...this.trackState(t), audible: audible.has(t.id) })),
    };
  }

  private sourceState(id: string) {
    const source = this.montages.montage().sources.find((s) => s.id === id)!;
    const state = this.library.sources()[id];
    const tempo = this.tempos.sourceTempo(id);
    const info = state && 'info' in state ? state.info : undefined;
    return {
      id,
      path: source.path,
      name: fileName(source.path),
      status: state?.status ?? 'unknown',
      ...(state?.status === 'error' ? { error: state.error } : {}),
      ...(info
        ? { codec: info.codec, sampleRate: info.sampleRate, channels: info.channels, length: round(info.duration) }
        : {}),
      tempo: tempo
        ? {
            bpm: round(meanBpm(tempo), 2),
            firstBeat: round(tempo.offset),
            confidence: tempo.confidence,
            manual: !!source.tempo,
            ...(tempo.anchors?.length
              ? { pinnedBars: tempo.anchors.length, pinnedByHand: tempo.anchors.filter((a) => !a.auto).length, variable: isVariable(tempo) }
              : {}),
          }
        : this.tempos.isDetecting(id)
          ? 'detecting'
          : null,
    };
  }

  private trackState(track: Track) {
    return {
      id: track.id,
      name: track.name,
      muted: !!track.muted,
      solo: !!track.solo,
      volumeDb: toDb(trackVolume(track)),
      clips: track.clips.map((c) => this.clipState(c.id)),
    };
  }

  /** Replaces the envelope of a clip (none when empty), as one undo step. */
  private setClipEnvelope(clipId: string, points: EnvelopePoint[]): void {
    this.montages.update((m) => ({
      ...m,
      tracks: m.tracks.map((t) =>
        t.clips.some((c) => c.id === clipId)
          ? { ...t, clips: t.clips.map((c) => (c.id === clipId ? { ...c, envelope: points.length ? points : undefined } : c)) }
          : t,
      ),
    }));
  }

  private clipState(id: string) {
    const { clip, track } = this.clip(id);
    const length = this.length(clip);
    const tempo = this.tempos.sourceTempo(clip.sourceId);
    const render = isProcessed(clip) ? this.processed.state(clip) : undefined;
    const source = this.library.sources()[clip.sourceId];
    return {
      id: clip.id,
      trackId: track.id,
      sourceId: clip.sourceId,
      start: round(clip.start),
      end: round(clip.start + length),
      length: round(length),
      offset: round(clip.offset),
      rate: clipRate(clip),
      pitch: clip.pitch ?? 0,
      mode: clip.varispeed ? 'varispeed' : 'stretch',
      bpm: tempo ? round(meanBpm(tempo) * clipRate(clip), 2) : null,
      status: render ? render.status : (source?.status ?? 'unknown'),
      // timeline seconds; points outside [start, end] are hidden by a trim but still shape the gain
      envelope: (clip.envelope ?? []).map((p) => ({ time: round(toTimeline(clip, p.time)), gainDb: toDb(p.gain), ...(p.curve ? { curve: p.curve } : {}) })),
    };
  }

  // -------------------------------------------------------------------------------------------
  // helpers

  private allClips(): Clip[] {
    return this.montages.montage().tracks.flatMap((t) => t.clips);
  }

  private clip(id: string): { clip: Clip; track: Track } {
    for (const track of this.montages.montage().tracks) {
      const clip = track.clips.find((c) => c.id === id);
      if (clip) return { clip, track };
    }
    const ids = this.allClips().map((c) => c.id);
    throw new Error(`Clip ${id} not found. Clips: ${ids.join(', ') || 'none'} (see get_state)`);
  }

  private track(id: string): Track {
    const track = this.montages.montage().tracks.find((t) => t.id === id);
    if (track) return track;
    const ids = this.montages.montage().tracks.map((t) => `${t.id} (${t.name})`);
    throw new Error(`Track ${id} not found. Tracks: ${ids.join(', ') || 'none'} (see get_state)`);
  }

  private strings(p: Params, key: string): string[] {
    const value = p[key];
    if (!Array.isArray(value) || !value.length) throw new Error(`${key} must be a non-empty list`);
    return value.map(String);
  }

  private selection(): { clipIds: readonly string[]; range: { start: number; end: number } | null } {
    return { clipIds: this.timeline.selectedClipIds(), range: this.timeline.range() };
  }

  private range(p: Params): [number, number] {
    const from = Number(p['from']);
    const to = Number(p['to']);
    if (!(to > from)) throw new Error('to must be greater than from');
    return [from, to];
  }

  private ensureDiscardable(p: Params): void {
    if (this.montages.dirty() && !p['discard']) {
      throw new Error('The montage has unsaved changes: save it first, or pass discard true (ask the user)');
    }
  }

  /** Waits until every clip has its audio (decoded and, when processed, rendered). */
  private async waitReady(): Promise<void> {
    const until = Date.now() + READY_TIMEOUT;
    while (!this.mixer.isComplete()) {
      const failed = Object.values(this.library.sources()).find((s) => s.status === 'error');
      if (failed && failed.status === 'error') throw new Error(`A source could not be decoded: ${failed.error}`);
      if (Date.now() > until) throw new Error('Audio still being decoded or processed: retry in a moment');
      await sleep(200);
    }
  }

  /** Waits until the tempo detection of the given sources (default: all) is over. */
  private async waitTempo(sourceIds?: string[]): Promise<void> {
    const until = Date.now() + READY_TIMEOUT;
    const ids = () => sourceIds ?? this.montages.montage().sources.map((s) => s.id);
    while (ids().some((id) => this.tempos.isDetecting(id) || !(id in this.tempos.detected()))) {
      if (Date.now() > until) return;
      await sleep(200);
    }
  }

  /** After adding files to a track, places them one after the other from `start`. */
  private placeInSequence(trackId: string, start: number, count: number): void {
    const track = this.track(trackId);
    const added = track.clips.slice(-count);
    let at = start;
    const positions = new Map(added.map((c) => {
      const position = at;
      at += this.length(c);
      return [c.id, position];
    }));
    this.montages.updateTrack(trackId, (t) => ({ ...t, clips: t.clips.map((c) => (positions.has(c.id) ? { ...c, start: positions.get(c.id)! } : c)) }));
  }

  /**
   * Samples to analyse: a clip as heard (its audio with the track envelope applied) or the mix of
   * the audible tracks over [from, to) rendered offline.
   */
  private async signal(p: Params): Promise<{ samples: Float32Array[]; start: number; sampleRate: number }> {
    await this.waitReady();
    if (p['clipId'] !== undefined) {
      const { clip, track } = this.clip(String(p['clipId']));
      const buffer = isProcessed(clip) ? this.processed.ready(clip)?.buffer : this.library.ready(clip.sourceId)?.buffer;
      if (!buffer) throw new Error('Audio of the clip not ready');
      const rate = clipRate(clip);
      const offset = isProcessed(clip) ? clip.offset / rate : clip.offset;
      const end = clip.start + this.length(clip);
      const from = Math.max(clip.start, Number(p['from'] ?? clip.start));
      const to = Math.min(end, Number(p['to'] ?? end));
      if (!(to > from)) throw new Error('Empty range for this clip');
      const first = Math.floor((offset + from - clip.start) * buffer.sampleRate);
      const count = Math.floor((to - from) * buffer.sampleRate);
      const samples = Array.from({ length: buffer.numberOfChannels }, (_, c) => {
        const data = buffer.getChannelData(c).slice(first, first + count);
        // the clip envelope and the track volume, sampled every 10 ms
        const step = Math.round(buffer.sampleRate / 100);
        for (let i = 0; i < data.length; i += step) {
          const gain = trackVolume(track) * clipGainAt(clip, from + i / buffer.sampleRate);
          for (let j = i; j < Math.min(data.length, i + step); j++) data[j] *= gain;
        }
        return data;
      });
      return { samples, start: from, sampleRate: buffer.sampleRate };
    }
    const from = Number(p['from'] ?? 0);
    const to = Math.min(this.timeline.duration(), Number(p['to'] ?? this.timeline.duration()));
    if (!(to > from)) throw new Error('Empty range: give from/to inside the montage, or a clipId');
    if (to - from > 1200) throw new Error('Range too long for an analysis of the mix (max 20 minutes)');
    const sampleRate = this.mixer.sampleRate();
    const ctx = new OfflineAudioContext({ numberOfChannels: 2, length: Math.ceil((to - from) * sampleRate), sampleRate });
    this.mixer.schedule(ctx, ctx.destination, from, 0);
    const rendered = await ctx.startRendering();
    return { samples: [rendered.getChannelData(0), rendered.getChannelData(1)], start: from, sampleRate };
  }

  private pushSilence(list: { from: number; to: number; duration: number }[], a: number, b: number, start: number, rate: number, min: number): void {
    const from = start + a / rate;
    const to = start + b / rate;
    if (to - from >= min) list.push({ from: round(from), to: round(to), duration: round(to - from) });
  }

  /** PNG of the timeline as shown: ruler, track names and lanes. */
  private async snapshot(): Promise<{ image: string; text: string }> {
    const ruler = document.querySelector<HTMLCanvasElement>('app-ruler canvas');
    const rows = [...document.querySelectorAll<HTMLElement>('.track')];
    if (!ruler) throw new Error('Timeline not visible');
    const header = 240;
    const ratio = window.devicePixelRatio || 1;
    const width = header + ruler.width / ratio;
    const rulerHeight = ruler.height / ratio;
    const heights = rows.map((r) => r.offsetHeight);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width);
    canvas.height = Math.round(rulerHeight + heights.reduce((a, b) => a + b, 0));
    const ctx = canvas.getContext('2d')!;
    const style = getComputedStyle(document.body);
    ctx.fillStyle = style.backgroundColor || '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.fillStyle = style.color || '#000';
    ctx.font = `12px ${style.fontFamily}`;
    ctx.drawImage(ruler, header, 0, ruler.width / ratio, rulerHeight);
    let y = rulerHeight;
    rows.forEach((row, i) => {
      const lane = row.querySelector<HTMLCanvasElement>('app-track-lane canvas');
      const name = row.querySelector('.name span')?.textContent ?? '';
      ctx.fillStyle = style.color || '#000';
      ctx.fillText(name, 8, y + 18);
      if (lane) ctx.drawImage(lane, header, y, lane.width / ratio, lane.height / ratio);
      ctx.strokeStyle = 'rgba(128,128,128,0.5)';
      ctx.beginPath();
      ctx.moveTo(0, y + heights[i] - 0.5);
      ctx.lineTo(width, y + heights[i] - 0.5);
      ctx.stroke();
      y += heights[i];
    });
    const playhead = this.timeline.timeToX(this.playback.position());
    if (playhead >= 0 && playhead <= width - header) {
      ctx.fillStyle = 'red';
      ctx.fillRect(header + playhead, 0, 1, canvas.height);
    }
    const visible = `${round(this.timeline.scroll())}–${round(this.timeline.xToTime(this.timeline.viewWidth()))} s`;
    return { image: canvas.toDataURL('image/png').split(',')[1], text: `Visible time: ${visible}; playhead ${round(this.playback.position())} s` };
  }
}

export type { Montage };
