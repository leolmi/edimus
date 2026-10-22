import { Injectable, inject } from '@angular/core';
import {
  AiClient,
  AiHostPort,
  BridgeConfig,
  ServerCommand,
  SetupResult,
} from '../../app/core/platform/ai-host.port';
import { SettingsService } from '../../app/core/settings.service';

const unavailable = () => Promise.reject(new Error('The AI clients cannot be configured from the browser'));

/** The page cannot look into the PC: the MCP server is reached at the address set by the user. */
@Injectable()
export class WebAiHost extends AiHostPort {
  private readonly settings = inject(SettingsService);

  readonly pid = undefined;

  async bridgeConfigs(): Promise<BridgeConfig[]> {
    const config = this.settings.aiBridge();
    return config ? [config] : [];
  }

  async serverCommand(): Promise<ServerCommand | null> {
    return null;
  }

  detect(): Promise<AiClient[]> {
    return unavailable();
  }

  configure(): Promise<SetupResult[]> {
    return unavailable();
  }
}
