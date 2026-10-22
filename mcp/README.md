# edimus MCP

Server [MCP](https://modelcontextprotocol.io) che permette a un assistente AI (Claude Code, Claude Desktop, …) di usare **edimus mentre è aperto**: legge il montaggio, lo modifica, lo ascolta (analisi livelli/silenzi/battiti, immagine della timeline), lo salva ed esporta. Ogni modifica è un normale passo di *annulla* visibile nella finestra.

```
AI ──stdio──▶ edimus-mcp.exe (o node server.mjs) ──WebSocket 127.0.0.1:47816──▶ edimus (si collega da solo)
```

## Distribuzione: `edimus-mcp.exe`

`npm run mcp:build` (dalla radice; incluso in `npm run package`) crea `mcp/dist/edimus-mcp.exe`
con [build-exe.mjs](build-exe.mjs): `server.mjs` e le sue dipendenze in un solo file (esbuild),
iniettato in una copia di `node.exe` (Node SEA). È un eseguibile autonomo di circa 90 MB (quasi
tutto è il runtime Node): nella cartella portabile sta accanto a `edimus.exe` e non richiede
Node.js né `npm install`. Da exe, `launch_edimus` avvia l'`edimus.exe` della stessa cartella.

## Registrazione

**Automatica**: nell'app, la scheda *Assistente AI* dell'Aiuto (pulsante **?** o F1) trova i client installati e registra il server in quelli
scelti (i file modificati vengono prima copiati in `<file>.bak-edimus`):

| Client | Dove |
|---|---|
| Claude Code | `claude mcp add --scope user edimus -- …` |
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` (`mcpServers`) |
| Cursor | `%USERPROFILE%\.cursor\mcp.json` (`mcpServers`) |
| VS Code (Copilot) | `%APPDATA%\Code\User\mcp.json` (`servers`, `type: "stdio"`) |
| Windsurf | `%USERPROFILE%\.codeium\windsurf\mcp_config.json` (`mcpServers`) |
| Gemini CLI | `%USERPROFILE%\.gemini\settings.json` (`mcpServers`) |
| Codex CLI | `%USERPROFILE%\.codex\config.toml` (`[mcp_servers.edimus]`) |

Un file JSON con commenti non viene toccato: va configurato a mano.

**Manuale** (`<edimus>` = cartella di edimus; il dialog mostra i comandi già completi):

```bash
claude mcp add --scope user edimus -- "<edimus>/edimus-mcp.exe"
```

```json
{ "mcpServers": { "edimus": { "command": "<edimus>/edimus-mcp.exe", "args": [] } } }
```

In sviluppo, senza exe: `cd mcp && npm install`, poi comando `node` con argomento
`<edimus>/mcp/server.mjs` (serve Node.js ≥ 20).

## Uso

1. Apri edimus (o chiedi all'AI di farlo: strumento `launch_edimus`).
2. Entro pochi secondi l'app si collega: l'icona 🤖 della toolbar si colora (lampeggia mentre l'AI lavora).
3. Chiedi all'AI cosa fare, ad esempio *"apri questi due brani, allinea il tempo del secondo al primo e fai un crossfade di 4 secondi"*.

Con più finestre aperte l'AI le vede con `list_instances` e sceglie con `select_instance`.

## Strumenti

| Gruppo | Strumenti |
|---|---|
| Guida e istanze | `get_guide`, `list_instances`, `select_instance`, `launch_edimus` |
| Stato | `get_state` |
| Progetto | `new_montage`, `open`, `save`, `export` |
| Trasporto e storia | `play`, `stop`, `seek`, `select`, `undo`, `redo` |
| Clip e tracce | `move_clip`, `trim_clip`, `split`, `delete_clip`, `delete_range`, `crop`, `set_track`, `delete_track` |
| Volume | `set_envelope`, `fade`, `crossfade` |
| Velocità e tempo | `set_clip_timing`, `set_tempo`, `set_bar_map`, `align_tempo` |
| Analisi | `analyze_levels`, `find_silence`, `get_beats`, `snapshot` |

La guida per l'AI (modello dati, unità, ricette) è in [guide.mjs](guide.mjs), esposta come risorsa `edimus://guide`.

## Sicurezza

- Il server ascolta solo su `127.0.0.1`; l'app si autentica con un token casuale che il server scrive in `%USERPROFILE%/.edimus/mcp-<pid>.json` (cancellato all'uscita; non in `%APPDATA%`, che i client impacchettati MSIX come Claude Desktop reindirizzano nella cartella del pacchetto).
- Ogni client AI avvia il proprio server: il primo prende la porta `EDIMUS_MCP_PORT`, gli altri una porta libera; l'app si collega a tutti quelli che trova, quindi ogni sessione vede le finestre aperte.
- Le operazioni che perdono dati (`new_montage` o `open` di un montaggio con modifiche non salvate, sovrascrittura di file) sono rifiutate se l'AI non passa esplicitamente `discard` / `overwrite`.

## Variabili d'ambiente

| Variabile | Default | Uso |
|---|---|---|
| `EDIMUS_MCP_PORT` | `47816` | porta preferita del bridge WebSocket (se occupata, una libera) |
| `EDIMUS_EXE` | `edimus.exe` accanto all'exe del server; da sorgenti `../release/edimus/edimus.exe` | eseguibile avviato da `launch_edimus` |

## Collaudo

Con edimus aperto: `node test-client.mjs` esegue una sequenza completa di strumenti (apertura, modifica, fade, allineamento tempo, analisi, snapshot, salvataggio, export).
