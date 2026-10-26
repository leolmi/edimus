import { Provider } from '@angular/core';
import { AiHostPort } from '../../app/core/platform/ai-host.port';
import { AudioEnginePort } from '../../app/core/platform/audio-engine.port';
import { DevToolsPort } from '../../app/core/platform/dev-tools.port';
import { FileSystemPort } from '../../app/core/platform/file-system.port';
import { PlatformInfo } from '../../app/core/platform/platform-info';
import { SettingsPort } from '../../app/core/platform/settings.port';
import { ShellPort } from '../../app/core/platform/shell.port';
import { UpdaterPort } from '../../app/core/platform/updater.port';
import { version } from '../../../package.json';
import { WebAiHost } from './web-ai-host';
import { WebAudioEngine } from './web-audio-engine';
import { WebDevTools } from './web-dev-tools';
import { WebFileSystem } from './web-file-system';
import { WebSettings } from './web-settings';
import { WebShell } from './web-shell';
import { WebUpdater } from './web-updater';

const web: PlatformInfo = { kind: 'web', version, canRevealFiles: false, canSetupAi: false, filesBesideSources: false, hasDevTools: false, canRecord: false, canUpdate: false };

/** Web app: everything runs in the browser of the user, files included. */
export const webProviders: Provider[] = [
  { provide: PlatformInfo, useValue: web },
  { provide: FileSystemPort, useClass: WebFileSystem },
  { provide: AudioEnginePort, useClass: WebAudioEngine },
  { provide: SettingsPort, useClass: WebSettings },
  { provide: ShellPort, useClass: WebShell },
  { provide: DevToolsPort, useClass: WebDevTools },
  { provide: AiHostPort, useClass: WebAiHost },
  { provide: UpdaterPort, useClass: WebUpdater },
];
