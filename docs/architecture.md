# Architettura

## Runtime

- **Neutralino 6** ospita il frontend in una web view e fornisce le API native
  (`filesystem`, `os.execCommand`/processi, `window`, `storage`, `events`).
  `tokenSecurity: none`, server locale su porta casuale; in sviluppo la finestra carica
  `ng serve` su `http://localhost:47815` (vedi `neutralino.config.json`).
- **Strumenti per sviluppatori**: spenti in `neutralino.config.json` (`enableInspector`,
  `openInspectorOnStartup` false); `npm run dev` li abilita da riga di comando
  (`--window-enable-inspector=true`). L'impostazione "Apri gli strumenti per sviluppatori
  all'avvio" fa riavviare il processo una volta con `--window-enable-inspector=true
  --window-open-inspector-on-startup=true` (`DevToolsService`): la finestra li prende solo
  dalla riga di comando, quindi cambiarli richiede un riavvio ("Riavvia ora").
- **Una istanza = un montaggio.** Il file da aprire all'avvio arriva da riga di comando
  (`InstanceService`, `NL_ARGS`). Più montaggi = più finestre/processi.
- **Cartella dell'app** (`appPath()`, da `NL_PATH`): contiene `.cache/` per i file PCM
  temporanei; le impostazioni (tema, lingua, volume d'ascolto, uscita audio, passo di aggancio)
  si cambiano dal dialog Impostazioni (`features/settings`, Ctrl+,; il volume dalla toolbar) e stanno nello storage di
  Neutralino (`SettingsService`).
- **ffmpeg/ffprobe** sono cercati accanto all'exe, in `ffmpeg/` o in `tools/ffmpeg/bin/`
  (`FfmpegService`) e lanciati come processi figli; lo scambio di audio avviene tramite file
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

- **Decodifica** (`AudioDecoderService`): ffprobe per formato/canali/durata, ffmpeg decodifica
  in float al sample rate nativo, mono o stereo (oltre 2 canali → downmix a 2).
- **Libreria** (`AudioLibraryService`): stato per sorgente (`loading`/`ready`/`error`), buffer
  e picchi; segue le sorgenti del montaggio corrente.
- **Tempo** (`TempoService`, `tempo.ts`): BPM e fase stimati dopo la decodifica (flusso
  spettrale → autocorrelazione con preferenza ~120 BPM → pettine per la fase), tenuti in
  memoria e ricalcolati a ogni apertura. Un tempo impostato a mano viene salvato sulla
  sorgente nel montaggio e ha la precedenza (`sourceTempo()`).
- **Audio processato** (`ProcessedAudioService`): una clip con velocità o pitch diversi da
  1/0 suona un render dell'**intera sorgente** per quella coppia rate/pitch (stretch:
  `rubberband=tempo:pitch`; varispeed: `asetrate`+`aresample`, più rubberband per il pitch
  aggiuntivo). Il render è riusato da trim, split, undo/redo e clip con le stesse impostazioni.
  Il buffer renderizzato è in tempo *timeline*: offset nel buffer = `clip.offset / rate`.
- **Mix** (`MixService`): un `GainNode` per traccia udibile (il volume della traccia) e un
  `AudioBufferSourceNode` per clip; una clip con inviluppo passa da un suo `GainNode`
  automatizzato (`automate` con i punti convertiti in tempo di timeline,
  `clipEnvelopeOnTimeline`). Lo stesso grafo serve riproduzione ed export, quindi suonano uguali.
- **Export** (`ExportService`): render offline, normalizzazione opzionale, scrittura PCM
  a blocchi, encoding con ffmpeg con progresso letto da `-progress pipe:1`.

## Stato e servizi

| Servizio | Ruolo |
|---|---|
| `MontageService` | montaggio corrente (immutabile), undo/redo (max 200 passi), `dirty`, percorso, apertura/salvataggio |
| `TimelineService` | zoom (`pxPerSec`), scroll, larghezza vista, selezione clip/intervallo, modalità inviluppo, griglia battute, marcatura battuta; conversioni `timeToX`/`xToTime`, `clipLength` |
| `EditService` | comandi di editing usati da UI e AI: split, delete, crop, dissolvenza incrociata, velocità/pitch, dialoghi tempo e allineamento, marcatura battuta |
| `DocumentService` | nuovo/apri/salva/salva con nome/rinomina/esporta/chiudi, con conferma per le modifiche non salvate; titolo della finestra |
| `PlaybackService` | play/stop/seek, loop, punto iniziale, posizione del playhead, `AudioContext` condiviso inviato all'uscita scelta (`setSinkId`; se il dispositivo manca, la predefinita) |
| `AudioOutputsService` | elenco delle uscite audio (`enumerateDevices`). WebView2 dà i nomi solo a una pagina con permesso microfono: all'apertura delle Impostazioni, la prima volta, si apre e chiude subito un flusso dal microfono. La scelta (id e nome) è nelle impostazioni |
| `DropTargetService` + `dropped-files.ts` | drop di file sulla finestra o su una traccia; la web view non dà i percorsi: si ricavano dalla selezione di Esplora risorse (PowerShell) o, in mancanza, il contenuto viene copiato |
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

- Il server scrive porta e token in `%APPDATA%/edimus/mcp.json`; l'app lo legge e si collega,
  riprovando finché il server non c'è.
- La scheda *Assistente AI* dell'Aiuto (`AiSetupComponent`) mostra lo stato del collegamento.
  `AiSetupService` individua il comando del server (`edimus-mcp.exe` accanto all'app, quello
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
  portabile, nessuna installazione (serve solo il WebView2 Runtime di Windows).
- `scripts/licenses.mjs` raccoglie le licenze di pacchetti npm (frontend e server MCP),
  runtime Neutralino, Node.js incluso in `edimus-mcp.exe` e ffmpeg in `public/licenses.json`
  (scheda *Info e licenze* dell'Aiuto) e `THIRD_PARTY_LICENSES.md`.

## Aiuto

`features/help/`: il pulsante **?** della toolbar (o F1) apre `HelpDialogComponent` con le
schede *Guida* (ogni funzione), *Come fare* (le operazioni più comuni passo per passo),
*Assistente AI* (`AiSetupComponent`) e *Info e licenze* (autore, repository, `LicensesComponent`).
I testi di Guida e Come fare sono dati strutturati in `help-content.ts`, uno per lingua:
**quando si aggiunge o cambia una funzione, va aggiornato anche lì**, in italiano e inglese.
