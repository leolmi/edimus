# edimus

Editor audio multitraccia **non distruttivo** per il desktop (Windows), costruito con
[Neutralino](https://neutralino.js.org) e Angular.

I file audio originali non vengono mai modificati: un *montaggio* (file `.edimus`) li
richiama e descrive come comporli in un unico mix mono o stereo, che si ottiene con
l'esportazione.

![edimus: tre tracce con griglia delle battute e inviluppi di volume](docs/images/screenshot.png)

## Funzionalità

- **Multitraccia**: clip trascinabili tra tracce, trim dei bordi, divisione, eliminazione di
  intervalli, crop; mute/solo per traccia.
- **Forma d'onda** per canale, zoom dal campione all'intero brano.
- **Inviluppo di volume** per clip (punti in dB, segmenti curvabili, fade e dissolvenze incrociate
  che seguono la clip) e volume per traccia.
- **Velocità e pitch** per clip: stretch (pitch invariato, Rubber Band) o varispeed (come un
  nastro).
- **Tempo**: rilevamento automatico dei BPM, griglia delle battute, correzione manuale
  (tap, battuta segnata sulla forma d'onda), allineamento del tempo tra più clip.
- **Import** di qualsiasi formato letto da ffmpeg (wav, mp3, flac, ogg, opus, m4a, aiff, wma…);
  **export** in wav, mp3, flac, ogg, opus, m4a.
- Annulla/ripeti, tema chiaro/scuro/sistema, italiano/inglese.
- **Pilotabile da un'AI** tramite il server MCP incluso (`edimus-mcp.exe`): dall'app, il
  pulsante dell'assistente lo registra con un clic in Claude Code, Claude Desktop, Cursor,
  VS Code, Windsurf, Gemini CLI e Codex CLI ([mcp/README.md](mcp/README.md)).

## Requisiti

- Node.js ≥ 20 e npm.
- ffmpeg/ffprobe Windows (build GPL “essentials” di [gyan.dev](https://www.gyan.dev/ffmpeg/builds/),
  che include Rubber Band e libmp3lame): `ffmpeg.exe` e `ffprobe.exe` vanno copiati in
  `tools/ffmpeg/bin/` (cartella esclusa da git), con `LICENSE` e `README.txt` in `tools/ffmpeg/`.

## Avvio

```bash
npm install
npm run setup
npm run dev
```

`setup` scarica il runtime Neutralino (`bin/`) e genera l'elenco delle licenze; `dev` apre la
finestra dell'app collegata a `ng serve` (porta 47815) con ricarica automatica.

## Build

```bash
npm run package
```

Produce `release/edimus/`: cartella portabile (nessuna installazione) con `edimus.exe`
(risorse incorporate), `edimus-mcp.exe` (server MCP autonomo), `ffmpeg.exe`, `ffprobe.exe` e le
licenze. Per usarla su un altro PC basta copiare la cartella; serve il WebView2 Runtime di
Windows, già presente su Windows 11 e sui Windows 10 aggiornati.

## Licenze

Progetto personale non distribuito. Le licenze di tutti i componenti usati sono in
[THIRD_PARTY_LICENSES.md](THIRD_PARTY_LICENSES.md) e nella finestra *Licenze* dell'app
(rigenerate da `npm run licenses`).
