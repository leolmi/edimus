import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { DevToolsService } from './core/dev-tools.service';
import { SettingsService } from './core/settings.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideAppInitializer(() => {
      inject(MatIconRegistry).setDefaultFontSetClass('material-symbols-outlined');
      const devTools = inject(DevToolsService);
      return inject(SettingsService)
        .load()
        .then(() => devTools.startupCheck());
    }),
  ],
};
