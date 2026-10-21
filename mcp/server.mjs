#!/usr/bin/env node
// edimus MCP server: lets an AI drive a running edimus instance.
//
//   Claude ──stdio──▶ this server ──WebSocket 127.0.0.1──▶ edimus (connects by itself)
//
// The server listens on 127.0.0.1 only and writes port and token to %APPDATA%/edimus/mcp.json
// (~/.config/edimus/mcp.json elsewhere): the app reads that file and connects; every edit made
// through the tools is an ordinary, undoable edit of the montage shown in the app.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { spawn } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { isSea } from 'node:sea';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import { z } from 'zod';
import { GUIDE } from './guide.mjs';

const PORT = Number(process.env.EDIMUS_MCP_PORT ?? 47816);
const CALL_TIMEOUT = 120_000;
/** Built as a single executable (edimus-mcp.exe, see build-exe.mjs): it sits next to edimus.exe. */
const packaged = isSea();
const here = packaged ? dirname(process.execPath) : dirname(fileURLToPath(import.meta.url));
const appExe = process.platform === 'win32' ? 'edimus.exe' : 'edimus';
const defaultExe = packaged ? join(here, appExe) : join(here, '..', 'release', 'edimus', appExe);
const configDir = process.env.APPDATA ? join(process.env.APPDATA, 'edimus') : join(homedir(), '.config', 'edimus');
const configFile = join(configDir, 'mcp.json');
const token = randomBytes(24).toString('hex');
const log = (...args) => console.error('[edimus-mcp]', ...args);

// ---------------------------------------------------------------------------------------
// bridge to the app instances

/** @type {Map<string, { ws: import('ws').WebSocket, title: string, pid: number, connectedAt: number }>} */
const instances = new Map();
/** @type {Map<number, { resolve: (v: unknown) => void, reject: (e: Error) => void, timer: NodeJS.Timeout }>} */
const pending = new Map();
let selected = null;
let nextId = 1;

const wss = new WebSocketServer({ host: '127.0.0.1', port: PORT });
wss.on('listening', () => {
  mkdirSync(configDir, { recursive: true });
  writeFileSync(configFile, JSON.stringify({ port: PORT, token, pid: process.pid }, null, 2));
  log(`listening on 127.0.0.1:${PORT}, config in ${configFile}`);
});
wss.on('error', (err) => log('bridge error:', err.message));
wss.on('connection', (ws, request) => {
  const url = new URL(request.url ?? '/', 'http://localhost');
  if (url.searchParams.get('token') !== token) {
    ws.close(4001, 'invalid token');
    return;
  }
  let instanceId = null;
  ws.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(String(raw));
    } catch {
      return;
    }
    if (message.type === 'hello') {
      instanceId = String(message.instanceId);
      instances.set(instanceId, { ws, title: message.title ?? '', pid: message.pid ?? 0, connectedAt: Date.now() });
      if (!selected || !instances.has(selected)) selected = instanceId;
      log(`instance connected: ${instanceId} (${message.title})`);
    } else if (message.type === 'title' && instanceId && instances.has(instanceId)) {
      instances.get(instanceId).title = message.title ?? '';
    } else if (message.type === 'response') {
      const call = pending.get(message.id);
      if (!call) return;
      pending.delete(message.id);
      clearTimeout(call.timer);
      if (message.error) call.reject(new Error(message.error));
      else call.resolve(message.result);
    }
  });
  ws.on('close', () => {
    if (!instanceId) return;
    instances.delete(instanceId);
    if (selected === instanceId) selected = [...instances.keys()].pop() ?? null;
    log(`instance disconnected: ${instanceId}`);
  });
});

function cleanup() {
  try {
    rmSync(configFile, { force: true });
  } catch {
    // ignore
  }
}
process.on('exit', cleanup);
process.on('SIGINT', () => process.exit(0));
process.on('SIGTERM', () => process.exit(0));
// the client closing stdio ends the server (a stale mcp.json left by a hard kill is harmless:
// the app simply fails to connect and retries)
process.stdin.on('close', () => process.exit(0));

function target(instance) {
  const id = instance ?? selected;
  if (!id || !instances.has(id)) {
    const list = [...instances.entries()].map(([key, i]) => `${key} (${i.title})`).join(', ');
    throw new Error(
      instances.size
        ? `Instance ${id} not found. Connected instances: ${list}`
        : 'No edimus instance is connected: start edimus (tool launch_edimus) and wait a few seconds for it to connect.',
    );
  }
  return instances.get(id);
}

/** Calls a method of the app and waits for its answer. */
function call(method, params = {}, instance) {
  const { ws } = target(instance);
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`edimus did not answer ${method} within ${CALL_TIMEOUT / 1000} s`));
    }, CALL_TIMEOUT);
    pending.set(id, { resolve, reject, timer });
    ws.send(JSON.stringify({ type: 'request', id, method, params }));
  });
}

// ---------------------------------------------------------------------------------------
// MCP server

const server = new McpServer(
  { name: 'edimus', version: '1.3.0' },
  {
    instructions:
      'edimus is a non-destructive audio montage editor running on this PC. Read the resource ' +
      'edimus://guide (or call get_guide) before editing: times are seconds on the timeline, volumes are dB, ' +
      'every edit is undoable. Start from get_state to learn the ids of tracks, clips and sources.',
  },
);

const text = (value) => ({ content: [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value, null, 1) }] });
const failure = (err) => ({ content: [{ type: 'text', text: `Error: ${err.message ?? err}` }], isError: true });

const instanceParam = { instance: z.string().optional().describe('Instance id (see list_instances); default: the selected one') };

/** Registers a tool executed by the app. */
function appTool(name, title, description, input, annotations = {}) {
  server.registerTool(
    name,
    { title, description, inputSchema: { ...input, ...instanceParam }, annotations },
    async (args) => {
      try {
        const { instance, ...params } = args ?? {};
        const result = await call(name, params, instance);
        if (result && typeof result === 'object' && result.image) {
          return {
            content: [
              { type: 'image', data: result.image, mimeType: 'image/png' },
              ...(result.text ? [{ type: 'text', text: result.text }] : []),
            ],
          };
        }
        return text(result);
      } catch (err) {
        return failure(err);
      }
    },
  );
}

server.registerResource(
  'guide',
  'edimus://guide',
  { title: 'edimus guide', description: 'Data model, units and workflow of edimus', mimeType: 'text/markdown' },
  async (uri) => ({ contents: [{ uri: uri.href, mimeType: 'text/markdown', text: GUIDE }] }),
);

server.registerTool(
  'get_guide',
  { title: 'Guide', description: 'How edimus works: data model, units, typical workflows. Read it first.', annotations: { readOnlyHint: true } },
  async () => text(GUIDE),
);

// --- instances ---------------------------------------------------------------------------
server.registerTool(
  'list_instances',
  {
    title: 'List instances',
    description: 'Running edimus windows connected to this server (each one holds one montage), and which one is selected.',
    annotations: { readOnlyHint: true },
  },
  async () =>
    text({
      selected,
      instances: [...instances.entries()].map(([id, i]) => ({ id, title: i.title, pid: i.pid })),
    }),
);

server.registerTool(
  'select_instance',
  {
    title: 'Select instance',
    description: 'Chooses the edimus window that the other tools act on.',
    inputSchema: { instance: z.string().describe('Instance id from list_instances') },
  },
  async ({ instance }) => {
    try {
      target(instance);
      selected = instance;
      return text(`Selected ${instance} (${instances.get(instance).title})`);
    } catch (err) {
      return failure(err);
    }
  },
);

server.registerTool(
  'launch_edimus',
  {
    title: 'Launch edimus',
    description:
      'Starts a new edimus window (optionally opening files) and waits until it connects. ' +
      'Uses EDIMUS_EXE, or edimus.exe next to this server (the portable build when run from the sources).',
    inputSchema: { files: z.array(z.string()).optional().describe('Audio files or a .edimus montage to open') },
  },
  async ({ files }) => {
    const exe = process.env.EDIMUS_EXE ?? defaultExe;
    if (!existsSync(exe)) return failure(new Error(`edimus executable not found: ${exe} (set EDIMUS_EXE)`));
    const before = new Set(instances.keys());
    const args = (files ?? []).map((f) => `--edimus-open=${f}`);
    spawn(exe, args, { cwd: dirname(exe), detached: true, stdio: 'ignore' }).unref();
    for (let i = 0; i < 60; i++) {
      await new Promise((r) => setTimeout(r, 500));
      const fresh = [...instances.keys()].find((id) => !before.has(id));
      if (fresh) {
        selected = fresh;
        return text(`edimus started and connected as ${fresh}`);
      }
    }
    return failure(new Error('edimus started but did not connect within 30 s'));
  },
);

// --- observe -----------------------------------------------------------------------------
appTool(
  'get_state',
  'Montage state',
  'The montage: file, audible span (mix without leading/trailing silence), tracks (mute/solo, volume envelope), clips (timeline start/end, source offset, speed, pitch, BPM), ' +
    'sources (file, format, length, tempo), playhead, selection. Ids returned here are used by all the other tools.',
  {},
  { readOnlyHint: true },
);

// --- project -------------------------------------------------------------------------------
appTool(
  'new_montage',
  'New montage',
  'Clears the window to a new, empty montage. Fails when there are unsaved changes, unless discard is true.',
  { discard: z.boolean().optional().describe('Discard unsaved changes') },
  { destructiveHint: true },
);
appTool(
  'open',
  'Open files',
  'Opens files: a .edimus montage or .edimuspack bundle replaces the current one (fails with unsaved changes unless discard is true); ' +
    'audio files are added as new tracks (or to trackId from start); an audio file of a missing source (same content, or same name) relinks it instead.',
  {
    paths: z.array(z.string()).min(1).describe('Absolute paths'),
    trackId: z.string().optional().describe('Add the audio files to this track, one after the other'),
    start: z.number().min(0).optional().describe('Timeline time (s) of the first added file, with trackId'),
    discard: z.boolean().optional(),
  },
);
appTool(
  'save',
  'Save montage',
  'Saves the montage (.edimus, or .edimuspack for a bundle with copies of the audio files). Without path saves over its file (fails for a never saved montage). ' +
    'A different existing file is overwritten only with overwrite true.',
  { path: z.string().optional(), overwrite: z.boolean().optional() },
);
appTool(
  'export',
  'Export mixdown',
  'Renders the mix of the audible tracks to one audio file. Formats: wav, flac, mp3, ogg, opus, m4a (web version: wav, mp3, ogg). ' +
    'Existing files are overwritten only with overwrite true.',
  {
    path: z.string().describe('Output file; the extension is added if missing'),
    format: z.enum(['wav', 'flac', 'mp3', 'ogg', 'opus', 'm4a']),
    channels: z.union([z.literal(1), z.literal(2)]).optional(),
    sampleRate: z.number().int().optional().describe('Hz (default: highest among the sources; opus is always 48000)'),
    bitDepth: z.union([z.literal(16), z.literal(24), z.literal(32)]).optional().describe('wav/flac'),
    bitrate: z.number().int().optional().describe('kbps, mp3/opus/m4a'),
    quality: z.number().min(0).max(10).optional().describe('ogg vorbis 0–10'),
    normalize: z.boolean().optional().describe('Peak at -1 dBFS'),
    overwrite: z.boolean().optional(),
  },
);

// --- transport and history -------------------------------------------------------------------
appTool('play', 'Play', 'Plays the montage from `from` (default: playhead), stopping at `to` if given.', {
  from: z.number().min(0).optional(),
  to: z.number().min(0).optional(),
});
appTool('stop', 'Stop', 'Stops the playback (playhead stays where it is).', {});
appTool('seek', 'Move playhead', 'Moves the playhead to a timeline time.', { time: z.number().min(0) });
appTool(
  'select',
  'Select',
  'Sets the selection shown in the window: clips (empty or omitted = none) and time range [from, to) (omitted = none). ' +
    'The user then acts on it with the toolbar (delete, split, crossfade, drag together).',
  { clipIds: z.array(z.string()).optional(), from: z.number().min(0).optional(), to: z.number().min(0).optional() },
);
appTool('undo', 'Undo', 'Undoes the last edit (also edits made by hand).', {});
appTool('redo', 'Redo', 'Redoes the last undone edit.', {});

// --- clips and tracks ------------------------------------------------------------------------
appTool(
  'move_clip',
  'Move clip',
  'Moves a clip in time and/or to another track (trackId), or to a new track (newTrack true).',
  {
    clipId: z.string(),
    start: z.number().min(0).optional().describe('New timeline start (s)'),
    trackId: z.string().optional(),
    newTrack: z.boolean().optional(),
  },
);
appTool(
  'trim_clip',
  'Trim clip',
  'Moves the start and/or end edge of a clip (timeline seconds); the other edge stays. The audio cannot extend beyond its source.',
  { clipId: z.string(), start: z.number().min(0).optional(), end: z.number().min(0).optional() },
);
appTool(
  'split',
  'Split',
  'Splits the clips crossing `time` in two (only clipIds if given). Returns the new clips.',
  { time: z.number().min(0), clipIds: z.array(z.string()).optional() },
);
appTool('delete_clip', 'Delete clip', 'Removes a clip (and its track when it was the last clip).', { clipId: z.string() }, { destructiveHint: true });
appTool(
  'delete_range',
  'Delete range',
  'Removes [from, to) from every track and moves what follows back to close the gap (envelopes too).',
  { from: z.number().min(0), to: z.number().min(0) },
  { destructiveHint: true },
);
appTool(
  'crop',
  'Crop',
  'Keeps only [from, to) of every track, moved to the start of the timeline.',
  { from: z.number().min(0), to: z.number().min(0) },
  { destructiveHint: true },
);
appTool('set_track', 'Track properties', 'Renames, mutes or solos a track, or sets the volume of the whole track (dB).', {
  trackId: z.string(),
  name: z.string().optional(),
  muted: z.boolean().optional(),
  solo: z.boolean().optional(),
  volumeDb: z.number().max(6).optional().describe('Volume of the whole track in dB (0 = unchanged, max +6)'),
});
appTool('delete_track', 'Delete track', 'Removes a track with its clips.', { trackId: z.string() }, { destructiveHint: true });

// --- volume ----------------------------------------------------------------------------------
const pointSchema = z.object({
  time: z.number().min(0).describe('Timeline seconds'),
  gainDb: z.number().max(6).describe('Volume in dB (0 = unchanged, -100 or less = silence, max +6)'),
  curve: z.number().min(-10).max(10).optional().describe('Bend of the segment to the next point: 0 straight, >0 slow start, <0 fast start'),
});
appTool(
  'set_envelope',
  'Set clip volume envelope',
  'Replaces the volume envelope of a clip (times in timeline seconds; empty list = no envelope, unity gain). ' +
    'The envelope belongs to the clip: it moves, splits, trims and stretches with it.',
  { clipId: z.string(), points: z.array(pointSchema) },
);
appTool(
  'fade',
  'Fade in/out',
  'Adds a fade-in (silence → current level) or fade-out (current level → silence) to a clip: over `length` seconds at its ' +
    'start (in) or end (out), or between two timeline times from/to. The clip is silent before a fade-in and after a ' +
    'fade-out; the rest of its envelope is kept. Shapes: linear, exponential (slow start), logarithmic (fast start), smooth.',
  {
    clipId: z.string(),
    type: z.enum(['in', 'out']),
    length: z.number().positive().optional(),
    from: z.number().min(0).optional(),
    to: z.number().min(0).optional(),
    shape: z.enum(['linear', 'exponential', 'logarithmic', 'smooth']).optional(),
  },
);
appTool(
  'crossfade',
  'Crossfade',
  'Equal-power crossfade where a clip ends over another one starting (any track): fades out the first and fades in ' +
    'the second over their overlap clamped to [from, to] (in the two clip envelopes). With clipIds only those ' +
    'clips are paired and from/to may be omitted (whole overlap). Returns the span used.',
  { clipIds: z.array(z.string()).min(2).optional(), from: z.number().min(0).optional(), to: z.number().min(0).optional() },
);

// --- speed, pitch, tempo ------------------------------------------------------------------------
appTool(
  'set_clip_timing',
  'Speed and pitch',
  'Changes the speed of a clip by factor (rate), by target length (s) or by target BPM, and its pitch (semitones). ' +
    'mode stretch keeps the pitch (Rubber Band); varispeed lets the pitch follow the speed (pitch is then extra).',
  {
    clipId: z.string(),
    rate: z.number().min(0.25).max(4).optional(),
    length: z.number().positive().optional(),
    bpm: z.number().positive().optional(),
    pitch: z.number().min(-24).max(24).optional(),
    mode: z.enum(['stretch', 'varispeed']).optional(),
  },
);
appTool(
  'set_tempo',
  'Set source tempo',
  'Sets by hand the tempo of the source of a clip (BPM and time of a downbeat in source seconds), or with reset true goes back to the detected one.',
  {
    clipId: z.string(),
    bpm: z.number().min(20).max(400).optional(),
    firstBeat: z.number().min(0).optional(),
    reset: z.boolean().optional(),
  },
);
appTool(
  'align_tempo',
  'Align tempo',
  'Brings clips to a common tempo: the reference one (target reference), a common one in between (middle, all clips change) ' +
    'or a given bpm (custom); mode stretch/varispeed; alignBars moves the adapted clips so their bars start on the reference bars.',
  {
    referenceClipId: z.string(),
    targetClipIds: z.array(z.string()).min(1),
    target: z.enum(['reference', 'middle', 'custom']).optional(),
    bpm: z.number().positive().optional(),
    mode: z.enum(['stretch', 'varispeed']).optional(),
    alignBars: z.boolean().optional(),
  },
);

// --- analysis --------------------------------------------------------------------------------
appTool(
  'analyze_levels',
  'Levels',
  'Peak and RMS (dB) in consecutive windows: of a clip as heard (speed, pitch and track envelope applied) or of the mix in [from, to).',
  {
    clipId: z.string().optional(),
    from: z.number().min(0).optional(),
    to: z.number().min(0).optional(),
    windows: z.number().int().min(1).max(500).optional().describe('Number of windows (default 40)'),
  },
  { readOnlyHint: true },
);
appTool(
  'find_silence',
  'Find silence',
  'Intervals (timeline seconds) where the clip or the mix stays below thresholdDb for at least minDuration.',
  {
    clipId: z.string().optional(),
    from: z.number().min(0).optional(),
    to: z.number().min(0).optional(),
    thresholdDb: z.number().max(0).optional().describe('Default -45'),
    minDuration: z.number().positive().optional().describe('Seconds, default 0.5'),
  },
  { readOnlyHint: true },
);
appTool(
  'get_beats',
  'Beats',
  'Beat and bar times (timeline seconds) of a clip with a known tempo, in [from, to) (default: the whole clip, at most 400 beats).',
  { clipId: z.string(), from: z.number().min(0).optional(), to: z.number().min(0).optional() },
  { readOnlyHint: true },
);
appTool('snapshot', 'Timeline image', 'PNG image of the timeline as currently shown (tracks, waveforms, envelopes, playhead).', {}, { readOnlyHint: true });

// no top-level await: the executable build bundles this file as CommonJS
server.connect(new StdioServerTransport()).then(() => log('MCP server ready'));
