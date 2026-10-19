// End-to-end check of the MCP server against a running edimus: `node test-client.mjs`.
// Needs edimus open (it connects to the server by itself within a few seconds).
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const samples = join(here, '..', 'samples').replaceAll('\\', '/');
const client = new Client({ name: 'edimus-test', version: '0.1.0' });
await client.connect(new StdioClientTransport({ command: process.execPath, args: [join(here, 'server.mjs')], stderr: 'inherit' }));

const show = (name, result) => {
  const text = result.content.filter((c) => c.type === 'text').map((c) => c.text).join('\n');
  console.log(`\n### ${name}${result.isError ? ' (ERROR)' : ''}\n${text.length > 1500 ? text.slice(0, 1500) + ' …' : text}`);
  return text;
};
const callTool = async (name, args = {}) => {
  const result = await client.callTool({ name, arguments: args });
  const text = show(name, result);
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
};

const tools = await client.listTools();
console.log('tools:', tools.tools.map((t) => t.name).join(', '));

// wait for the app to connect
let instances;
for (let i = 0; i < 20; i++) {
  instances = JSON.parse((await client.callTool({ name: 'list_instances', arguments: {} })).content[0].text);
  if (instances.instances.length) break;
  await new Promise((r) => setTimeout(r, 1000));
}
console.log('instances:', JSON.stringify(instances));
if (process.argv.includes('--instance')) await callTool('select_instance', { instance: process.argv[process.argv.indexOf('--instance') + 1] });

await callTool('new_montage', { discard: true });
const opened = await callTool('open', { paths: [`${samples}/beat-128.mp3`, `${samples}/beat-95.mp3`] });
const [t1, t2] = opened.tracks;
const c1 = t1.clips[0].id;
const c2 = t2.clips[0].id;
await callTool('trim_clip', { clipId: c1, start: 1, end: 25 });
await callTool('move_clip', { clipId: c2, start: 3 });
await callTool('split', { time: 10, clipIds: [c1] });
await callTool('fade', { trackId: t1.id, type: 'out', from: 20, to: 25, shape: 'logarithmic' });
await callTool('fade', { trackId: t2.id, type: 'in', from: 3, to: 6, shape: 'exponential' });
await callTool('set_clip_timing', { clipId: c2, bpm: 128.05, mode: 'stretch' });
await callTool('align_tempo', { referenceClipId: c1, targetClipIds: [c2], alignBars: true });
await callTool('get_beats', { clipId: c2, from: 5, to: 8 });
await callTool('analyze_levels', { from: 0, to: 10, windows: 5 });
await callTool('find_silence', { clipId: c2, thresholdDb: -60, minDuration: 0.05 });
await callTool('set_track', { trackId: t2.id, name: 'beat 95→128' });
const state = await callTool('get_state');
const snap = await client.callTool({ name: 'snapshot', arguments: {} });
const image = snap.content.find((c) => c.type === 'image');
if (image) {
  writeFileSync(join(here, '..', 'samples', 'mcp-snapshot.png'), Buffer.from(image.data, 'base64'));
  console.log('\n### snapshot saved to samples/mcp-snapshot.png');
} else show('snapshot', snap);
await callTool('save', { path: `${samples}/mcp-test.edimus`, overwrite: true });
await callTool('export', { path: `${samples}/mcp-test.mp3`, format: 'mp3', overwrite: true, normalize: true });
await callTool('undo');
await callTool('play', { from: 0, to: 1 });
console.log('\nfinal duration:', state.duration);
await client.close();
process.exit(0);
