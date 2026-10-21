import { isDevMode } from '@angular/core';
import { init } from '@neutralinojs/lib';

// Development only: lets an external browser drive a running instance, using the globals
// script of that instance saved in localStorage (Neutralino injects them only in its window).
const DEV_GLOBALS_KEY = 'edimus.devGlobals';

/** Connects to the Neutralino runtime, before the app starts. */
export function initNeutralino(): void {
  if (isDevMode() && !window.NL_PORT) {
    const globals = localStorage.getItem(DEV_GLOBALS_KEY);
    if (globals) {
      const script = document.createElement('script');
      script.textContent = globals;
      document.head.appendChild(script);
    }
  }
  init();
}
