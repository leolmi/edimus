# Wishlist

Idee valutate ma rimandate: da riprendere **solo se nasce una vera esigenza**.

## Warp marker (tempo variabile)

Punti di ancoraggio audio → timeline su una clip; tra due marker consecutivi l'audio è stirato con un fattore proprio, così un brano a tempo non costante (live, senza metronomo) segue una griglia esatta.

- La mappa delle battute (`Tempo.anchors`, tracciamento automatico e ancore a mano) esiste già e fa seguire la griglia all'audio: i warp marker ne sarebbero l'uso per stirare l'audio sulla griglia regolare.
- Render a tratti (Rubber Band o varispeed) uniti con breve crossfade, oppure mappa tempo di Rubber Band in un solo passaggio.
- Trim, divisione e taglio di intervalli devono spostare/tagliare anche i marker; la griglia della clip segue i marker.
- Stima: circa 3 blocchi (modello e tratti, render, interfaccia). Limite: su musica senza attacchi netti i marker automatici vanno corretti a mano.

## Release compilate da GitHub Actions

Oggi `npm run package` e `npm run release` girano sul PC dello sviluppatore: il codice è pubblico, ma nessuno può verificare che gli eseguibili delle release vengano davvero da quel codice. Compilarli in CI renderebbe la provenienza verificabile.

- Workflow su runner `windows-latest` avviato dal push di un tag `v*`: `npm ci`, `npm run setup`, `npm run package`, poi pubblicazione di zip e `manifest.json` come release (al posto di `scripts/release.mjs`, o con lo stesso script e `GITHUB_TOKEN`).
- ffmpeg non va nel pacchetto: la build di `package.mjs` lo richiede per la cartella portabile, quindi in CI va scaricato dalla build fissata (`config.ffmpeg`) o reso facoltativo per il solo pacchetto di aggiornamento.
- Attestazione di provenienza (`actions/attest-build-provenance`): chiunque verifica con `gh attestation verify edimus.exe --repo leolmi/edimus` che il file è stato prodotto da quel workflow e da quel commit.
- Facoltativo, a parte: firma del codice (certificato a pagamento o Azure Trusted Signing) per togliere l'avviso di SmartScreen.
- Da verificare: `neu build` e `mcp:build` (Node SEA) sul runner, tempi della build, README e `docs/architecture.md` da aggiornare (sezione Sicurezza e trasparenza: le release diventano verificabili).
- Stima: 1–2 blocchi.
