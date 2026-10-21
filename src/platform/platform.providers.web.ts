// Providers of the web build: replaces platform.providers.ts (fileReplacements in angular.json).
export { webProviders as platformProviders } from './web/providers';

export function initPlatform(): void {
  // nothing to connect to: the browser APIs are always there
}
