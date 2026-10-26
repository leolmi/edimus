import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';
import type { AudioDevice } from './audio/audio-devices.service';
import type { BridgeConfig } from './platform/ai-host.port';
import { SettingsPort } from './platform/settings.port';

export type ThemeMode = 'light' | 'dark' | 'system';
export type Language = 'it' | 'en';
/** Step of a clip dragged on the beat grid: a whole bar, a beat (quarter note) or half a beat (eighth). */
export type SnapStep = 'bar' | 'beat' | 'half';

interface Settings {
  theme: ThemeMode;
  language: Language;
  /** Listening volume of the playback (0–1); the export is not affected. */
  volume: number;
  muted: boolean;
  /** Output device of the playback (id and name), null = system default. */
  audioOutput: AudioDevice | null;
  /** Input device of the recording (id and name), null = system default. */
  audioInput: AudioDevice | null;
  /** Measured round-trip latency (s) of the recording, by input and output (see `latencyKey`). */
  recordingLatency: Record<string, number>;
  snapStep: SnapStep;
  /** Opens the developer tools of the window at startup. */
  devTools: boolean;
  /** Saves the bar map of a source in its bar file at every change (only where files beside the sources can be written). */
  autoSaveBars: boolean;
  /** Address of the MCP server set by hand (web app: the page cannot read it from the PC). */
  aiBridge: BridgeConfig | null;
  /** Looks for a newer version at startup (where the app can update itself). */
  checkUpdates: boolean;
  /** GitHub repository ("owner/name") whose releases update the app. */
  updateRepo: string;
  /** Version the user chose not to install: not offered again at startup. */
  skippedVersion: string | null;
}

/** Repository of the app, where its releases are published. */
export const DEFAULT_UPDATE_REPO = 'leolmi/edimus';

const STORAGE_KEY = 'settings';
const DEFAULTS: Settings = {
  theme: 'system',
  language: 'it',
  volume: 1,
  muted: false,
  audioOutput: null,
  audioInput: null,
  recordingLatency: {},
  snapStep: 'beat',
  autoSaveBars: false,
  devTools: false,
  aiBridge: null,
  checkUpdates: true,
  updateRepo: DEFAULT_UPDATE_REPO,
  skippedVersion: null,
};

/** User preferences (theme, language, listening volume and output), persisted by the platform (`SettingsPort`). */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly document = inject(DOCUMENT);
  private readonly store = inject(SettingsPort);

  readonly theme = signal<ThemeMode>(DEFAULTS.theme);
  readonly language = signal<Language>(DEFAULTS.language);
  readonly volume = signal(DEFAULTS.volume);
  readonly muted = signal(DEFAULTS.muted);
  readonly audioOutput = signal<AudioDevice | null>(DEFAULTS.audioOutput);
  readonly audioInput = signal<AudioDevice | null>(DEFAULTS.audioInput);
  readonly recordingLatency = signal<Record<string, number>>(DEFAULTS.recordingLatency);
  readonly snapStep = signal<SnapStep>(DEFAULTS.snapStep);
  readonly autoSaveBars = signal(DEFAULTS.autoSaveBars);
  readonly devTools = signal(DEFAULTS.devTools);
  readonly aiBridge = signal<BridgeConfig | null>(DEFAULTS.aiBridge);
  readonly checkUpdates = signal(DEFAULTS.checkUpdates);
  readonly updateRepo = signal(DEFAULTS.updateRepo);
  readonly skippedVersion = signal<string | null>(DEFAULTS.skippedVersion);

  constructor() {
    effect(() => {
      const root = this.document.documentElement;
      root.classList.toggle('theme-light', this.theme() === 'light');
      root.classList.toggle('theme-dark', this.theme() === 'dark');
    });
    effect(() => {
      this.document.documentElement.lang = this.language();
    });
  }

  async load(): Promise<void> {
    try {
      const saved = JSON.parse((await this.store.read(STORAGE_KEY)) ?? '{}') as Partial<Settings>;
      if (saved.theme) this.theme.set(saved.theme);
      if (saved.language) this.language.set(saved.language);
      if (typeof saved.volume === 'number') this.volume.set(saved.volume);
      if (typeof saved.muted === 'boolean') this.muted.set(saved.muted);
      if (saved.audioOutput?.id) this.audioOutput.set(saved.audioOutput);
      if (saved.audioInput?.id) this.audioInput.set(saved.audioInput);
      if (saved.recordingLatency && typeof saved.recordingLatency === 'object') this.recordingLatency.set(saved.recordingLatency);
      if (saved.snapStep === 'bar' || saved.snapStep === 'beat' || saved.snapStep === 'half') this.snapStep.set(saved.snapStep);
      if (typeof saved.autoSaveBars === 'boolean') this.autoSaveBars.set(saved.autoSaveBars);
      if (typeof saved.devTools === 'boolean') this.devTools.set(saved.devTools);
      if (saved.aiBridge?.port && saved.aiBridge.token) this.aiBridge.set(saved.aiBridge);
      if (typeof saved.checkUpdates === 'boolean') this.checkUpdates.set(saved.checkUpdates);
      if (typeof saved.updateRepo === 'string' && saved.updateRepo) this.updateRepo.set(saved.updateRepo);
      if (typeof saved.skippedVersion === 'string') this.skippedVersion.set(saved.skippedVersion);
    } catch {
      // no saved settings yet (or storage unavailable): keep defaults
    }
  }

  setTheme(theme: ThemeMode): void {
    this.theme.set(theme);
    void this.save();
  }

  setLanguage(language: Language): void {
    this.language.set(language);
    void this.save();
  }

  /** Sets the listening volume; `persist` false while dragging the slider (saved on release). */
  setVolume(volume: number, persist = true): void {
    this.volume.set(Math.min(1, Math.max(0, volume)));
    this.muted.set(false);
    if (persist) void this.save();
  }

  toggleMuted(): void {
    this.muted.update((muted) => !muted);
    void this.save();
  }

  setAudioOutput(output: AudioDevice | null): void {
    this.audioOutput.set(output);
    void this.save();
  }

  setAudioInput(input: AudioDevice | null): void {
    this.audioInput.set(input);
    void this.save();
  }

  /** Round-trip latency measured for the chosen input and output, undefined when never measured. */
  currentLatency(): number | undefined {
    return this.recordingLatency()[this.latencyKey()];
  }

  /** Saves (or, with null, forgets) the latency of the chosen input and output. */
  setCurrentLatency(seconds: number | null): void {
    const key = this.latencyKey();
    this.recordingLatency.update(({ [key]: _, ...others }) => (seconds === null ? others : { ...others, [key]: seconds }));
    void this.save();
  }

  /** The latency depends on both devices (and on their drivers). */
  private latencyKey(): string {
    return `${this.audioInput()?.id ?? ''}>${this.audioOutput()?.id ?? ''}`;
  }

  setSnapStep(step: SnapStep): void {
    this.snapStep.set(step);
    void this.save();
  }

  setAutoSaveBars(on: boolean): void {
    this.autoSaveBars.set(on);
    void this.save();
  }

  setDevTools(open: boolean): void {
    this.devTools.set(open);
    void this.save();
  }

  setAiBridge(config: BridgeConfig | null): void {
    this.aiBridge.set(config);
    void this.save();
  }

  setCheckUpdates(on: boolean): void {
    this.checkUpdates.set(on);
    void this.save();
  }

  /** Sets the update repository ("owner/name"); empty goes back to the default one. */
  setUpdateRepo(repo: string): void {
    this.updateRepo.set(repo.trim() || DEFAULT_UPDATE_REPO);
    void this.save();
  }

  setSkippedVersion(version: string | null): void {
    this.skippedVersion.set(version);
    void this.save();
  }

  private async save(): Promise<void> {
    const data: Settings = {
      theme: this.theme(),
      language: this.language(),
      volume: this.volume(),
      muted: this.muted(),
      audioOutput: this.audioOutput(),
      audioInput: this.audioInput(),
      recordingLatency: this.recordingLatency(),
      snapStep: this.snapStep(),
      autoSaveBars: this.autoSaveBars(),
      devTools: this.devTools(),
      aiBridge: this.aiBridge(),
      checkUpdates: this.checkUpdates(),
      updateRepo: this.updateRepo(),
      skippedVersion: this.skippedVersion(),
    };
    try {
      await this.store.write(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.error('Unable to save settings', err);
    }
  }
}
