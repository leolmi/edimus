import type { CapturedAudio } from './input-capture';

/** Clicks played by the calibration, one every CLICK_INTERVAL seconds. */
export const CLICK_COUNT = 6;
export const CLICK_INTERVAL = 0.5;
/** Longest round trip looked for (s): the echo of a click must come before the next one. */
const MAX_LATENCY = 0.4;
/** Clicks that must be heard, and how close (s) to each other, for a valid measure. */
const MIN_HEARD = 4;
const AGREEMENT = 0.002;

/** Short burst (3 ms of 2 kHz, faded in and out): a sharp onset, easy to find in the recording. */
export function clickBuffer(sampleRate: number): AudioBuffer {
  const length = Math.round(0.003 * sampleRate);
  const buffer = new AudioBuffer({ length, numberOfChannels: 1, sampleRate });
  const data = buffer.getChannelData(0);
  for (let i = 0; i < length; i++) {
    data[i] = 0.8 * Math.sin((2 * Math.PI * 2000 * i) / sampleRate) * Math.sin((Math.PI * i) / length);
  }
  return buffer;
}

/**
 * Round-trip latency (s) from the clicks played at the context frames `clicks` and the captured input: for each
 * click, the first sample that rises well above the background noise. Null when the clicks were not heard clearly
 * or the delays disagree (noise, a microphone too far from the speakers).
 */
export function measureLatency(captured: CapturedAudio, clicks: readonly number[], sampleRate: number): number | null {
  const level = (frame: number) => {
    const i = frame - captured.start;
    return i >= 0 && i < captured.channels[0].length ? Math.max(...captured.channels.map((c) => Math.abs(c[i]))) : 0;
  };
  const peak = (from: number, to: number) => {
    let max = 0;
    for (let f = from; f < to; f++) max = Math.max(max, level(f));
    return max;
  };
  const window = Math.round(MAX_LATENCY * sampleRate);
  // the background noise, just before the first click
  const noise = peak(clicks[0] - Math.round(0.3 * sampleRate), clicks[0]);
  const delays: number[] = [];
  for (const click of clicks) {
    const loudest = peak(click, click + window);
    if (loudest < Math.max(0.01, noise * 4)) continue;
    const threshold = Math.max(noise * 2, loudest * 0.3);
    for (let f = click; f < click + window; f++) {
      if (level(f) >= threshold) {
        delays.push((f - click) / sampleRate);
        break;
      }
    }
  }
  if (delays.length < MIN_HEARD) return null;
  const sorted = [...delays].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const agreeing = sorted.filter((d) => Math.abs(d - median) <= AGREEMENT);
  return agreeing.length >= MIN_HEARD ? agreeing.reduce((a, b) => a + b, 0) / agreeing.length : null;
}
