import { Injectable } from '@angular/core';
import { Subject } from 'rxjs';

/** Where files were dropped: a track (and the x under the pointer, px from the lane start) or the empty strips. */
export type DropTarget = { kind: 'track'; trackId: string; x: number } | { kind: 'new' } | { kind: 'none' };

export interface FileDrop {
  files: File[];
  target: DropTarget;
}

/** Class set on the drop zone under the pointer while dragging files over the window. */
const OVER_CLASS = 'drop-over';

/**
 * Drop of files from the OS on the page: accepts the drag, highlights the zone under the
 * pointer (elements with a `data-drop-track` attribute) and reports the dropped files with
 * their target. The web view gives the content of the files, not their path (see
 * resolveDroppedFiles).
 */
@Injectable({ providedIn: 'root' })
export class DropTargetService {
  readonly drops = new Subject<FileDrop>();
  private over?: HTMLElement;

  constructor() {
    document.addEventListener('dragover', (e) => {
      if (!e.dataTransfer?.types.includes('Files')) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      this.highlight(this.zoneAt(e.clientX, e.clientY));
    });
    document.addEventListener('dragleave', (e) => {
      // leaving the window (no related target) clears the highlight
      if (!e.relatedTarget) this.highlight(undefined);
    });
    document.addEventListener('drop', (e) => {
      e.preventDefault();
      this.highlight(undefined);
      const files = [...(e.dataTransfer?.files ?? [])];
      if (files.length) this.drops.next({ files, target: this.targetAt(e.clientX, e.clientY) });
    });
  }

  private targetAt(x: number, y: number): DropTarget {
    const zone = this.zoneAt(x, y);
    const id = zone?.dataset['dropTrack'];
    if (!zone || !id) return { kind: 'none' };
    if (id === 'new') return { kind: 'new' };
    const lane = zone.querySelector('app-track-lane');
    return { kind: 'track', trackId: id, x: lane ? x - lane.getBoundingClientRect().left : 0 };
  }

  private zoneAt(x: number, y: number): HTMLElement | undefined {
    return document.elementFromPoint(x, y)?.closest<HTMLElement>('[data-drop-track]') ?? undefined;
  }

  private highlight(zone: HTMLElement | undefined): void {
    if (zone === this.over) return;
    this.over?.classList.remove(OVER_CLASS);
    zone?.classList.add(OVER_CLASS);
    this.over = zone;
  }
}
