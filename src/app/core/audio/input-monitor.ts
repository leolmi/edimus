import { openInput, streamChannels } from './input-capture';

/** Channels asked to a device when watching it: a card gives all its inputs, up to this many. */
const PROBE_CHANNELS = 32;

/** Channels of the devices already read (they do not change while connected). */
const channelCounts = new Map<string, number>();

/**
 * Watches an input without recording it: how many channels it gives and the peak of each one, for the level
 * meter of the track settings. Nothing is heard (the analysers end in a silent gain).
 */
export class InputMonitor {
  private readonly data: Float32Array<ArrayBuffer>;

  private constructor(
    private readonly ctx: AudioContext,
    private readonly stream: MediaStream,
    private readonly analysers: AnalyserNode[],
  ) {
    this.data = new Float32Array(analysers[0]?.fftSize ?? 0);
  }

  /**
   * Channels a device (null: the system default) gives: read once by opening and closing it at once, so that
   * the microphone is not kept in use just to fill the channel menu.
   */
  static async channelsOf(deviceId: string | null): Promise<number> {
    const key = deviceId ?? '';
    const known = channelCounts.get(key);
    if (known) return known;
    const stream = await openInput(deviceId, PROBE_CHANNELS);
    const count = streamChannels(stream);
    stream.getTracks().forEach((track) => track.stop());
    channelCounts.set(key, count);
    return count;
  }

  /** Opens a device (null: the system default) with all its channels. */
  static async open(deviceId: string | null): Promise<InputMonitor> {
    const stream = await openInput(deviceId, PROBE_CHANNELS);
    const ctx = new AudioContext();
    try {
      const count = streamChannels(stream);
      channelCounts.set(deviceId ?? '', count);
      const source = ctx.createMediaStreamSource(stream);
      const splitter = ctx.createChannelSplitter(count);
      const sink = ctx.createGain();
      sink.gain.value = 0;
      sink.connect(ctx.destination);
      source.connect(splitter);
      const analysers = Array.from({ length: count }, (_, c) => {
        const analyser = new AnalyserNode(ctx, { fftSize: 2048 });
        splitter.connect(analyser, c);
        analyser.connect(sink);
        return analyser;
      });
      await ctx.resume();
      return new InputMonitor(ctx, stream, analysers);
    } catch (err) {
      stream.getTracks().forEach((track) => track.stop());
      void ctx.close();
      throw err;
    }
  }

  /** Channels the device gives. */
  get channels(): number {
    return this.analysers.length;
  }

  /** Peak (linear, 0–1) of each channel over the last ~40 ms. */
  peaks(): number[] {
    return this.analysers.map((analyser) => {
      analyser.getFloatTimeDomainData(this.data);
      let peak = 0;
      for (const v of this.data) peak = Math.max(peak, Math.abs(v));
      return Math.min(1, peak);
    });
  }

  close(): void {
    this.stream.getTracks().forEach((track) => track.stop());
    void this.ctx.close();
  }
}
