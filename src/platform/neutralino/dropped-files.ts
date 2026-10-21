import { filesystem, os } from '@neutralinojs/lib';
import { appPath } from './app-paths';
import { fileName } from '../../app/core/montage/montage.model';

/** Bytes written per call when copying a dropped file (Neutralino transfers files through its socket). */
const WRITE_CHUNK = 8 * 1024 * 1024;

/** Items selected in the open File Explorer windows (the ones being dragged, in a drag from Explorer). */
const EXPLORER_SELECTION = `
$shell = New-Object -ComObject Shell.Application
$items = foreach ($w in $shell.Windows()) {
  try { foreach ($i in $w.Document.SelectedItems()) { [pscustomobject]@{ path = $i.Path; size = [long]$i.Size } } } catch {}
}
ConvertTo-Json -Compress -InputObject @($items)
`;

interface SelectedItem {
  path: string;
  size: number;
}

/** Runs a PowerShell script (encoded, so no quoting issue with cmd.exe) and returns its output. */
async function powershell(script: string): Promise<string> {
  const utf16 = new Uint8Array(new Uint16Array([...script].map((c) => c.charCodeAt(0))).buffer);
  const encoded = btoa(String.fromCharCode(...utf16));
  const result = await os.execCommand(`powershell -NoProfile -NonInteractive -EncodedCommand ${encoded}`);
  if (result.exitCode !== 0) throw new Error(result.stdErr);
  return result.stdOut;
}

async function explorerSelection(): Promise<SelectedItem[]> {
  if (window.NL_OS !== 'Windows') return [];
  try {
    const items = JSON.parse((await powershell(EXPLORER_SELECTION)).trim() || '[]') as SelectedItem[];
    return items.filter((i) => i?.path);
  } catch {
    return [];
  }
}

/** Copies a dropped file into the imports folder of the app, returning its new path. */
async function importCopy(file: File): Promise<string> {
  const dir = `${await appPath()}/imports`;
  await filesystem.createDirectory(dir).catch(() => undefined);
  const dot = file.name.lastIndexOf('.');
  const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
  const ext = dot > 0 ? file.name.slice(dot) : '';
  let path = `${dir}/${file.name}`;
  for (let n = 2; await filesystem.getStats(path).then(() => true, () => false); n++) path = `${dir}/${stem} (${n})${ext}`;
  const bytes = await file.arrayBuffer();
  await filesystem.writeBinaryFile(path, bytes.slice(0, Math.min(WRITE_CHUNK, bytes.byteLength)));
  for (let offset = WRITE_CHUNK; offset < bytes.byteLength; offset += WRITE_CHUNK) {
    await filesystem.appendBinaryFile(path, bytes.slice(offset, offset + WRITE_CHUNK));
  }
  return path;
}

/**
 * Real paths of files dropped on the page: the web view gives only their content, so they are
 * matched (name and size) with the items selected in File Explorer, where a drag usually starts.
 * Files not found there are copied into the imports folder of the app.
 */
export async function resolveDroppedFiles(files: File[]): Promise<{ paths: string[]; imported: number }> {
  const selection = await explorerSelection();
  const paths: string[] = [];
  let imported = 0;
  for (const file of files) {
    const match = selection.find((i) => fileName(i.path).toLowerCase() === file.name.toLowerCase() && Number(i.size) === file.size);
    if (match) {
      paths.push(match.path.replaceAll('\\', '/'));
    } else {
      paths.push(await importCopy(file));
      imported++;
    }
  }
  return { paths, imported };
}
