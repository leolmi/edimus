import { Injectable, computed, effect, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { app, events, filesystem, os, window as appWindow, type Icon, type MessageBoxChoice } from '@neutralinojs/lib';
import { firstValueFrom } from 'rxjs';
import { ExportDialogComponent, FORMATS } from '../features/export/export-dialog.component';
import { RenameDialogComponent, RenameDialogData } from '../features/rename/rename-dialog.component';
import { ExportOptions, ExportService } from './audio/export.service';
import { AudioDecoderService } from './audio/audio-decoder.service';
import { MixService } from './audio/mix.service';
import { DevToolsService } from './dev-tools.service';
import { DropTarget, DropTargetService } from './drop-target.service';
import { resolveDroppedFiles } from './dropped-files';
import { TimelineService } from './timeline/timeline.service';
import { I18nService } from './i18n/i18n.service';
import type { TranslationKey } from './i18n/it';
import { InstanceService } from './instance.service';
import { AUDIO_EXTENSIONS, MONTAGE_EXTENSION, baseName, dirName, isMontageFile } from './montage/montage.model';
import { MontageService } from './montage/montage.service';
import { SettingsService } from './settings.service';

interface StatusMessage {
  key: TranslationKey;
  params?: Record<string, string | number>;
}

const errorMessage = (err: unknown) => String((err as { message?: string })?.message ?? err);

/** Document commands of the instance: reset, open, save, close (with the unsaved changes check). */
@Injectable({ providedIn: 'root' })
export class DocumentService {
  private readonly montages = inject(MontageService);
  private readonly instances = inject(InstanceService);
  private readonly i18n = inject(I18nService);
  private readonly dialogs = inject(MatDialog);
  private readonly exporter = inject(ExportService);
  private readonly mixer = inject(MixService);
  private readonly drops = inject(DropTargetService);
  private readonly decoder = inject(AudioDecoderService);
  private readonly timeline = inject(TimelineService);
  private readonly devTools = inject(DevToolsService);
  private readonly settings = inject(SettingsService);
  /** Options of the last export, proposed again by the next one. */
  private exportOptions?: ExportOptions;

  private readonly message = signal<StatusMessage>({ key: 'app.ready' });
  readonly status = computed(() => this.i18n.t(this.message().key, this.message().params));
  readonly title = computed(() => this.montages.displayName() ?? this.i18n.t('montage.new'));
  /** Where dropped files are going, from the drop until they are on the montage (their tracks then show the decoding). */
  readonly pendingDrop = signal<DropTarget | null>(null);

  constructor() {
    effect(() => void appWindow.setTitle(`${this.title()}${this.montages.dirty() ? ' •' : ''} — edimus`));
    events.on('windowClose', () => void this.close());
    this.drops.drops.subscribe(async ({ files, target }) => {
      this.pendingDrop.set(target);
      try {
        const { paths, imported } = await resolveDroppedFiles(files);
        await this.open(paths, target);
        if (imported) this.message.set({ key: 'drop.imported', params: { n: imported } });
      } finally {
        this.pendingDrop.set(null);
      }
    });
    const startup = this.instances.startupFiles();
    if (startup.length) void this.open(startup);
  }

  /** Resets to a new, empty montage (asking about unsaved changes), releasing the decoded audio. */
  async reset(): Promise<void> {
    if (this.montages.pristine() || !(await this.confirmDiscard())) return;
    this.montages.reset();
    this.message.set({ key: 'montage.reset' });
  }

  async openDialog(): Promise<void> {
    const paths = await os.showOpenDialog(this.i18n.t('dialog.open.title'), {
      multiSelections: true,
      filters: [
        { name: this.i18n.t('filter.supported'), extensions: [...AUDIO_EXTENSIONS, MONTAGE_EXTENSION] },
        { name: this.i18n.t('filter.audio'), extensions: AUDIO_EXTENSIONS },
        { name: this.i18n.t('filter.montage'), extensions: [MONTAGE_EXTENSION] },
        { name: this.i18n.t('filter.all'), extensions: ['*'] },
      ],
    });
    await this.open(paths);
  }

  /**
   * Opens files (from the dialog, a drop or the command line): a montage file replaces the
   * current montage (asking about unsaved changes), audio files are added to it: as new tracks,
   * or in sequence on the track they were dropped on, from the time under the pointer.
   */
  async open(paths: string[], target: DropTarget = { kind: 'new' }): Promise<void> {
    if (!paths.length) return;
    const montagePath = paths.find(isMontageFile);
    if (montagePath) {
      if (!this.montages.pristine() && !(await this.confirmDiscard())) return;
      try {
        await this.montages.openMontage(montagePath);
        return this.message.set({ key: 'open.montage', params: { path: montagePath } });
      } catch (err) {
        return this.message.set({ key: 'open.error', params: { message: errorMessage(err) } });
      }
    }
    if (target.kind === 'track') {
      const start = Math.max(0, this.timeline.xToTime(target.x));
      const lengths = await Promise.all(paths.map((p) => this.decoder.probe(p).then((i) => i.duration, () => 0)));
      const count = this.montages.addAudioToTrack(target.trackId, paths, start, lengths);
      if (count) return this.message.set({ key: 'add.toTrack', params: { n: count } });
    }
    const count = this.montages.addAudio(paths);
    this.message.set(count ? { key: 'add.done', params: { n: count } } : { key: 'open.unsupported' });
  }

  /** Saves over the montage file, or asks where when it was never saved. Returns false if not saved. */
  /**
   * Saves over the montage file, renaming it first when a new name was chosen. The first save
   * asks the name (unless already chosen) and then where to save.
   */
  async save(): Promise<boolean> {
    const path = this.montages.path();
    if (!path) {
      if (!this.montages.pendingName()) {
        const name = await this.askName(true);
        if (!name) return false;
        this.montages.rename(name);
      }
      return this.saveAs();
    }
    const pending = this.montages.pendingName();
    if (!pending) return this.write(path);
    const renamed = `${dirName(path)}/${pending}.${MONTAGE_EXTENSION}`;
    const taken = await filesystem.getStats(renamed).then(() => true, () => false);
    if (taken && renamed.toLowerCase() !== path.toLowerCase()) {
      this.message.set({ key: 'rename.exists', params: { path: renamed } });
      return false;
    }
    try {
      await filesystem.move(path, renamed);
    } catch (err) {
      this.message.set({ key: 'save.error', params: { message: errorMessage(err) } });
      return false;
    }
    return this.write(renamed);
  }

  /** Rename dialog (click on the title): the new name is applied to the file by the next save. */
  async rename(): Promise<void> {
    const name = await this.askName(false);
    if (name) this.montages.rename(name);
  }

  private async askName(firstSave: boolean): Promise<string | undefined> {
    const firstSource = this.montages.montage().sources[0]?.path;
    const name = this.montages.displayName() ?? (firstSource ? baseName(firstSource) : this.i18n.t('montage.new'));
    const ref = this.dialogs.open<RenameDialogComponent, RenameDialogData, string>(RenameDialogComponent, {
      data: { name, firstSave },
    });
    return firstValueFrom(ref.afterClosed());
  }

  async saveAs(): Promise<boolean> {
    const current = this.montages.path();
    const firstSource = this.montages.montage().sources[0]?.path;
    const name = this.montages.displayName() ?? (firstSource ? baseName(firstSource) : undefined);
    const folder = current ? dirName(current) : firstSource ? dirName(firstSource) : undefined;
    const defaultPath = folder && name ? `${folder}/${name}.${MONTAGE_EXTENSION}` : (current ?? undefined);
    const path = await os.showSaveDialog(this.i18n.t('dialog.save.title'), {
      defaultPath,
      filters: [{ name: this.i18n.t('filter.montage'), extensions: [MONTAGE_EXTENSION] }],
    });
    return path ? this.write(path) : false;
  }

  /** Mixdown: asks format and quality, then where to save the file. */
  async exportDialog(): Promise<void> {
    if (this.montages.isEmpty() || this.exporter.progress()) return;
    if (!this.mixer.isComplete()) return this.message.set({ key: 'export.notReady' });
    const initial: ExportOptions = this.exportOptions ?? {
      format: 'mp3',
      channels: this.montages.montage().channels,
      sampleRate: this.mixer.sampleRate(),
      bitDepth: 16,
      bitrate: 192,
      quality: 6,
      normalize: false,
    };
    const ref = this.dialogs.open(ExportDialogComponent, { data: initial, autoFocus: 'dialog' });
    const options = await firstValueFrom(ref.afterClosed());
    if (!options) return;
    this.exportOptions = options;

    const format = FORMATS.find((f) => f.id === options.format)!;
    const base = this.montages.path() ?? this.montages.montage().sources[0]?.path;
    const defaultPath = base ? `${dirName(base)}/${this.montages.fileName() ?? baseName(base)}.${format.extension}` : undefined;
    let path = await os.showSaveDialog(this.i18n.t('export.title'), {
      defaultPath,
      filters: [{ name: format.label, extensions: [format.extension] }],
    });
    if (!path) return;
    if (!path.toLowerCase().endsWith(`.${format.extension}`)) path = `${path}.${format.extension}`;
    try {
      await this.exporter.export(path, options);
      this.message.set({ key: 'export.done', params: { path } });
    } catch (err) {
      this.message.set({ key: 'export.error', params: { message: errorMessage(err) } });
    }
  }

  /** Closes the window, asking what to do with unsaved changes. */
  async close(): Promise<void> {
    if (await this.confirmDiscard()) await app.exit();
  }

  /** Restarts the app (asking about unsaved changes) with the developer tools as set. */
  async restartForDevTools(): Promise<void> {
    if (await this.confirmDiscard()) await this.devTools.relaunch(this.settings.devTools());
  }

  /** With unsaved changes asks whether to save them; false when the user cancels (or saving fails). */
  private async confirmDiscard(): Promise<boolean> {
    if (!this.montages.dirty()) return true;
    const choice = await os.showMessageBox(
      this.title(),
      this.i18n.t('montage.unsaved'),
      'YES_NO_CANCEL' as MessageBoxChoice,
      'QUESTION' as Icon,
    );
    if (choice === 'CANCEL') return false;
    return choice === 'NO' || this.save();
  }

  private async write(path: string): Promise<boolean> {
    try {
      const saved = await this.montages.saveAs(path);
      this.message.set({ key: 'save.done', params: { path: saved } });
      return true;
    } catch (err) {
      this.message.set({ key: 'save.error', params: { message: errorMessage(err) } });
      return false;
    }
  }
}
