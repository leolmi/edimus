import { Injectable, Injector, inject, signal } from '@angular/core';
import { MatDialog } from '@angular/material/dialog';
import { firstValueFrom } from 'rxjs';
import { LinkImportChoice, LinkImportDialogComponent, LinkImportDialogData } from '../features/link-import/link-import-dialog.component';
import { DocumentService } from './document.service';
import { I18nService } from './i18n/i18n.service';
import { AUDIO_EXTENSIONS, dirName, fileExtension } from './montage/montage.model';
import { MontageService } from './montage/montage.service';
import { FileSystemPort } from './platform/file-system.port';
import { LinkImportPort, YTDLP_PAGE } from './platform/link-import.port';
import { PlatformInfo } from './platform/platform-info';
import { ShellPort } from './platform/shell.port';

const errorMessage = (err: unknown) => String((err as { message?: string })?.message ?? err);

/** Characters not allowed in file names (Windows rules, the strictest). */
const INVALID = /[\\/:*?"<>|\u0000-\u001f]/g;

/** A file name from the title of a video. */
export const linkFileName = (title: string) =>
  title.replace(INVALID, '-').replace(/\s+/g, ' ').replace(/[. ]+$/, '').trim().slice(0, 120) || 'audio';

/** `path` without its audio extension: yt-dlp adds the one of the format it gets. */
export const linkStem = (path: string) => (AUDIO_EXTENSIONS.includes(fileExtension(path)) ? path.slice(0, path.lastIndexOf('.')) : path);

/**
 * Import of the audio of a web video from its link (`LinkImportPort`, desktop only): the audio
 * is saved as a new file where the user chooses, then added to the montage as any other file.
 * yt-dlp is downloaded the first time, after asking, and updated on request.
 */
@Injectable({ providedIn: 'root' })
export class LinkImportService {
  private readonly platform = inject(PlatformInfo);
  private readonly links = inject(LinkImportPort);
  private readonly montages = inject(MontageService);
  private readonly files = inject(FileSystemPort);
  private readonly i18n = inject(I18nService);
  private readonly dialogs = inject(MatDialog);
  private readonly shell = inject(ShellPort);
  // DocumentService opens this dialog: taken when needed
  private readonly injector = inject(Injector);
  private get documents(): DocumentService {
    return this.injector.get(DocumentService);
  }

  /** Downloading yt-dlp or the audio of a link. */
  readonly busy = signal(false);

  /** Dialog of the link, then the download and the new track. */
  async importDialog(): Promise<void> {
    if (!this.platform.canImportLinks || this.busy()) return;
    if (this.montages.locked()) return this.documents.notify({ key: 'lock.blocked' });
    const toolVersion = await this.links.toolVersion();
    const ref = this.dialogs.open<LinkImportDialogComponent, LinkImportDialogData, LinkImportChoice>(LinkImportDialogComponent, {
      data: { toolVersion },
      autoFocus: 'dialog',
    });
    const choice = await firstValueFrom(ref.afterClosed());
    if (!choice) return;
    if (choice === 'update') {
      if (await this.installTool()) await this.importDialog();
      return;
    }
    if (!toolVersion && !(await this.offerTool())) return;
    await this.importUrl(choice.url);
  }

  /** yt-dlp is not there yet: asks to download it. */
  private async offerTool(): Promise<boolean> {
    if ((await this.shell.ask(this.i18n.t('link.toolTitle'), this.i18n.t('link.toolAsk', { page: YTDLP_PAGE }))) !== 'yes') return false;
    return this.installTool();
  }

  /** Downloads the latest yt-dlp, showing the progress; true when done. */
  private async installTool(): Promise<boolean> {
    this.busy.set(true);
    try {
      const version = await this.links.installTool((fraction) => this.documents.notify({ key: 'link.toolDownloading', params: { p: Math.round(fraction * 100) } }));
      this.documents.notify({ key: 'link.toolInstalled', params: { version } });
      return true;
    } catch (err) {
      this.documents.notify({ key: 'link.toolError', params: { message: errorMessage(err) } });
      return false;
    } finally {
      this.busy.set(false);
    }
  }

  private async importUrl(url: string): Promise<void> {
    this.busy.set(true);
    try {
      this.documents.notify({ key: 'link.reading' });
      const media = await this.links.info(url);
      // next to the montage, as a recording; the extension is the one of the format downloaded
      const near = this.montages.path() ?? this.montages.montage().sources[0]?.path;
      const name = `${linkFileName(media.title)}.m4a`;
      const path = await this.files.showSaveDialog(
        this.i18n.t('link.saveTitle'),
        [{ name: this.i18n.t('filter.audio'), extensions: ['m4a', 'opus'] }],
        near ? `${dirName(near)}/${name}` : name,
      );
      if (!path) return this.documents.notify({ key: 'link.cancelled' });
      this.documents.notify({ key: 'link.downloading', params: { p: 0 } });
      const file = await this.links.download(url, linkStem(path), (fraction) =>
        this.documents.notify({ key: 'link.downloading', params: { p: Math.round(fraction * 100) } }),
      );
      await this.documents.open([file]);
      this.documents.notify({ key: 'link.done', params: { path: file } });
    } catch (err) {
      this.documents.notify({ key: 'link.error', params: { message: errorMessage(err) } });
    } finally {
      this.busy.set(false);
    }
  }
}
