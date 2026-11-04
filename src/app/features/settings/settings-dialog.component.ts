import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule } from '@angular/material/dialog';
import { MatIconModule } from '@angular/material/icon';
import { MatSelectModule } from '@angular/material/select';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AudioDevice, AudioDevicesService } from '../../core/audio/audio-devices.service';
import { RecordingService } from '../../core/audio/recording.service';
import { DocumentService } from '../../core/document.service';
import type { TranslationKey } from '../../core/i18n/it';
import { I18nService } from '../../core/i18n/i18n.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { DevToolsPort } from '../../core/platform/dev-tools.port';
import { PlatformInfo } from '../../core/platform/platform-info';
import {
  DEFAULT_UPDATE_REPO,
  Language,
  SettingsService,
  SnapStep,
  ThemeMode,
} from '../../core/settings.service';
import { UpdateService } from '../../core/update.service';
import { FieldComponent } from '../../shared/controls/field.component';
import { SwitchComponent } from '../../shared/controls/switch.component';

const THEMES: { mode: ThemeMode; label: TranslationKey }[] = [
  { mode: 'light', label: 'settings.theme.light' },
  { mode: 'dark', label: 'settings.theme.dark' },
  { mode: 'system', label: 'settings.theme.system' },
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

/**
 * Preferences changed rarely: appearance, audio output, editing, developer tools. Every change
 * is saved at once; the developer tools apply at the next start (or with "restart now").
 */
@Component({
  selector: 'app-settings-dialog',
  imports: [
    FieldComponent,
    MatButtonModule,
    MatDialogModule,
    MatIconModule,
    MatSelectModule,
    MatTooltipModule,
    SwitchComponent,
    TranslatePipe,
  ],
  template: `
    <h2 mat-dialog-title>{{ 'settings.title' | t }}</h2>
    <mat-dialog-content class="content">
      <h3>{{ 'settings.appearance' | t }}</h3>
      <div class="row">
        <span class="label">{{ 'settings.theme' | t }}</span>
        <app-field class="choice">
          <mat-select [value]="settings.theme()" (selectionChange)="settings.setTheme($event.value)">
            @for (theme of themes; track theme.mode) {
              <mat-option [value]="theme.mode">{{ theme.label | t }}</mat-option>
            }
          </mat-select>
        </app-field>
      </div>
      <div class="row">
        <span class="label">{{ 'settings.language' | t }}</span>
        <app-field class="choice">
          <mat-select
            [value]="settings.language()"
            (selectionChange)="settings.setLanguage($event.value)"
          >
            @for (language of languages; track language.code) {
              <mat-option [value]="language.code">{{ language.label }}</mat-option>
            }
          </mat-select>
        </app-field>
      </div>

      <h3>{{ 'settings.audio' | t }}</h3>
      <div class="row">
        <span class="label">{{ 'output.title' | t }}</span>
        <app-field class="output">
          <mat-select
            [value]="settings.audioOutput()?.id ?? ''"
            (selectionChange)="setOutput($event.value)"
          >
            <mat-option value="">{{ 'output.default' | t }}</mat-option>
            @for (output of menuOutputs(); track output.id) {
              <mat-option [value]="output.id" [disabled]="output.missing">
                {{ output.missing ? ('output.missing' | t: { name: output.label }) : output.label }}
              </mat-option>
            }
          </mat-select>
        </app-field>
      </div>
      <p class="hint">{{ 'settings.outputHint' | t }}</p>
      @if (platform.canRecord) {
        <div class="row">
          <span class="label">{{ 'input.title' | t }}</span>
          <app-field class="output">
            <mat-select
              [value]="settings.audioInput()?.id ?? ''"
              (selectionChange)="setInput($event.value)"
            >
              <mat-option value="">{{ 'input.default' | t }}</mat-option>
              @for (input of menuInputs(); track input.id) {
                <mat-option [value]="input.id" [disabled]="input.missing">
                  {{ input.missing ? ('input.missing' | t: { name: input.label }) : input.label }}
                </mat-option>
              }
            </mat-select>
          </app-field>
        </div>
        <p class="hint">{{ 'settings.inputHint' | t }}</p>
        <div class="row">
          <span class="label">{{ 'latency.title' | t }}</span>
          <span class="latency">{{ latencyLabel() }}</span>
          <button mat-stroked-button [disabled]="recorder.state() !== 'idle'" (click)="calibrate()">
            <mat-icon>graphic_eq</mat-icon>
            {{
              (recorder.state() === 'calibrating' ? 'latency.calibrating' : 'latency.calibrate') | t
            }}
          </button>
          @if (settings.currentLatency() !== undefined) {
            <button
              mat-icon-button
              (click)="settings.setCurrentLatency(null)"
              [matTooltip]="'latency.reset' | t"
            >
              <mat-icon>restart_alt</mat-icon>
            </button>
          }
        </div>
        @if (calibration(); as calibration) {
          <p class="hint" [class.error]="calibration.failed">{{ calibration.text }}</p>
        }
        <p class="hint">{{ 'settings.latencyHint' | t }}</p>
      }

      <h3>{{ 'settings.editing' | t }}</h3>
      <div class="row">
        <span class="label">{{ 'settings.snap' | t }}</span>
        <app-field class="choice">
          <mat-select
            [value]="settings.snapStep()"
            (selectionChange)="settings.setSnapStep($event.value)"
          >
            @for (snap of snapSteps; track snap.step) {
              <mat-option [value]="snap.step">
                <span class="symbol">{{ snap.symbol }}</span>
                {{ snap.label | t }}
              </mat-option>
            }
          </mat-select>
        </app-field>
      </div>
      <p class="hint">{{ 'settings.snapHint' | t }}</p>
      @if (platform.filesBesideSources) {
        <app-switch
          [checked]="settings.autoSaveBars()"
          (checkedChange)="settings.setAutoSaveBars($event)"
        >
          {{ 'settings.autoSaveBars' | t }}
        </app-switch>
        <p class="hint">{{ 'settings.autoSaveBarsHint' | t }}</p>
      }

      @if (platform.canUpdate) {
        <h3>{{ 'settings.updates' | t }}</h3>
        <app-switch
          [checked]="settings.checkUpdates()"
          (checkedChange)="settings.setCheckUpdates($event)"
        >
          {{ 'settings.checkUpdates' | t }}
        </app-switch>
        <div class="row field-row">
          <app-field class="repo">
            <span fieldLabel>{{ 'settings.updateRepo' | t }}</span>
            <input
              #repo
              [value]="settings.updateRepo()"
              (change)="settings.setUpdateRepo(repo.value)"
            />
          </app-field>
          <button mat-stroked-button (click)="updates.check(true)">
            <mat-icon>update</mat-icon>
            {{ 'settings.checkNow' | t }}
          </button>
        </div>
        <p class="hint">{{ 'settings.updateRepoHint' | t: { repo: defaultRepo } }}</p>
      }

      @if (platform.hasDevTools) {
        <h3>{{ 'settings.advanced' | t }}</h3>
        <app-switch
          [checked]="settings.devTools()"
          (checkedChange)="settings.setDevTools($event)"
        >
          {{ 'settings.devTools' | t }}
        </app-switch>
        @if (settings.devTools() !== devTools.active) {
          <div class="restart">
            <span class="hint">{{ 'settings.restartNeeded' | t }}</span>
            <button mat-stroked-button (click)="documents.restartForDevTools()">
              <mat-icon>restart_alt</mat-icon>
              {{ 'settings.restartNow' | t }}
            </button>
          </div>
        }
      }
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
    .field-row {
      align-items: flex-end;
    }
    .label {
      min-width: 140px;
    }
    .latency {
      flex: 1 1 auto;
    }
    .hint.error {
      color: var(--mat-sys-error);
    }
    .output,
    .repo {
      flex: 1 1 260px;
    }
    .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
      margin: 0 0 8px;
    }
    .restart {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-top: 8px;
      .hint {
        margin: 0;
      }
    }
    .choice {
      width: 220px;
    }
    app-switch {
      display: flex;
      margin: 4px 0;
    }
    .symbol {
      display: inline-block;
      width: 20px;
      font-size: 18px;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class SettingsDialogComponent {
  protected readonly settings = inject(SettingsService);
  protected readonly platform = inject(PlatformInfo);
  protected readonly devTools = inject(DevToolsPort);
  protected readonly documents = inject(DocumentService);
  protected readonly updates = inject(UpdateService);
  protected readonly recorder = inject(RecordingService);
  private readonly devices = inject(AudioDevicesService);
  private readonly i18n = inject(I18nService);

  protected readonly defaultRepo = DEFAULT_UPDATE_REPO;
  protected readonly themes = THEMES;
  protected readonly languages = LANGUAGES;
  protected readonly snapSteps = SNAP_STEPS;

  /** Output devices; the chosen one, when no longer connected, is listed as missing. */
  protected readonly menuOutputs = computed(() =>
    withChosen(this.devices.outputs(), this.settings.audioOutput()),
  );
  protected readonly menuInputs = computed(() =>
    withChosen(this.devices.inputs(), this.settings.audioInput()),
  );

  protected readonly latencyLabel = computed(() => {
    const latency = this.settings.currentLatency();
    return latency === undefined
      ? this.i18n.t('latency.estimated')
      : this.i18n.t('latency.measured', { ms: Math.round(latency * 1000) });
  });
  /** Outcome of the last measure of the latency. */
  protected readonly calibration = signal<{ text: string; failed: boolean } | null>(null);

  constructor() {
    void this.devices.refresh();
  }

  protected setOutput(id: string): void {
    const output = this.menuOutputs().find((o) => o.id === id);
    this.settings.setAudioOutput(output ? { id: output.id, label: output.label } : null);
    this.calibration.set(null);
  }

  protected setInput(id: string): void {
    const input = this.menuInputs().find((o) => o.id === id);
    this.settings.setAudioInput(input ? { id: input.id, label: input.label } : null);
    this.calibration.set(null);
  }

  protected async calibrate(): Promise<void> {
    this.calibration.set(null);
    try {
      const latency = await this.recorder.calibrate();
      this.calibration.set(
        latency === null
          ? { text: this.i18n.t('latency.failed'), failed: true }
          : {
              text: this.i18n.t('latency.done', { ms: Math.round(latency * 1000) }),
              failed: false,
            },
      );
    } catch (err) {
      this.calibration.set({
        text: this.i18n.t('record.error', { message: String((err as Error)?.message ?? err) }),
        failed: true,
      });
    }
  }
}

/** The devices, plus the chosen one listed as missing when it is no longer connected. */
function withChosen(
  devices: AudioDevice[],
  chosen: AudioDevice | null,
): (AudioDevice & { missing: boolean })[] {
  const list = devices.map((d) => ({ ...d, missing: false }));
  if (chosen && !list.some((d) => d.id === chosen.id))
    list.push({ ...chosen, missing: list.length > 0 });
  return list;
}
