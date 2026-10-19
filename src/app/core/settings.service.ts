import { DOCUMENT, Injectable, effect, inject, signal } from '@angular/core';
import { storage } from '@neutralinojs/lib';

export type ThemeMode = 'light' | 'dark' | 'system';
export type Language = 'it' | 'en';

interface Settings {
  theme: ThemeMode;
  language: Language;
  /** Listening volume of the playback (0–1); the export is not affected. */
  volume: number;
  muted: boolean;
}

const STORAGE_KEY = 'settings';
const DEFAULTS: Settings = { theme: 'system', language: 'it', volume: 1, muted: false };

/** User preferences (theme, language, listening volume), persisted with the Neutralino storage API. */
@Injectable({ providedIn: 'root' })
export class SettingsService {
  private readonly document = inject(DOCUMENT);

  readonly theme = signal<ThemeMode>(DEFAULTS.theme);
  readonly language = signal<Language>(DEFAULTS.language);
  readonly volume = signal(DEFAULTS.volume);
  readonly muted = signal(DEFAULTS.muted);

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
      const saved = JSON.parse(await storage.getData(STORAGE_KEY)) as Partial<Settings>;
      if (saved.theme) this.theme.set(saved.theme);
      if (saved.language) this.language.set(saved.language);
      if (typeof saved.volume === 'number') this.volume.set(saved.volume);
      if (typeof saved.muted === 'boolean') this.muted.set(saved.muted);
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

  private async save(): Promise<void> {
    const data: Settings = { theme: this.theme(), language: this.language(), volume: this.volume(), muted: this.muted() };
    try {
      await storage.setData(STORAGE_KEY, JSON.stringify(data));
    } catch (err) {
      console.error('Unable to save settings', err);
    }
  }
}
