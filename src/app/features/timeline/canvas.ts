import { DestroyRef, ElementRef, inject, signal } from '@angular/core';

export interface Size {
  width: number;
  height: number;
}

/** Signal with the CSS size of the host element, kept up to date with a ResizeObserver. */
export function observeSize(): ReturnType<typeof signal<Size>> {
  const host = inject(ElementRef<HTMLElement>).nativeElement as HTMLElement;
  const size = signal<Size>({ width: 0, height: 0 });
  const observer = new ResizeObserver(([entry]) => {
    const { width, height } = entry.contentRect;
    size.set({ width: Math.floor(width), height: Math.floor(height) });
  });
  observer.observe(host);
  inject(DestroyRef).onDestroy(() => observer.disconnect());
  return size;
}

/** Sizes the canvas backing store for the device pixel ratio and returns a context in CSS pixels. */
export function prepareCanvas(canvas: HTMLCanvasElement, { width, height }: Size): CanvasRenderingContext2D {
  const ratio = window.devicePixelRatio || 1;
  const w = Math.max(1, Math.round(width * ratio));
  const h = Math.max(1, Math.round(height * ratio));
  if (canvas.width !== w) canvas.width = w;
  if (canvas.height !== h) canvas.height = h;
  canvas.style.width = `${width}px`;
  canvas.style.height = `${height}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.clearRect(0, 0, width, height);
  return ctx;
}
