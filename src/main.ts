import { bootstrapApplication } from '@angular/platform-browser';
import { initPlatform } from './platform/platform.providers';
import { appConfig } from './app/app.config';
import { App } from './app/app';

initPlatform();

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
