import type { Tempo } from '../audio/tempo';
import type { EnvelopePoint } from './envelope';

/** Extension of the montage project files. */
export const MONTAGE_EXTENSION = 'edimus';
/** 2: volume envelopes on the clips (in source time) and a single volume per track. */
export const MONTAGE_VERSION = 2;

export const AUDIO_EXTENSIONS = ['wav', 'mp3', 'flac', 'ogg', 'oga', 'opus', 'm4a', 'aac', 'aif', 'aiff', 'wma'];

/** An original audio file referenced (never modified) by the montage. */
export interface AudioSource {
  id: string;
  /** Absolute path. */
  path: string;
  /** Path relative to the montage file, used when the absolute one no longer exists. */
  relativePath?: string;
  /** Tempo set by hand (otherwise detected at every opening). */
  tempo?: Tempo;
}

/** A portion of a source placed on a track; times in seconds. */
export interface Clip {
  id: string;
  sourceId: string;
  /** Position on the timeline. */
  start: number;
  /** Offset inside the source (source time). */
  offset: number;
  /** Length of the portion of the source (source time); 0 = up to the end of the source. */
  duration: number;
  /** Speed factor (2 = twice as fast, half the length on the timeline); default 1. */
  rate?: number;
  /** Pitch shift in semitones, independent of the speed; default 0. */
  pitch?: number;
  /**
   * Varispeed: the speed change also changes the pitch (like a tape or a turntable), with no
   * stretching artefacts; `pitch` is then an extra shift on top of it.
   */
  varispeed?: boolean;
  /**
   * Volume envelope (fades) in **source** time, sorted: it moves, splits, trims and stretches
   * with the clip; none = unity gain.
   */
  envelope?: EnvelopePoint[];
}

/** Speed factor of a clip. */
export const clipRate = (clip: Clip) => clip.rate ?? 1;

/** Timeline time of a source time of a clip. */
export const toTimeline = (clip: Clip, source: number) => clip.start + (source - clip.offset) / clipRate(clip);

/** Source time of a timeline time of a clip. */
export const toSource = (clip: Clip, time: number) => clip.offset + (time - clip.start) * clipRate(clip);

/** True when the clip plays its source altered (speed or pitch), through a rendered version. */
export const isProcessed = (clip: Clip) => clipRate(clip) !== 1 || (clip.pitch ?? 0) !== 0;

export interface Track {
  id: string;
  name: string;
  clips: Clip[];
  muted?: boolean;
  solo?: boolean;
  /** Volume of the whole track (linear gain, up to MAX_GAIN); default 1. */
  volume?: number;
}

/** Volume of a track (linear gain). */
export const trackVolume = (track: Track) => track.volume ?? 1;

/** Tracks heard in the mix: not muted and, when some track is soloed, soloed. */
export function audibleTracks(montage: Montage): Track[] {
  const soloing = montage.tracks.some((t) => t.solo);
  return montage.tracks.filter((t) => !t.muted && (!soloing || t.solo));
}

/** Non-destructive montage: tracks composed from references to the original files. */
export interface Montage {
  version: number;
  /** Output channels of the mixdown. */
  channels: 1 | 2;
  sources: AudioSource[];
  tracks: Track[];
}

export function fileExtension(path: string): string {
  const name = fileName(path);
  const dot = name.lastIndexOf('.');
  return dot > 0 ? name.slice(dot + 1).toLowerCase() : '';
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function dirName(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
  return index >= 0 ? path.slice(0, index) : '';
}

export function baseName(path: string): string {
  return fileName(path).replace(/\.[^.]+$/, '');
}

/**
 * Name for a copy of a track: "<name> (n)" with the lowest n not used yet; a trailing "(n)"
 * of the original is replaced, so the copy of "Voice (1)" is "Voice (2)", not "Voice (1) (1)".
 */
export function copyName(name: string, existing: readonly string[]): string {
  const stem = name.replace(/\s*\(\d+\)$/, '');
  const taken = new Set(existing);
  let n = 1;
  while (taken.has(`${stem} (${n})`)) n++;
  return `${stem} (${n})`;
}

export const isMontageFile = (path: string) => fileExtension(path) === MONTAGE_EXTENSION;
export const isAudioFile = (path: string) => AUDIO_EXTENSIONS.includes(fileExtension(path));
