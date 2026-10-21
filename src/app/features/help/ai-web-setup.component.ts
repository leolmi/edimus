import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatIconModule } from '@angular/material/icon';
import { MatInputModule } from '@angular/material/input';
import { AiBridgeService } from '../../core/ai/ai-bridge.service';
import { TranslatePipe } from '../../core/i18n/translate.pipe';
import { SettingsService } from '../../core/settings.service';

/** Default port of the bridge of the MCP server (EDIMUS_MCP_PORT changes it). */
const DEFAULT_PORT = 47816;

/**
 * Connection of an AI assistant from the browser: the page cannot read the address of the MCP
 * server from the PC, so the user copies port and token from the file written by the server.
 */
@Component({
  selector: 'app-ai-web-setup',
  imports: [MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, TranslatePipe],
  template: `
    <p class="state" [class.on]="ai.connected()">
      <mat-icon>{{ ai.connected() ? 'link' : 'link_off' }}</mat-icon>
      {{ (ai.connected() ? 'aiSetup.connected' : 'aiSetup.disconnected') | t }}
    </p>
    <p>{{ 'aiWeb.intro' | t }}</p>
    <p class="hint">{{ 'aiWeb.where' | t }}</p>
    <div class="fields">
      <mat-form-field class="port">
        <mat-label>{{ 'aiWeb.port' | t }}</mat-label>
        <input matInput type="number" [value]="port()" (input)="port.set(+$any($event.target).value)" />
      </mat-form-field>
      <mat-form-field class="token">
        <mat-label>{{ 'aiWeb.token' | t }}</mat-label>
        <input matInput [value]="token()" (input)="token.set($any($event.target).value.trim())" />
      </mat-form-field>
    </div>
    <button mat-flat-button [disabled]="!port() || !token()" (click)="save()">
      <mat-icon>link</mat-icon>
      {{ 'aiWeb.connect' | t }}
    </button>
  `,
  styles: `
    .state {
      display: flex;
      align-items: center;
      gap: 8px;
      color: var(--mat-sys-on-surface-variant);
    }
    .state.on {
      color: var(--mat-sys-primary);
    }
    .hint {
      color: var(--mat-sys-on-surface-variant);
      font: var(--mat-sys-body-small);
    }
    .fields {
      display: flex;
      gap: 12px;
    }
    .port {
      width: 120px;
    }
    .token {
      flex: 1 1 auto;
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AiWebSetupComponent {
  protected readonly ai = inject(AiBridgeService);
  private readonly settings = inject(SettingsService);

  protected readonly port = signal(this.settings.aiBridge()?.port ?? DEFAULT_PORT);
  protected readonly token = signal(this.settings.aiBridge()?.token ?? '');

  protected save(): void {
    this.settings.setAiBridge({ port: this.port(), token: this.token() });
  }
}
