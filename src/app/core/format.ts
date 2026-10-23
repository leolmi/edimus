/** Formats seconds as `m:ss.d` (or `h:mm:ss.d`). */
export function formatDuration(seconds: number): string {
  const tenths = Math.round(seconds * 10);
  const h = Math.floor(tenths / 36000);
  const m = Math.floor((tenths % 36000) / 600);
  const s = ((tenths % 600) / 10).toFixed(1).padStart(4, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${s}` : `${m}:${s}`;
}

/** Parses `m:ss.mmm`, `h:mm:ss.mmm` or plain seconds (comma or dot as decimal separator). */
export function parseTime(text: string): number | null {
  const parts = text.trim().replace(',', '.').split(':');
  if (parts.some((p) => p === '' || isNaN(Number(p)))) return null;
  return parts.reduce((total, part) => total * 60 + Number(part), 0);
}
