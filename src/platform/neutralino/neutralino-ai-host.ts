import { Injectable } from '@angular/core';
import { filesystem, os } from '@neutralinojs/lib';
import {
  AiClient,
  AiClientId,
  AiHostPort,
  BridgeConfig,
  ServerCommand,
  SetupResult,
} from '../../app/core/platform/ai-host.port';
import { appPath } from './app-paths';

/** Name of the server in the configuration of the AI clients. */
const SERVER_NAME = 'edimus';

/** A client configured through a JSON file: where it lives and how the server entry looks. */
interface JsonClient {
  id: AiClientId;
  name: string;
  /** Folder whose presence tells that the client is installed. */
  dir: string;
  file: string;
  /** Key of the servers map. */
  key: 'mcpServers' | 'servers';
  entry: (server: ServerCommand) => Record<string, unknown>;
}

const exists = (path: string) =>
  filesystem.getStats(path).then(
    () => true,
    () => false,
  );

const slashes = (path: string) => path.replaceAll('\\', '/');

/** Server entry as found in a client configuration. */
interface ServerEntry {
  command?: string;
  args?: string[];
}

/** The entry starts this server (same command and arguments). */
const sameServer = (entry: ServerEntry | undefined, server: ServerCommand) =>
  !!entry?.command &&
  slashes(entry.command) === server.command &&
  JSON.stringify((entry.args ?? []).map(slashes)) === JSON.stringify(server.args);

/**
 * The MCP server on this PC: its address, written by the server to <app data>/edimus/mcp.json,
 * and its registration in the AI clients found here (Claude Code through its command line, the
 * others by adding an entry to their configuration file, backed up first).
 */
@Injectable()
export class NeutralinoAiHost extends AiHostPort {
  readonly pid = window.NL_PID;

  async bridgeConfig(): Promise<BridgeConfig | null> {
    const dataDir = await os.getPath('data');
    return JSON.parse(await filesystem.readFile(`${dataDir}/edimus/mcp.json`)) as BridgeConfig;
  }

  /**
   * Command that starts the server: the executable next to edimus.exe (portable folder); in the
   * sources node with the script (edits take effect at once), or the executable built there.
   * Null when none is there.
   */
  async serverCommand(): Promise<ServerCommand | null> {
    const dir = slashes(await appPath());
    if (await exists(`${dir}/edimus-mcp.exe`)) return { command: `${dir}/edimus-mcp.exe`, args: [] };
    const script = `${dir}/mcp/server.mjs`;
    if ((await exists(script)) && (await exists(`${dir}/mcp/node_modules`))) return { command: 'node', args: [script] };
    if (await exists(`${dir}/mcp/dist/edimus-mcp.exe`)) return { command: `${dir}/mcp/dist/edimus-mcp.exe`, args: [] };
    return null;
  }

  async detect(server: ServerCommand): Promise<AiClient[]> {
    const clients: AiClient[] = [];
    const claude = await this.run('claude --version');
    // user-scope servers of Claude Code are in ~/.claude.json (read it: "claude mcp get" would
    // start a second server to check it)
    const home = slashes(await os.getEnv('USERPROFILE'));
    const claudeConfig = claude ? await this.readJson(`${home}/.claude.json`).catch(() => null) : null;
    const registered = (claudeConfig?.['mcpServers'] as Record<string, ServerEntry> | undefined)?.[SERVER_NAME];
    clients.push({
      id: 'claude-code',
      name: 'Claude Code',
      detected: claude,
      configured: sameServer(registered, server),
      target: `claude mcp add --scope user ${SERVER_NAME}`,
    });
    for (const client of await this.jsonClients()) {
      const detected = await exists(client.dir);
      const config = detected ? await this.readJson(client.file).catch(() => null) : null;
      const entry = (config?.[client.key] as Record<string, ServerEntry> | undefined)?.[SERVER_NAME];
      clients.push({ id: client.id, name: client.name, detected, configured: sameServer(entry, server), target: client.file });
    }
    const codex = await this.codexFiles();
    const toml = (await exists(codex.dir)) ? await filesystem.readFile(codex.file).catch(() => '') : null;
    clients.push({
      id: 'codex',
      name: 'Codex CLI',
      detected: toml !== null,
      configured: !!toml && toml.includes(`[mcp_servers.${SERVER_NAME}]`) && toml.includes(server.command),
      target: codex.file,
    });
    return clients;
  }

  async configure(ids: AiClientId[], server: ServerCommand): Promise<SetupResult[]> {
    const results: SetupResult[] = [];
    const jsonClients = await this.jsonClients();
    for (const id of ids) {
      try {
        if (id === 'claude-code') await this.configureClaudeCode(server);
        else if (id === 'codex') await this.configureCodex(server);
        else await this.configureJson(jsonClients.find((c) => c.id === id)!, server);
        results.push({ id, ok: true });
      } catch (err) {
        results.push({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
      }
    }
    return results;
  }

  private async configureClaudeCode(server: ServerCommand): Promise<void> {
    // replaces a previous registration (e.g. from another folder)
    await os.execCommand(`claude mcp remove --scope user ${SERVER_NAME}`).catch(() => undefined);
    const command = [server.command, ...server.args].map((part) => `"${part}"`).join(' ');
    const result = await os.execCommand(`claude mcp add --scope user ${SERVER_NAME} -- ${command}`);
    if (result.exitCode !== 0) throw new Error(result.stdErr.trim() || result.stdOut.trim() || `exit code ${result.exitCode}`);
  }

  /** Adds (or replaces) the edimus entry, keeping everything else; a file that is not plain JSON is left alone. */
  private async configureJson(client: JsonClient, server: ServerCommand): Promise<void> {
    let config: Record<string, unknown> = {};
    if (await exists(client.file)) {
      try {
        config = await this.readJson(client.file);
      } catch {
        throw new Error(`${client.file}: not plain JSON (comments?), add the server by hand`);
      }
      await this.backup(client.file);
    }
    const servers = { ...((config[client.key] as Record<string, unknown> | undefined) ?? {}), [SERVER_NAME]: client.entry(server) };
    await filesystem.writeFile(client.file, JSON.stringify({ ...config, [client.key]: servers }, null, 2) + '\n');
  }

  /** Codex CLI: TOML table [mcp_servers.edimus], replaced if already there. */
  private async configureCodex(server: ServerCommand): Promise<void> {
    const { file } = await this.codexFiles();
    let toml = '';
    if (await exists(file)) {
      toml = await filesystem.readFile(file);
      await this.backup(file);
    }
    const lines = toml.split(/\r?\n/);
    const start = lines.findIndex((line) => line.trim() === `[mcp_servers.${SERVER_NAME}]`);
    if (start >= 0) {
      let end = start + 1;
      while (end < lines.length && !lines[end].trim().startsWith('[')) end++;
      lines.splice(start, end - start);
    }
    const quote = (value: string) => JSON.stringify(value);
    const table = [`[mcp_servers.${SERVER_NAME}]`, `command = ${quote(server.command)}`, `args = [${server.args.map(quote).join(', ')}]`];
    const body = lines.join('\n').trimEnd();
    await filesystem.writeFile(file, `${body ? body + '\n\n' : ''}${table.join('\n')}\n`);
  }

  private async jsonClients(): Promise<JsonClient[]> {
    const home = slashes(await os.getEnv('USERPROFILE'));
    const appData = slashes(await os.getPath('data'));
    const standard = (server: ServerCommand) => ({ command: server.command, args: server.args });
    return [
      { id: 'claude-desktop', name: 'Claude Desktop', dir: `${appData}/Claude`, file: `${appData}/Claude/claude_desktop_config.json`, key: 'mcpServers', entry: standard },
      { id: 'cursor', name: 'Cursor', dir: `${home}/.cursor`, file: `${home}/.cursor/mcp.json`, key: 'mcpServers', entry: standard },
      {
        id: 'vscode',
        name: 'VS Code (Copilot)',
        dir: `${appData}/Code/User`,
        file: `${appData}/Code/User/mcp.json`,
        key: 'servers',
        entry: (server) => ({ type: 'stdio', ...standard(server) }),
      },
      { id: 'windsurf', name: 'Windsurf', dir: `${home}/.codeium/windsurf`, file: `${home}/.codeium/windsurf/mcp_config.json`, key: 'mcpServers', entry: standard },
      { id: 'gemini', name: 'Gemini CLI', dir: `${home}/.gemini`, file: `${home}/.gemini/settings.json`, key: 'mcpServers', entry: standard },
    ];
  }

  private async codexFiles(): Promise<{ dir: string; file: string }> {
    const home = slashes(await os.getEnv('USERPROFILE'));
    return { dir: `${home}/.codex`, file: `${home}/.codex/config.toml` };
  }

  /** Copy of a configuration file before changing it (`<file>.bak-edimus`, the last one kept). */
  private async backup(path: string): Promise<void> {
    await filesystem.writeFile(`${path}.bak-edimus`, await filesystem.readFile(path));
  }

  private async readJson(path: string): Promise<Record<string, unknown>> {
    const text = (await filesystem.readFile(path)).trim();
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  }

  /** Runs a command: true when it succeeds. */
  private async run(command: string): Promise<boolean> {
    try {
      const result = await os.execCommand(command);
      return result.exitCode === 0;
    } catch {
      return false;
    }
  }
}
