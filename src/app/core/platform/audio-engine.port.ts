/** Properties of the first audio stream of a file. */
export interface AudioInfo {
  codec: string;
  format: string;
  sampleRate: number;
  /** Channels of the decoded audio (sources with more than 2 channels are downmixed to stereo). */
  channels: 1 | 2;
  sourceChannels: number;
  duration: number;
  bitRate?: number;
}

/** Speed and pitch change applied while decoding (processed clips). */
export interface AudioProcessing {
  /** Speed factor (1 = unchanged). */
  rate: number;
  /** Pitch shift in semitones. */
  pitch: number;
  /** Speed by resampling, the pitch follows it (plus `pitch`); otherwise time-stretch. */
  varispeed: boolean;
}

export interface DecodeOptions {
  /** Start of the portion to decode (seconds). */
  offset?: number;
  /** Length of the portion to decode (seconds). */
  duration?: number;
  processing?: AudioProcessing;
  /** Expected length of the output, for the progress (default: the input length). */
  outputDuration?: number;
}

export type ExportFormat = 'wav' | 'mp3' | 'flac' | 'ogg' | 'opus' | 'm4a';

export interface EncodeOptions {
  format: ExportFormat;
  channels: 1 | 2;
  sampleRate: number;
  /** Bits per sample of the lossless formats (32 = float for WAV). */
  bitDepth: 16 | 24 | 32;
  /** Bitrate (kbps) of MP3, Opus and AAC. */
  bitrate: number;
  /** Vorbis quality (0–10). */
  quality: number;
}

/** Reading, processing and writing of audio files. */
export abstract class AudioEnginePort {
  /** Formats `encode` can write. */
  abstract readonly exportFormats: readonly ExportFormat[];
  abstract probe(path: string): Promise<AudioInfo>;
  /** Decodes the file (or the portion given in `options`) to float PCM at its native sample rate. */
  abstract decode(
    path: string,
    info: AudioInfo,
    onProgress?: (fraction: number) => void,
    options?: DecodeOptions,
  ): Promise<AudioBuffer>;
  /** Writes interleaved samples to a file of the given format. */
  abstract encode(
    path: string,
    samples: Float32Array<ArrayBuffer>,
    options: EncodeOptions,
    onProgress?: (fraction: number) => void,
  ): Promise<void>;
}
