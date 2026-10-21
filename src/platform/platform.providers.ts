// Providers of the platform the app is built for: this file is the desktop (Neutralino) one,
// the build configurations of the other platforms replace it (fileReplacements in angular.json).
export { initNeutralino as initPlatform } from './neutralino/init';
export { neutralinoProviders as platformProviders } from './neutralino/providers';
