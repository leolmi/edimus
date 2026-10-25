import { Provider } from '@angular/core';
import { AiHostPort } from '../../app/core/platform/ai-host.port';
import { AudioEnginePort } from '../../app/core/platform/audio-engine.port';
import { DevToolsPort } from '../../app/core/platform/dev-tools.port';
import { FileSystemPort } from '../../app/core/platform/file-system.port';
import { PlatformInfo } from '../../app/core/platform/platform-info';
import { SettingsPort } from '../../app/core/platform/settings.port';
import { ShellPort } from '../../app/core/platform/shell.port';
import { UpdaterPort } from '../../app/core/platform/updater.port';
import { NeutralinoAiHost } from './neutralino-ai-host';
import { NeutralinoAudioEngine } from './neutralino-audio-engine';
import { NeutralinoDevTools } from './neutralino-dev-tools';
import { NeutralinoFileSystem } from './neutralino-file-system';
import { NeutralinoSettings } from './neutralino-settings';
import { NeutralinoShell } from './neutralino-shell';
import { NeutralinoUpdater } from './neutralino-updater';

// a factory: the globals of Neutralino are there only after initPlatform()
const desktop = (): PlatformInfo => ({
  kind: 'desktop',
  version: window.NL_APPVERSION ?? '',
  runtime: `Neutralinojs ${window.NL_VERSION ?? ''}`,
  canRevealFiles: true,
  canSetupAi: true,
  filesBesideSources: true,
  hasDevTools: true,
  canUpdate: window.NL_OS === 'Windows',
});

/** Desktop app: Neutralino window with access to the file system and to the processes. */
export const neutralinoProviders: Provider[] = [
  { provide: PlatformInfo, useFactory: desktop },
  { provide: FileSystemPort, useClass: NeutralinoFileSystem },
  { provide: AudioEnginePort, useClass: NeutralinoAudioEngine },
  { provide: SettingsPort, useClass: NeutralinoSettings },
  { provide: ShellPort, useClass: NeutralinoShell },
  { provide: DevToolsPort, useClass: NeutralinoDevTools },
  { provide: AiHostPort, useClass: NeutralinoAiHost },
  { provide: UpdaterPort, useClass: NeutralinoUpdater },
];
