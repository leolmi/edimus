import { Injectable } from '@angular/core';
import { SettingsPort } from '../../app/core/platform/settings.port';

@Injectable()
export class WebSettings extends SettingsPort {
  async read(key: string): Promise<string | null> {
    try {
      return localStorage.getItem(key);
    } catch {
      // storage blocked (private window, site data disabled): defaults
      return null;
    }
  }

  async write(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  }
}
