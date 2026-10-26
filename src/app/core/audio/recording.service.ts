import { Injectable, computed, effect, inject, signal, untracked } from '@angular/core';
import { DocumentService } from '../document.service';
import { I18nService } from '../i18n/i18n.service';
import { dirName } from '../montage/montage.model';
import { MontageService } from '../montage/montage.service';
import { AudioEnginePort } from '../platform/audio-engine.port';
import { FileSystemPort } from '../platform/file-system.port';
import { PlatformInfo } from '../platform/platform-info';
import { SettingsService } from '../settings.service';
import { TimelineService } from '../timeline/timeline.service';
import { CapturedAudio, InputCapture, openInput } from './input-capture';
import { CLICK_COUNT, CLICK_INTERVAL, clickBuffer, measureLatency } from './latency';
import { MixService } from './mix.service';
import { PlaybackService } from './playback.service';

export type RecordingState = 'idle' | 'preparing' | 'recording' | 'saving' | 'calibrating';

/** Time (s) between the start of the capture and the start of the backing: the input is running by then. */
const LEAD = 0.2;
/** Shortest take kept (s). */
const MIN_TAKE = 0.05;

/** A running recording. */
interface Take {
  ctx: AudioContext;
  stream: MediaStream;
  capture: InputCapture;
  backing?: AudioBufferSourceNode;
  trackId: string;
  /** Timeline time of the start (the playhead when recording started). */
  from: number;
  /** Context time at which the backing starts, that is, timeline time `from`. */
  when: number;
  /** Round trip (s) removed from the take. */
  latency: number;
}

const errorMessage = (err: unknown) => String((err as { message?: string })?.message ?? err);

/**
 * Records the audio input on a track armed for recording, from the playhead, while the montage plays. The
 * montage is heard as a single buffer rendered beforehand (the backing, same mix as the export): steady playback
 * and a constant delay, so that the take can be lined up with it by removing the round-trip latency (measured by
 * `calibrate`). At the stop the user chooses where to save the take, which becomes a clip of the track.
 */
@Injectable({ providedIn: 'root' })
export class RecordingService {
  private readonly montages = inject(MontageService);
  private readonly mixer = inject(MixService);
  private readonly playback = inject(PlaybackService);
  private readonly timeline = inject(TimelineService);
  private readonly settings = inject(SettingsService);
  private readonly documents = inject(DocumentService);
  private readonly files = inject(FileSystemPort);
  private readonly engine = inject(AudioEnginePort);
  private readonly i18n = inject(I18nService);
  /** Recording is a feature of the desktop app only. */
  readonly available = inject(PlatformInfo).canRecord;

  readonly state = signal<RecordingState>('idle');
  /** Track in recording mode (its header shows the recording commands), null when none. */
  readonly armedTrackId = signal<string | null>(null);
  /** Recording (or preparing, saving, measuring): the playback commands are off; in recording mode they work. */
  readonly busy = computed(() => this.state() !== 'idle');
  private take?: Take;
  private frame = 0;

  constructor() {
    // the armed track was removed (or another montage opened)
    effect(() => {
      const tracks = this.montages.montage().tracks;
      untracked(() => {
        const armed = this.armedTrackId();
        if (armed && !tracks.some((t) => t.id === armed) && this.state() === 'idle') this.armedTrackId.set(null);
      });
    });
  }

  /** Puts a track in recording mode (one at a time), stopping the playback. */
  arm(trackId: string): void {
    if (this.state() !== 'idle' || !this.available) return;
    this.playback.pause();
    this.armedTrackId.set(trackId);
  }

  /** Leaves the recording mode. */
  disarm(): void {
    if (this.state() === 'idle') this.armedTrackId.set(null);
  }

  /** Starts or stops recording on the armed track. */
  toggle(): Promise<void> {
    if (this.state() === 'recording') return this.stop();
    return this.start();
  }

  /** Starts recording on the armed track from the playhead. */
  async start(): Promise<void> {
    const trackId = this.armedTrackId();
    if (this.state() !== 'idle' || !trackId) return;
    this.playback.pause();
    if (!this.mixer.isComplete()) return this.documents.notify({ key: 'export.notReady' });
    this.state.set('preparing');
    this.documents.notify({ key: 'record.preparing' });
    let ctx: AudioContext | undefined;
    let stream: MediaStream | undefined;
    try {
      stream = await this.openInput();
      ctx = await this.openContext();
      const from = this.playback.position();
      // the stops go back to where the take started (a second stop to the start of the montage)
      this.playback.setCue(from);
      const backing = await this.backing(ctx, from);
      const capture = await InputCapture.start(ctx, stream);
      await ctx.resume();
      const when = ctx.currentTime + LEAD;
      backing?.start(when);
      const latency = this.settings.currentLatency() ?? estimatedLatency(ctx, stream);
      this.take = { ctx, stream, capture, backing, trackId, from, when, latency };
      this.timeline.recordingClip.set({ trackId, start: from, end: from });
      this.state.set('recording');
      this.documents.notify({ key: 'record.recording' });
      this.frame = requestAnimationFrame(() => this.tick());
    } catch (err) {
      stream?.getTracks().forEach((track) => track.stop());
      void ctx?.close();
      this.state.set('idle');
      this.documents.notify({ key: 'record.error', params: { message: errorMessage(err) } });
    }
  }

  /** Stops the recording, asks where to save the take and adds it to the track as a clip. */
  async stop(): Promise<void> {
    const take = this.take;
    if (this.state() !== 'recording' || !take) return;
    this.take = undefined;
    cancelAnimationFrame(this.frame);
    this.state.set('saving');
    try {
      take.backing?.stop();
      const captured = await take.capture.stop();
      release(take);
      const channels = alignedTake(captured, take, take.ctx.sampleRate);
      this.playback.position.set(take.from);
      if (channels[0].length < MIN_TAKE * take.ctx.sampleRate) return this.documents.notify({ key: 'record.empty' });
      // asked at once: in the browser the file picker needs the click on stop
      const path = await this.files.recordingPath(this.i18n.t('record.saveTitle'), this.defaultPath(take.trackId));
      if (!path) return this.documents.notify({ key: 'record.discarded' });
      this.documents.notify({ key: 'record.saving' });
      await this.engine.encode(path, interleave(channels), {
        format: 'wav',
        channels: channels.length === 1 ? 1 : 2,
        sampleRate: take.ctx.sampleRate,
        bitDepth: 24,
        bitrate: 0,
        quality: 0,
      });
      this.montages.addAudioToTrack(take.trackId, [path], take.from, [channels[0].length / take.ctx.sampleRate]);
      this.documents.notify({ key: 'record.done', params: { path } });
    } catch (err) {
      release(take);
      this.documents.notify({ key: 'record.error', params: { message: errorMessage(err) } });
    } finally {
      this.timeline.recordingClip.set(null);
      this.state.set('idle');
    }
  }

  /**
   * Measures the round-trip latency of the chosen input and output: plays a few clicks and finds them in the
   * input. Saved for the pair of devices; null (nothing saved) when the clicks were not heard clearly.
   */
  async calibrate(): Promise<number | null> {
    if (this.state() !== 'idle') return null;
    this.playback.pause();
    this.state.set('calibrating');
    let ctx: AudioContext | undefined;
    let stream: MediaStream | undefined;
    try {
      stream = await this.openInput();
      ctx = await this.openContext();
      const capture = await InputCapture.start(ctx, stream);
      await ctx.resume();
      const click = clickBuffer(ctx.sampleRate);
      const first = ctx.currentTime + 0.5;
      const times = Array.from({ length: CLICK_COUNT }, (_, i) => first + i * CLICK_INTERVAL);
      for (const time of times) {
        const node = new AudioBufferSourceNode(ctx, { buffer: click });
        node.connect(ctx.destination);
        node.start(time);
      }
      await new Promise((resolve) => setTimeout(resolve, (times[times.length - 1] - ctx!.currentTime + CLICK_INTERVAL) * 1000));
      const captured = await capture.stop();
      const latency = measureLatency(
        captured,
        times.map((t) => Math.round(t * ctx!.sampleRate)),
        ctx.sampleRate,
      );
      if (latency !== null) this.settings.setCurrentLatency(latency);
      return latency;
    } finally {
      stream?.getTracks().forEach((track) => track.stop());
      void ctx?.close();
      this.state.set('idle');
    }
  }

  /** Moves the playhead and stretches the clip being recorded (the view follows them, as in the playback). */
  private tick(): void {
    const take = this.take;
    if (!take) return;
    const position = take.from + Math.max(0, take.ctx.currentTime - take.when);
    this.playback.position.set(position);
    this.timeline.recordingClip.set({ trackId: take.trackId, start: take.from, end: position });
    this.frame = requestAnimationFrame(() => this.tick());
  }

  /** Proposed file: "<track> <date time>.wav" next to the montage (or to its first source). */
  private defaultPath(trackId: string): string {
    const track = this.montages.montage().tracks.find((t) => t.id === trackId);
    const near = this.montages.path() ?? this.montages.montage().sources[0]?.path;
    const name = `${track?.name ?? this.i18n.t('record.fileName')} ${timestamp()}.wav`.replace(/[\\/:*?"<>|]/g, '-');
    return near ? `${dirName(near)}/${name}` : name;
  }

  /** The chosen input; when it is no longer connected, the default one. */
  private async openInput(): Promise<MediaStream> {
    const id = this.settings.audioInput()?.id ?? null;
    try {
      return await openInput(id);
    } catch (err) {
      if (!id || (err as { name?: string })?.name !== 'OverconstrainedError') throw err;
      return openInput(null);
    }
  }

  /** A context on the chosen output (as the playback), at the rate of the device. */
  private async openContext(): Promise<AudioContext> {
    const ctx = new AudioContext({ latencyHint: 'interactive' }) as AudioContext & { setSinkId?: (id: string) => Promise<void> };
    const id = this.settings.audioOutput()?.id;
    if (id && ctx.setSinkId) await ctx.setSinkId(id).catch(() => undefined);
    return ctx;
  }

  /** The montage from `from` to its end, rendered and ready to play at the listening volume. */
  private async backing(ctx: AudioContext, from: number): Promise<AudioBufferSourceNode | undefined> {
    const duration = this.timeline.duration() + this.mixer.tail() - from;
    if (this.timeline.duration() <= 0 || duration <= 0) return undefined;
    const buffer = await this.mixer.render(from, duration, this.montages.montage().channels, ctx.sampleRate);
    const volume = ctx.createGain();
    volume.gain.value = this.settings.muted() ? 0 : this.settings.volume();
    volume.connect(ctx.destination);
    const node = new AudioBufferSourceNode(ctx, { buffer });
    node.connect(volume);
    return node;
  }
}

/** Closes the input and the context of a take (again after an error: no harm). */
function release(take: Take): void {
  take.stream.getTracks().forEach((track) => track.stop());
  take.ctx.close().catch(() => undefined);
}

/** Round trip expected from what the browser reports, when it was never measured. */
function estimatedLatency(ctx: AudioContext, stream: MediaStream): number {
  const input = (stream.getAudioTracks()[0]?.getSettings() as { latency?: number } | undefined)?.latency ?? 0;
  return (ctx.outputLatency || 0) + (ctx.baseLatency || 0) + input;
}

/** The captured samples from the moment the backing started, as heard back through the input. */
function alignedTake(captured: CapturedAudio, take: Take, rate: number): Float32Array<ArrayBuffer>[] {
  // the sound heard at `when` comes back `latency` later: the take starts there
  const skip = Math.round((take.when + take.latency) * rate) - captured.start;
  return captured.channels.map((data) => {
    if (skip >= 0) return data.slice(skip);
    // started late: silence before the samples
    const out = new Float32Array(data.length - skip);
    out.set(data, -skip);
    return out;
  });
}

function interleave(channels: Float32Array<ArrayBuffer>[]): Float32Array<ArrayBuffer> {
  const count = channels.length;
  const out = new Float32Array(channels[0].length * count);
  channels.forEach((data, c) => {
    for (let i = 0, j = c; i < data.length; i++, j += count) out[j] = data[i];
  });
  return out;
}

/** Date and time for the file name of a take (no characters a file name cannot have). */
function timestamp(): string {
  const d = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}`;
}
