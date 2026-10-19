import { os } from '@neutralinojs/lib';
import { nativePath } from './app-paths';
import { dirName } from './montage/montage.model';

/** Shows a file in the file manager of the OS (selected where the OS allows it). */
export async function revealFile(path: string): Promise<void> {
  const native = nativePath(path);
  switch (window.NL_OS) {
    case 'Windows':
      // explorer exits with code 1 even when it works: the result is not checked
      await os.execCommand(`explorer /select,"${native}"`, { background: true });
      return;
    case 'Darwin':
      await os.execCommand(`open -R "${native}"`, { background: true });
      return;
    default:
      // most Linux file managers cannot select a file: open its folder
      await os.execCommand(`xdg-open "${dirName(native)}"`, { background: true });
  }
}
