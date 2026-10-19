import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatMenuModule } from '@angular/material/menu';
import { MatToolbarModule } from '@angular/material/toolbar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { MatDialog } from '@angular/material/dialog';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { ExportService } from './core/audio/export.service';
import { AiBridgeService } from './core/ai/ai-bridge.service';
import { PlaybackService } from './core/audio/playback.service';
import { DocumentService } from './core/document.service';
import { EditService } from './core/edit.service';
import { formatDuration } from './core/format';
import type { TranslationKey } from './core/i18n/it';
import { TranslatePipe } from './core/i18n/translate.pipe';
import { MontageService } from './core/montage/montage.service';
import { Language, SettingsService, ThemeMode } from './core/settings.service';
import { TimelineService } from './core/timeline/timeline.service';
import { ClipBarComponent } from './features/timeline/clip-bar.component';
import { LicensesDialogComponent } from './features/licenses/licenses-dialog.component';
import { TimelineComponent } from './features/timeline/timeline.component';
import { ScaleSliderComponent } from './shared/scale-slider.component';

const THEMES: { mode: ThemeMode; icon: string; label: TranslationKey }[] = [
  { mode: 'light', icon: 'light_mode', label: 'settings.theme.light' },
  { mode: 'dark', icon: 'dark_mode', label: 'settings.theme.dark' },
  { mode: 'system', icon: 'contrast', label: 'settings.theme.system' },
];

const LANGUAGES: { code: Language; label: string }[] = [
  { code: 'it', label: 'Italiano' },
  { code: 'en', label: 'English' },
];

@Component({
  selector: 'app-root',
  host: { '(window:keydown)': 'onKeydown($event)' },
  imports: [
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
    MatMenuModule,
    MatTooltipModule,
    MatProgressBarModule,
    ScaleSliderComponent,
    TranslatePipe,
    TimelineComponent,
    ClipBarComponent,
  ],
  templateUrl: './app.html',
  styleUrl: './app.scss',
})
export class App {
  protected readonly settings = inject(SettingsService);
  protected readonly montages = inject(MontageService);
  protected readonly timeline = inject(TimelineService);
  protected readonly playback = inject(PlaybackService);
  protected readonly documents = inject(DocumentService);
  protected readonly edits = inject(EditService);
  protected readonly exporter = inject(ExportService);
  protected readonly ai = inject(AiBridgeService);
  private readonly dialogs = inject(MatDialog);

  protected readonly themes = THEMES;
  protected readonly languages = LANGUAGES;
  protected readonly themeIcon = computed(() => THEMES.find((t) => t.mode === this.settings.theme())!.icon);

  protected readonly percentLabel = (value: number) => `${Math.round(value)}%`;

  protected readonly volumeIcon = computed(() => {
    const volume = this.settings.volume();
    if (this.settings.muted() || volume === 0) return 'volume_off';
    return volume < 0.5 ? 'volume_down' : 'volume_up';
  });

  protected readonly time = computed(
    () => `${formatDuration(this.playback.position())} / ${formatDuration(this.timeline.duration())}`,
  );

  protected showLicenses(): void {
    this.dialogs.open(LicensesDialogComponent, { autoFocus: 'dialog', maxWidth: '95vw' });
  }

  /** Document (Ctrl+N/O/S/Shift+S/Z/Y), transport (Space, Home, End) and edit (S split, E envelope, B beat grid, Delete, Escape) shortcuts. */
  protected onKeydown(event: KeyboardEvent): void {
    const editing = event.target instanceof Element && event.target.closest('input, textarea, [contenteditable]');
    if (editing) return;
    if (this.timeline.beatMarking()) {
      // marking the beats: Enter confirms, Backspace removes the last mark, Escape cancels
      const actions: Record<string, () => unknown> = {
        Enter: () => this.edits.confirmBeatMarking(),
        NumpadEnter: () => this.edits.confirmBeatMarking(),
        Backspace: () => this.edits.undoBeatMark(),
        Escape: () => this.edits.cancelBeatMarking(),
      };
      const action = actions[event.code];
      if (action) {
        event.preventDefault();
        void action();
        return;
      }
    }
    if (event.ctrlKey || event.metaKey) {
      const command = this.documentCommand(event.code, event.shiftKey);
      if (command) {
        event.preventDefault();
        void command();
      }
      return;
    }
    if (this.montages.isEmpty()) return;
    switch (event.code) {
      case 'Space':
        event.preventDefault();
        return this.playback.toggle();
      case 'Home':
        event.preventDefault();
        return this.playback.seek(0);
      case 'End':
        event.preventDefault();
        return this.playback.seek(this.timeline.duration());
      case 'Delete':
      case 'Backspace':
        event.preventDefault();
        return this.edits.delete();
      case 'KeyS':
        event.preventDefault();
        return this.edits.split();
      case 'KeyE':
        event.preventDefault();
        return this.timeline.envelopeMode.update((on) => !on);
      case 'KeyB':
        event.preventDefault();
        return this.timeline.beatGrid.update((on) => !on);
      case 'Escape':
        return this.edits.clearSelection();
    }
  }

  private documentCommand(code: string, shift: boolean): (() => unknown) | undefined {
    switch (code) {
      case 'KeyN':
        return () => this.documents.reset();
      case 'KeyO':
        return () => this.documents.openDialog();
      case 'KeyE':
        return () => this.documents.exportDialog();
      case 'KeyS':
        return shift ? () => this.documents.saveAs() : () => this.documents.save();
      case 'KeyZ':
        return shift ? () => this.montages.redo() : () => this.montages.undo();
      case 'KeyY':
        return () => this.montages.redo();
      default:
        return undefined;
    }
  }
}
