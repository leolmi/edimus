# Architettura

## Runtime

- **Piattaforma**: il codice dell'app (`src/app`) non usa direttamente le API native ma delle
  porte astratte in `core/platform/`, registrate come provider Angular:

  | Porta | Ruolo |
  |---|---|
  | `FileSystemPort` | lettura/scrittura file, percorsi relativi, dialoghi apri/salva, file trascinati |
  | `AudioEnginePort` | probe, decodifica (con velocità/pitch, `AudioProcessing`), encoding dell'export |
  | `SettingsPort` | archivio delle impostazioni |
  | `ShellPort` | titolo e chiusura della finestra, domande sì/no, link esterni, mostra file |
  | `PlatformInfo` | capacità della piattaforma (mostra file, configurazione AI, file accanto alle sorgenti, strumenti sviluppatori): la UI nasconde ciò che manca |

  | `DevToolsPort` | strumenti per sviluppatori della finestra (solo desktop) |
  | `AiHostPort` | indirizzo del server MCP e configurazione dei client AI installati |
  | `UpdaterPort` | aggiornamento dell'app dalle release GitHub (solo desktop Windows) |

  Le implementazioni stanno in `src/platform/<piattaforma>/`; `src/platform/platform.providers.ts`
  sceglie quella della build (`neutralino`) e fornisce `initPlatform()`, chiamata da `main.ts`
  prima dell'avvio. La configurazione `web` di `angular.json` (`npm run dev:web`,
  `npm run build:web` → `dist/web/`) lo sostituisce con `platform.providers.web.ts`
  (`fileReplacements`); il dev server web invia gli header COOP/COEP, necessari a
  `SharedArrayBuffer` per i worker wasm. In `src/app` non c'è nessun import di
  `@neutralinojs/lib`, quindi la build web non contiene Neutralino.
- **File nel browser** (`WebFileSystem`): niente percorsi reali. Ogni file aperto, salvato o
  trascinato riceve un percorso `/<id>/<nome>` nel `WebFileRegistry`. Con la File System
  Access API (Chromium) i file sono handle in lettura/scrittura, salvati in IndexedDB per
  ritrovare le sorgenti nelle sessioni successive (il permesso viene richiesto di nuovo), e la
  rinomina usa `move`. Anche i file trascinati hanno l'handle, chiesto durante l'evento di drop
  (`DataTransferItem.getAsFileSystemHandle`, `DropTargetService`). La ricerca in una cartella
  (`showDirectoryPicker`) registra gli handle trovati senza salvarli: un handle va in IndexedDB
  quando il file viene letto. Senza l'API si apre con il selettore della pagina (solo lettura,
  file validi per la sessione); ogni scrittura su un file senza handle (o su un percorso dato
  dall'AI) diventa un download. Niente cartelle: `relativePath` è sempre assente.
- **File del montaggio** (`SourceFilesService`, `SourceFilesDialogComponent`): dopo l'apertura
  di un montaggio `FileSystemPort.access` dice per ogni sorgente se è `ready`, `permission`
  (handle noto, il browser rivuole il permesso: va chiesto da un clic, `requestAccess`) o
  `missing`. Se qualcosa non è pronto si apre il dialog: consenti l'accesso, seleziona più file,
  cerca in una cartella (`showFolderDialog`, ricorsivo; desktop con Neutralino), trova il file di
  una sorgente. L'abbinamento è per nome (verificando l'impronta, se c'è) e poi per impronta
  (file rinominati, al massimo 400 file esaminati). Le clip delle sorgenti mancanti sono
  disegnate come segnaposto tratteggiati; *Trova i file…* sotto la traccia riapre il dialog.
- **Motore audio web** (`WebAudioEngine`): il probe legge rate e canali dall'header
  (`audio-header.ts`: wav, flac, mp3, ogg vorbis/opus, mp4) e decodifica con `decodeAudioData`
  a quel rate (il buffer è tenuto per la decodifica che segue). Varispeed e downmix con un
  `OfflineAudioContext` (`playbackRate`); stretch e pitch con Rubber Band in wasm
  (`rubberband-wasm`, modalità offline, stesse opzioni del filtro ffmpeg) in un Web Worker
  (`rubberband.worker.ts`). I render processati restano nell'OPFS (`render-cache.ts`, chiave:
  impronta della sorgente e parametri, al massimo 24). Export: WAV in JS (`wav-encoder.ts`),
  MP3 (LAME) e Ogg Vorbis con `wasm-media-encoders`; flac, opus e m4a non ci sono
  (`AudioEnginePort.exportFormats`: il dialogo mostra solo i formati disponibili). I `.wasm`
  sono copiati in `wasm/` dagli asset della configurazione `web`.
- **Zoom della web view** disattivato sul desktop (`initNeutralino`): il pizzico del touchpad
  (Ctrl+rotella) e Ctrl +/−/0 non ingrandiscono la pagina; gli eventi arrivano comunque alla
  timeline. Nel web lo zoom del browser resta (accessibilità).
- **Neutralino 6** ospita il frontend in una web view e fornisce le API native
  (`filesystem`, `os.execCommand`/processi, `window`, `storage`, `events`).
  `tokenSecurity: none`, server locale su porta casuale; in sviluppo la finestra carica
  `ng serve` su `http://localhost:47815` (vedi `neutralino.config.json`).
- **Strumenti per sviluppatori**: spenti in `neutralino.config.json` (`enableInspector`,
  `openInspectorOnStartup` false); `npm run dev` li abilita da riga di comando
  (`--window-enable-inspector=true`). L'impostazione "Apri gli strumenti per sviluppatori
  all'avvio" fa riavviare il processo una volta con `--window-enable-inspector=true
  --window-open-inspector-on-startup=true` (`NeutralinoDevTools`): la finestra li prende solo
  dalla riga di comando, quindi cambiarli richiede un riavvio ("Riavvia ora").
- **Una istanza = un montaggio.** Il file da aprire all'avvio arriva da riga di comando
  (`ShellPort.startupFiles`, su desktop da `NL_ARGS`). Più montaggi = più finestre/processi.
- **Cartella dell'app** (`appPath()` in `platform/neutralino/app-paths.ts`, da `NL_PATH`): contiene `.cache/` per i file PCM
  temporanei; le impostazioni (tema, lingua, volume d’ascolto, uscita audio, passo di aggancio, salvataggio automatico delle battute)
  si cambiano dal dialog Impostazioni (`features/settings`, Ctrl+,; il volume dalla toolbar) e stanno nello storage di
  Neutralino (`SettingsService` tramite `SettingsPort`).
- **Montaggi recenti** (`RecentFilesService`, mostrati dal dialog di Apri `RecentFilesDialogComponent`): file `.edimus`/`.edimuspack` aperti o salvati, nella
  stessa archiviazione delle impostazioni (chiave `recentFiles`), condivisa dalle istanze: ogni modifica
  rilegge l'elenco salvato prima di scriverlo. Al massimo 20 file non bloccati; quelli bloccati non
  contano. Nella versione web i percorsi sono gli identificativi del registro dei file.
- **ffmpeg/ffprobe** sono cercati accanto all'exe, in `ffmpeg/` o in `tools/ffmpeg/bin/`
  (`platform/neutralino/ffmpeg.service.ts`) e lanciati come processi figli; lo scambio di audio avviene tramite file
  PCM `f32le` in `.cache/`.

## Flusso audio

```
file originale ──ffprobe──▶ AudioInfo
               ──ffmpeg (f32le)──▶ AudioBuffer ──▶ AudioLibraryService (per sourceId)
                                               ├─▶ peaks.ts (piramide min/max per il disegno)
                                               └─▶ TempoService (rilevamento BPM, curva degli attacchi)
clip con rate/pitch ≠ neutri ──ffmpeg rubberband / asetrate──▶ ProcessedAudioService (buffer renderizzato)
MixService.schedule(ctx) ──▶ AudioContext (PlaybackService)  |  OfflineAudioContext (ExportService)
ExportService: render offline ─▶ f32le ─▶ ffmpeg encoder (wav/mp3/flac/ogg/opus/m4a)
```

- **Decodifica** (`AudioEnginePort`, su desktop `NeutralinoAudioEngine`): ffprobe per formato/canali/durata, ffmpeg decodifica
  in float al sample rate nativo, mono o stereo (oltre 2 canali → downmix a 2).
- **Libreria** (`AudioLibraryService`): stato per sorgente (`loading`/`ready`/`error`), buffer
  e picchi; segue le sorgenti del montaggio corrente.
- **Tempo** (`TempoService`, `tempo.ts`): BPM e fase stimati dopo la decodifica (flusso
  spettrale → autocorrelazione con preferenza ~120 BPM → pettine per la fase), tenuti in
  memoria e ricalcolati a ogni apertura. Un tempo impostato a mano viene salvato sulla
  sorgente nel montaggio e ha la precedenza (`sourceTempo()`).
- **Audio processato** (`ProcessedAudioService`): una clip con velocità o pitch diversi da
  1/0 suona un render dell'**intera sorgente** per quella coppia rate/pitch, chiesto al motore
  audio come `AudioProcessing` (su desktop, filtri ffmpeg: stretch:
  `rubberband=tempo:pitch`; varispeed: `asetrate`+`aresample`, più rubberband per il pitch
  aggiuntivo). Il render è riusato da trim, split, undo/redo e clip con le stesse impostazioni.
  Il buffer renderizzato è in tempo *timeline*: offset nel buffer = `clip.offset / rate`.
- **Mix** (`MixService`): un `GainNode` per traccia udibile (il volume della traccia) e un
  `AudioBufferSourceNode` per clip; una clip con inviluppo passa da un suo `GainNode`
  automatizzato (`automate` con i punti convertiti in tempo di timeline,
  `clipEnvelopeOnTimeline`). Lo stesso grafo serve riproduzione ed export, quindi suonano uguali.
  `audibleRange` dà il tratto udibile del mix (dal primo all'ultimo blocco di 10 ms sopra −60 dBFS
  delle tracce udibili, inviluppi e volumi compresi): barra di stato e `get_state`.
- **Export** (`ExportService`): render offline da 0 alla fine dell'ultima clip più il silenzio
  finale opzionale (`trailingSilence`), normalizzazione opzionale; l'encoding è del
  motore audio (su desktop: scrittura PCM a blocchi, ffmpeg con progresso letto da `-progress pipe:1`).

## Stato e servizi

| Servizio | Ruolo |
|---|---|
| `MontageService` | montaggio corrente (immutabile), undo/redo (max 200 passi), `dirty`, percorso, apertura/salvataggio |
| `TimelineService` | zoom (`pxPerSec`), scroll, larghezza vista, selezione clip/intervallo, modalità inviluppo, griglia battute, marcatura battuta; conversioni `timeToX`/`xToTime`, `clipLength` |
| `EditService` | comandi di editing usati da UI e AI: split, delete, crop, dissolvenza incrociata, velocità/pitch, dialoghi tempo e allineamento, marcatura battuta |
| `DocumentService` | nuovo/apri/salva/salva con nome/rinomina/esporta/chiudi, con conferma per le modifiche non salvate; titolo della finestra |
| `PlaybackService` | play/stop/seek, loop, punto iniziale, posizione del playhead, `AudioContext` condiviso inviato all'uscita scelta (`setSinkId`; se il dispositivo manca, la predefinita) |
| `AudioOutputsService` | elenco delle uscite audio (`enumerateDevices`). WebView2 dà i nomi solo a una pagina con permesso microfono: all'apertura delle Impostazioni, la prima volta, si apre e chiude subito un flusso dal microfono. La scelta (id e nome) è nelle impostazioni |
| `DropTargetService` + `FileSystemPort.resolveDropped` (desktop: `platform/neutralino/dropped-files.ts`) | drop di file sulla finestra o su una traccia; la web view non dà i percorsi: si ricavano dalla selezione di Esplora risorse (PowerShell) o, in mancanza, il contenuto viene copiato |
| `ThemeColorsService` | token Material risolti in colori concreti per il canvas |
| `I18nService` + pipe `t` | traduzioni it/en a runtime |

Le regole di modifica del montaggio (immutabilità, `update` vs `preview`/`commit`) sono in
[data-model.md](data-model.md).

## Bridge AI (MCP)

```
AI ──stdio──▶ edimus-mcp.exe | node mcp/server.mjs ──WebSocket 127.0.0.1:47816 (token)──▶ AiBridgeService ──▶ AiCommandsService
```

- Il server è `mcp/server.mjs`; per la cartella portabile diventa `edimus-mcp.exe` (Node SEA,
  `mcp/build-exe.mjs`, `npm run mcp:build`), quindi chi lo usa non deve installare Node.
  Niente top-level await nel server: viene impacchettato come CommonJS.

- Ogni sessione AI avvia il proprio server. Il server ascolta sulla 47816 (`EDIMUS_MCP_PORT`)
  se è libera, altrimenti su una porta libera qualsiasi, e scrive porta e token in
  `%USERPROFILE%/.edimus/mcp-<pid>.json` (lo cancella all'uscita; all'avvio rimuove quelli di
  server non più vivi). Non `%APPDATA%`: un client AI impacchettato MSIX (Claude Desktop) vi
  reindirizza le scritture dei processi figli nella cartella del pacchetto, invisibile all'app. L'app li ottiene da `AiHostPort.bridgeConfigs()` e si collega a **tutti**,
  ricontrollando ogni 3 secondi i server nuovi: così ogni sessione vede la finestra. Sul desktop
  `NeutralinoAiHost` legge i file; nel web la pagina non può leggerli: porta e token si
  inseriscono nella scheda *Assistente AI* (`AiWebSetupComponent`) e restano nelle impostazioni
  (`aiBridge`). Una pagina https può aprire `ws://127.0.0.1` (localhost è un'origine sicura), ma
  il browser può chiedere il permesso di accesso alla rete locale.
- La scheda *Assistente AI* dell'Aiuto (`AiSetupComponent`) mostra lo stato del collegamento.
  `NeutralinoAiHost` individua il comando del server (`edimus-mcp.exe` accanto all'app, quello
  in `mcp/dist`, oppure `node mcp/server.mjs` in sviluppo) e i client AI installati, e
  registra il server in quelli scelti dall'utente: Claude Code tramite la sua CLI, gli altri
  aggiungendo una voce al loro file di configurazione, dopo averne fatto un backup
  (elenco in [mcp/README.md](../mcp/README.md)). Il dialog offre anche i comandi per la
  configurazione manuale.
- `AiCommandsService` esegue ogni comando con gli stessi servizi della UI: ogni modifica è un
  passo di annulla visibile nella finestra.
- Aggiungere una funzione per l'AI significa toccare: `ai-commands.service.ts` (esecuzione),
  `mcp/server.mjs` (strumento e schema), `mcp/guide.mjs` (se cambia il modello o l'uso),
  `mcp/README.md` (tabella strumenti).

Dettagli d'uso: [mcp/README.md](../mcp/README.md).

## Build e distribuzione

- `npm run build` → `neu build --release --embed-resources` (prima esegue `licenses.mjs` e
  `ng build` in `build/web/`).
- `npm run package` → build, `npm run mcp:build`, poi `scripts/package.mjs` assembla
  `release/edimus/`: `edimus.exe`, `edimus-mcp.exe`, ffmpeg, ffprobe, licenze. Cartella
  portabile, nessuna installazione (serve solo il WebView2 Runtime di Windows). Produce anche il
  pacchetto di aggiornamento (vedi *Aggiornamento automatico*); `npm run release` lo pubblica.
- `scripts/licenses.mjs` raccoglie le licenze di pacchetti npm (frontend e server MCP),
  runtime Neutralino, Node.js incluso in `edimus-mcp.exe` e ffmpeg in `public/licenses.json`
  (scheda *Info e licenze* dell'Aiuto) e `THIRD_PARTY_LICENSES.md`.

## Aggiornamento automatico

Solo app desktop su Windows (`PlatformInfo.canUpdate`); in sviluppo (`isDevMode`) il controllo
funziona ma l'installazione è bloccata.

- **Pubblicazione**: `npm run package` produce anche `release/edimus-<versione>-win-x64.zip`
  (`edimus.exe`, `edimus-mcp.exe`, licenze; **senza ffmpeg**, installato una volta con l'app) e
  `release/manifest.json` (`version`, `minFfmpeg` da `config.minFfmpeg` di `package.json`,
  nome, dimensione e SHA-256 dello zip). `npm run release` (GitHub CLI, `gh auth login`) li
  pubblica come release `v<versione>` del repository. Le release stanno fuori dalla storia git.
- **Controllo** (`UpdateService`): all'avvio, dopo 3 s e con l'impostazione attiva, o con
  *Verifica ora* nelle Impostazioni. `NeutralinoUpdater.latest` legge
  `api.github.com/repos/<repo>/releases/latest` (repository nelle impostazioni, predefinito
  `leolmi/edimus`) e il manifest con `curl.exe` (i download di GitHub non ammettono CORS). Una
  versione saltata non viene riproposta all'avvio. Blocchi (`UpdateBlocker`): avvio dai
  sorgenti, cartella dell'app non scrivibile, ffmpeg installato più vecchio di `minFfmpeg`.
- **Installazione**: dopo la conferma e il controllo delle modifiche non salvate l'app scarica
  lo zip in `%TEMP%\edimus-update`, vi scrive `update.ps1` (`update-script.ts`) e `update.json`
  (percorsi, PID, hash, testi tradotti), avvia PowerShell nascosto ed esce. Lo script verifica
  lo SHA-256, aspetta l'uscita del processo e delle altre finestre dell'app (chiede se
  riprovare, chiuderle a forza o rinunciare), rinomina i file da sostituire in `*.<data>.old`
  (un exe in uso si può rinominare: il server MCP può essere ancora aperto da un client AI),
  copia i nuovi, scrive il marcatore `edimus-update.json` e avvia la nuova versione.
- **Conferma e ripristino**: all'avvio `UpdaterPort.finish` toglie il marcatore (per lo script è
  il segnale di avvio riuscito), cancella i `.old` (quelli ancora in uso al prossimo avvio) e
  mostra la versione installata. Se la nuova versione esce senza togliere il marcatore, o un
  passo fallisce, lo script rimette i file precedenti e riavvia la versione di prima. Log in
  `%TEMP%\edimus-update\update.log`.
- La prima versione con l'aggiornamento va installata a mano; un ffmpeg nuovo si copia a mano
  nella cartella dell'app (alzando `minFfmpeg` quando una versione lo richiede).

## Aiuto

`features/help/`: il pulsante **?** della toolbar (o F1) apre `HelpDialogComponent` con le
schede *Guida* (ogni funzione), *Come fare* (le operazioni più comuni passo per passo),
*Assistente AI* (`AiSetupComponent`) e *Info e licenze* (autore, repository, `LicensesComponent`).
I testi di Guida e Come fare sono dati strutturati in `help-content.ts`, uno per lingua:
**quando si aggiunge o cambia una funzione, va aggiornato anche lì**, in italiano e inglese.
