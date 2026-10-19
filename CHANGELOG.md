# Changelog

Versioni secondo [Semantic Versioning](https://semver.org/lang/it/): correzioni in 1.0.x,
funzioni nuove in 1.x. Dalla 1.0.0 il formato dei file `.edimus` è un impegno: le versioni
successive devono aprire i montaggi già salvati (migrazione in `readMontage`).

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
