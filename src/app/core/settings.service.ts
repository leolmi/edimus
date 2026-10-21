import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';
import type { AudioOutput } from './audio/audio-outputs.service';
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
  audioOutput: AudioOutput | null;
  snapStep: SnapStep;
  /** Opens the developer tools of the window at startup. */
  devTools: boolean;
  /** Address of the MCP server set by hand (web app: the page cannot read it from the PC). */
  aiBridge: BridgeConfig | null;
}

const STORAGE_KEY = 'settings';
const DEFAULTS: Settings = { theme: 'system', language: 'it', volume: 1, muted: false, audioOutput: null, snapStep: 'beat', devTools: false, aiBridge: null };

/** User preferences (theme, language, listening volume and output), persisted by the platform (`SettingsPort`). */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly document = inject(DOCUMENT);
  private readonly store = inject(SettingsPort);

  readonly theme = signal<ThemeMode>(DEFAULTS.theme);
  readonly language = signal<Language>(DEFAULTS.language);
  readonly volume = signal(DEFAULTS.volume);
  readonly muted = signal(DEFAULTS.muted);
  readonly audioOutput = signal<AudioOutput | null>(DEFAULTS.audioOutput);
  readonly snapStep = signal<SnapStep>(DEFAULTS.snapStep);
  readonly devTools = signal(DEFAULTS.devTools);
  readonly aiBridge = signal<BridgeConfig | null>(DEFAULTS.aiBridge);

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
      if (saved.snapStep === 'bar' || saved.snapStep === 'beat' || saved.snapStep === 'half') this.snapStep.set(saved.snapStep);
      if (typeof saved.devTools === 'boolean') this.devTools.set(saved.devTools);
      if (saved.aiBridge?.port && saved.aiBridge.token) this.aiBridge.set(saved.aiBridge);
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

  setAudioOutput(output: AudioOutput | null): void {
    this.audioOutput.set(output);
    void this.save();
  }

  setSnapStep(step: SnapStep): void {
    this.snapStep.set(step);
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

  private async save(): Promise<void> {
    const data: Settings = {
      theme: this.theme(),
      language: this.language(),
      volume: this.volume(),
      muted: this.muted(),
      audioOutput: this.audioOutput(),
      snapStep: this.snapStep(),
      devTools: this.devTools(),
      aiBridge: this.aiBridge(),
    };
    try {
      await this.store.write(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.error('Unable to save settings', err);
    }
  }
}
