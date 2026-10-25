/** Range of a control: linear or logarithmic (frequencies, times, ratios). */
export interface ControlScale {
  min: number;
  max: number;
  log?: boolean;
}

/** Position 0–1 of a value along the control. */
export function toPosition(scale: ControlScale, value: number): number {
  const { min, max, log } = scale;
  const v = Math.min(max, Math.max(min, value));
  const p = log && min > 0 ? Math.log(v / min) / Math.log(max / min) : (v - min) / (max - min);
  return Number.isFinite(p) ? p : 0;
}

/** Value at a position 0–1 along the control. */
export function fromPosition(scale: ControlScale, position: number): number {
  const { min, max, log } = scale;
  const p = Math.min(1, Math.max(0, position));
  return log && min > 0 ? min * Math.pow(max / min, p) : min + p * (max - min);
}

/**
 * Keys shared by the controls: arrows (Shift = fine), PageUp/PageDown, Home/End. Returns the
 * new position, or null for a key the control does not handle.
 */
export function keyPosition(key: string, position: number, fine: boolean): number | null {
  const step = fine ? 0.005 : 0.02;
  switch (key) {
    case 'ArrowUp':
    case 'ArrowRight':
      return position + step;
    case 'ArrowDown':
    case 'ArrowLeft':
      return position - step;
    case 'PageUp':
      return position + 0.1;
    case 'PageDown':
      return position - 0.1;
    case 'Home':
      return 0;
    case 'End':
      return 1;
    default:
      return null;
  }
}
