import type { BarAnchor, Tempo } from './tempo';

/** Extension of the bar files, added to the name of the audio file (`song.mp3.edimusbars`). */
export const BARS_EXTENSION = 'edimusbars';

const BARS_KIND = 'edimus-bars';
const BARS_VERSION = 1;

/** Path of the bar file of an audio file: next to it, with its whole name. */
export const barFilePath = (audioPath: string) => `${audioPath}.${BARS_EXTENSION}`;

/** Content of a bar file: the tempo of an audio file, with its bar map. */
export interface BarFile {
  /** Fingerprint of the audio (see fingerprint.ts), to recognize a file of another audio. */
  fingerprint?: string;
  tempo: Tempo;
}

/** Text of a bar file. */
export function writeBarFile(audioName: string, file: BarFile): string {
  const { bpm, offset, beatsPerBar, anchors } = file.tempo;
  return JSON.stringify(
    {
      kind: BARS_KIND,
      version: BARS_VERSION,
      audio: audioName,
      fingerprint: file.fingerprint,
      tempo: { bpm, offset, beatsPerBar: beatsPerBar ?? 4, anchors },
    },
    null,
    2,
  );
}

/** Content of a bar file; throws when the text is not one. */
export function readBarFile(text: string): BarFile {
  const data = JSON.parse(text);
  const tempo = data?.tempo;
  if (data?.kind !== BARS_KIND || typeof tempo?.bpm !== 'number' || !(tempo.bpm > 0) || typeof tempo.offset !== 'number') {
    throw new Error('Not a bar file');
  }
  const anchors: BarAnchor[] | undefined = Array.isArray(tempo.anchors)
    ? tempo.anchors
        .filter((a: BarAnchor) => Number.isInteger(a?.bar) && Number.isFinite(a?.time))
        .map((a: BarAnchor) => (a.auto ? { bar: a.bar, time: a.time, auto: true } : { bar: a.bar, time: a.time }))
        .sort((a: BarAnchor, b: BarAnchor) => a.bar - b.bar)
    : undefined;
  return {
    fingerprint: typeof data.fingerprint === 'string' ? data.fingerprint : undefined,
    tempo: {
      bpm: tempo.bpm,
      offset: tempo.offset,
      confidence: 1,
      beatsPerBar: Number.isInteger(tempo.beatsPerBar) && tempo.beatsPerBar > 0 ? tempo.beatsPerBar : 4,
      ...(anchors?.length ? { anchors } : {}),
    },
  };
}
