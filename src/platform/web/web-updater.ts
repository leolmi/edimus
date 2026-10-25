import { Injectable } from '@angular/core';
import { AppRelease, InstalledUpdate, UpdaterPort } from '../../app/core/platform/updater.port';

/** The page is always the published one: nothing to install. */
@Injectable()
export class WebUpdater extends UpdaterPort {
  async latest(): Promise<AppRelease | null> {
    return null;
  }

  async blocker(): Promise<null> {
    return null;
  }

  async otherInstances(): Promise<number> {
    return 0;
  }

  install(): Promise<void> {
    return Promise.reject(new Error('The web app is not installed'));
  }

  async finish(): Promise<InstalledUpdate | null> {
    return null;
  }
}
