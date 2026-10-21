import { isDevMode } from '@angular/core';
import { init } from '@neutralinojs/lib';

// Development only: lets an external browser drive a running instance, using the globals
// script of that instance saved in localStorage (Neutralino injects them only in its window).
const DEV_GLOBALS_KEY = 'edimus.devGlobals';

/** Keys that zoom the web view with Ctrl: + (and =), −, 0, also on the numeric keypad. */
const ZOOM_KEYS = new Set(['Equal', 'Minus', 'Digit0', 'NumpadAdd', 'NumpadSubtract', 'Numpad0']);

/**
 * The window is an app, not a page: the zoom of the web view (pinch on the touchpad, which
 * arrives as Ctrl+wheel, and Ctrl +/−/0) is turned off. The listeners only prevent the default:
 * the zoom of the timeline (Ctrl+wheel on the lanes) still gets the events.
 */
function disableViewZoom(): void {
  document.addEventListener('wheel', (e) => e.ctrlKey && e.preventDefault(), { passive: false });
  document.addEventListener('keydown', (e) => (e.ctrlKey || e.metaKey) && ZOOM_KEYS.has(e.code) && e.preventDefault());
}

/** Connects to the Neutralino runtime, before the app starts. */
export function initNeutralino(): void {
  disableViewZoom();
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
