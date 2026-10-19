import { ChangeDetectionStrategy, Component, inject, resource, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatIconModule } from '@angular/material/icon';
import { filesystem } from '@neutralinojs/lib';
import { formatDuration } from '../../core/format';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { dirName, fileName } from '../../core/montage/montage.model';
import { revealFile } from '../../core/reveal';

/** A source used by the track, with what is known about it. */
export interface TrackInfoSource {
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

export interface TrackInfoResult {
  name: string;
}

export interface TrackInfoData {
  name: string;
  clips: number;
  length: number;
  muted: boolean;
  solo: boolean;
  envelopePoints: number;
  sources: TrackInfoSource[];
}

const formatSize = (bytes: number) =>
  bytes >= 1048576 ? `${(bytes / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(bytes / 1024))} kB`;

/** Details of a track and of the files it uses, with a shortcut to show them in the file manager. */
@Component({
  selector: 'app-track-info-dialog',
  imports: [MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ 'trackInfo.title' | t }}</h2>
    <mat-dialog-content class="content">
      <mat-form-field class="name-field">
        <mat-label>{{ 'trackInfo.name' | t }}</mat-label>
        <input #input matInput [value]="name()" (input)="name.set(input.value)" (keydown.enter)="close()" (focus)="input.select()" />
        <mat-hint>{{ 'trackInfo.nameHint' | t }}</mat-hint>
      </mat-form-field>
      <table class="facts">
        <tr><td>{{ 'trackInfo.clips' | t }}</td><td>{{ data.clips }}</td></tr>
        <tr><td>{{ 'trackInfo.length' | t }}</td><td>{{ duration(data.length) }}</td></tr>
        <tr><td>{{ 'trackInfo.state' | t }}</td><td>{{ stateLabel() | t }}</td></tr>
        <tr><td>{{ 'trackInfo.envelope' | t }}</td><td>{{ data.envelopePoints || '—' }}</td></tr>
      </table>

      @for (source of data.sources; track source.path; let i = $index) {
        <section class="source">
          <div class="file">
            <mat-icon>audio_file</mat-icon>
            <div class="names">
              <span class="file-name">{{ fileNameOf(source.path) }}</span>
              <span class="folder">{{ folder(source.path) }}</span>
            </div>
            <button mat-stroked-button (click)="reveal(source.path)">
              <mat-icon>folder_open</mat-icon>
              {{ 'trackInfo.reveal' | t }}
            </button>
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
      <button mat-button mat-dialog-close>{{ 'common.cancel' | t }}</button>
      <button mat-flat-button [disabled]="!name().trim()" (click)="close()">{{ 'common.ok' | t }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    .content {
      width: min(560px, 85vw);
    }
    .name-field {
      width: 100%;
      margin-bottom: 8px;
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
      margin-top: 16px;
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
export class TrackInfoDialogComponent {
  protected readonly data = inject<TrackInfoData>(MAT_DIALOG_DATA);
  private readonly dialog = inject(MatDialogRef<TrackInfoDialogComponent, TrackInfoResult>);
  protected readonly name = signal(this.data.name);

  protected readonly fileNameOf = fileName;
  protected readonly folder = dirName;
  protected readonly duration = formatDuration;

  /** File sizes, read from the disk. */
  protected readonly sizes = resource({
    loader: () =>
      Promise.all(
        this.data.sources.map((s) =>
          filesystem.getStats(s.path).then(
            (stats) => formatSize(stats.size),
            () => '—',
          ),
        ),
      ),
  });

  protected stateLabel() {
    if (this.data.muted) return 'trackInfo.muted' as const;
    if (this.data.solo) return 'trackInfo.solo' as const;
    return 'trackInfo.active' as const;
  }

  /** Closes with the (trimmed) name, when not empty. */
  protected close(): void {
    const name = this.name().trim();
    if (name) this.dialog.close({ name });
  }

  protected reveal(path: string): void {
    void revealFile(path);
  }
}
