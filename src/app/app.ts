import { Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
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
import { TranslatePipe } from './core/i18n/translate.pipe';
import { MontageService } from './core/montage/montage.service';
import { SettingsService } from './core/settings.service';
import { TimelineService } from './core/timeline/timeline.service';
import { ClipBarComponent } from './features/timeline/clip-bar.component';
import { HelpDialogComponent, HelpTab } from './features/help/help-dialog.component';
import { SettingsDialogComponent } from './features/settings/settings-dialog.component';
import { TimelineComponent } from './features/timeline/timeline.component';
import { ScaleSliderComponent } from './shared/scale-slider.component';

@Component({
  selector: 'app-root',
  host: { '(window:keydown)': 'onKeydown($event)' },
  imports: [
    MatToolbarModule,
    MatButtonModule,
    MatIconModule,
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
  /** Started with the app: connects this window to the MCP server when it runs. */
  private readonly ai = inject(AiBridgeService);
  private readonly dialogs = inject(MatDialog);

  protected readonly percentLabel = (value: number) => `${Math.round(value)}%`;

  protected readonly volumeIcon = computed(() => {
    const volume = this.settings.volume();
    if (this.settings.muted() || volume === 0) return 'volume_off';
    return volume < 0.5 ? 'volume_down' : 'volume_up';
  });

  protected readonly time = computed(
    () => `${formatDuration(this.playback.position())} / ${formatDuration(this.timeline.duration())}`,
  );

  protected showSettings(): void {
    if (this.dialogs.openDialogs.some((d) => d.componentInstance instanceof SettingsDialogComponent)) return;
    this.dialogs.open(SettingsDialogComponent, { autoFocus: 'dialog', maxWidth: '95vw' });
  }

  protected showHelp(tab: HelpTab = 'guide'): void {
    if (this.dialogs.openDialogs.some((d) => d.componentInstance instanceof HelpDialogComponent)) return;
    this.dialogs.open(HelpDialogComponent, { data: tab, autoFocus: 'dialog', maxWidth: '95vw' });
  }

  /**
   * Help (F1), document (Ctrl+N/O/S/Shift+S/Z/Y, Ctrl+A select all clips), transport (Space, Home, End) and edit
   * (S split, E envelope, B beat grid, Delete, Escape) shortcuts.
   */
  protected onKeydown(event: KeyboardEvent): void {
    if (event.code === 'F1') {
      event.preventDefault();
      return this.showHelp();
    }
    const editing = event.target instanceof Element && event.target.closest('input, textarea, [contenteditable]');
    if (editing) return;
    if (this.timeline.beatMarking()) {
      // marking a bar: Enter confirms, Backspace starts again from the 1, Escape cancels
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
      case 'Comma':
        return () => this.showSettings();
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
      case 'KeyA':
        return () => this.edits.selectAll();
      default:
        return undefined;
    }
  }
}
