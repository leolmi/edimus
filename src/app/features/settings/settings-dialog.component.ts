import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialogModule } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { AudioOutputsService } from '../../core/audio/audio-outputs.service';
import type { TranslationKey } from '../../core/i18n/it';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { Language, SettingsService, SnapStep, ThemeMode } from '../../core/settings.service';

const THEMES: { mode: ThemeMode; icon: string; label: TranslationKey }[] = [
  { mode: 'light', icon: 'light_mode', label: 'settings.theme.light' },
  { mode: 'dark', icon: 'dark_mode', label: 'settings.theme.dark' },
  { mode: 'system', icon: 'contrast', label: 'settings.theme.system' },
];

const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'it', label: 'Italiano' },
  { code: 'en', label: 'English' },
];

const SNAP_STEPS: { step: SnapStep; symbol: string; label: TranslationKey }[] = [
  { step: 'bar', symbol: '𝅝', label: 'settings.snap.bar' },
  { step: 'beat', symbol: '♩', label: 'settings.snap.beat' },
  { step: 'half', symbol: '♪', label: 'settings.snap.half' },
];

/** Preferences changed rarely: appearance, audio output, editing. Every change applies and is saved at once. */
@Component({
  selector: 'app-settings-dialog',
  imports: [MatButtonModule, MatButtonToggleModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatSelectModule, TranslatePipe],
  template: `
    <h2 mat-dialog-title>{{ 'settings.title' | t }}</h2>
    <mat-dialog-content class="content">
      <h3>{{ 'settings.appearance' | t }}</h3>
      <div class="row">
        <span class="label">{{ 'settings.theme' | t }}</span>
        <mat-button-toggle-group [value]="settings.theme()" (change)="settings.setTheme($event.value)">
          @for (theme of themes; track theme.mode) {
            <mat-button-toggle [value]="theme.mode">
              <mat-icon>{{ theme.icon }}</mat-icon>
              {{ theme.label | t }}
            </mat-button-toggle>
          }
        </mat-button-toggle-group>
      </div>
      <div class="row">
        <span class="label">{{ 'settings.language' | t }}</span>
        <mat-button-toggle-group [value]="settings.language()" (change)="settings.setLanguage($event.value)">
          @for (language of languages; track language.code) {
            <mat-button-toggle [value]="language.code">{{ language.label }}</mat-button-toggle>
          }
        </mat-button-toggle-group>
      </div>

      <h3>{{ 'settings.audio' | t }}</h3>
      <div class="row">
        <span class="label">{{ 'output.title' | t }}</span>
        <mat-form-field class="output" subscriptSizing="dynamic">
          <mat-select [value]="settings.audioOutput()?.id ?? ''" (selectionChange)="setOutput($event.value)">
            <mat-option value="">{{ 'output.default' | t }}</mat-option>
            @for (output of menuOutputs(); track output.id) {
              <mat-option [value]="output.id" [disabled]="output.missing">
                {{ output.missing ? ('output.missing' | t: { name: output.label }) : output.label }}
              </mat-option>
            }
          </mat-select>
        </mat-form-field>
      </div>
      <p class="hint">{{ 'settings.outputHint' | t }}</p>

      <h3>{{ 'settings.editing' | t }}</h3>
      <div class="row">
        <span class="label">{{ 'settings.snap' | t }}</span>
        <mat-button-toggle-group [value]="settings.snapStep()" (change)="settings.setSnapStep($event.value)">
          @for (snap of snapSteps; track snap.step) {
            <mat-button-toggle [value]="snap.step">
              <span class="symbol">{{ snap.symbol }}</span>
              {{ snap.label | t }}
            </mat-button-toggle>
          }
        </mat-button-toggle-group>
      </div>
      <p class="hint">{{ 'settings.snapHint' | t }}</p>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'common.close' | t }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    .content {
      width: min(600px, 85vw);
    }
    h3 {
      font: var(--mat-sys-title-small);
      color: var(--mat-sys-primary);
      margin: 16px 0 8px;
      &:first-child {
        margin-top: 0;
      }
    }
    .row {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 12px;
      margin-bottom: 8px;
    }
    .label {
      min-width: 140px;
    }
    .output {
      flex: 1 1 260px;
    }
    .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      margin: 0 0 8px;
    }
    .symbol {
      font-size: 18px;
      margin-right: 2px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsDialogComponent {
  protected readonly settings = inject(SettingsService);
  private readonly outputs = inject(AudioOutputsService);

  protected readonly themes = THEMES;
  protected readonly languages = LANGUAGES;
  protected readonly snapSteps = SNAP_STEPS;

  /** Output devices; the chosen one, when no longer connected, is listed as missing. */
  protected readonly menuOutputs = computed(() => {
    const outputs = this.outputs.outputs().map((o) => ({ ...o, missing: false }));
    const chosen = this.settings.audioOutput();
    if (chosen && !outputs.some((o) => o.id === chosen.id)) outputs.push({ ...chosen, missing: outputs.length > 0 });
    return outputs;
  });

  constructor() {
    void this.outputs.refresh();
  }

  protected setOutput(id: string): void {
    const output = this.menuOutputs().find((o) => o.id === id);
    this.settings.setAudioOutput(output ? { id: output.id, label: output.label } : null);
  }
}
