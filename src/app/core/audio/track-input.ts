import { Injectable, inject } from '@angular/core';
import { I18nService } from '../i18n/i18n.service';
import { Track, TrackInput } from '../montage/montage.model';
import { SettingsService } from '../settings.service';
import { AudioDevicesService } from './audio-devices.service';

/** The input a track records from, found among the connected devices. */
export interface ResolvedInput {
  /** Device to open; null: the system default. */
  deviceId: string | null;
  /** Channels to keep (0-based); none: the first two. */
  channels?: number[];
  /** The device of the track is not connected: the default input is used instead. */
  missing: boolean;
}

/** "1", "1+2": channels as the cards number them. */
export const channelsLabel = (channels: readonly number[]) => channels.map((c) => c + 1).join('+');

/** Choices of channels of a device: each one alone (mono take), then the pairs 1+2, 3+4... (stereo take). */
export function channelChoices(count: number): number[][] {
  if (count < 2) return [];
  const single = Array.from({ length: count }, (_, c) => [c]);
  const pairs = Array.from({ length: Math.floor(count / 2) }, (_, i) => [2 * i, 2 * i + 1]);
  return [...single, ...pairs];
}

/** Same channels (none and an empty list alike). */
export const sameChannels = (a?: readonly number[], b?: readonly number[]) =>
  (a ?? []).length === (b ?? []).length && (a ?? []).every((c, i) => c === b?.[i]);

/**
 * Inputs of the tracks: the device of the track (by id or, when the id changed, by name), else the one of the
 * Settings, else the system default.
 */
@Injectable({ providedIn: 'root' })
export class TrackInputService {
  private readonly devices = inject(AudioDevicesService);
  private readonly settings = inject(SettingsService);
  private readonly i18n = inject(I18nService);

  /** Finds the input of a track among the connected devices (read again first). */
  async resolve(track: Track | undefined): Promise<ResolvedInput> {
    const own = track?.input;
    if (!own) return { deviceId: this.settings.audioInput()?.id ?? null, missing: false };
    await this.devices.refresh();
    const device = this.find(own);
    return device ? { deviceId: device, channels: own.channels, missing: false } : { deviceId: null, missing: true };
  }

  /** Id of the connected device of an input, undefined when it is not connected (the list must be read). */
  find(input: TrackInput): string | undefined {
    const inputs = this.devices.inputs();
    return (inputs.find((d) => d.id === input.deviceId) ?? inputs.find((d) => d.label === input.label))?.id;
  }

  /** Name of the input of a track, with its channels ("Card · 1+2"). */
  label(track: Track | undefined): string {
    const own = track?.input;
    if (!own) return this.settings.audioInput()?.label ?? this.i18n.t('input.default');
    return own.channels?.length ? `${own.label} · ${channelsLabel(own.channels)}` : own.label;
  }
}
