import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, booleanAttribute, computed, effect, inject, input, viewChildren } from '@angular/core';
import { PlaybackService } from '../../core/audio/playback.service';

/** Range of the meter (dBFS): from silence to a little above full scale. */
const FLOOR_DB = -48;
const TOP_DB = 6;
/** Fall of the bars (share of the range per second) and time the peak mark holds. */
const FALL = 1.5;
const HOLD = 1;
/** LEDs of the bars: length and distance from one to the next (px). */
const LED = 4;
const LED_PITCH = 6;

const toPosition = (peak: number) => (peak <= 0 ? 0 : Math.max(0, Math.min(1, (20 * Math.log10(peak) - FLOOR_DB) / (TOP_DB - FLOOR_DB))));
/** Where -6 dB and 0 dB fall on the bar, for the zones of the colours. */
const WARN = (-6 - FLOOR_DB) / (TOP_DB - FLOOR_DB);
const CLIP = -FLOOR_DB / (TOP_DB - FLOOR_DB);

/**
 * Peak level of a track while it plays: one bar of LEDs per channel (two for a stereo track),
 * green, orange above -6 dB and red above 0 dB, with the highest peak marked for a moment. Without a
 * track it reads the whole mix (the master meter of the toolbar, `horizontal`). The bars are
 * moved straight on the DOM at every frame, outside the change detection.
 */
@Component({
  selector: 'app-track-meter',
  host: { '[class.horizontal]': 'horizontal()' },
  template: `
    @for (channel of channels(); track $index) {
      <div class="bar" [style.--warn.%]="warn" [style.--clip.%]="clip" [style.--led.px]="led" [style.--led-pitch.px]="ledPitch">
        <div #cover class="cover"></div>
        <div #hold class="hold"></div>
      </div>
    }
  `,
  styles: `
    /* as wide for a mono track (one bar) as for a stereo one (two): the header controls stay aligned */
    :host {
      display: flex;
      gap: 1px;
      width: 9px;
      height: 100%;
      padding: 6px 0;
      box-sizing: border-box;
    }
    .bar {
      position: relative;
      flex: 1 1 0;
      overflow: hidden;
      background: linear-gradient(
        to top,
        var(--app-success) 0 var(--warn),
        var(--mat-sys-tertiary) var(--warn) var(--clip),
        var(--mat-sys-error) var(--clip) 100%
      );
      /* LEDs from the bottom: the gaps between them are cut out of the bar */
      mask-image: repeating-linear-gradient(to top, #000 0 var(--led), transparent var(--led) var(--led-pitch));
    }
    /* the unlit part, from the top */
    .cover {
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 100%;
      background: var(--mat-sys-surface-container-highest);
    }
    .hold {
      position: absolute;
      left: 0;
      right: 0;
      bottom: 0;
      height: var(--led);
      background: var(--mat-sys-on-surface);
      opacity: 0;
    }
    /* lying down: the bars one above the other, a row of LEDs lit from the left */
    :host(.horizontal) {
      flex-direction: column;
      gap: 4px;
      width: auto;
      height: 36px;
      padding: 0;
      .bar {
        background: linear-gradient(
          to right,
          var(--app-success) 0 var(--warn),
          var(--mat-sys-tertiary) var(--warn) var(--clip),
          var(--mat-sys-error) var(--clip) 100%
        );
        mask-image: repeating-linear-gradient(to right, #000 0 var(--led), transparent var(--led) var(--led-pitch));
      }
      .cover {
        top: 0;
        bottom: 0;
        left: auto;
        right: 0;
        width: 100%;
        height: auto;
      }
      .hold {
        top: 0;
        bottom: 0;
        left: 0;
        width: var(--led);
        height: auto;
      }
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class TrackMeterComponent {
  /** Track read; none for the whole mix. */
  readonly trackId = input<string>();
  readonly horizontal = input(false, { transform: booleanAttribute });
  /** Two bars (left and right), or one. */
  readonly stereo = input(true);
  protected readonly channels = computed(() => (this.stereo() ? [0, 1] : [0]));

  protected readonly warn = WARN * 100;
  protected readonly clip = CLIP * 100;

  protected readonly led = LED;
  protected readonly ledPitch = LED_PITCH;

  private readonly playback = inject(PlaybackService);
  private readonly covers = viewChildren<ElementRef<HTMLElement>>('cover');
  private readonly holds = viewChildren<ElementRef<HTMLElement>>('hold');
  private frame = 0;
  private last = 0;
  private levels: number[] = [];
  private peaks: { position: number; at: number }[] = [];

  constructor() {
    effect(() => {
      cancelAnimationFrame(this.frame);
      if (this.playback.playing()) this.frame = requestAnimationFrame((now) => this.tick(now));
      else this.show([], 0);
    });
    inject(DestroyRef).onDestroy(() => cancelAnimationFrame(this.frame));
  }

  private tick(now: number): void {
    const elapsed = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
    this.last = now;
    const trackId = this.trackId();
    const peaks = trackId === undefined ? this.playback.mixPeaks() : this.playback.trackPeaks(trackId);
    // a mono meter shows the louder side
    const values = peaks ? (this.channels().length > 1 ? peaks : [Math.max(...peaks)]) : [];
    this.show(values.map(toPosition), elapsed, now);
    this.frame = requestAnimationFrame((t) => this.tick(t));
  }

  /** Bars up at once to a new peak, then falling; the peak mark holds, then fades. */
  private show(positions: number[], elapsed: number, now = 0): void {
    const covers = this.covers();
    const holds = this.holds();
    const horizontal = this.horizontal();
    // the LEDs light whole: the level goes up to the end of the LED it reaches
    const bar = covers[0]?.nativeElement.parentElement;
    const length = (horizontal ? bar?.clientWidth : bar?.clientHeight) || 1;
    const leds = Math.max(1, Math.round((length + LED_PITCH - LED) / LED_PITCH));
    const lit = (position: number) => Math.min(1, (Math.ceil(position * leds) * LED_PITCH) / length);
    covers.forEach((cover, i) => {
      const level = Math.max(positions[i] ?? 0, (this.levels[i] ?? 0) - FALL * elapsed);
      this.levels[i] = positions.length ? level : 0;
      cover.nativeElement.style[horizontal ? 'width' : 'height'] = `${(1 - lit(this.levels[i])) * 100}%`;
      const peak = this.peaks[i];
      if (!positions.length) this.peaks[i] = { position: 0, at: 0 };
      else if (!peak || level >= peak.position || now - peak.at > HOLD * 1000) this.peaks[i] = { position: level, at: now };
      const hold = holds[i]?.nativeElement;
      if (hold) {
        const position = this.peaks[i].position;
        hold.style[horizontal ? 'left' : 'bottom'] = `${Math.max(0, Math.ceil(position * leds) - 1) * LED_PITCH}px`;
        hold.style.opacity = position > 0 ? '0.8' : '0';
      }
    });
    if (!positions.length) this.last = 0;
  }
}
