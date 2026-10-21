import type { StretchRequest, StretchResponse } from './rubberband.worker';

interface Pending {
  resolve: (channels: Float32Array[]) => void;
  reject: (error: Error) => void;
  onProgress?: (fraction: number) => void;
}

/** Rubber Band (wasm) in a worker, so that long renders do not block the page. */
export class RubberBandClient {
  private worker?: Worker;
  private readonly pending = new Map<number, Pending>();
  private nextId = 1;

  /** Time-stretch (`timeRatio` = output / input length) and pitch shift of the given channels. */
  process(
    channels: Float32Array[],
    sampleRate: number,
    timeRatio: number,
    pitchScale: number,
    onProgress?: (fraction: number) => void,
  ): Promise<Float32Array[]> {
    const id = this.nextId++;
    const request: StretchRequest = {
      id,
      wasmUrl: new URL('wasm/rubberband.wasm', document.baseURI).href,
      sampleRate,
      channels,
      timeRatio,
      pitchScale,
    };
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject, onProgress });
      this.start().postMessage(request, channels.map((data) => data.buffer));
    });
  }

  private start(): Worker {
    if (this.worker) return this.worker;
    const worker = new Worker(new URL('./rubberband.worker', import.meta.url), { type: 'module' });
    worker.onmessage = ({ data }: MessageEvent<StretchResponse>) => {
      const pending = this.pending.get(data.id);
      if (!pending) return;
      if ('progress' in data) return pending.onProgress?.(data.progress);
      this.pending.delete(data.id);
      if ('error' in data) pending.reject(new Error(data.error));
      else pending.resolve(data.channels);
    };
    worker.onerror = (event) => {
      for (const pending of this.pending.values()) pending.reject(new Error(event.message || 'Rubber Band worker failed'));
      this.pending.clear();
      this.worker = undefined;
    };
    this.worker = worker;
    return worker;
  }
}
