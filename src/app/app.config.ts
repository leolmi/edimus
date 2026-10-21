import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { platformProviders } from '../platform/platform.providers';
import { DevToolsPort } from './core/platform/dev-tools.port';
import { SettingsService } from './core/settings.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    ...platformProviders,
    provideAppInitializer(() => {
      inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-outlined');
      const devTools = inject(DevToolsPort);
      return inject(SettingsService)
        .load()
        .then(() => devTools.startupCheck());
    }),
  ],
};
