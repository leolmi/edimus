# Wishlist

Idee valutate ma rimandate: da riprendere **solo se nasce una vera esigenza**.

## Warp marker (tempo variabile)

Punti di ancoraggio audio → timeline su una clip; tra due marker consecutivi l'audio è stirato con un fattore proprio, così un brano a tempo non costante (live, senza metronomo) segue una griglia esatta.

- La mappa delle battute (`Tempo.anchors`, tracciamento automatico e ancore a mano) esiste già e fa seguire la griglia all'audio: i warp marker ne sarebbero l'uso per stirare l'audio sulla griglia regolare.
- Render a tratti (Rubber Band o varispeed) uniti con breve crossfade, oppure mappa tempo di Rubber Band in un solo passaggio.
- Trim, divisione e taglio di intervalli devono spostare/tagliare anche i marker; la griglia della clip segue i marker.
- Stima: circa 3 blocchi (modello e tratti, render, interfaccia). Limite: su musica senza attacchi netti i marker automatici vanno corretti a mano.
