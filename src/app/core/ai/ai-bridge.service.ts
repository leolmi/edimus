import { Injectable, effect, inject, signal } from '@angular/core';
import { DocumentService } from '../document.service';
import { AiHostPort, BridgeConfig } from '../platform/ai-host.port';
import { AiCommandsService } from './ai-commands.service';

/** Seconds between two looks for MCP servers. */
const RETRY_MS = 3000;

interface Request {
  type: 'request';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

/**
 * Connections to the edimus MCP servers (mcp/server.mjs), so that an AI can drive this window.
 * Every AI session starts its own server: the platform tells where they are (on the desktop:
 * %USERPROFILE%/.edimus/mcp-<pid>.json, written by each server) and the app connects to all of them,
 * looking again periodically for servers started later.
 */
@Injectable({ providedIn: 'root' })
export class AiBridgeService {
  private readonly commands = inject(AiCommandsService);
  private readonly documents = inject(DocumentService);
  private readonly host = inject(AiHostPort);

  /** Connected to at least one MCP server. */
  readonly connected = signal(false);
  /** A command from the AI is running. */
  readonly busy = signal(false);

  /** Open (or opening) sockets by server address. */
  private readonly sockets = new Map<string, WebSocket>();
  private readonly instanceId = `${this.host.pid ?? 'dev'}-${Math.random().toString(36).slice(2, 6)}`;

  constructor() {
    void this.loop();
    // the servers show the window title in list_instances
    effect(() => this.broadcast({ type: 'title', title: this.documents.title() }));
  }

  private async loop(): Promise<void> {
    for (;;) {
      const configs = await this.host.bridgeConfigs().catch(() => []);
      for (const config of configs) {
        const key = `${config.port}:${config.token}`;
        if (!this.sockets.has(key)) this.connect(key, config);
      }
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }

  private connect(key: string, config: BridgeConfig): void {
    const socket = new WebSocket(`ws://127.0.0.1:${config.port}/?token=${config.token}`);
    this.sockets.set(key, socket);
    socket.onopen = () => {
      this.updateConnected();
      this.send(socket, { type: 'hello', instanceId: this.instanceId, title: this.documents.title(), pid: this.host.pid });
    };
    // a failed attempt ends in close as well: the next look tries again
    socket.onclose = () => {
      if (this.sockets.get(key) === socket) this.sockets.delete(key);
      this.updateConnected();
    };
    socket.onmessage = (event) => void this.onMessage(socket, event.data);
  }

  private updateConnected(): void {
    this.connected.set([...this.sockets.values()].some((s) => s.readyState === WebSocket.OPEN));
  }

  private async onMessage(socket: WebSocket, data: unknown): Promise<void> {
    let message: Request;
    try {
      message = JSON.parse(String(data)) as Request;
    } catch {
      return;
    }
    if (message.type !== 'request') return;
    this.busy.set(true);
    try {
      const result = await this.commands.execute(message.method, message.params);
      this.send(socket, { type: 'response', id: message.id, result });
    } catch (err) {
      this.send(socket, { type: 'response', id: message.id, error: String((err as { message?: string })?.message ?? err) });
    } finally {
      this.busy.set(false);
    }
  }

  private broadcast(message: Record<string, unknown>): void {
    for (const socket of this.sockets.values()) this.send(socket, message);
  }

  private send(socket: WebSocket, message: Record<string, unknown>): void {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(message));
  }
}
