import { Injectable, effect, inject, signal } from '@angular/core';
import { filesystem, os } from '@neutralinojs/lib';
import { DocumentService } from '../document.service';
import { AiCommandsService } from './ai-commands.service';

/** Seconds between two attempts to reach the MCP server. */
const RETRY_MS = 3000;

interface BridgeConfig {
  port: number;
  token: string;
}

interface Request {
  type: 'request';
  id: number;
  method: string;
  params: Record<string, unknown>;
}

/**
 * Connection to the edimus MCP server (mcp/server.mjs), so that an AI can drive this window.
 * The server, when running, writes its port and token to <app data>/edimus/mcp.json: the app
 * reads it and connects, retrying while the server is not there.
 */
@Injectable({ providedIn: 'root' })
export class AiBridgeService {
  private readonly commands = inject(AiCommandsService);
  private readonly documents = inject(DocumentService);

  /** Connected to an MCP server. */
  readonly connected = signal(false);
  /** A command from the AI is running. */
  readonly busy = signal(false);

  private socket?: WebSocket;
  private readonly instanceId = `${window.NL_PID ?? 'dev'}-${Math.random().toString(36).slice(2, 6)}`;

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
    const dataDir = await os.getPath('data');
    const config = JSON.parse(await filesystem.readFile(`${dataDir}/edimus/mcp.json`)) as BridgeConfig;
    await new Promise<void>((resolve, reject) => {
      const socket = new WebSocket(`ws://127.0.0.1:${config.port}/?token=${config.token}`);
      socket.onopen = () => {
        this.socket = socket;
        this.connected.set(true);
        this.send({ type: 'hello', instanceId: this.instanceId, title: this.documents.title(), pid: window.NL_PID });
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
