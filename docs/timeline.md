# Timeline

Componenti in `src/app/features/timeline/`; stato di vista in `TimelineService`.

## Struttura

- `TimelineComponent`: righello, intestazioni delle tracce (nome → dettagli, mute, solo,
  info, elimina), una `TrackLaneComponent` per traccia, scrollbar nativa, area di drop.
  Gestisce tutti i gesti del puntatore sulle lane (`onLaneDown/Move/Up`).
- `TrackLaneComponent`: disegna una traccia su `<canvas>` e offre gli hit test
  (`clipAt`, `pointAt`, `curveHandleAt`, `markedBarAt`) usati dai gesti.
- `RulerComponent`: righello dei tempi.
- `ClipBarComponent`: barra della clip selezionata (BPM → dialogo tempo, velocità/pitch);
  durante la marcatura della battuta mostra istruzioni e Ricomincia/Annulla/Conferma.

Il disegno è un `effect()` che rilegge i signal usati: ogni cambio di zoom, scroll, montaggio,
tema o modalità ridisegna. Il canvas va preparato con `prepareCanvas()` (device pixel ratio)
e i colori presi da `ThemeColorsService` / `sourceColors()` (un colore per sorgente).

## Disegno di una lane

Nell'ordine:

1. per la clip selezionata, l'estensione dell'intera sorgente (grigio tratteggiato);
2. corpo della clip e forma d'onda per canale, **scalata dall'inviluppo** (si vede il livello
   ascoltato); oltre lo zoom dei campioni diventa una polilinea; le clip in render mostrano
   l'avanzamento;
3. griglia delle battute (se attiva), esclusa la clip in marcatura;
4. battuta in marcatura (vedi sotto);
5. inviluppo di volume (sempre se ha punti; con punti e maniglie in modalità inviluppo).

## Gesti

| Contesto | Gesto | Effetto |
|---|---|---|
| fuori dalle clip | clic | sposta il playhead, deseleziona |
| fuori dalle clip | trascina | seleziona un intervallo di tempo |
| corpo clip | trascina | sposta la clip (anche su altre tracce; oltre l'ultima crea una traccia nuova); con la griglia visibile a passi di battito, Alt per lo spostamento libero |
| bordo clip (6 px) | trascina | trim dell'inizio o della fine |
| corpo clip | doppio clic | dialogo velocità/pitch |
| modalità inviluppo | clic / trascina | aggiunge e sposta un punto; su un punto lo sposta |
| modalità inviluppo | trascina maniglia | piega il segmento (doppio clic: lo raddrizza) |
| modalità inviluppo | clic destro su un punto | lo elimina |
| lane o righello | rotella | zoom attorno al puntatore |
| intestazioni tracce | rotella | scorre le tracce in verticale |
| ovunque | Ctrl+rotella | zoom attorno al puntatore |
| ovunque | Shift+rotella / rotella orizzontale | scorre il tempo |

I gesti trascinati usano `preview` + `commit` (un passo di annulla per gesto).
Durante la riproduzione la vista segue il playhead pagina per pagina; all'apertura di un
montaggio la vista si adatta all'intero contenuto quando tutte le sorgenti sono decodificate.

## Scorciatoie (`app.ts`)

| Tasto | Azione |
|---|---|
| Ctrl+N / O / S / Shift+S / E | nuovo, apri, salva, salva con nome, esporta |
| Ctrl+, / F1 | Impostazioni / Aiuto |
| Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y | annulla / ripeti |
| Spazio, Home, End | play/pausa, inizio, fine |
| S | divide al playhead |
| Canc / Backspace | elimina la selezione (clip o intervallo) |
| E | modalità inviluppo |
| B | griglia delle battute |
| Esc | toglie la selezione |

Trasporto (barra di stato, a destra): centra la vista sul playhead (`TimelineService.centerOn`,
che vicino agli estremi si ferma all'inizio o alla fine), loop, stop, play/pausa, tempo
corrente/durata.

**Loop** (`PlaybackService.loop`, attivo solo con un intervallo selezionato): la riproduzione
ripete l'intervallo. Se il playhead è fuori dall'intervallo parte dal suo inizio, se è dentro
parte da lì e al primo giro arriva alla fine. Ogni giro è un mix schedulato fino alla fine
dell'intervallo (`MixService.schedule(…, until)`), con il giro successivo già accodato per
non avere pause; cambiare loop o intervallo durante l'ascolto rischedula.

**Punto iniziale** (`PlaybackService.cue`): un clic (o trascinamento) sul righello fissa il
punto iniziale dove viene rilasciato, segnato da una bandierina e una linea tratteggiata.
Da lì ogni **stop** (non la pausa) riporta il playhead a quel punto; uno stop quando il
playhead è già sul punto iniziale lo annulla e riporta il playhead a zero. Senza punto
iniziale lo stop porta a zero. I clic sulle lane spostano il playhead ma non il punto iniziale.

Durante la marcatura della battuta: Invio conferma, Backspace ricomincia dall'1, Esc annulla.

## Griglia delle battute

Disegnata da `drawBarGrid()` in `track-lane.component.ts` a partire dal `Tempo` della sorgente
della clip. La lettura è **prima per battute, poi per movimenti**:

- fasce alternate, una per battuta (le battute dispari, 1, 3, …, ombreggiate);
- linea marcata e numero di battuta sull'1 (numero solo se la battuta è larga ≥ 28 px e non
  precede l'inizio della sorgente);
- linee dei movimenti più leggere e corte, solo se distanti ≥ 6 px;
- sotto 6 px per battuta la griglia non si disegna.

### Aggancio ai battiti

Con la griglia visibile, lo spostamento di una clip passa da `snapToBeats()`
(`core/timeline/beat-snap.ts`, funzione pura) con il passo scelto nelle Impostazioni
(`SettingsService.snapStep`): **battuta** (`beatsPerBar` battiti, fase sull'1), **semiminima**
(un battito, default) o **croma** (mezzo battito). Il punto della griglia della clip trascinata
più vicino al puntatore viene portato sul punto più vicino delle altre clip con tempo noto
(entro ±4 s, ±16 s per le battute), quindi la clip si muove di passo in passo. Una clip senza
tempo aggancia il suo inizio; senza altre griglie vicine lo spostamento procede a passi interi
della clip stessa. Alt disattiva l'aggancio.

## Tempo di una sorgente (dialogo Tempo)

`TempoDialogComponent`, aperto dalla clip-bar: tempo rilevato e affidabilità, metro
(2/4, 3/4, 4/4, 6/8), BPM (digitati, ÷2, ×2, tap, anche col tasto T), posizione del primo
battito (±1 battito, "al playhead"), ritorno al tempo rilevato. Il risultato è salvato sulla
sorgente (`MontageService.setSourceTempo`) e accende la griglia.

### Segna la battuta

Dal dialogo, "Segna la battuta" chiude il dialogo e avvia la marcatura
(`TimelineService.beatMarking: BarMarking`, metodi in `EditService`):

1. l'utente clicca **solo l'1** di una battuta sulla forma d'onda della clip; il punto viene
   agganciato all'attacco più vicino (`snapToOnsets`, ±70 ms);
2. compare la griglia di **una battuta** con `beatsPerBar` colonne numerate, larga quanto il
   BPM corrente; sul resto della clip la griglia prosegue sfumata, per controllare la
   coincidenza con la musica lontano dalla battuta segnata;
3. trascinando il corpo la battuta si sposta; trascinando un bordo la battuta si allarga o
   stringe (il bordo opposto resta fermo) e cambia il BPM, entro 20–400 BPM;
   un clic fuori dalla battuta riposiziona l'1;
4. Conferma salva `bpm` e `offset` (normalizzato al primo 1 della sorgente) con
   `confidence: 1`.

Il tempo è considerato fisso per tutto il brano; la definizione per tratti è prevista in futuro.

## Allineamento del tempo

`AlignTempoDialogComponent` + `tempo-align.ts`: scelta della clip di riferimento e delle clip
da adattare, tempo obiettivo (quello del riferimento, una media geometrica comune, o digitato),
stretch o varispeed, e opzionalmente spostamento delle clip perché il loro primo 1 cada
sull'1 più vicino del riferimento.
