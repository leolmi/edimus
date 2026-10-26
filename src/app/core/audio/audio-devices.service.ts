import { Injectable, signal } from '@angular/core';

/** An audio device of the system (output of the playback or input of the recording). */
export interface AudioDevice {
  /** Device id for AudioContext.setSinkId or getUserMedia (stable for the origin of the app). */
  id: string;
  label: string;
}

/** Pseudo-devices of Chromium, offered as "system default" instead. */
const ALIASES = ['default', 'communications'];

/** Audio output and input devices available for the playback and the recording. */
@Injectable({ providedIn: 'root' })
export class AudioDevicesService {
  readonly outputs = signal<AudioDevice[]>([]);
  readonly inputs = signal<AudioDevice[]>([]);

  /** True once the device names have been unlocked (see refresh). */
  private unlocked = false;

  constructor() {
    navigator.mediaDevices?.addEventListener('devicechange', () => {
      if (this.unlocked) void this.refresh();
    });
  }

  /**
   * Reads the devices (when the Settings open). The web view gives their names only to a page allowed to use a
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
    const of = (kind: MediaDeviceKind) =>
      devices
        .filter((d) => d.kind === kind && !ALIASES.includes(d.deviceId))
        .map((d, i) => ({ id: d.deviceId, label: d.label || `#${i + 1}` }));
    this.outputs.set(of('audiooutput'));
    this.inputs.set(of('audioinput'));
  }

  private async list(): Promise<MediaDeviceInfo[]> {
    return (await navigator.mediaDevices?.enumerateDevices()) ?? [];
  }
}
