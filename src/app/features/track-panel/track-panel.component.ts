import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { EditService } from '../../core/edit.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { MontageService } from '../../core/montage/montage.service';
import { TimelineService } from '../../core/timeline/timeline.service';
import { EffectsPanelComponent } from '../effects/effects-panel.component';
import { TrackInfoPanelComponent } from './track-info-panel.component';

/**
 * Side panel of the selected track, in two tabs: its settings (Info) and its effects (FX). It follows the
 * selected track: selecting a clip of another track shows that one.
 */
@Component({
  selector: 'app-track-panel',
  imports: [MatButtonModule, MatIconModule, MatTabsModule, MatTooltipModule, TranslatePipe, EffectsPanelComponent, TrackInfoPanelComponent],
  template: `
    @if (track(); as track) {
      <header class="head">
        <span class="name" [title]="track.name">{{ track.name }}</span>
        <button mat-icon-button class="small" (click)="close()" [matTooltip]="'trackPanel.close' | t">
          <mat-icon>close</mat-icon>
        </button>
      </header>
      <nav mat-tab-nav-bar mat-stretch-tabs [tabPanel]="panel" class="tabs">
        <a mat-tab-link [active]="tab() === 'info'" (click)="edits.showPanel(track.id, 'info')">
          <mat-icon>info</mat-icon>{{ 'trackPanel.info' | t }}
        </a>
        <a mat-tab-link [active]="tab() === 'fx'" [disabled]="edits.locked()" (click)="edits.showPanel(track.id, 'fx')">
          <mat-icon>tune</mat-icon>{{ 'fx.title' | t }}
        </a>
      </nav>
      <mat-tab-nav-panel #panel class="content">
        @if (tab() === 'fx') {
          <app-effects-panel class="fill" />
        } @else {
          <app-track-info-panel class="scroll" />
        }
      </mat-tab-nav-panel>
    }
  `,
  styles: `
    :host {
      display: flex;
      flex-direction: column;
      /* fixed: five effect controls fit in a row */
      flex: 0 0 330px;
      width: 330px;
      min-height: 0;
      background: var(--mat-sys-surface-container-low);
      border-left: 1px solid var(--mat-sys-outline-variant);
    }
    .head {
      display: flex;
      align-items: center;
      gap: 8px;
      padding: 4px 4px 0 12px;
    }
    .name {
      flex: 1 1 auto;
      min-width: 0;
      font: var(--mat-sys-title-small);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
    }
    .tabs {
      flex: none;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      mat-icon {
        margin-right: 6px;
      }
    }
    .content {
      display: flex;
      flex-direction: column;
      flex: 1 1 auto;
      min-height: 0;
    }
    .fill {
      flex: 1 1 auto;
    }
    .scroll {
      flex: 1 1 auto;
      min-height: 0;
      overflow-y: auto;
    }
    .small {
      --mat-icon-button-state-layer-size: 28px;
      --mat-icon-button-icon-size: 18px;
      --mat-icon-button-icon-color: var(--mat-sys-on-surface-variant);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrackPanelComponent {
  protected readonly edits = inject(EditService);
  private readonly montages = inject(MontageService);
  private readonly timeline = inject(TimelineService);

  protected readonly tab = this.timeline.panelTab;
  protected readonly track = computed(() => {
    const id = this.timeline.selectedTrackId();
    return this.montages.montage().tracks.find((t) => t.id === id) ?? null;
  });

  protected close(): void {
    this.timeline.selectedTrackId.set(null);
  }
}
