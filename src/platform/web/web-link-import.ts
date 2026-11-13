import { Injectable } from '@angular/core';
import { LinkImportPort, LinkMedia } from '../../app/core/platform/link-import.port';

const unavailable = () => Promise.reject(new Error('The web app cannot import links (the sites do not allow other pages to read their media)'));

/** No downloader in the browser (PlatformInfo.canImportLinks): the UI hides the command. */
@Injectable()
export class WebLinkImport extends LinkImportPort {
  async toolVersion(): Promise<string | null> {
    return null;
  }

  installTool(): Promise<string> {
    return unavailable();
  }

  info(): Promise<LinkMedia> {
    return unavailable();
  }

  download(): Promise<string> {
    return unavailable();
  }
}
