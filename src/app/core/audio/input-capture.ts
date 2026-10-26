/**
 * Worklet that copies the input samples, tagged with the context frame they were processed at, and posts them in
 * blocks (a message per render quantum would be too many). Inline: the build has no separate worklet file.
 */
const CAPTURE_WORKLET = `
class EdimusCapture extends AudioWorkletProcessor {
  constructor() {
    super();
    this.blocks = [];
    this.frames = 0;
    this.start = -1;
    this.port.onmessage = () => {
      this.flush();
      this.stopped = true;
      this.port.postMessage({ done: true });
    };
  }
  process(inputs) {
    if (this.stopped) return false;
    const input = inputs[0];
    if (input.length) {
      // a gap (input not connected yet) starts a new block: blocks are placed by their frame
      if (this.start >= 0 && this.start + this.frames !== currentFrame) this.flush();
      if (this.start < 0) this.start = currentFrame;
      this.blocks.push(input.map((channel) => channel.slice()));
      this.frames += input[0].length;
      if (this.frames >= 4096) this.flush();
    }
    return true;
  }
  flush() {
    if (!this.frames) return;
    const count = Math.max(...this.blocks.map((b) => b.length));
    const channels = Array.from({ length: count }, (_, c) => {
      const out = new Float32Array(this.frames);
      let at = 0;
      for (const block of this.blocks) {
        const data = block[c] ?? block[0];
        out.set(data, at);
        at += data.length;
      }
      return out;
    });
    this.port.postMessage({ start: this.start, channels }, channels.map((c) => c.buffer));
    this.blocks = [];
    this.frames = 0;
    this.start = -1;
  }
}
registerProcessor('edimus-capture', EdimusCapture);
`;

let workletUrl: string | undefined;
const loaded = new WeakSet<BaseAudioContext>();

/** Samples of an input, from a context frame on. */
export interface CapturedAudio {
  /** Context frame of the first sample. */
  start: number;
  channels: Float32Array<ArrayBuffer>[];
}

/** Block of samples posted by the worklet. */
interface CapturedBlock {
  start: number;
  channels: Float32Array<ArrayBuffer>[];
}

/**
 * Opens an input device (null: the system default) as the raw signal: echo cancellation, noise suppression and
 * automatic gain off, as a recording needs (they are meant for calls and would change the sound).
 */
export function openInput(deviceId: string | null): Promise<MediaStream> {
  return navigator.mediaDevices.getUserMedia({
    audio: {
      deviceId: deviceId ? { exact: deviceId } : undefined,
      echoCancellation: false,
      noiseSuppression: false,
      autoGainControl: false,
    },
  });
}

/**
 * Records a stream on a context: every sample is placed at the context frame it was processed at, so that it
 * can be lined up with what the context played (see `CapturedAudio`).
 */
export class InputCapture {
  private readonly blocks: CapturedBlock[] = [];
  private constructor(
    private readonly source: MediaStreamAudioSourceNode,
    private readonly node: AudioWorkletNode,
    private readonly sink: GainNode,
  ) {
    node.port.onmessage = (event: MessageEvent<CapturedBlock | { done: true }>) => {
      if ('start' in event.data) this.blocks.push(event.data);
    };
  }

  static async start(ctx: AudioContext, stream: MediaStream): Promise<InputCapture> {
    if (!loaded.has(ctx)) {
      workletUrl ??= URL.createObjectURL(new Blob([CAPTURE_WORKLET], { type: 'text/javascript' }));
      await ctx.audioWorklet.addModule(workletUrl);
      loaded.add(ctx);
    }
    const source = ctx.createMediaStreamSource(stream);
    const node = new AudioWorkletNode(ctx, 'edimus-capture', { numberOfInputs: 1, numberOfOutputs: 1 });
    // silent path to the destination: a node not pulled by the graph may not run
    const sink = ctx.createGain();
    sink.gain.value = 0;
    source.connect(node).connect(sink).connect(ctx.destination);
    return new InputCapture(source, node, sink);
  }

  /** Stops and returns the samples, from the first frame recorded (gaps filled with silence). */
  async stop(): Promise<CapturedAudio> {
    await new Promise<void>((resolve) => {
      const previous = this.node.port.onmessage;
      this.node.port.onmessage = (event: MessageEvent) => {
        previous?.call(this.node.port, event);
        if ((event.data as { done?: boolean }).done) resolve();
      };
      this.node.port.postMessage('stop');
    });
    this.source.disconnect();
    this.node.disconnect();
    this.sink.disconnect();
    return joinBlocks(this.blocks);
  }
}

function joinBlocks(blocks: CapturedBlock[]): CapturedAudio {
  if (!blocks.length) return { start: 0, channels: [new Float32Array(0)] };
  const start = blocks[0].start;
  const end = Math.max(...blocks.map((b) => b.start + b.channels[0].length));
  const count = Math.min(2, Math.max(...blocks.map((b) => b.channels.length)));
  const channels = Array.from({ length: count }, () => new Float32Array(end - start));
  for (const block of blocks) {
    channels.forEach((out, c) => out.set(block.channels[c] ?? block.channels[0], block.start - start));
  }
  return { start, channels };
}
