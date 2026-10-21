# edimus — guida per l'AI

Editor audio multitraccia **non distruttivo** per Windows: app desktop Neutralino con
frontend Angular. Un montaggio (`.edimus`, JSON) richiama i file audio originali, che non
vengono mai modificati, e descrive come comporli; l'export produce il mix finale.

Panoramica per l'utente: [README.md](README.md). Le specifiche di dettaglio sono in `docs/`
e vanno lette prima di toccare l'area corrispondente:

| Documento | Contenuto |
|---|---|
| [docs/architecture.md](docs/architecture.md) | runtime Neutralino, servizi, flusso audio (decodifica, render, mix, export), bridge MCP |
| [docs/data-model.md](docs/data-model.md) | montaggio, sorgenti, clip, tracce, inviluppo, tempo: campi, unità, invarianti, formato file |
| [docs/timeline.md](docs/timeline.md) | vista multitraccia: disegno su canvas, gesti, scorciatoie, griglia delle battute e marcatura |
| [mcp/README.md](mcp/README.md) | server MCP che permette a un'AI di pilotare l'app aperta |
| [WISHLIST.md](WISHLIST.md) | idee valutate e rimandate (non implementarle senza richiesta) |

## Stack

- Angular 22 (standalone, signals, `OnPush`, zoneless), Angular Material M3, Material Symbols.
- Neutralino 6 (`@neutralinojs/lib`): filesystem, processi, finestra, storage. Usato solo
  dietro le porte di `core/platform/` (implementazioni in `src/platform/neutralino/`).
- Web Audio API per riproduzione e render offline; **ffmpeg/ffprobe** esterni (build GPL con
  Rubber Band e libmp3lame) per decodifica, stretch/pitch ed encoding.
- TypeScript 6, Prettier. Nessun framework di test: la verifica è `tsc` + prova nell'app.

## Comandi

| Comando | Uso |
|---|---|
| `npm run dev` | finestra Neutralino collegata a `ng serve` sulla porta 47815 |
| `npm run dev:web` | versione web nel browser (`ng serve`, porta 47817, header COOP/COEP; la 47816 è del bridge MCP) |
| `npm run build:web` | build web in `dist/web/` |
| `npm run typecheck` | `tsc --noEmit` dell'app: il controllo da lanciare dopo ogni insieme di modifiche |
| `npm run package` | build release + `mcp:build` + cartella portabile `release/edimus/` |
| `npm run mcp:build` | `mcp/dist/edimus-mcp.exe`: server MCP come eseguibile autonomo (Node SEA) |
| `npm run licenses` | rigenera `public/licenses.json` e `THIRD_PARTY_LICENSES.md` |
| `npm run mcp:test` | collaudo del server MCP (con l'app aperta) |

ffmpeg non è nel repository: va messo in `tools/ffmpeg/bin/` (vedi README).

## Mappa del codice

```
src/app/
  app.ts/.html          shell: toolbar, scorciatoie da tastiera, drop dei file
  core/
    montage/            modello e logica pura del montaggio (Angular solo nel service)
      montage.model.ts    tipi Montage/AudioSource/Track/Clip
      montage.service.ts  stato corrente immutabile + undo/redo, dirty, path
      edits.ts            operazioni pure: move/trim/split/crop/deleteRange/setClipTiming
      envelope.ts         inviluppo di volume delle clip (punti in tempo sorgente, curve, fade)
      crossfade.ts        dissolvenza incrociata tra due clip
      tempo-align.ts      allineamento del tempo tra clip
      montage-file.ts     lettura/scrittura .edimus (percorsi relativi)
    audio/              libreria buffer, picchi, tempo, render processato, mix, playback, export
    platform/           porte verso la piattaforma: file system, motore audio, impostazioni, shell, capacità
    timeline/           TimelineService: zoom, scroll, selezione, modalità (inviluppo, griglia, marcatura)
    edit.service.ts     comandi di editing per UI e AI (selezione, playhead, dialoghi tempo/velocità)
    document.service.ts nuovo/apri/salva/esporta/chiudi con controllo modifiche non salvate
    ai/                 bridge WebSocket verso mcp/server.mjs ed esecuzione dei comandi
    i18n/               it.ts / en.ts + pipe `t`
    settings, theme-colors, instance, drop-target, ...
  features/             componenti UI: timeline (lane, ruler, clip-bar, dialoghi), export, rename, settings,
                        help (Aiuto: guida, come fare, assistente AI, info e licenze)
  shared/               componenti riusabili (scale-slider)
src/platform/           implementazioni delle porte: neutralino/ (ffmpeg, dialoghi, drop, reveal);
                        web/ (File System Access API, Rubber Band e encoder wasm); platform.providers.ts sceglie la piattaforma della build,
                        sostituito da platform.providers.web.ts nella configurazione `web`
mcp/                    server MCP (Node, stdio), guida per l'AI (guide.mjs), build dell'exe (build-exe.mjs)
scripts/                licenses.mjs, package.mjs
```

## Regole del progetto

- **Piattaforma**: in `src/app` niente `@neutralinojs/lib` né API del browser legate a una
  sola piattaforma: le capacità native passano dalle porte di `core/platform/`, implementate in
  `src/platform/neutralino/` e `src/platform/web/` (una capacità nuova va in entrambe).
- **Non distruttivo**: mai scrivere sui file sorgente; tutto passa dal montaggio.
- **Montaggio immutabile**: ogni modifica produce un nuovo `Montage` tramite
  `MontageService.update()` (un passo di annulla) o `preview()` + `commit(from)` per i gesti
  trascinati (un solo passo per tutto il gesto). Le operazioni sul modello stanno in funzioni
  pure (`edits.ts`, `envelope.ts`, `tempo-align.ts`).
- **Tempi in secondi**: timeline seconds salvo dove il nome/commento dice *source*.
  Conversione: `timeline = clip.start + (source - clip.offset) / rate`. Volumi in gain lineare
  nel modello, dB solo in UI/MCP.
- **Una finestra = un montaggio**: niente multi-documento; più montaggi = più istanze.
- **UI**: solo Angular Material e token del tema (`--mat-sys-*`), nessun colore fisso;
  per il canvas usare `ThemeColorsService`. Icone nei pulsanti mai ridimensionate a mano
  (usare i token Material). Ogni testo visibile va in `i18n/it.ts` **e** `i18n/en.ts`.
- **Codice e commenti in inglese**, documentazione in italiano. Commenti brevi che dicono
  il *perché*, come quelli esistenti.
- **Funzioni esposte all'AI**: una nuova capacità di editing va aggiunta anche a
  `core/ai/ai-commands.service.ts`, `mcp/server.mjs` (strumento) e, se cambia il modello o
  l'uso, `mcp/guide.mjs`.
- **Licenze**: progetto non distribuito, librerie GPL ammesse; ogni componente di terze
  parti deve comparire in `THIRD_PARTY_LICENSES.md` / scheda Info e licenze (`npm run licenses`).
- **Aiuto in linea**: ogni funzione nuova o cambiata va descritta anche in
  `features/help/help-content.ts` (Guida e, se è un'operazione comune, Come fare), it ed en.
- **Documentazione**: quando cambia un comportamento descritto in `docs/` o qui, aggiornare
  il documento nello stesso intervento.
