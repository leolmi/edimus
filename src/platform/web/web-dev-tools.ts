import { Injectable } from '@angular/core';
import { DevToolsPort } from '../../app/core/platform/dev-tools.port';

/** The developer tools are those of the browser: nothing to turn on. */
@Injectable()
export class WebDevTools extends DevToolsPort {
  readonly active = false;

  async startupCheck(): Promise<void> {
    // nothing to do
  }

  async relaunch(): Promise<void> {
    // nothing to do
  }
}
