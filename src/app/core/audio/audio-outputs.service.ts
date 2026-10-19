import { Injectable, signal } from '@angular/core';

/** An audio output device of the system. */
export interface AudioOutput {
  /** Device id for AudioContext.setSinkId (stable for the origin of the app). */
  id: string;
  label: string;
}

/** Pseudo-devices of Chromium, offered as "system default" instead. */
const ALIASES = ['default', 'communications'];

/** Audio output devices available for the playback. */
@Injectable({ providedIn: 'root' })
export class AudioOutputsService {
  readonly outputs = signal<AudioOutput[]>([]);

  /** True once the device names have been unlocked (see refresh). */
  private unlocked = false;

  constructor() {
    navigator.mediaDevices?.addEventListener('devicechange', () => {
      if (this.unlocked) void this.refresh();
    });
  }

  /**
   * Reads the output devices (when the Settings open). The web view gives their names only to a page allowed to use a
   * microphone: the first time a microphone stream is opened and closed at once, nothing is recorded.
   */
  async refresh(): Promise<void> {
    let devices = await this.list();
    if (!this.unlocked && devices.some((d) => !d.label)) {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        stream.getTracks().forEach((track) => track.stop());
        devices = await this.list();
      } catch {
        // no microphone permission: the devices keep a generic name
      }
    }
    this.unlocked = true;
    this.outputs.set(
      devices
        .filter((d) => !ALIASES.includes(d.deviceId))
        .map((d, i) => ({ id: d.deviceId, label: d.label || `#${i + 1}` })),
    );
  }

  private async list(): Promise<MediaDeviceInfo[]> {
    const devices = (await navigator.mediaDevices?.enumerateDevices()) ?? [];
    return devices.filter((d) => d.kind === 'audiooutput');
  }
}
