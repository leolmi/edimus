import { Injectable, inject } from '@angular/core';
import type { AudioInfo } from './platform/audio-engine.port';
import { AudioLibraryService } from './audio/audio-library.service';
import { isVariable, meanBpm } from './audio/tempo-map';
import { TempoService } from './audio/tempo.service';
import { EditService } from './edit.service';
import { formatDuration } from './format';
import { I18nService } from './i18n/i18n.service';
import { SettingsService } from './settings.service';

/** One-line description of a source file: format and tempo (tooltip of the clip name). */
@Injectable({ providedIn: 'root' })
export class SourceSummaryService {
  private readonly library = inject(AudioLibraryService);
  private readonly tempos = inject(TempoService);
  private readonly edits = inject(EditService);
  private readonly i18n = inject(I18nService);
  private readonly settings = inject(SettingsService);

  /** E.g. "mp3 · 44,1 kHz · stereo · 128 kbps · 3:36.9 ♩ 125.3 BPM · affidabilità 62%"; null while unknown. */
  summary(sourceId: string): string | null {
    const state = this.library.sources()[sourceId];
    if (!state || !('info' in state) || !state.info) return null;
    const tempo = this.tempoLabel(sourceId);
    return tempo ? `${this.describe(state.info)} ${tempo}` : this.describe(state.info);
  }

  private describe(info: AudioInfo): string {
    const parts = [
      info.codec,
      `${(info.sampleRate / 1000).toLocaleString(this.settings.language())} kHz`,
      this.i18n.t(`channels.${info.channels}`),
    ];
    if (info.bitRate) parts.push(`${Math.round(info.bitRate / 1000)} kbps`);
    parts.push(formatDuration(info.duration));
    return parts.join(' · ');
  }

  private tempoLabel(sourceId: string): string | null {
    if (this.tempos.isDetecting(sourceId)) return this.i18n.t('tempo.detecting');
    if (this.edits.trackingSource() === sourceId) return this.i18n.t('tempo.tracking');
    const tempo = this.tempos.sourceTempo(sourceId);
    if (tempo === undefined) return null;
    if (tempo === null) return this.i18n.t('tempo.unknown');
    if (isVariable(tempo)) return this.i18n.t('tempo.variableValue', { bpm: meanBpm(tempo).toFixed(1) });
    const state = this.tempos.detected()[sourceId];
    if (state?.status === 'ready' && state.fromFile && tempo === state.tempo) return this.i18n.t('tempo.fileValue', { bpm: tempo.bpm.toFixed(1) });
    return this.i18n.t('tempo.value', { bpm: tempo.bpm.toFixed(1), confidence: Math.round(tempo.confidence * 100) });
  }
}
