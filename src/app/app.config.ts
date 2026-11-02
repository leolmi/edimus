import { ApplicationConfig, inject, provideAppInitializer, provideBrowserGlobalErrorListeners } from '@angular/core';
import { MatIconRegistry } from '@angular/material/icon';
import { DomSanitizer } from '@angular/platform-browser';
import { platformProviders } from '../platform/platform.providers';
import { appIcons } from './app-icons';
import { DevToolsPort } from './core/platform/dev-tools.port';
import { SettingsService } from './core/settings.service';

export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    ...platformProviders,
    provideAppInitializer(() => {
      const icons = inject(MatIconRegistry);
      const sanitizer = inject(DomSanitizer);
      icons.setDefaultFontSetClass('material-symbols-outlined');
      for (const [name, svg] of Object.entries(appIcons)) icons.addSvgIconLiteral(name, sanitizer.bypassSecurityTrustHtml(svg));
      const devTools = inject(DevToolsPort);
      return inject(SettingsService)
        .load()
        .then(() => devTools.startupCheck());
    }),
  ],
};
