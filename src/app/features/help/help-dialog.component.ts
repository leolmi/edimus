import { ChangeDetectionStrategy, Component, computed, inject } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule } from '@angular/material/dialog';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatTabsModule } from '@angular/material/tabs';
import { os } from '@neutralinojs/lib';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { SettingsService } from '../../core/settings.service';
import { AiSetupComponent } from './ai-setup.component';
import { APP_INFO, HELP_CONTENT } from './help-content';
import { LicensesComponent } from './licenses.component';

export type HelpTab = 'guide' | 'howto' | 'ai' | 'info';

const TABS: HelpTab[] = ['guide', 'howto', 'ai', 'info'];

/** Help of the app: guide to every function, how-to of the common tasks, AI assistant setup, info and licenses. */
@Component({
  selector: 'app-help-dialog',
  imports: [MatButtonModule, MatDialogModule, MatExpansionModule, MatIconModule, MatTabsModule, AiSetupComponent, LicensesComponent, TranslatePipe],
  template: `
    <mat-dialog-content class="content">
      <mat-tab-group [selectedIndex]="initialTab" mat-stretch-tabs="false" animationDuration="0ms">
        <mat-tab [label]="'help.guide' | t">
          <div class="tab">
            @for (section of content().guide; track section.title) {
              <h3>
                <mat-icon>{{ section.icon }}</mat-icon>
                {{ section.title }}
              </h3>
              <mat-accordion displayMode="flat" multi>
                @for (topic of section.topics; track topic.title) {
                  <mat-expansion-panel>
                    <mat-expansion-panel-header>
                      <mat-panel-title>{{ topic.title }}</mat-panel-title>
                      <mat-panel-description>
                        @for (key of topic.keys ?? []; track key) {
                          <kbd>{{ key }}</kbd>
                        }
                      </mat-panel-description>
                    </mat-expansion-panel-header>
                    @for (paragraph of topic.text; track $index) {
                      <p>{{ paragraph }}</p>
                    }
                  </mat-expansion-panel>
                }
              </mat-accordion>
            }
          </div>
        </mat-tab>
        <mat-tab [label]="'help.howto' | t">
          <div class="tab">
            <mat-accordion displayMode="flat" multi>
              @for (howto of content().howto; track howto.title) {
                <mat-expansion-panel>
                  <mat-expansion-panel-header>
                    <mat-panel-title>{{ howto.title }}</mat-panel-title>
                  </mat-expansion-panel-header>
                  <ol>
                    @for (step of howto.steps; track $index) {
                      <li>{{ step }}</li>
                    }
                  </ol>
                  @if (howto.note) {
                    <p class="note">{{ howto.note }}</p>
                  }
                </mat-expansion-panel>
              }
            </mat-accordion>
          </div>
        </mat-tab>
        <mat-tab [label]="'help.ai' | t">
          <ng-template matTabContent>
            <div class="tab">
              <app-ai-setup />
            </div>
          </ng-template>
        </mat-tab>
        <mat-tab [label]="'help.info' | t">
          <div class="tab">
            <div class="about">
              <mat-icon class="logo">graphic_eq</mat-icon>
              <div>
                <div class="name">edimus {{ version }}</div>
                <div class="hint">{{ 'help.description' | t }}</div>
              </div>
            </div>
            <dl>
              <dt>{{ 'help.author' | t }}</dt>
              <dd>{{ info.author }}</dd>
              <dt>{{ 'help.repository' | t }}</dt>
              <dd>
                <a href="#" (click)="$event.preventDefault(); openRepository()">{{ info.repository }}</a>
              </dd>
              <dt>{{ 'help.runtime' | t }}</dt>
              <dd>Neutralinojs {{ neutralino }}</dd>
            </dl>
            <h3>
              <mat-icon>license</mat-icon>
              {{ 'licenses.title' | t }}
            </h3>
            <app-licenses />
          </div>
        </mat-tab>
      </mat-tab-group>
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button mat-dialog-close>{{ 'common.close' | t }}</button>
    </mat-dialog-actions>
  `,
  styles: `
    .content {
      width: min(860px, 90vw);
      height: min(640px, 75vh);
      padding-top: 0;
    }
    .tab {
      padding: 12px 4px 4px;
    }
    h3 {
      display: flex;
      align-items: center;
      gap: 8px;
      font: var(--mat-sys-title-small);
      color: var(--mat-sys-primary);
      margin: 16px 0 6px;
      &:first-child {
        margin-top: 4px;
      }
    }
    p,
    li {
      font: var(--mat-sys-body-medium);
      margin: 0 0 6px;
    }
    ol {
      margin: 0 0 6px;
      padding-left: 22px;
    }
    .note,
    .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    // the title takes all the room left by the keys (Material splits it 1:2 by default)
    mat-panel-title {
      flex: 1 1 auto;
    }
    mat-panel-description {
      flex: 0 1 auto;
      justify-content: flex-end;
      gap: 4px;
      flex-wrap: wrap;
    }
    kbd {
      font: 11px/1.6 Consolas, 'Cascadia Mono', monospace;
      padding: 0 6px;
      border-radius: 4px;
      border: 1px solid var(--mat-sys-outline-variant);
      background: var(--mat-sys-surface-container-highest);
      color: var(--mat-sys-on-surface);
      white-space: nowrap;
    }
    .about {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
      .name {
        font: var(--mat-sys-title-large);
      }
    }
    .logo {
      color: var(--mat-sys-primary);
    }
    dl {
      display: grid;
      grid-template-columns: max-content 1fr;
      gap: 4px 16px;
      margin: 0 0 8px;
      font: var(--mat-sys-body-medium);
    }
    dt {
      color: var(--mat-sys-on-surface-variant);
    }
    dd {
      margin: 0;
    }
    a {
      color: var(--mat-sys-primary);
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HelpDialogComponent {
  private readonly settings = inject(SettingsService);

  protected readonly initialTab = Math.max(0, TABS.indexOf(inject<HelpTab | null>(MAT_DIALOG_DATA, { optional: true }) ?? 'guide'));
  protected readonly content = computed(() => HELP_CONTENT[this.settings.language()]);
  protected readonly info = APP_INFO;
  protected readonly version = window.NL_APPVERSION ?? '';
  protected readonly neutralino = window.NL_VERSION ?? '';

  /** The repository opens in the system browser (not inside the app window). */
  protected openRepository(): void {
    void os.open(this.info.repository);
  }
}
