import { ChangeDetectionStrategy, Component, inject, resource } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { formatDuration } from '../../core/format';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { dirName, fileName } from '../../core/montage/montage.model';
import { FileSystemPort } from '../../core/platform/file-system.port';
import { PlatformInfo } from '../../core/platform/platform-info';
import { ShellPort } from '../../core/platform/shell.port';

/** A file used by the track, with what is known about it. */
export interface TrackFile {
  path: string;
  codec?: string;
  format?: string;
  sampleRate?: number;
  channels?: number;
  sourceChannels?: number;
  bitRate?: number;
  duration?: number;
  bpm?: number;
  bpmManual?: boolean;
  /** Clips of the track that use it. */
  clips: number;
}

export interface TrackFilesData {
  /** Name of the track. */
  track: string;
  /** Only the file of a clip (from the menu of the clip). */
  clip: boolean;
  sources: TrackFile[];
}

const formatSize = (bytes: number) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;

/** The files used by a track (or by a clip), with a shortcut to show them in the file manager. */
@Component({
  selector: 'app-track-files-dialog',
  imports: [MatButtonModule, MatDialogModule, MatIconModule, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ (data.clip ? 'trackFiles.clipTitle' : 'trackFiles.title') | t }}</h2>
    <mat-dialog-content class="content">
      <p class="track">{{ data.track }}</p>
      @for (source of data.sources; track source.path; let i = $index) {
        <section class="source">
          <div class="file">
            <mat-icon>audio_file</mat-icon>
            <div class="names">
              <span class="file-name">{{ fileNameOf(source.path) }}</span>
              <span class="folder">{{ folder(source.path) }}</span>
            </div>
            @if (platform.canRevealFiles) {
              <button mat-stroked-button (click)="reveal(source.path)">
                <mat-icon>folder_open</mat-icon>
                {{ 'trackInfo.reveal' | t }}
              </button>
            }
          </div>
          <table class="facts">
            <tr><td>{{ 'trackInfo.format' | t }}</td><td>{{ source.format ?? '—' }} · {{ source.codec ?? '—' }}</td></tr>
            <tr>
              <td>{{ 'trackInfo.audio' | t }}</td>
              <td>
                @if (source.sampleRate) {
                  {{ source.sampleRate / 1000 }} kHz · {{ source.sourceChannels ?? source.channels }} ch
                  @if (source.bitRate) {
                    · {{ (source.bitRate / 1000).toFixed(0) }} kbps
                  }
                } @else {
                  —
                }
              </td>
            </tr>
            <tr><td>{{ 'trackInfo.duration' | t }}</td><td>{{ source.duration !== undefined ? duration(source.duration) : '—' }}</td></tr>
            <tr><td>{{ 'trackInfo.size' | t }}</td><td>{{ sizes.value()?.[i] ?? '…' }}</td></tr>
            <tr>
              <td>{{ 'tempo.title' | t }}</td>
              <td>
                {{ source.bpm ? source.bpm.toFixed(2) + ' BPM' : '—' }}
                @if (source.bpmManual) {
                  ({{ 'tempo.manual' | t }})
                }
              </td>
            </tr>
            @if (data.sources.length > 1) {
              <tr><td>{{ 'trackInfo.usedBy' | t }}</td><td>{{ source.clips }}</td></tr>
            }
          </table>
        </section>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-flat-button mat-dialog-close>{{ 'common.close' | t }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    .content {
      width: min(560px, 85vw);
    }
    .track {
      margin: 0;
      color: var(--mat-sys-on-surface-variant);
    }
    .facts {
      width: 100%;
      border-collapse: collapse;
      font-variant-numeric: tabular-nums;
      td {
        padding: 2px 0;
        vertical-align: top;
      }
      td:first-child {
        color: var(--mat-sys-on-surface-variant);
        width: 40%;
      }
    }
    .source {
      margin-top: 12px;
      padding-top: 12px;
      border-top: 1px solid var(--mat-sys-outline-variant);
    }
    .file {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
    }
    .names {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-width: 0;
    }
    .file-name {
      font: var(--mat-sys-title-small);
      overflow-wrap: anywhere;
    }
    .folder {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      overflow-wrap: anywhere;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrackFilesDialogComponent {
  protected readonly data = inject<TrackFilesData>(MAT_DIALOG_DATA);
  private readonly files = inject(FileSystemPort);
  private readonly shell = inject(ShellPort);
  protected readonly platform = inject(PlatformInfo);

  protected readonly fileNameOf = fileName;
  protected readonly folder = dirName;
  protected readonly duration = formatDuration;

  /** File sizes, read from the disk. */
  protected readonly sizes = resource({
    loader: () =>
      Promise.all(
        this.data.sources.map((s) =>
          this.files.size(s.path).then((size) => (size === undefined ? '—' : formatSize(size))),
        ),
      ),
  });

  protected reveal(path: string): void {
    void this.shell.revealFile(path);
  }
}
