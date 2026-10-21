/** Persistent storage of the app settings, as strings by key. */
export abstract class SettingsPort {
  /** Saved value, null when there is none. */
  abstract read(key: string): Promise<string | null>;
  abstract write(key: string, value: string): Promise<void>;
}
