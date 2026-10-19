import { isDevMode } from '@angular/core';
import { bootstrapApplication } from '@angular/platform-browser';
import { init } from '@neutralinojs/lib';
import { appConfig } from './app/app.config';
import { App } from './app/app';

// Development only: lets an external browser drive a running instance, using the globals
// script of that instance saved in localStorage (Neutralino injects them only in its window).
const DEV_GLOBALS_KEY = 'edimus.devGlobals';
if (isDevMode() && !window.NL_PORT) {
  const globals = localStorage.getItem(DEV_GLOBALS_KEY);
  if (globals) {
    const script = document.createElement('script');
    script.textContent = globals;
    document.head.appendChild(script);
  }
}

init();

bootstrapApplication(App, appConfig).catch((err) => console.error(err));
