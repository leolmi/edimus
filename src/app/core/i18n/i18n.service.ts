import { Injectable, inject } from '@angular/core';
import { SettingsService } from '../settings.service';
import { en } from './en';
import { it, type TranslationKey } from './it';

const DICTIONARIES = { it, en } as const;

/** Runtime translations driven by the language setting. */
@Injectable({ providedIn: 'root' })
export class I18nService {
  private readonly settings = inject(SettingsService);

  /** Translates a key, replacing `{name}` placeholders with the given params. */
  t(key: TranslationKey, params?: Record<string, string | number>): string {
    let text: string = DICTIONARIES[this.settings.language()][key] ?? key;
    for (const [name, value] of Object.entries(params ?? {})) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
    return text;
  }
}
