# Changelog

Versioni secondo [Semantic Versioning](https://semver.org/lang/it/): correzioni in 1.0.x,
funzioni nuove in 1.x. Dalla 1.0.0 il formato dei file `.edimus` è un impegno: le versioni
successive devono aprire i montaggi già salvati (migrazione in `readMontage`).

## 1.3.0 — 2026-10-21

### File
- Finestra *File del montaggio*: se all'apertura qualche file audio non è raggiungibile, mostra
  lo stato di ogni file e permette di consentire di nuovo l'accesso (web), selezionare più file
  o una cartella (abbinati per contenuto o nome) o indicare il file di una traccia. Si riapre con
  *Trova i file…* sotto una traccia in errore.
- Le clip dei file mancanti sono disegnate come riquadri tratteggiati; al salvataggio le clip
  che arrivano a fine sorgente hanno la durata scritta, così restano al loro posto anche senza
  il file.
- Web: anche i file trascinati vengono ritrovati nelle sessioni successive (Chrome, Edge).

### Ascolto
- Durata udibile nella barra di stato: il mix senza i silenzi iniziale e finale (dal primo
  all'ultimo suono sopra −60 dB, con volumi e inviluppi); un clic seleziona l'intervallo. Anche
  in `get_state` (`audible`) per l'assistente AI.

### Interfaccia
- App desktop: disattivato lo zoom della pagina (pizzico sul touchpad, Ctrl +/−/0); lo zoom della
  timeline resta.

### Editing
- Le frecce ← → spostano le clip selezionate di un pixel allo zoom corrente; con Shift saltano al
  punto di aggancio successivo (bordi e inviluppi delle altre clip, cursore). Un tasto tenuto
  premuto, o premuto più volte di seguito, è un solo passo di annulla.
- Accorciando o spostando l'ultima clip la vista non scorre più sotto il puntatore: la lunghezza
  della timeline si adegua al rilascio.
- Canc chiede conferma quando le clip selezionate sono tutte quelle di una traccia (che verrebbe
  eliminata), come il pulsante di eliminazione della traccia.

## 1.2.0 — 2026-10-21

### Versione web
- edimus gira anche nel browser (`npm run dev:web`, `npm run build:web`), tutto sul computer
  dell'utente: i file audio non vanno su nessun server. Con Chrome ed Edge i file si aprono e
  salvano con le finestre del sistema e vengono ritrovati nelle sessioni successive; con gli
  altri browser si aprono in sola lettura e i salvataggi diventano download.
- Velocità e intonazione con lo stesso motore del desktop (Rubber Band, in WebAssembly); i
  render restano in una cache del browser. Export in wav, mp3 e ogg.
- Assistente AI collegabile anche alla versione web, indicando porta e token del server MCP
  nella scheda Assistente AI dell'Aiuto.

### File
- Pacchetto `.edimuspack` (in *Salva con nome*): il montaggio con una copia di tutti i file
  audio in un unico file, da spostare o condividere; si apre sia sul desktop (i file vengono
  estratti in `<nome>.sources`) sia nel web.
- Al salvataggio ogni sorgente riceve un'impronta del contenuto: un file audio mancante si
  ricollega da solo aprendo o trascinando il file giusto, anche con un altro nome o in un'altra
  cartella. Il formato `.edimus` resta la versione 2 (l'impronta è un campo in più, ignorato
  dalla 1.1.0).

### Assistente AI
- `open` e `save` accettano i pacchetti `.edimuspack`; la guida descrive le istanze web.

### Interno
- Il codice dell'app non usa più direttamente Neutralino: file, audio, impostazioni, finestra,
  strumenti per sviluppatori e assistente AI passano da porte (`core/platform/`) con
  un'implementazione desktop e una web (`src/platform/`).

## 1.1.0 — 2026-10-21

### Volume
- L'inviluppo di volume appartiene alla clip (non più alla traccia): segue la clip quando viene
  spostata, divisa, accorciata o ne cambia la velocità. Ogni traccia ha invece un volume unico,
  regolabile dal cursore nella sua intestazione (−30…+6 dB).
- Dissolvenza incrociata a potenza costante (pulsante in toolbar): sfuma in uscita la clip che
  finisce e in entrata quella che inizia, anche sulla stessa traccia, tra le clip selezionate o
  nella fascia di tempo selezionata.
- Trascinando un punto dell'inviluppo, si aggancia ai bordi delle clip, ai punti degli
  inviluppi delle altre clip e, in verticale, a 0 dB (Alt: libero).

### Editing
- Selezione di più clip: Ctrl+clic aggiunge o toglie, Ctrl+A tutte, Esc nessuna; le clip
  selezionate si trascinano insieme e si eliminano, dividono o dissolvono insieme.
- Le clip trascinate si agganciano a inizio, fine e punti dell'inviluppo delle altre clip, su
  qualsiasi traccia (Alt: libero).

### Interfaccia
- Indicatore di caricamento sulla traccia per i file trascinati, dal rilascio alla fine della
  decodifica.

### Assistente AI
- `set_envelope` e `fade` lavorano sulla clip (`fade` anche con `length`), `set_track` ha
  `volumeDb`, nuovo strumento `select`, `crossfade` anche tra clip indicate; `get_state`
  riporta la selezione multipla e l'inviluppo di ogni clip.

### File
- Formato `.edimus` versione 2. I montaggi salvati con le versioni precedenti si aprono
  convertiti senza differenze di suono (l'inviluppo della traccia passa a ciascuna delle sue
  clip); una volta salvati non si aprono più con la 1.0.x.

## 1.0.1 — 2026-10-19

### Correzioni
- All'avvio non si aprono più gli strumenti per sviluppatori; diventano un'opzione delle
  Impostazioni (Avanzate), spenta di default.

## 1.0.0 — 2026-10-19

Prima versione data in uso.

### Montaggio e file
- Montaggio non distruttivo multitraccia: i file audio originali non vengono mai modificati;
  il progetto è un file `.edimus` con percorsi anche relativi (ritrovati se la cartella viene
  spostata insieme ai file audio).
- Apertura di qualsiasi formato letto da ffmpeg, anche trascinando i file sulla finestra o su
  una traccia; esportazione del mix in wav, mp3, flac, ogg, opus, m4a con normalizzazione.
- Annulla/ripeti per ogni modifica.

### Editing
- Clip spostabili nel tempo e tra tracce, trim dei bordi, divisione al cursore, selezione di
  un intervallo su tutte le tracce con ritaglio ed eliminazione (che chiude il buco).
- Mute e solo per traccia; inviluppo di volume con punti in dB e segmenti curvabili.
- Velocità e intonazione per clip: stretch (Rubber Band) o varispeed.

### Tempo
- Rilevamento automatico dei BPM; griglia per battute (fasce alternate numerate) e movimenti.
- Correzione manuale: metro, BPM, ÷2/×2, tap, primo battito, e marcatura di una battuta
  sulla forma d'onda da spostare e allargare.
- Allineamento del tempo di più clip, con allineamento delle battute.
- Con la griglia visibile, trascinamento delle clip agganciato a battuta, semiminima o croma
  (Alt per lo spostamento libero).

### Ascolto
- Trasporto nella barra di stato: centra la vista sul cursore, loop dell'intervallo
  selezionato, stop che torna al punto iniziale fissato sul righello, play/pausa.
- Volume d'ascolto e scelta del dispositivo di uscita.
- Zoom con la rotellina sulle tracce e sul righello.

### Assistente AI
- Server MCP (`edimus-mcp.exe`, autonomo) con cui un assistente AI legge, ascolta, modifica,
  salva ed esporta il montaggio aperto; ogni modifica si può annullare.
- Configurazione automatica in Claude Code, Claude Desktop, Cursor, VS Code (Copilot),
  Windsurf, Gemini CLI e Codex CLI.

### Interfaccia
- Angular Material, tema chiaro/scuro/sistema, italiano e inglese.
- Impostazioni (Ctrl+,) e Aiuto (F1) con guida alle funzioni, "come fare", configurazione
  dell'assistente AI, informazioni e licenze di tutti i componenti.
- Cartella portabile per Windows, senza installazione.
