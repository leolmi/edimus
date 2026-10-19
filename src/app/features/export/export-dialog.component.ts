import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatSelectModule } from '@angular/material/select';
import type { ExportFormat, ExportOptions } from '../../core/audio/export.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { ScaleSliderComponent } from '../../shared/scale-slider.component';

export const FORMATS: { id: ExportFormat; label: string; extension: string }[] = [
  { id: 'wav', label: 'WAV', extension: 'wav' },
  { id: 'flac', label: 'FLAC', extension: 'flac' },
  { id: 'mp3', label: 'MP3', extension: 'mp3' },
  { id: 'ogg', label: 'OGG Vorbis', extension: 'ogg' },
  { id: 'opus', label: 'Opus', extension: 'opus' },
  { id: 'm4a', label: 'AAC (M4A)', extension: 'm4a' },
];

const BITRATES: Partial<Record<ExportFormat, number[]>> = {
  mp3: [128, 160, 192, 256, 320],
  opus: [64, 96, 128, 160, 192, 256],
  m4a: [128, 160, 192, 256, 320],
};

const SAMPLE_RATES = [22050, 32000, 44100, 48000, 88200, 96000];

/** Choice of format and quality of the mixdown. Closes with the options, or nothing when cancelled. */
@Component({
  selector: 'app-export-dialog',
  imports: [
    MatButtonModule,
    MatButtonToggleModule,
    MatCheckboxModule,
    MatDialogModule,
    MatFormFieldModule,
    MatSelectModule,
    ScaleSliderComponent,
    TranslatePipe,
  ],
  template: `
    <h2 mat-dialog-title>{{ 'export.title' | t }}</h2>
    <mat-dialog-content class="content">
      <mat-form-field>
        <mat-label>{{ 'export.format' | t }}</mat-label>
        <mat-select [value]="format()" (valueChange)="setFormat($event)">
          @for (f of formats; track f.id) {
            <mat-option [value]="f.id">{{ f.label }}</mat-option>
          }
        </mat-select>
      </mat-form-field>

      <div class="row">
        <span class="label">{{ 'export.channels' | t }}</span>
        <mat-button-toggle-group [value]="channels()" (change)="channels.set($event.value)">
          <mat-button-toggle [value]="1">{{ 'channels.1' | t }}</mat-button-toggle>
          <mat-button-toggle [value]="2">{{ 'channels.2' | t }}</mat-button-toggle>
        </mat-button-toggle-group>
      </div>

      @if (format() !== 'opus') {
        <mat-form-field>
          <mat-label>{{ 'export.sampleRate' | t }}</mat-label>
          <mat-select [value]="sampleRate()" (valueChange)="sampleRate.set($event)">
            @for (rate of sampleRates; track rate) {
              <mat-option [value]="rate">{{ rate / 1000 }} kHz</mat-option>
            }
          </mat-select>
        </mat-form-field>
      }

      @if (format() === 'wav' || format() === 'flac') {
        <mat-form-field>
          <mat-label>{{ 'export.bitDepth' | t }}</mat-label>
          <mat-select [value]="bitDepth()" (valueChange)="bitDepth.set($event)">
            <mat-option [value]="16">16 bit</mat-option>
            <mat-option [value]="24">24 bit</mat-option>
            @if (format() === 'wav') {
              <mat-option [value]="32">32 bit float</mat-option>
            }
          </mat-select>
        </mat-form-field>
      }

      @if (bitrates(); as list) {
        <mat-form-field>
          <mat-label>{{ 'export.bitrate' | t }}</mat-label>
          <mat-select [value]="bitrate()" (valueChange)="bitrate.set($event)">
            @for (b of list; track b) {
              <mat-option [value]="b">{{ b }} kbps</mat-option>
            }
          </mat-select>
        </mat-form-field>
      }

      @if (format() === 'ogg') {
        <div class="row">
          <span class="label">{{ 'export.quality' | t }}</span>
          <app-scale-slider
            class="quality"
            [min]="0"
            [max]="10"
            [step]="1"
            [majorTicks]="1"
            [minorTicks]="0"
            [ariaLabel]="'export.quality' | t"
            [value]="quality()"
            (valueChange)="quality.set($event)"
          />
        </div>
      }

      <mat-checkbox [checked]="normalize()" (change)="normalize.set($event.checked)">
        {{ 'export.normalize' | t }}
      </mat-checkbox>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'common.cancel' | t }}</button>
      <button mat-flat-button (click)="confirm()">{{ 'export.confirm' | t }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    .content {
      display: flex;
      flex-direction: column;
      gap: 4px;
      min-width: 360px;
    }
    .row {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 16px;
    }
    .label {
      min-width: 90px;
    }
    .quality {
      flex: 1 1 auto;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportDialogComponent {
  private readonly dialog = inject(MatDialogRef<ExportDialogComponent, ExportOptions>);
  private readonly initial = inject<ExportOptions>(MAT_DIALOG_DATA);

  protected readonly formats = FORMATS;
  protected readonly sampleRates = SAMPLE_RATES;

  protected readonly format = signal(this.initial.format);
  protected readonly channels = signal(this.initial.channels);
  protected readonly sampleRate = signal(this.initial.sampleRate);
  protected readonly bitDepth = signal(this.initial.bitDepth);
  protected readonly bitrate = signal(this.initial.bitrate);
  protected readonly quality = signal(this.initial.quality);
  protected readonly normalize = signal(this.initial.normalize);

  protected readonly bitrates = computed(() => BITRATES[this.format()] ?? null);

  protected setFormat(format: ExportFormat): void {
    this.format.set(format);
    const list = BITRATES[format];
    if (list && !list.includes(this.bitrate())) this.bitrate.set(list[Math.floor(list.length / 2)]);
    if (format === 'flac' && this.bitDepth() === 32) this.bitDepth.set(24);
  }

  protected confirm(): void {
    this.dialog.close({
      format: this.format(),
      channels: this.channels(),
      sampleRate: this.format() === 'opus' ? 48000 : this.sampleRate(),
      bitDepth: this.bitDepth(),
      bitrate: this.bitrate(),
      quality: this.quality(),
      normalize: this.normalize(),
    });
  }
}
