// Web Worker (typed with the DOM library of the app: postMessage with options works in both)
import { RubberBandInterface, RubberBandOption } from 'rubberband-wasm';

export interface StretchRequest {
  id: number;
  wasmUrl: string;
  sampleRate: number;
  channels: Float32Array[];
  /** Output length / input length (1 / speed). */
  timeRatio: number;
  pitchScale: number;
}

export type StretchResponse =
  | { id: number; progress: number }
  | { id: number; channels: Float32Array[] }
  | { id: number; error: string };

/** Samples per call (the offline mode takes any block up to the maximum process size). */
const BLOCK = 4096;
/** Same settings as the ffmpeg filter of the desktop: quality pitch, channels processed together. */
const OPTIONS =
  RubberBandOption.RubberBandOptionProcessOffline |
  RubberBandOption.RubberBandOptionPitchHighQuality |
  RubberBandOption.RubberBandOptionChannelsTogether;

let api: Promise<RubberBandInterface> | undefined;

function stretch(rb: RubberBandInterface, request: StretchRequest, progress: (fraction: number) => void): Float32Array[] {
  const { channels, timeRatio, pitchScale } = request;
  const length = channels[0].length;
  const output = channels.map(() => new Float32Array(Math.ceil(length * timeRatio) + BLOCK));
  const state = rb.rubberband_new(request.sampleRate, channels.length, OPTIONS, timeRatio, pitchScale);
  rb.rubberband_set_max_process_size(state, BLOCK);
  rb.rubberband_set_expected_input_duration(state, length);
  const pointers = rb.malloc(channels.length * 4);
  const buffers = channels.map((_, c) => {
    const buffer = rb.malloc(BLOCK * 4);
    rb.memWritePtr(pointers + c * 4, buffer);
    return buffer;
  });
  try {
    // offline mode: a first pass to study the whole input, then the processing
    for (const pass of ['study', 'process'] as const) {
      let written = 0;
      for (let read = 0; read < length; ) {
        const count = Math.min(BLOCK, length - read);
        channels.forEach((data, c) => rb.memWrite(buffers[c], data.subarray(read, read + count)));
        read += count;
        const final = read >= length ? 1 : 0;
        if (pass === 'study') {
          rb.rubberband_study(state, pointers, count, final);
          continue;
        }
        rb.rubberband_process(state, pointers, count, final);
        written = retrieve(rb, state, pointers, buffers, output, written);
        progress(read / length);
      }
      if (pass === 'process') {
        // the tail after the last input block
        written = retrieve(rb, state, pointers, buffers, output, written);
        return output.map((data) => data.slice(0, Math.min(written, Math.round(length * timeRatio))));
      }
    }
    return output;
  } finally {
    buffers.forEach((buffer) => rb.free(buffer));
    rb.free(pointers);
    rb.rubberband_delete(state);
  }
}

function retrieve(rb: RubberBandInterface, state: number, pointers: number, buffers: number[], output: Float32Array[], written: number): number {
  for (let available = rb.rubberband_available(state); available > 0; available = rb.rubberband_available(state)) {
    const count = rb.rubberband_retrieve(state, pointers, Math.min(BLOCK, available));
    buffers.forEach((buffer, c) => {
      if (written + count > output[c].length) {
        const grown = new Float32Array((written + count) * 2);
        grown.set(output[c]);
        output[c] = grown;
      }
      output[c].set(rb.memReadF32(buffer, count), written);
    });
    written += count;
  }
  return written;
}

addEventListener('message', async (event: MessageEvent<StretchRequest>) => {
  const request = event.data;
  const reply = (response: StretchResponse, transfer: Transferable[] = []) => postMessage(response, { transfer });
  try {
    api ??= WebAssembly.compileStreaming(fetch(request.wasmUrl)).then((module) => RubberBandInterface.initialize(module));
    let last = 0;
    const channels = stretch(await api, request, (progress) => {
      if (progress - last < 0.02) return;
      last = progress;
      reply({ id: request.id, progress });
    });
    reply({ id: request.id, channels }, channels.map((data) => data.buffer));
  } catch (err) {
    reply({ id: request.id, error: String((err as { message?: string })?.message ?? err) });
  }
});
