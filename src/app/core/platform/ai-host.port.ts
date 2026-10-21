/** How an AI client starts the edimus MCP server (forward slashes: valid everywhere on Windows). */
export interface ServerCommand {
  command: string;
  args: string[];
}

export type AiClientId = 'claude-code' | 'claude-desktop' | 'cursor' | 'vscode' | 'windsurf' | 'gemini' | 'codex';

/** An AI client that can use MCP servers. */
export interface AiClient {
  id: AiClientId;
  name: string;
  /** Found on this PC. */
  detected: boolean;
  /** Already starts this server (same command). */
  configured: boolean;
  /** Configuration file (or command) changed by the setup, shown to the user. */
  target: string;
}

export interface SetupResult {
  id: AiClientId;
  ok: boolean;
  error?: string;
}

/** Address of the running MCP server. */
export interface BridgeConfig {
  port: number;
  token: string;
}

/**
 * Where the MCP server is and, where the platform allows it (`PlatformInfo.canSetupAi`), the
 * registration of the server in the AI clients installed on the PC.
 */
export abstract class AiHostPort {
  /** Process id of this window, shown by the server to tell instances apart. */
  abstract readonly pid?: string | number;
  /** Address of the running server, null when it is not known. */
  abstract bridgeConfig(): Promise<BridgeConfig | null>;
  /** Command that starts the server, null when the server is not installed. */
  abstract serverCommand(): Promise<ServerCommand | null>;
  abstract detect(server: ServerCommand): Promise<AiClient[]>;
  abstract configure(ids: AiClientId[], server: ServerCommand): Promise<SetupResult[]>;
}
