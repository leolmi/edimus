import { Injectable, effect, inject, signal } from '@angular/core';
import { DocumentService } from '../document.service';
import { AiHostPort } from '../platform/ai-host.port';
import { AiCommandsService } from './ai-commands.service';

/** Seconds between two attempts to reach the MCP server. */
const RETRY_MS = 3000;

interface Request {
  type: 'request';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

/**
 * Connection to the edimus MCP server (mcp/server.mjs), so that an AI can drive this window.
 * The platform tells where the server is (on the desktop: <app data>/edimus/mcp.json, written by
 * the server): the app connects, retrying while the server is not there.
 */
@Injectable({ providedIn: 'root' })
export class AiBridgeService {
  private readonly commands = inject(AiCommandsService);
  private readonly documents = inject(DocumentService);
  private readonly host = inject(AiHostPort);

  /** Connected to an MCP server. */
  readonly connected = signal(false);
  /** A command from the AI is running. */
  readonly busy = signal(false);

  private socket?: WebSocket;
  private readonly instanceId = `${this.host.pid ?? 'dev'}-${Math.random().toString(36).slice(2, 6)}`;

  constructor() {
    void this.loop();
    // the server shows the window title in list_instances
    effect(() => this.send({ type: 'title', title: this.documents.title() }));
  }

  private async loop(): Promise<void> {
    for (;;) {
      if (!this.socket) await this.connect().catch(() => undefined);
      await new Promise((resolve) => setTimeout(resolve, RETRY_MS));
    }
  }

  private async connect(): Promise<void> {
    const config = await this.host.bridgeConfig();
    if (!config) return;
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${config.port}/?token=${config.token}`);
      socket.onopen = () => {
        this.socket = socket;
        this.connected.set(true);
        this.send({ type: 'hello', instanceId: this.instanceId, title: this.documents.title(), pid: this.host.pid });
        resolve();
      };
      socket.onerror = () => reject(new Error('MCP server not reachable'));
      socket.onclose = () => {
        if (this.socket === socket) this.socket = undefined;
        this.connected.set(false);
      };
      socket.onmessage = (event) => void this.onMessage(event.data);
    });
  }

  private async onMessage(data: unknown): Promise<void> {
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
      this.send({ type: 'response', id: message.id, result });
    } catch (err) {
      this.send({ type: 'response', id: message.id, error: String((err as { message?: string })?.message ?? err) });
    } finally {
      this.busy.set(false);
    }
  }

  private send(message: Record<string, unknown>): void {
    if (this.socket?.readyState === WebSocket.OPEN) this.socket.send(JSON.stringify(message));
  }
}
