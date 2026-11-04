import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AudioDevicesService } from '../../core/audio/audio-devices.service';
import { InputMonitor } from '../../core/audio/input-monitor';
import { RecordingService } from '../../core/audio/recording.service';
import { TrackInputService, channelChoices, channelsLabel, sameChannels } from '../../core/audio/track-input';
import { EditService } from '../../core/edit.service';
import { formatDuration } from '../../core/format';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Track } from '../../core/montage/montage.model';
import { MontageService } from '../../core/montage/montage.service';
import { SettingsService } from '../../core/settings.service';
import { TimelineService } from '../../core/timeline/timeline.service';
import { FieldComponent } from '../../shared/controls/field.component';

/** Lowest level shown by the input meter (dB). */
const FLOOR_DB = -60;

/** Value of the channel menu for the default channels (the first two). */
const DEFAULT_CHANNELS = '';

/**
 * Settings of the track shown in the side panel: name, audio input (device, channels, live level, latency) and a
 * summary of its contents, with the way to its files.
 */
@Component({
  selector: 'app-track-info-panel',
  imports: [FieldComponent, MatButtonModule, MatIconModule, MatSelectModule, MatTooltipModule, TranslatePipe],
  template: `
    @if (track(); as track) {
      @let locked = edits.locked();
      <app-field class="wide">
        <span fieldLabel>{{ 'trackInfo.name' | t }}</span>
        <input
          #name
          [value]="track.name"
          [disabled]="locked"
          (focus)="name.select()"
          (keydown.enter)="name.blur()"
          (keydown.escape)="name.value = track.name; name.blur()"
          (blur)="rename(track, name)"
        />
      </app-field>

      @if (recorder.available) {
        <h3>{{ 'input.title' | t }}</h3>
        <app-field class="wide">
          <span fieldLabel>{{ 'trackInput.device' | t }}</span>
          <mat-select
            [value]="deviceValue()"
            [disabled]="locked || recorder.busy()"
            (selectionChange)="setDevice(track, $event.value)"
          >
            <mat-option value="">{{ 'trackInput.settings' | t: { name: settingsInput() } }}</mat-option>
            @for (device of devices(); track device.id) {
              <mat-option [value]="device.id" [disabled]="device.missing">
                {{ device.missing ? ('input.missing' | t: { name: device.label }) : device.label }}
              </mat-option>
            }
          </mat-select>
        </app-field>
        @if (missing()) {
          <p class="hint error">{{ 'trackInput.missing' | t }}</p>
        }
        @if (channelCount() > 1 && track.input) {
          <app-field class="wide">
            <span fieldLabel>{{ 'trackInput.channels' | t }}</span>
            <mat-select
              [value]="channelsValue()"
              [disabled]="locked || recorder.busy()"
              (selectionChange)="setChannels(track, $event.value)"
            >
              <mat-option [value]="defaultChannels">{{ 'trackInput.channelsDefault' | t }}</mat-option>
              @for (choice of choices(); track choice) {
                <mat-option [value]="choice">
                  {{ (choice.includes('+') ? 'trackInput.stereo' : 'trackInput.mono') | t: { c: choice } }}
                </mat-option>
              }
            </mat-select>
          </app-field>
        }
        <div class="listen">
          <button
            mat-stroked-button
            [class.on]="listening()"
            [disabled]="recorder.busy()"
            (click)="listening.set(!listening())"
          >
            <mat-icon>{{ listening() ? 'mic_off' : 'mic' }}</mat-icon>
            {{ (listening() ? 'trackInput.stopListening' : 'trackInput.listen') | t }}
          </button>
        </div>
        @if (listening()) {
          <div class="meters" [attr.aria-label]="'trackInput.level' | t">
            @for (meter of meters(); track meter.label) {
              <div class="meter">
                <span class="channel">{{ meter.label }}</span>
                <div class="bar"><div class="fill" [class.clip]="meter.clip" [style.width.%]="meter.level * 100"></div></div>
              </div>
            } @empty {
              @if (monitorError(); as error) {
                <p class="hint error">{{ error }}</p>
              }
            }
          </div>
        }
        <div class="latency">
          <span>{{ 'latency.title' | t }}: {{ latencyLabel() }}</span>
          <button mat-stroked-button [disabled]="recorder.busy()" (click)="calibrate(track)">
            <mat-icon>graphic_eq</mat-icon>
            {{ (recorder.state() === 'calibrating' ? 'latency.calibrating' : 'latency.calibrate') | t }}
          </button>
        </div>
        @if (calibration(); as calibration) {
          <p class="hint" [class.error]="calibration.failed">{{ calibration.text }}</p>
        }
      }

      <h3>{{ 'trackInfo.contents' | t }}</h3>
      <table class="facts">
        <tr><td>{{ 'trackInfo.clips' | t }}</td><td>{{ track.clips.length }}</td></tr>
        <tr><td>{{ 'trackInfo.length' | t }}</td><td>{{ extent() }}</td></tr>
        <tr><td>{{ 'trackInfo.state' | t }}</td><td>{{ stateLabel(track) | t }}</td></tr>
        <tr><td>{{ 'trackInfo.envelope' | t }}</td><td>{{ envelopePoints(track) || '—' }}</td></tr>
        <tr><td>{{ 'fx.title' | t }}</td><td>{{ track.effects?.length || '—' }}</td></tr>
      </table>
      <button mat-stroked-button class="files" [disabled]="!track.clips.length" (click)="edits.showTrackFiles(track.id)">
        <mat-icon>audio_file</mat-icon>
        {{ 'trackFiles.open' | t }}
      </button>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
    }
    .wide {
      width: 100%;
    }
    h3 {
      margin: 12px 0 0;
      font: var(--mat-sys-title-small);
    }
    .hint {
      margin: 0;
      font: var(--mat-sys-body-small);
      color: var(--mat-sys-on-surface-variant);
      &.error {
        color: var(--mat-sys-error);
      }
    }
    .listen .on {
      --mat-button-outlined-label-text-color: var(--mat-sys-primary);
    }
    .meters {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .meter {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .channel {
      width: 16px;
      text-align: right;
      font: var(--mat-sys-label-small);
      color: var(--mat-sys-on-surface-variant);
      font-variant-numeric: tabular-nums;
    }
    .bar {
      flex: 1 1 auto;
      height: 6px;
      border-radius: 3px;
      background: var(--mat-sys-surface-container-highest);
      overflow: hidden;
    }
    .fill {
      height: 100%;
      background: var(--mat-sys-tertiary);
      &.clip {
        background: var(--mat-sys-error);
      }
    }
    .latency {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
      font: var(--mat-sys-body-medium);
    }
    .facts {
      width: 100%;
      border-collapse: collapse;
      font: var(--mat-sys-body-medium);
      font-variant-numeric: tabular-nums;
      td {
        padding: 2px 0;
      }
      td:first-child {
        color: var(--mat-sys-on-surface-variant);
        width: 55%;
      }
    }
    .files {
      align-self: flex-start;
      margin-top: 4px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrackInfoPanelComponent {
  protected readonly edits = inject(EditService);
  protected readonly recorder = inject(RecordingService);
  private readonly montages = inject(MontageService);
  private readonly timeline = inject(TimelineService);
  private readonly audioDevices = inject(AudioDevicesService);
  private readonly inputs = inject(TrackInputService);
  private readonly settings = inject(SettingsService);
  private readonly i18n = inject(I18nService);

  protected readonly defaultChannels = DEFAULT_CHANNELS;

  protected readonly track = computed(() => {
    const id = this.timeline.selectedTrackId();
    return this.montages.montage().tracks.find((t) => t.id === id) ?? null;
  });

  /** Only whether there is a track: the monitor is not reopened by every edit of the track. */
  private readonly hasTrack = computed(() => !!this.track());

  /** Connected device of the track input (by id or name), null for the Settings one, undefined when missing. */
  private readonly device = computed(() => {
    const input = this.track()?.input;
    this.audioDevices.inputs();
    return input ? this.inputs.find(input) : null;
  });

  protected readonly missing = computed(() => this.device() === undefined && this.audioDevices.inputs().length > 0);

  protected readonly deviceValue = computed(() => {
    const input = this.track()?.input;
    return input ? (this.device() ?? input.deviceId) : '';
  });

  /** Input devices; the one of the track, when not connected, listed as missing. */
  protected readonly devices = computed(() => {
    const list = this.audioDevices.inputs().map((d) => ({ ...d, missing: false }));
    const input = this.track()?.input;
    if (input && this.device() === undefined) list.push({ id: input.deviceId, label: input.label, missing: list.length > 0 });
    return list;
  });

  protected readonly settingsInput = computed(() => this.settings.audioInput()?.label ?? this.i18n.t('input.default'));

  /** Device actually watched: the one of the track, else the one of the Settings, else the default. */
  private readonly watched = computed(() => {
    const device = this.device();
    return device === null || device === undefined ? (this.settings.audioInput()?.id ?? null) : device;
  });

  /** Channels of the watched device, known once the monitor opens it. */
  protected readonly channelCount = signal(0);
  protected readonly choices = computed(() => channelChoices(this.channelCount()).map(channelsLabel));
  protected readonly channelsValue = computed(() => {
    const channels = this.track()?.input?.channels;
    return channels?.length ? channelsLabel(channels) : DEFAULT_CHANNELS;
  });

  private readonly peaks = signal<number[]>([]);
  /** Peaks held a little, as the meters of the tracks. */
  private held: number[] = [];
  protected readonly monitorError = signal<string | null>(null);
  /** The level meter is on: the input stays open only while asked (Windows shows the microphone in use). */
  protected readonly listening = signal(false);

  /** The meters of the channels the track records (all of them with the default: the first two). */
  protected readonly meters = computed(() => {
    const peaks = this.peaks();
    const own = this.track()?.input?.channels;
    const shown = own?.length ? own : peaks.slice(0, 2).map((_, c) => c);
    return shown
      .filter((c) => c < peaks.length)
      .map((c) => {
        const db = 20 * Math.log10(Math.max(peaks[c], 1e-6));
        return { label: String(c + 1), level: Math.max(0, (db - FLOOR_DB) / -FLOOR_DB), clip: peaks[c] >= 0.99 };
      });
  });

  protected readonly latencyLabel = computed(() => {
    const latency = this.settings.latencyOf(this.watched());
    return latency === undefined ? this.i18n.t('latency.estimated') : this.i18n.t('latency.measured', { ms: Math.round(latency * 1000) });
  });
  protected readonly calibration = signal<{ text: string; failed: boolean } | null>(null);

  protected readonly extent = computed(() => {
    const clips = this.track()?.clips ?? [];
    if (!clips.length) return '—';
    const start = Math.min(...clips.map((c) => c.start));
    const end = Math.max(...clips.map((c) => c.start + this.timeline.clipLength(c)));
    return formatDuration(end - start);
  });

  constructor() {
    if (!this.recorder.available) return;
    void this.audioDevices.refresh();
    // the channels of the device, for the menu (read once, the device is closed at once)
    effect(() => {
      const device = this.watched();
      untracked(() => {
        this.channelCount.set(0);
        InputMonitor.channelsOf(device).then(
          (count) => {
            if (this.watched() === device) this.channelCount.set(count);
          },
          () => undefined,
        );
      });
    });
    // the input is watched while asked and nothing else uses it (recording, measure)
    let monitor: InputMonitor | undefined;
    let frame = 0;
    let generation = 0;
    const stop = () => {
      generation++;
      cancelAnimationFrame(frame);
      monitor?.close();
      monitor = undefined;
      this.peaks.set([]);
    };
    const loop = () => {
      if (!monitor) return;
      const peaks = monitor.peaks();
      this.held = peaks.map((p, c) => Math.max(p, (this.held[c] ?? 0) * 0.9));
      this.peaks.set(this.held);
      frame = requestAnimationFrame(loop);
    };
    effect(() => {
      const device = this.watched();
      const busy = this.recorder.busy();
      const hasTrack = this.hasTrack();
      const listening = this.listening();
      untracked(() => {
        stop();
        this.monitorError.set(null);
        if (busy || !hasTrack || !listening) return;
        const current = generation;
        InputMonitor.open(device).then(
          (opened) => {
            if (current !== generation) return opened.close();
            monitor = opened;
            frame = requestAnimationFrame(loop);
          },
          (err) => {
            if (current === generation) this.monitorError.set(this.i18n.t('record.error', { message: String((err as Error)?.message ?? err) }));
          },
        );
      });
    });
    inject(DestroyRef).onDestroy(stop);
  }

  protected rename(track: Track, input: HTMLInputElement): void {
    if (!input.value.trim()) input.value = track.name;
    else this.edits.renameTrack(track.id, input.value);
  }

  protected setDevice(track: Track, id: string): void {
    const device = this.audioDevices.inputs().find((d) => d.id === id);
    this.edits.setTrackInput(track.id, device ? { deviceId: device.id, label: device.label } : undefined);
    this.calibration.set(null);
  }

  protected setChannels(track: Track, value: string): void {
    const input = track.input;
    if (!input) return;
    const channels = value === DEFAULT_CHANNELS ? undefined : value.split('+').map((c) => Number(c) - 1);
    if (sameChannels(channels, input.channels)) return;
    const { channels: _, ...rest } = input;
    this.edits.setTrackInput(track.id, channels ? { ...rest, channels } : rest);
  }

  protected async calibrate(track: Track): Promise<void> {
    this.calibration.set(null);
    try {
      const input = await this.inputs.resolve(track);
      const latency = await this.recorder.calibrate(input);
      this.calibration.set(
        latency === null
          ? { text: this.i18n.t('latency.failed'), failed: true }
          : { text: this.i18n.t('latency.done', { ms: Math.round(latency * 1000) }), failed: false },
      );
    } catch (err) {
      this.calibration.set({ text: this.i18n.t('record.error', { message: String((err as Error)?.message ?? err) }), failed: true });
    }
  }

  protected stateLabel(track: Track) {
    if (track.muted) return 'trackInfo.muted' as const;
    if (track.solo) return 'trackInfo.solo' as const;
    return 'trackInfo.active' as const;
  }

  protected envelopePoints(track: Track): number {
    return track.clips.reduce((n, c) => n + (c.envelope?.length ?? 0), 0);
  }
}
