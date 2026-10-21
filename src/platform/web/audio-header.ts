/**
 * Format, sample rate and channels read from the first bytes of an audio file. The browser
 * decoder resamples to the rate of its context, so the native rate must be known beforehand.
 */
export interface AudioHeader {
  format: string;
  codec: string;
  sampleRate?: number;
  channels?: number;
}

const MP3_RATES: Record<number, number[]> = {
  3: [44100, 48000, 32000], // MPEG 1
  2: [22050, 24000, 16000], // MPEG 2
  0: [11025, 12000, 8000], // MPEG 2.5
};

const ascii = (b: Uint8Array, at: number, length: number) => String.fromCharCode(...b.subarray(at, at + length));

function indexOf(b: Uint8Array, text: string, from = 0): number {
  const first = text.charCodeAt(0);
  outer: for (let i = b.indexOf(first, from); i >= 0 && i <= b.length - text.length; i = b.indexOf(first, i + 1)) {
    for (let j = 1; j < text.length; j++) if (b[i + j] !== text.charCodeAt(j)) continue outer;
    return i;
  }
  return -1;
}

function wav(b: Uint8Array, view: DataView): AudioHeader {
  // chunks after "RIFF....WAVE": id (4), size (4, little endian), data
  for (let at = 12; at + 8 <= b.length; at += 8 + view.getUint32(at + 4, true) + (view.getUint32(at + 4, true) % 2)) {
    if (ascii(b, at, 4) === 'fmt ') {
      return { format: 'wav', codec: 'pcm', channels: view.getUint16(at + 10, true), sampleRate: view.getUint32(at + 12, true) };
    }
  }
  return { format: 'wav', codec: 'pcm' };
}

function mp3(b: Uint8Array): AudioHeader {
  let at = 0;
  // ID3v2 tag: 10 bytes of header, size as 4 x 7 bits
  if (ascii(b, 0, 3) === 'ID3') at = 10 + ((b[6] << 21) | (b[7] << 14) | (b[8] << 7) | b[9]);
  for (; at + 4 <= b.length; at++) {
    if (b[at] !== 0xff || (b[at + 1] & 0xe0) !== 0xe0) continue;
    const version = (b[at + 1] >> 3) & 3;
    const rate = MP3_RATES[version]?.[(b[at + 2] >> 2) & 3];
    if (!rate) continue;
    return { format: 'mp3', codec: 'mp3', sampleRate: rate, channels: b[at + 3] >> 6 === 3 ? 1 : 2 };
  }
  return { format: 'mp3', codec: 'mp3' };
}

function ogg(b: Uint8Array, view: DataView): AudioHeader {
  const vorbis = indexOf(b, '\x01vorbis');
  if (vorbis >= 0) return { format: 'ogg', codec: 'vorbis', channels: b[vorbis + 11], sampleRate: view.getUint32(vorbis + 12, true) };
  const opus = indexOf(b, 'OpusHead');
  // Opus always decodes at 48 kHz
  if (opus >= 0) return { format: 'ogg', codec: 'opus', channels: b[opus + 9], sampleRate: 48000 };
  return { format: 'ogg', codec: '?' };
}

function mp4(b: Uint8Array, view: DataView): AudioHeader {
  // audio sample entry: type, 6 reserved, data reference (2), 8 reserved, channels (2),
  // sample size (2), 4 reserved, sample rate (16.16)
  const entry = indexOf(b, 'mp4a');
  if (entry < 0 || entry + 30 > b.length) return { format: 'mp4', codec: 'aac' };
  return { format: 'mp4', codec: 'aac', channels: view.getUint16(entry + 20), sampleRate: view.getUint16(entry + 28) };
}

export function readAudioHeader(bytes: ArrayBuffer): AudioHeader {
  const b = new Uint8Array(bytes);
  const view = new DataView(bytes);
  if (ascii(b, 0, 4) === 'RIFF' && ascii(b, 8, 4) === 'WAVE') return wav(b, view);
  if (ascii(b, 0, 4) === 'fLaC') {
    // STREAMINFO: sample rate in 20 bits, then channels - 1 in 3 bits
    return { format: 'flac', codec: 'flac', sampleRate: (b[18] << 12) | (b[19] << 4) | (b[20] >> 4), channels: ((b[20] >> 1) & 7) + 1 };
  }
  if (ascii(b, 0, 4) === 'OggS') return ogg(b, view);
  if (ascii(b, 4, 4) === 'ftyp') return mp4(b, view);
  return mp3(b);
}
