import { Clipboard } from '@angular/cdk/clipboard';
import { NgTemplateOutlet } from '@angular/common';
import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatCheckboxModule } from '@angular/material/checkbox';
import { MatExpansionModule } from '@angular/material/expansion';
import { MatIconModule } from '@angular/material/icon';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { AiBridgeService } from '../../core/ai/ai-bridge.service';
import { AiClient, AiClientId, AiHostPort, ServerCommand, SetupResult } from '../../core/platform/ai-host.port';
import { TranslatePipe } from '../../core/i18n/translate.pipe';

/**
 * Connection of an AI assistant: registers the edimus MCP server in the AI clients found on
 * this PC (the user picks which), with the manual instructions as a fallback.
 */
@Component({
  selector: 'app-ai-setup',
  imports: [NgTemplateOutlet, MatButtonModule, MatCheckboxModule, MatExpansionModule, MatIconModule, MatProgressBarModule, MatTooltipModule, TranslatePipe],
  template: `
      <p class="state" [class.on]="ai.connected()">
        <mat-icon>{{ ai.connected() ? 'link' : 'link_off' }}</mat-icon>
        {{ (ai.connected() ? 'aiSetup.connected' : 'aiSetup.disconnected') | t }}
      </p>
      <p>{{ 'aiSetup.intro' | t }}</p>

      @if (loading()) {
        <mat-progress-bar mode="indeterminate" />
      } @else if (!server()) {
        <p class="warning">{{ 'aiSetup.noServer' | t }}</p>
      } @else {
        <h3>{{ 'aiSetup.auto' | t }}</h3>
        <p class="hint">{{ 'aiSetup.autoHint' | t }}</p>
        <div class="clients">
          @for (client of clients(); track client.id) {
            @let result = resultOf(client.id);
            <div class="client">
              <mat-checkbox [disabled]="!client.detected || busy()" [checked]="selected().has(client.id)" (change)="toggle(client.id)">
                {{ client.name }}
              </mat-checkbox>
              <span class="badge" [class.ok]="result?.ok || (!result && client.configured)" [class.error]="result && !result.ok" [title]="client.target">
                @if (result) {
                  {{ (result.ok ? 'aiSetup.done' : 'aiSetup.failed') | t }}
                } @else if (!client.detected) {
                  {{ 'aiSetup.notInstalled' | t }}
                } @else if (client.configured) {
                  {{ 'aiSetup.configured' | t }}
                }
              </span>
            </div>
            @if (result?.error; as error) {
              <p class="warning detail">{{ error }}</p>
            }
          }
        </div>
        <button mat-flat-button [disabled]="!selected().size || busy()" (click)="configure()">
          <mat-icon>auto_fix_high</mat-icon>
          {{ 'aiSetup.configure' | t }}
        </button>
        @if (results().length) {
          <p class="hint restart">{{ 'aiSetup.restart' | t }}</p>
        }

        <mat-expansion-panel class="manual">
          <mat-expansion-panel-header>{{ 'aiSetup.manual' | t }}</mat-expansion-panel-header>
          <p class="hint">Claude Code</p>
          <ng-container *ngTemplateOutlet="snippet; context: { $implicit: claudeCode() }" />
          <p class="hint">{{ 'aiSetup.jsonHint' | t }}</p>
          <ng-container *ngTemplateOutlet="snippet; context: { $implicit: json() }" />
          <p class="hint">{{ 'aiSetup.otherHint' | t: { command: commandLine() } }}</p>
        </mat-expansion-panel>
      }

      <ng-template #snippet let-text>
        <div class="snippet">
          <pre>{{ text }}</pre>
          <button mat-icon-button (click)="copy(text)" [matTooltip]="(copied() === text ? 'aiSetup.copied' : 'aiSetup.copy') | t">
            <mat-icon>{{ copied() === text ? 'check' : 'content_copy' }}</mat-icon>
          </button>
        </div>
      </ng-template>
  `,
  styles: `
    :host {
      display: block;
    }
    .restart {
      margin-top: 8px;
    }
    h3 {
      font: var(--mat-sys-title-small);
      margin: 16px 0 4px;
    }
    p {
      margin: 0 0 8px;
    }
    .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .state {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--mat-sys-on-surface-variant);
      &.on {
        color: var(--mat-sys-tertiary);
      }
    }
    .warning {
      color: var(--mat-sys-error);
      font: var(--mat-sys-body-small);
    }
    .clients {
      display: grid;
      grid-template-columns: 1fr;
      margin-bottom: 8px;
    }
    .client {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }
    .badge {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-label-medium);
      &.ok {
        color: var(--mat-sys-tertiary);
      }
      &.error {
        color: var(--mat-sys-error);
      }
    }
    .detail {
      margin: -4px 0 8px 40px;
    }
    .manual {
      margin-top: 12px;
    }
    .snippet {
      display: flex;
      align-items: flex-start;
      gap: 4px;
      margin-bottom: 8px;
      padding: 4px 4px 4px 12px;
      border-radius: 8px;
      background: var(--mat-sys-surface-container-highest);
      pre {
        flex: 1 1 auto;
        min-width: 0;
        margin: 8px 0;
        overflow-x: auto;
        font: 12px/1.5 Consolas, 'Cascadia Mono', monospace;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiSetupComponent {
  protected readonly ai = inject(AiBridgeService);
  private readonly setup = inject(AiHostPort);
  private readonly clipboard = inject(Clipboard);

  protected readonly loading = signal(true);
  protected readonly busy = signal(false);
  protected readonly server = signal<ServerCommand | null>(null);
  protected readonly clients = signal<AiClient[]>([]);
  protected readonly selected = signal(new Set<AiClientId>());
  protected readonly results = signal<SetupResult[]>([]);
  protected readonly copied = signal<string | null>(null);

  protected readonly commandLine = computed(() => {
    const server = this.server();
    return server ? [server.command, ...server.args].map((part) => `"${part}"`).join(' ') : '';
  });
  protected readonly claudeCode = computed(() => `claude mcp add --scope user edimus -- ${this.commandLine()}`);
  protected readonly json = computed(() => {
    const server = this.server();
    return server ? JSON.stringify({ mcpServers: { edimus: { command: server.command, args: server.args } } }, null, 2) : '';
  });

  constructor() {
    void this.load();
  }

  private async load(): Promise<void> {
    const server = await this.setup.serverCommand();
    this.server.set(server);
    if (server) {
      const clients = await this.setup.detect(server);
      this.clients.set(clients);
      // proposed: the clients found that do not start this server yet
      this.selected.set(new Set(clients.filter((c) => c.detected && !c.configured).map((c) => c.id)));
    }
    this.loading.set(false);
  }

  protected resultOf(id: AiClientId): SetupResult | undefined {
    return this.results().find((r) => r.id === id);
  }

  protected toggle(id: AiClientId): void {
    this.selected.update((set) => {
      const next = new Set(set);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }

  protected async configure(): Promise<void> {
    const server = this.server();
    if (!server) return;
    this.busy.set(true);
    try {
      this.results.set(await this.setup.configure([...this.selected()], server));
      const clients = await this.setup.detect(server);
      this.clients.set(clients);
      this.selected.set(new Set());
    } finally {
      this.busy.set(false);
    }
  }

  protected copy(text: string): void {
    if (this.clipboard.copy(text)) this.copied.set(text);
  }
}
