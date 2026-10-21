import { Injectable } from '@angular/core';
import { storage } from '@neutralinojs/lib';
import { SettingsPort } from '../../app/core/platform/settings.port';

@Injectable()
export class NeutralinoSettings extends SettingsPort {
  read(key: string): Promise<string | null> {
    // getData fails when the key was never saved
    return storage.getData(key).catch(() => null);
  }

  async write(key: string, value: string): Promise<void> {
    await storage.setData(key, value);
  }
}
