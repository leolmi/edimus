# edimus MCP

Server [MCP](https://modelcontextprotocol.io) che permette a un assistente AI (Claude Code, Claude Desktop, …) di usare **edimus mentre è aperto**: legge il montaggio, lo modifica, lo ascolta (analisi livelli/silenzi/battiti, immagine della timeline), lo salva ed esporta. Ogni modifica è un normale passo di *annulla* visibile nella finestra.

```
AI ──stdio──▶ mcp/server.mjs ──WebSocket 127.0.0.1:47816──▶ edimus (si collega da solo)
```

## Installazione

Serve Node.js (≥ 20) solo sul PC dove si usa l'MCP.

```bash
cd mcp
npm install
```

## Registrazione in Claude Code

```bash
claude mcp add edimus -- node D:/Sviluppo/@leolmi/edimus/mcp/server.mjs
```

Per Claude Desktop, in `claude_desktop_config.json`:

```json
{ "mcpServers": { "edimus": { "command": "node", "args": ["D:/Sviluppo/@leolmi/edimus/mcp/server.mjs"] } } }
```

## Uso

1. Apri edimus (o chiedi all'AI di farlo: strumento `launch_edimus`).
2. Entro pochi secondi l'app si collega: in toolbar compare l'icona 🤖 (lampeggia mentre l'AI lavora).
3. Chiedi all'AI cosa fare, ad esempio *"apri questi due brani, allinea il tempo del secondo al primo e fai un crossfade di 4 secondi"*.

Con più finestre aperte l'AI le vede con `list_instances` e sceglie con `select_instance`.

## Strumenti

| Gruppo | Strumenti |
|---|---|
| Guida e istanze | `get_guide`, `list_instances`, `select_instance`, `launch_edimus` |
| Stato | `get_state` |
| Progetto | `new_montage`, `open`, `save`, `export` |
| Trasporto e storia | `play`, `stop`, `seek`, `undo`, `redo` |
| Clip e tracce | `move_clip`, `trim_clip`, `split`, `delete_clip`, `delete_range`, `crop`, `set_track`, `delete_track` |
| Volume | `set_envelope`, `fade` |
| Velocità e tempo | `set_clip_timing`, `set_tempo`, `align_tempo` |
| Analisi | `analyze_levels`, `find_silence`, `get_beats`, `snapshot` |

La guida per l'AI (modello dati, unità, ricette) è in [guide.mjs](guide.mjs), esposta come risorsa `edimus://guide`.

## Sicurezza

- Il server ascolta solo su `127.0.0.1`; l'app si autentica con un token casuale che il server scrive in `%APPDATA%/edimus/mcp.json` (cancellato all'uscita).
- Le operazioni che perdono dati (`new_montage` o `open` di un montaggio con modifiche non salvate, sovrascrittura di file) sono rifiutate se l'AI non passa esplicitamente `discard` / `overwrite`.

## Variabili d'ambiente

| Variabile | Default | Uso |
|---|---|---|
| `EDIMUS_MCP_PORT` | `47816` | porta del bridge WebSocket |
| `EDIMUS_EXE` | `../release/edimus/edimus.exe` | eseguibile avviato da `launch_edimus` |

## Collaudo

Con edimus aperto: `node test-client.mjs` esegue una sequenza completa di strumenti (apertura, modifica, fade, allineamento tempo, analisi, snapshot, salvataggio, export).
