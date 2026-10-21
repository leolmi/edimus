# Modello dati

Tipi in `src/app/core/montage/montage.model.ts`, `envelope.ts`, `src/app/core/audio/tempo.ts`.

## Montage

```ts
Montage { version: 2; channels: 1 | 2; sources: AudioSource[]; tracks: Track[] }
```

- `channels`: canali del mix esportato.
- Un montaggio vuoto (nessuna traccia) è lo stato iniziale di ogni istanza.
- Le sorgenti non più usate da nessuna clip vengono rimosse (`withoutUnusedSources`).

## AudioSource

| Campo | Significato |
|---|---|
| `id` | identificativo (UUID) usato dalle clip |
| `path` | percorso assoluto del file originale |
| `relativePath?` | percorso relativo al file `.edimus`, scritto al salvataggio; all'apertura, se `path` non esiste più, la sorgente viene ricollocata con questo |
| `tempo?` | tempo impostato a mano; senza, il tempo è quello rilevato (non salvato) |

Formato, durata, canali e tempo rilevato **non** sono nel file: vengono ricavati a ogni apertura.

## Track

| Campo | Significato |
|---|---|
| `name` | nome mostrato; le copie prendono `"nome (n)"` (`copyName`) |
| `clips` | clip della traccia (possono sovrapporsi; la selezionata è disegnata sopra) |
| `muted?`, `solo?` | udibili = non mute e, se qualche traccia è in solo, in solo (`audibleTracks`) |
| `volume?` | volume di tutta la traccia, gain lineare (0..`MAX_GAIN`); assente = 1 (`trackVolume`) |

## Clip

| Campo | Unità | Significato |
|---|---|---|
| `sourceId` | | sorgente |
| `start` | s timeline | posizione sulla timeline |
| `offset` | s sorgente | inizio della porzione nella sorgente |
| `duration` | s sorgente | lunghezza della porzione; `0` = fino alla fine della sorgente |
| `rate?` | fattore | velocità (2 = doppia, metà durata); default 1 |
| `pitch?` | semitoni | trasposizione indipendente dalla velocità; default 0 |
| `varispeed?` | | `true`: la velocità cambia anche il pitch (nastro), `pitch` si somma; `false`: stretch Rubber Band |
| `envelope?` | s sorgente | inviluppo di volume della clip (dissolvenze), ordinato per tempo; assente = guadagno unitario |

Conversioni (usare sempre queste):

- lunghezza sulla timeline: `TimelineService.clipLength(clip)` = durata sorgente / `rate`;
- timeline → sorgente: `toSource(clip, t)` = `clip.offset + (t - clip.start) * rate`;
- sorgente → timeline: `toTimeline(clip, source)` = `clip.start + (source - clip.offset) / rate`.

`isProcessed(clip)` (rate ≠ 1 o pitch ≠ 0) indica che la clip suona un render (vedi
[architecture.md](architecture.md)).

## Inviluppo di volume

```ts
EnvelopePoint { time: number /* s sorgente della clip */; gain: number /* lineare, 0..MAX_GAIN=2 (+6 dB) */; curve?: number }
```

- L'inviluppo è **della clip** e i suoi tempi sono in secondi **sorgente**: segue la clip senza
  ricalcoli quando viene spostata, divisa (le due parti condividono la stessa curva), accorciata
  (i punti nascosti restano e ricompaiono riallargando), rallentata o accelerata (la curva si
  allunga con l'audio). Crop e delete range non lo toccano.
- Prima del primo punto e dopo l'ultimo il livello resta costante.
- `curve` piega il segmento verso il punto successivo: 0 retta, > 0 partenza lenta
  (fade-in naturale), < 0 partenza veloce (fade-out); limite `MAX_CURVE`. È invariante per la
  conversione lineare sorgente ↔ timeline.
- Il modello usa gain lineare; i dB compaiono solo in UI e nell'MCP (`gainToDb`). L'MCP riceve e
  restituisce i punti in secondi di timeline.
- Guadagno ascoltato di una clip = `clipGainAt(clip, t)` × `trackVolume(track)`.
- `withFade` scrive una sfumatura: in entrata silenzio prima, in uscita silenzio dopo; i punti
  dall'altra parte restano.
- La dissolvenza incrociata (`crossfade.ts`) cerca nell'intervallo una clip che finisce sopra
  una che inizia, su qualsiasi traccia (anche la stessa), eventualmente solo tra le clip
  indicate (`findCrossfade`, vince la sovrapposizione più ampia) e scrive nei loro inviluppi un
  fade-out e un fade-in sulla sovrapposizione limitata all'intervallo, con curve a potenza
  costante (√½ a metà: ±0,2 dB dalla legge seno/coseno).

## Tempo

```ts
Tempo { bpm: number; offset: number /* s sorgente */; confidence: number /* 0..1, 1 = manuale */; beatsPerBar?: number /* default 4 */ }
```

- La griglia dei battiti è `offset + k · 60/bpm` in tempo **sorgente**; con `beatsPerBar` il
  battito `offset` è un **1** (inizio battuta) e le battute sono ogni `beatsPerBar` battiti.
- Il tempo è della **sorgente**; il tempo percepito in una clip è `bpm × rate`.
- Si assume tempo **costante** per tutto il brano; il tempo variabile (warp marker) è in
  [WISHLIST.md](../WISHLIST.md).
- `offset` manuale è normalizzato al primo 1 della sorgente (`downbeat mod battuta`), così le
  battute sono numerate dall'inizio del file.

## Modifiche e annulla

- Il `Montage` è **immutabile**: ogni modifica ne crea uno nuovo.
- `MontageService.update(fn)`: una modifica = un passo di annulla.
- Gesti trascinati: `preview(m)` a ogni movimento (nessun passo), `commit(from)` al rilascio
  registra un solo passo dallo stato iniziale `from`.
- Le funzioni di modifica sono pure e stanno in `edits.ts` (move di gruppo, trim con lunghezza minima,
  split, crop, deleteRange, setClipTiming), `envelope.ts`, `crossfade.ts`, `tempo-align.ts`.
- Cronologia limitata a 200 passi; `dirty` segnala modifiche non salvate.

## File `.edimus`

JSON indentato del `Montage`, con `relativePath` aggiunto a ogni sorgente al salvataggio
(`montage-file.ts`). Una versione diversa da `MONTAGE_VERSION` viene rifiutata: un cambio
incompatibile del formato richiede di incrementarla e prevedere la migrazione in `readMontage`.

Migrazioni:

- **1 → 2** (`upgradeV1`): l'inviluppo della traccia (in secondi di timeline) diventa
  l'inviluppo di ognuna delle sue clip, convertito in secondi sorgente. Il suono non cambia (la
  conversione è lineare, curve comprese); la traccia resta a volume 1. Il file viene riscritto
  in versione 2 al primo salvataggio.
