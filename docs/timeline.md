# Timeline

Componenti in `src/app/features/timeline/`; stato di vista in `TimelineService`.

## Struttura

- `TimelineComponent`: righello, intestazioni delle tracce (nome → dettagli, mute, solo,
  effetti, info, elimina), una `TrackLaneComponent` per traccia, scrollbar nativa, area di drop.
  Gestisce tutti i gesti del puntatore sulle lane (`onLaneDown/Move/Up`).
  Caricamento dei file trascinati: dal rilascio (`DocumentService.pendingDrop`, che copre la
  risoluzione dei percorsi e il probe) alla fine della decodifica delle sorgenti della traccia,
  sopra la lane compare un indicatore (indeterminato, poi con la percentuale di decodifica);
  per i file destinati a tracce nuove compare nell'area vuota finché la traccia non esiste.
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
2. corpo della clip e forma d'onda per canale, **scalata dall'inviluppo della clip e dal volume
   della traccia** (si vede il livello ascoltato); oltre lo zoom dei campioni diventa una
   polilinea; le clip in render mostrano l'avanzamento; le clip senza audio (file mancante o in
   caricamento) sono un riquadro tratteggiato con il nome del file, rosso se il file manca;
3. griglia delle battute (se attiva), esclusa la clip in marcatura;
4. linee verticali tratteggiate sui punti d'inviluppo di tutte le clip del montaggio, su tutte le
   tracce (`envelopeAnchors`): sono punti di aggancio per le clip spostate;
5. battuta in marcatura (vedi sotto);
6. inviluppo di volume di ogni clip, dentro i suoi bordi (sempre se ha punti; in modalità
   inviluppo anche senza, con punti e maniglie; i punti nascosti da un trim non si vedono).

L'intestazione della traccia ha sul lato destro il fader verticale del volume della traccia
(`FaderComponent` in versione `slim`, alto quanto la traccia; −30…+6 dB, passo 0,5;
un passo di annulla per trascinamento) e il pulsante degli effetti: apre a destra
`EffectsPanelComponent` per quella traccia (`TimelineService.selectedTrackId`; Esc o di nuovo il
pulsante lo chiude; a pannello aperto segue la traccia dell'ultima clip selezionata), con
l'intestazione evidenziata; il pulsante è colorato se la traccia ha
effetti attivi. Sotto le informazioni della sorgente `EffectChainComponent` mostra la catena
degli effetti (colore e sigla per tipo, `effectColor`; un clic apre il pannello). Vedi
[effects.md](effects.md).

## Gesti

| Contesto | Gesto | Effetto |
|---|---|---|
| fuori dalle clip | clic | sposta il playhead, deseleziona |
| fuori dalle clip | trascina | seleziona un intervallo di tempo |
| corpo clip | clic | seleziona solo quella clip (anche se era in una selezione multipla) |
| clip | Ctrl+clic | aggiunge la clip alla selezione o la toglie (`TimelineService.toggleClip`) |
| corpo clip | trascina | sposta la clip (anche su altre tracce; oltre l'ultima crea una traccia nuova); inizio, fine e punti d'inviluppo si agganciano a bordi e punti d'inviluppo delle altre clip, con la griglia visibile a passi di battito, Alt per lo spostamento libero |
| corpo di una clip selezionata | trascina | sposta insieme tutte le clip selezionate (`moveClips`): stesse distanze, cambio traccia solo se restano tutte su tracce esistenti, si ferma quando la prima arriva a 0; l'aggancio considera i bordi di tutte e ignora le clip del gruppo |
| bordo clip (6 px) | trascina | trim dell'inizio o della fine |
| linea di battuta, con la griglia | Maiusc+trascina / Maiusc+clic destro | fissa la battuta lì (stretch della mappa) / la libera |
| corpo clip | doppio clic | dialogo velocità/pitch |
| modalità inviluppo | clic / trascina su una clip | aggiunge un punto all'inviluppo della clip più in alto sotto il puntatore e lo sposta; su un punto lo sposta. Il punto resta dentro la clip e si aggancia (10 px) ai bordi di tutte le clip e ai punti degli inviluppi delle altre clip, in verticale a 0 dB (6 px); Alt per lo spostamento libero |
| modalità inviluppo | trascina maniglia | piega il segmento (doppio clic: lo raddrizza) |
| modalità inviluppo | clic destro su un punto | lo elimina |
| lane o righello | rotella | zoom attorno al puntatore |
| intestazioni tracce | rotella | scorre le tracce in verticale |
| ovunque | Ctrl+rotella | zoom attorno al puntatore |
| ovunque | Shift+rotella / rotella orizzontale | scorre il tempo |

I gesti trascinati usano `preview` + `commit` (un passo di annulla per gesto). Durante un gesto
l'estensione della timeline resta quella di partenza (`holdExtent`): accorciando o spostando
l'ultima clip la vista non scorre sotto il puntatore; si adegua al rilascio.
Durante la riproduzione, quando il playhead arriva a metà della vista si ferma lì e le tracce
scorrono sotto (alla fine del montaggio la vista si ferma e il playhead prosegue; se il playhead
finisce fuori a sinistra, per esempio col ciclo, la vista si centra su di lui). Lo stesso durante
una registrazione; da fermo, un playhead spostato fuori dalla vista (stop, Home, End, fine di una
registrazione) riporta la vista su di lui. Il playhead si posiziona ovunque, anche oltre la fine del
montaggio o su tracce vuote (da lì parte una registrazione): la vista tiene raggiungibile anche lui
(`TimelineService.playhead` nell'`extent`); Play da oltre la fine riparte da 0. All'apertura di un
montaggio la vista si adatta all'intero contenuto quando tutte le sorgenti sono decodificate. Il pulsante
"Adatta alla finestra" (`TimelineService.fit`) adatta la vista all'intervallo selezionato, se c'è (con un 2%
di margine per lato), altrimenti all'intero montaggio.

## Scorciatoie (`app.ts`)

| Tasto | Azione |
|---|---|
| Ctrl+N / O / S / Shift+S / E | nuovo, apri, salva, salva con nome, esporta |
| Ctrl+, / F1 | Impostazioni / Aiuto |
| Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y | annulla / ripeti |
| Spazio, Home, End | play/pausa, inizio, fine |
| Spazio o R / Esc | con una traccia in registrazione (pallino rosso dell'intestazione): avvia/ferma la ripresa al posto dell'ascolto / esce dalla registrazione; entrando si ferma l'ascolto; play e stop restano usabili con i pulsanti (spenti solo durante la ripresa); durante la ripresa gli altri tasti sono ignorati |
| S | divide al playhead (le clip selezionate, o tutte se nessuna) |
| Canc / Backspace | elimina la selezione (intervallo, altrimenti le clip selezionate; se svuota tracce, chiede conferma) |
| ← / → | sposta le clip selezionate di un pixel allo zoom corrente; tasto tenuto o pressioni a meno di 0,8 s l'una dall'altra = un passo di annulla (`EditService.nudge` / `endNudge`) |
| Shift+← / → | sposta le clip selezionate al punto di aggancio successivo: bordi e punti d'inviluppo delle altre clip, playhead, raggiunti da bordi o punti d'inviluppo delle clip spostate (`nextAnchorShift`) |
| E | modalità inviluppo |
| B | griglia delle battute |
| Ctrl+A | seleziona tutte le clip |
| Esc | toglie la selezione |

## Selezione

`TimelineService.selectedClipIds` è l'elenco delle clip selezionate (nell'ordine in cui sono
state scelte); `selectedClipId` vale solo quando ce n'è una (barra della clip, dialoghi),
`selectedClips` è lo stesso elenco come insieme. Le clip che spariscono dal montaggio (annulla,
elimina, crop) escono dalla selezione. Con più clip la barra della clip mostra quante sono.
L'intervallo di tempo (`range`) è indipendente dalla selezione delle clip; la dissolvenza
incrociata usa le clip selezionate se sono almeno due, la fascia altrimenti.

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
- sotto 6 px per battuta (in media nella vista) la griglia non si disegna;
- le battute seguono la mappa della sorgente (`barTime`), quindi possono avere durate diverse;
  le battute fissate a mano hanno un triangolino in alto, quelle del tracciamento automatico un
  quadratino in basso.

### Stretch della mappa delle battute

Con la griglia visibile, **Maiusc+trascina** una linea di battuta (entro 6 px; cursore
`col-resize`) la sposta e la fissa (`pinBar`): le battute tra lei e l'ancora precedente (o la
successiva) si allargano o stringono in modo uniforme, oltre l'ultima ancora prendono la nuova
durata. Su una griglia senza ancore resta ferma la battuta 0 (`offset`). La linea si aggancia
all'attacco più vicino (±50 ms, `snapToOnsets`), Alt la muove liberamente; nessuna battuta può
scendere sotto un battito di 150 ms (400 BPM). Un gesto = un passo di annulla.
**Maiusc+clic destro** su una battuta fissata la libera (`unpinBar`).

### Tracciamento delle battute

`trackBars()` (`tempo-map.ts`), dal dialogo Tempo ("Rileva le battute") o da `set_bar_map`:
sulla curva degli attacchi di tutta la sorgente un anello ad aggancio di fase prevede ogni
battito un battito dopo il precedente, lo attira verso l'attacco più forte vicino (±15 % del
battito, pesato con la distanza) e aggiorna lentamente la durata del battito (entro 0,7–1,4×).
Parte dalle ancore a mano: tra due ancore il numero di battute è fissato e l'errore all'arrivo
è distribuito sui battiti; prima della prima e dopo l'ultima procede libero fino agli estremi
del file. Senza ancore a mano parte dall'attacco più forte nel primo battito della griglia,
segue i battiti nei due versi e sceglie come 1 il movimento con gli attacchi più forti in
media (l'accento), perché la fase rilevata può essere sbagliata di qualche battito. Il risultato è un'ancora `auto` per battuta.

### Aggancio ai bordi delle clip

Sempre attivo durante lo spostamento: `snapToEdges()` (`core/timeline/edge-snap.ts`, funzione
pura) porta l'inizio, la fine o un punto visibile dell'inviluppo della clip trascinata (o di
una delle clip del gruppo) sul punto di aggancio più vicino delle altre clip (`snapAnchors`:
inizio, fine e punti visibili del loro inviluppo), su qualsiasi traccia, se distano meno di 10 px. Ha la precedenza sull'aggancio ai
battiti; Alt li disattiva entrambi.

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

La battuta segnata diventa un'ancora a mano: è il punto fermo dei successivi stretch e del
tracciamento. Il dialogo mostra anche lo stato della mappa e "Rileva le battute"; con almeno
un'ancora, "Rimuovi ancore" (`clearAnchors`: torna alla griglia costante di partenza, `bpm` e
`offset`, che la mappa non modifica), "Rimuovi ancore automatiche" (con ancore di entrambi i
tipi: tiene quelle a mano) e, con la mappa variabile, "Tempo costante" (`steadyTempo`: toglie
la mappa e lascia il tempo medio). Applicare il dialogo senza
cambiare BPM, primo battito o metro conserva la mappa; cambiandoli il tempo torna costante.
"Salva le battute" e "Carica le battute" scrivono e leggono il file delle battute dell'audio
(vedi [data-model.md](data-model.md#file-delle-battute-edimusbars)); con il tempo letto da quel
file il dialogo e l'intestazione della traccia lo indicano.

## Allineamento del tempo

`AlignTempoDialogComponent` + `tempo-align.ts`: scelta della clip di riferimento e delle clip
da adattare, tempo obiettivo (quello del riferimento, una media geometrica comune, o digitato),
stretch o varispeed, e opzionalmente spostamento delle clip perché il loro primo 1 cada
sull'1 più vicino del riferimento.
