import { Injectable, effect, inject, untracked } from '@angular/core';
import { DocumentService } from '../document.service';
import { I18nService } from '../i18n/i18n.service';
import { fileFingerprint } from '../montage/fingerprint';
import { fileName } from '../montage/montage.model';
import { MontageService } from '../montage/montage.service';
import { FileSystemPort } from '../platform/file-system.port';
import { PlatformInfo } from '../platform/platform-info';
import { ShellPort } from '../platform/shell.port';
import { SettingsService } from '../settings.service';
import { TimelineService } from '../timeline/timeline.service';
import { BARS_EXTENSION, barFilePath, readBarFile, writeBarFile } from './bar-file';
import type { Tempo } from './tempo';
import { TempoService } from './tempo.service';

/** Pause (ms) after the last change of a tempo before it is saved automatically (a drag changes it at every move). */
const AUTO_SAVE_DELAY = 1000;

/**
 * Bar files of the sources (`song.mp3.edimusbars`): the tempo of an audio file with its bar
 * map, to use it again in other montages. On the desktop they are next to the audio (saved
 * there, and read by themselves on opening, see TempoService), optionally saved at every change;
 * in the browser they are saved and opened through the dialogs.
 */
@Injectable({ providedIn: 'root' })
export class BarFileService {
  private readonly montages = inject(MontageService);
  private readonly tempos = inject(TempoService);
  private readonly files = inject(FileSystemPort);
  private readonly platform = inject(PlatformInfo);
  private readonly settings = inject(SettingsService);
  private readonly shell = inject(ShellPort);
  private readonly i18n = inject(I18nService);
  private readonly documents = inject(DocumentService);
  private readonly timeline = inject(TimelineService);

  private readonly filters = [{ name: 'edimus bars', extensions: [BARS_EXTENSION] }];
  /** Tempo of each source at the last look, to save only those that change. */
  private seen = new Map<string, Tempo | undefined>();
  private generation = -1;
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor() {
    effect(() => {
      const generation = this.montages.generation();
      const sources = this.montages.montage().sources;
      const auto = this.settings.autoSaveBars() && this.platform.filesBesideSources;
      untracked(() => {
        // a montage opened: its tempos are not changes
        if (generation !== this.generation) {
          this.generation = generation;
          this.seen = new Map(sources.map((s) => [s.id, s.tempo]));
          return;
        }
        for (const source of sources) {
          const known = this.seen.has(source.id);
          if (known && this.seen.get(source.id) === source.tempo) continue;
          this.seen.set(source.id, source.tempo);
          // a source just added has no change to save
          if (!auto || !known || !source.tempo) continue;
          clearTimeout(this.timers.get(source.id));
          this.timers.set(
            source.id,
            setTimeout(() => void this.save(source.id, true).catch((err) => console.error('Unable to save the bar file', err)), AUTO_SAVE_DELAY),
          );
        }
      });
    });
  }

  /**
   * Saves the tempo of a source in its bar file: next to the audio on the desktop, where the
   * user chooses in the browser. Returns the path, undefined when cancelled or with no tempo.
   */
  async save(sourceId: string, quiet = false): Promise<string | undefined> {
    const source = this.montages.montage().sources.find((s) => s.id === sourceId);
    const tempo = this.tempos.sourceTempo(sourceId);
    if (!source || !tempo) return undefined;
    const path = this.platform.filesBesideSources
      ? barFilePath(source.path)
      : await this.files.showSaveDialog(this.i18n.t('bars.saveTitle'), this.filters, barFilePath(fileName(source.path)));
    if (!path) return undefined;
    const fingerprint = (await fileFingerprint(this.files, source.path)) ?? source.fingerprint;
    try {
      await this.files.writeText(path, writeBarFile(fileName(source.path), { fingerprint, tempo }));
    } catch (err) {
      if (quiet) throw err;
      this.documents.notify({ key: 'bars.saveError', params: { message: String((err as Error)?.message ?? err) } });
      return undefined;
    }
    if (!quiet) this.documents.notify({ key: 'bars.saved', params: { path } });
    return path;
  }

  /**
   * Gives a source the tempo of a bar file (as set by hand): the one next to the audio on the
   * desktop, otherwise one chosen by the user. A file of another audio is used only if the user
   * agrees (`force` skips the question). Returns the path loaded, undefined when nothing was.
   */
  async load(sourceId: string, force = false): Promise<string | undefined> {
    const source = this.montages.montage().sources.find((s) => s.id === sourceId);
    if (!source) return undefined;
    const beside = barFilePath(source.path);
    const path =
      this.platform.filesBesideSources && (await this.files.exists(beside))
        ? beside
        : (await this.files.showOpenDialog(this.i18n.t('bars.openTitle'), this.filters))[0];
    if (!path) return undefined;
    try {
      const file = readBarFile(await this.files.readText(path));
      const fingerprint = await fileFingerprint(this.files, source.path);
      if (!force && file.fingerprint && fingerprint && file.fingerprint !== fingerprint) {
        const answer = await this.shell.ask(this.i18n.t('bars.openTitle'), this.i18n.t('bars.otherAudio', { name: fileName(source.path) }));
        if (answer !== 'yes') return undefined;
      }
      this.montages.setSourceTempo(sourceId, file.tempo);
      this.timeline.beatGrid.set(true);
      this.documents.notify({ key: 'bars.loaded', params: { path } });
      return path;
    } catch (err) {
      this.documents.notify({ key: 'bars.openError', params: { message: String((err as Error)?.message ?? err) } });
      return undefined;
    }
  }
}
