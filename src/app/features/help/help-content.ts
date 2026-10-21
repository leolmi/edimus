import type { Language } from '../../core/settings.service';

/** Author and public repository, shown in the Info tab. */
export const APP_INFO = {
  author: 'Leonardo Olmi',
  repository: 'https://github.com/leolmi/edimus',
};

/** A function of the app: what it does and how to use it (one paragraph per entry). */
export interface HelpTopic {
  title: string;
  /** Keyboard shortcuts or gestures, shown as chips. */
  keys?: string[];
  text: string[];
}

/** A group of functions of the Guide tab. */
export interface HelpSection {
  title: string;
  icon: string;
  topics: HelpTopic[];
}

/** A task of the How-to tab, as a sequence of steps. */
export interface HowTo {
  title: string;
  steps: string[];
  /** Remark after the steps (limits, alternatives). */
  note?: string;
}

export interface HelpContent {
  guide: HelpSection[];
  howto: HowTo[];
}

const IT: HelpContent = {
  guide: [
    {
      title: 'Montaggio e file',
      icon: 'folder_open',
      topics: [
        {
          title: 'Montaggio non distruttivo',
          text: [
            'edimus non modifica mai i file audio originali: il montaggio (file .edimus) li richiama e descrive come comporli. Il risultato finale si ottiene con l’esportazione.',
            'Ogni finestra contiene un montaggio; per lavorare su più montaggi apri più finestre.',
          ],
        },
        {
          title: 'Aprire file audio o un montaggio',
          keys: ['Ctrl+O', 'trascina i file'],
          text: [
            'I file audio (wav, mp3, flac, ogg, opus, m4a, aiff, wma…) vengono aggiunti come nuove tracce; un file .edimus sostituisce il montaggio aperto.',
            'Puoi anche trascinare i file sulla finestra: sull’area vuota sotto le tracce diventano nuove tracce, su una traccia esistente vengono inseriti in quella traccia. Finché il caricamento non è finito, la traccia (o l’area vuota) mostra un indicatore con l’avanzamento.',
          ],
        },
        {
          title: 'Nuovo, salva, salva con nome, rinomina',
          keys: ['Ctrl+N', 'Ctrl+S', 'Ctrl+Shift+S'],
          text: [
            'Il primo salvataggio chiede il nome del montaggio. Per rinominarlo clicca sul titolo nella barra in alto. Il pallino accanto al titolo indica modifiche non salvate.',
            'Se sposti il file .edimus insieme ai file audio (stessa struttura di cartelle), i percorsi vengono ritrovati da soli.',
          ],
        },
        {
          title: 'Esportare il mix',
          keys: ['Ctrl+E'],
          text: [
            'Produce un unico file mono o stereo con tutte le tracce udibili, i volumi e le modifiche di velocità: wav, mp3, flac, ogg, opus o m4a, con qualità, frequenza di campionamento e normalizzazione a scelta.',
          ],
        },
        {
          title: 'Annulla e ripeti',
          keys: ['Ctrl+Z', 'Ctrl+Shift+Z', 'Ctrl+Y'],
          text: ['Ogni modifica, anche fatta da un assistente AI, si può annullare e ripetere.'],
        },
      ],
    },
    {
      title: 'Ascolto',
      icon: 'play_circle',
      topics: [
        {
          title: 'Play, pausa e stop',
          keys: ['Spazio', 'Home', 'End'],
          text: [
            'I comandi di ascolto sono in basso a destra, con il tempo corrente e la durata. Spazio avvia e mette in pausa; Home e End portano il cursore all’inizio e alla fine.',
          ],
        },
        {
          title: 'Spostare il cursore e punto iniziale',
          text: [
            'Un clic su un’area vuota delle tracce sposta il cursore. Un clic (o un trascinamento) sul righello dei tempi sposta il cursore e fissa il punto iniziale, segnato da una bandierina: da lì ogni stop riporta il cursore a quel punto. Uno stop quando il cursore è già sul punto iniziale lo annulla e riporta il cursore a zero.',
          ],
        },
        {
          title: 'Ripetere un intervallo (loop)',
          text: [
            'Seleziona un intervallo trascinando su un’area vuota delle tracce, poi attiva il pulsante loop: l’ascolto ripete l’intervallo senza pause. Se il cursore è fuori dall’intervallo, l’ascolto parte dal suo inizio.',
          ],
        },
        {
          title: 'Centrare la vista sul cursore',
          text: ['Il pulsante con il mirino porta il cursore al centro della vista (all’inizio o alla fine se è vicino agli estremi).'],
        },
        {
          title: 'Volume d’ascolto e uscita audio',
          text: [
            'Il cursore del volume e il pulsante muto agiscono solo sull’ascolto, non sull’esportazione.',
            'Il dispositivo di uscita (predefinito di sistema, cuffie, scheda audio…) si sceglie nelle Impostazioni. La prima volta Windows chiede il permesso per il microfono: serve solo a leggere i nomi dei dispositivi, non viene registrato nulla.',
          ],
        },
      ],
    },
    {
      title: 'Vista',
      icon: 'zoom_in',
      topics: [
        {
          title: 'Zoom e scorrimento',
          keys: ['rotella', 'Shift+rotella'],
          text: [
            'La rotella sulle tracce o sul righello ingrandisce e riduce attorno al puntatore; Shift+rotella (o la rotella orizzontale) scorre il tempo; la rotella sulle intestazioni delle tracce le scorre in verticale.',
            'I pulsanti in alto a destra ingrandiscono, riducono e adattano la vista all’intero montaggio.',
          ],
        },
        {
          title: 'Forma d’onda',
          text: [
            'Ogni clip mostra la forma d’onda dei suoi canali, già scalata dal suo inviluppo e dal volume della traccia: vedi il livello che ascolti. Ogni file sorgente ha un suo colore.',
          ],
        },
      ],
    },
    {
      title: 'Tracce e clip',
      icon: 'view_timeline',
      topics: [
        {
          title: 'Tracce',
          text: [
            'Nell’intestazione di ogni traccia: muto, solo (se una traccia è in solo si sentono solo quelle in solo), dettagli sui file usati (con il pulsante per mostrarli in Esplora risorse) ed eliminazione della traccia.',
          ],
        },
        {
          title: 'Selezionare e spostare una clip',
          text: [
            'Una clip è una porzione di un file audio posata su una traccia. Clic per selezionarla, trascina per spostarla nel tempo o su un’altra traccia; trascinandola sotto l’ultima traccia ne crea una nuova.',
            'Inizio e fine della clip si agganciano all’inizio o alla fine delle altre clip, su qualsiasi traccia, quando ci passano vicino. Con la griglia delle battute visibile la clip si sposta a passi (battuta, semiminima o croma, da scegliere nelle Impostazioni): il punto della griglia della clip sotto il puntatore si aggancia al più vicino delle altre clip. Tieni premuto Alt per spostarla liberamente.',
          ],
        },
        {
          title: 'Selezionare più clip',
          keys: ['Ctrl+clic', 'Ctrl+A'],
          text: [
            'Ctrl+clic aggiunge una clip alla selezione o la toglie; Ctrl+A seleziona tutte le clip, Esc nessuna. Trascinando una delle clip selezionate si spostano tutte insieme, mantenendo le distanze (cambiano traccia insieme finché restano tutte su tracce esistenti); un clic senza trascinare lascia selezionata solo quella clip.',
            'Le operazioni agiscono sulle clip selezionate: Canc le elimina, S le divide al cursore, la dissolvenza incrociata lavora tra quelle.',
          ],
        },
        {
          title: 'Accorciare una clip (trim)',
          text: ['Trascina il bordo sinistro o destro della clip. La parte nascosta non è persa: riallargando il bordo ricompare (la clip selezionata mostra tratteggiata l’estensione dell’intero file).'],
        },
        {
          title: 'Dividere',
          keys: ['S'],
          text: ['Divide in due, nel punto del cursore, le clip selezionate; senza selezione divide tutte le clip attraversate dal cursore.'],
        },
        {
          title: 'Selezionare un intervallo di tempo',
          keys: ['Esc'],
          text: [
            'Trascina su un’area vuota delle tracce: la fascia selezionata vale per tutte le tracce. Serve per ritagliare, eliminare o ripetere in loop un tratto. Esc toglie la selezione.',
          ],
        },
        {
          title: 'Ritagliare (crop) ed eliminare',
          keys: ['Canc'],
          text: [
            '“Ritaglia alla selezione” tiene solo l’intervallo selezionato e lo porta all’inizio.',
            'Canc elimina l’intervallo selezionato da tutte le tracce chiudendo il buco; senza intervallo elimina le clip selezionate.',
          ],
        },
        {
          title: 'Dissolvenza incrociata',
          text: [
            'Dove una clip finisce sopra un’altra che inizia (su qualsiasi traccia, anche la stessa), il pulsante “Dissolvenza incrociata” scrive nell’inviluppo delle due clip la sfumatura in uscita della prima e in entrata della seconda, a potenza costante, così il volume complessivo non cala. Le sfumature seguono le clip se poi le sposti.',
            'Con due o più clip selezionate (Ctrl+clic) la dissolvenza è tra quelle, su tutta la loro sovrapposizione; altrimenti vale la fascia di tempo selezionata e, se contiene più coppie, la più ampia. Con clip e fascia insieme, la dissolvenza è tra le clip e limitata alla fascia.',
            'Il resto della clip che finisce resta muto, così come l’inizio di quella che entra prima della dissolvenza.',
          ],
        },
      ],
    },
    {
      title: 'Volume',
      icon: 'show_chart',
      topics: [
        {
          title: 'Inviluppo di volume della clip',
          keys: ['E', 'Alt'],
          text: [
            'Ogni clip ha il suo inviluppo di volume, per sfumature e dissolvenze: segue la clip quando la sposti, la dividi, la accorci o ne cambi la velocità.',
            'Con la modalità inviluppo attiva (pulsante o tasto E) il clic su una clip aggiunge un punto di volume; i punti si trascinano dentro la clip, il clic destro li elimina.',
            'Trascinando, il punto si aggancia ai bordi delle clip, ai punti degli inviluppi delle altre clip e, in verticale, a 0 dB; Alt lo sposta liberamente. Anche le clip trascinate si agganciano ai punti degli inviluppi delle altre clip.',
            'Il pallino a metà di un segmento lo curva (per dissolvenze naturali); doppio clic lo raddrizza. Prima del primo punto e dopo l’ultimo il volume resta costante.',
          ],
        },
        {
          title: 'Volume della traccia',
          text: ['Il cursore nell’intestazione della traccia regola il volume di tutta la traccia (da −30 a +6 dB); doppio clic lo riporta a 0 dB.'],
        },
      ],
    },
    {
      title: 'Velocità, intonazione e tempo',
      icon: 'speed',
      topics: [
        {
          title: 'Velocità e intonazione di una clip',
          text: [
            'Seleziona la clip e usa “Velocità e intonazione” nella barra in basso (o doppio clic sulla clip). Stretch cambia la velocità mantenendo l’intonazione; varispeed la cambia come un nastro (più veloce = più acuto). L’intonazione si sposta anche da sola, in semitoni.',
          ],
        },
        {
          title: 'Rilevamento del tempo e griglia delle battute',
          keys: ['B'],
          text: [
            'All’apertura edimus stima i BPM di ogni file. La griglia (pulsante nota o tasto B) mostra le battute come fasce alternate numerate, con i movimenti più leggeri.',
          ],
        },
        {
          title: 'Correggere il tempo',
          keys: ['T'],
          text: [
            'Seleziona la clip e premi il pulsante BPM nella barra in basso: puoi scegliere il metro (2/4, 3/4, 4/4, 6/8), scrivere i BPM, dimezzarli o raddoppiarli, battere il tempo (Tap o tasto T) e spostare il primo battito.',
            '“Segna la battuta” è il modo più preciso: clicchi sull’1 di una battuta, compare la griglia di una battuta che sposti trascinandola e allarghi dai bordi finché coincide con la musica; Invio conferma.',
          ],
        },
        {
          title: 'Allineare il tempo di più clip',
          text: [
            'Il pulsante con le frecce nella barra in alto porta più clip allo stesso tempo: scegli la clip di riferimento, quelle da adattare, il tempo da raggiungere e, se vuoi, l’allineamento delle battute.',
          ],
        },
      ],
    },
    {
      title: 'Impostazioni e assistente AI',
      icon: 'settings',
      topics: [
        {
          title: 'Impostazioni',
          keys: ['Ctrl+,'],
          text: [
            'Il pulsante ingranaggio in alto a destra apre le preferenze che si cambiano di rado: tema chiaro, scuro o di sistema; lingua; uscita audio; passo di aggancio delle clip alla griglia; apertura degli strumenti per sviluppatori all’avvio (vale dal prossimo avvio, o con “Riavvia ora”). Ogni modifica resta salvata.',
          ],
        },
        {
          title: 'Assistente AI (MCP)',
          text: [
            'Un assistente AI (Claude, Cursor, Copilot, Gemini…) può aprire, ascoltare, modificare e salvare il montaggio. La scheda Assistente AI di questo Aiuto lo configura automaticamente e mostra se un assistente è collegato.',
          ],
        },
      ],
    },
  ],
  howto: [
    {
      title: 'Tagliare via un pezzo da una traccia',
      steps: [
        'Porta il cursore all’inizio del pezzo e premi S per dividere la clip; ripeti alla fine del pezzo.',
        'Seleziona la clip centrale con un clic e premi Canc.',
        'Se vuoi chiudere il buco, trascina a sinistra la clip che segue.',
      ],
      note: 'Per togliere lo stesso tratto da tutte le tracce insieme, selezionalo trascinando su un’area vuota e premi Canc: il buco si chiude da solo.',
    },
    {
      title: 'Spostare (tagliare e incollare) un pezzo di traccia',
      steps: [
        'Isola il pezzo dividendo la clip con S all’inizio e alla fine.',
        'Trascina il pezzo dove serve, anche su un’altra traccia o sotto l’ultima per crearne una nuova.',
      ],
      note: 'Il copia e incolla (duplicare un pezzo) non c’è ancora: per riusare un tratto, aggiungi di nuovo lo stesso file e accorcialo dai bordi.',
    },
    {
      title: 'Tenere solo una parte del brano',
      steps: ['Seleziona l’intervallo trascinando su un’area vuota delle tracce.', 'Premi il pulsante “Ritaglia alla selezione”: resta solo l’intervallo, portato all’inizio.'],
    },
    {
      title: 'Mettere a tempo più tracce tra loro',
      steps: [
        'Attiva la griglia (B) e controlla che le battute di ogni traccia cadano sui colpi; se una è sbagliata, correggila con il pulsante BPM della clip (meglio con “Segna la battuta”).',
        'Apri “Allinea il tempo delle clip” (pulsante con le frecce in alto).',
        'Scegli la clip di riferimento e le clip da adattare; come tempo usa quello del riferimento, oppure una via di mezzo per stirare meno ogni clip.',
        'Lascia attivo l’allineamento delle battute: le clip si spostano perché i loro “1” cadano sugli “1” del riferimento.',
      ],
      note: 'Stretch mantiene l’intonazione; varispeed suona più naturale per piccole correzioni ma cambia l’intonazione.',
    },
    {
      title: 'Mettere a tempo l’ultima traccia aggiunta con quelle già presenti',
      steps: [
        'Aggiungi il file (Ctrl+O o trascinandolo) e controlla con la griglia che il suo tempo sia rilevato bene; correggilo se serve.',
        'Apri “Allinea il tempo delle clip”: come riferimento scegli una clip già presente, come clip da adattare solo quella nuova.',
        'Come tempo scegli quello del riferimento, così le tracce esistenti non cambiano; attiva l’allineamento delle battute.',
        'Ascolta un tratto in loop per verificare e, se serve, sposta a mano la nuova clip di una battuta.',
      ],
    },
    {
      title: 'Fare una dissolvenza tra due brani',
      steps: [
        'Metti i due brani su tracce diverse e sovrapponi la fine del primo all’inizio del secondo.',
        'Seleziona i due brani con Ctrl+clic (oppure trascina su un’area vuota una fascia che comprenda la sovrapposizione).',
        'Premi “Dissolvenza incrociata”: il primo brano sfuma in uscita, il secondo in entrata, a volume costante.',
        'Se vuoi ritoccarla, attiva la modalità inviluppo (E) e sposta o curva i punti creati.',
      ],
    },
    {
      title: 'Abbassare il volume di una traccia',
      steps: ['Trascina verso sinistra il cursore del volume nell’intestazione della traccia (doppio clic: torna a 0 dB).'],
    },
    {
      title: 'Ascoltare in loop un passaggio',
      steps: ['Seleziona il passaggio trascinando su un’area vuota delle tracce.', 'Attiva il loop (in basso a destra) e premi Spazio.'],
    },
    {
      title: 'Cambiare velocità senza cambiare intonazione',
      steps: ['Seleziona la clip e apri “Velocità e intonazione” (o doppio clic sulla clip).', 'Imposta la velocità in modalità stretch e conferma.'],
    },
    {
      title: 'Esportare il risultato',
      steps: ['Premi Ctrl+E (o il pulsante esporta).', 'Scegli formato, qualità e canali, poi il file di destinazione.'],
      note: 'Si esportano solo le tracce udibili: controlla muto e solo prima di esportare.',
    },
    {
      title: 'Far lavorare un assistente AI sul montaggio',
      steps: [
        'Apri l’Aiuto (pulsante ? o F1) e la scheda Assistente AI.',
        'Scegli gli assistenti installati e premi Configura.',
        'Riavvia l’assistente e chiedigli, per esempio: “allinea il tempo della seconda traccia alla prima”.',
      ],
    },
  ],
};

const EN: HelpContent = {
  guide: [
    {
      title: 'Montage and files',
      icon: 'folder_open',
      topics: [
        {
          title: 'Non-destructive montage',
          text: [
            'edimus never changes the original audio files: the montage (.edimus file) refers to them and describes how to combine them. The final result comes from the export.',
            'Each window holds one montage; open more windows to work on more montages.',
          ],
        },
        {
          title: 'Open audio files or a montage',
          keys: ['Ctrl+O', 'drag the files'],
          text: [
            'Audio files (wav, mp3, flac, ogg, opus, m4a, aiff, wma…) are added as new tracks; a .edimus file replaces the open montage.',
            'You can also drag files onto the window: on the empty area below the tracks they become new tracks, on an existing track they are inserted into it. Until the loading is over, the track (or the empty area) shows an indicator with the progress.',
          ],
        },
        {
          title: 'New, save, save as, rename',
          keys: ['Ctrl+N', 'Ctrl+S', 'Ctrl+Shift+S'],
          text: [
            'The first save asks for the name of the montage. To rename it click the title in the top bar. The dot next to the title means unsaved changes.',
            'If you move the .edimus file together with the audio files (same folder structure), the paths are found again by themselves.',
          ],
        },
        {
          title: 'Export the mix',
          keys: ['Ctrl+E'],
          text: [
            'Produces a single mono or stereo file with all the audible tracks, volumes and speed changes: wav, mp3, flac, ogg, opus or m4a, with the quality, sample rate and normalization you choose.',
          ],
        },
        {
          title: 'Undo and redo',
          keys: ['Ctrl+Z', 'Ctrl+Shift+Z', 'Ctrl+Y'],
          text: ['Every edit, also one made by an AI assistant, can be undone and redone.'],
        },
      ],
    },
    {
      title: 'Listening',
      icon: 'play_circle',
      topics: [
        {
          title: 'Play, pause and stop',
          keys: ['Space', 'Home', 'End'],
          text: [
            'The transport is at the bottom right, with the current time and the length. Space plays and pauses; Home and End move the playhead to the start and the end.',
          ],
        },
        {
          title: 'Moving the playhead and start point',
          text: [
            'A click on an empty area of the tracks moves the playhead. A click (or a drag) on the time ruler moves the playhead and sets the start point, marked by a flag: from then on every stop brings the playhead back there. A stop when the playhead is already on the start point drops it and brings the playhead to zero.',
          ],
        },
        {
          title: 'Repeating a range (loop)',
          text: [
            'Select a range by dragging on an empty area of the tracks, then switch on the loop button: playback repeats the range without gaps. When the playhead is outside the range, playback starts from its beginning.',
          ],
        },
        {
          title: 'Centering the view on the playhead',
          text: ['The crosshair button brings the playhead to the middle of the view (to the start or the end when it is close to them).'],
        },
        {
          title: 'Listening volume and audio output',
          text: [
            'The volume slider and the mute button affect only listening, not the export.',
            'The output device (system default, headphones, audio interface…) is chosen in the Settings. The first time Windows asks for microphone permission: it is only needed to read the device names, nothing is recorded.',
          ],
        },
      ],
    },
    {
      title: 'View',
      icon: 'zoom_in',
      topics: [
        {
          title: 'Zoom and scroll',
          keys: ['wheel', 'Shift+wheel'],
          text: [
            'The wheel on the tracks or on the ruler zooms around the pointer; Shift+wheel (or the horizontal wheel) scrolls the time; the wheel on the track headers scrolls them vertically.',
            'The buttons at the top right zoom in, zoom out and fit the whole montage in the view.',
          ],
        },
        {
          title: 'Waveform',
          text: ['Each clip shows the waveform of its channels, already scaled by its envelope and the track volume: you see the level you hear. Each source file has its own color.'],
        },
      ],
    },
    {
      title: 'Tracks and clips',
      icon: 'view_timeline',
      topics: [
        {
          title: 'Tracks',
          text: [
            'In the header of each track: mute, solo (when a track is soloed only the soloed tracks are heard), details of the files used (with a button to show them in File Explorer) and track removal.',
          ],
        },
        {
          title: 'Select and move a clip',
          text: [
            'A clip is a portion of an audio file placed on a track. Click to select it, drag to move it in time or to another track; dragging it below the last track creates a new one.',
            'The start and end of the clip snap to the start or end of the other clips, on any track, when they pass close by. With the bar grid shown the clip moves by steps (bar, quarter or eighth note, chosen in the Settings): the grid point of the clip under the pointer snaps to the nearest one of the other clips. Hold Alt to move it freely.',
          ],
        },
        {
          title: 'Select several clips',
          keys: ['Ctrl+click', 'Ctrl+A'],
          text: [
            'Ctrl+click adds a clip to the selection or removes it; Ctrl+A selects all the clips, Esc none. Dragging one of the selected clips moves them all together, keeping their spacing (they change track together while all of them stay on existing tracks); a click without dragging leaves only that clip selected.',
            'The operations act on the selected clips: Delete removes them, S splits them at the playhead, the crossfade works between them.',
          ],
        },
        {
          title: 'Shorten a clip (trim)',
          text: ['Drag the left or right edge of the clip. The hidden part is not lost: widening the edge brings it back (the selected clip shows the extent of the whole file dashed).'],
        },
        {
          title: 'Split',
          keys: ['S'],
          text: ['Splits the selected clips in two at the playhead; with no selection it splits every clip under the playhead.'],
        },
        {
          title: 'Select a time range',
          keys: ['Esc'],
          text: ['Drag on an empty area of the tracks: the selected band applies to all the tracks. Use it to crop, delete or loop a stretch. Esc clears the selection.'],
        },
        {
          title: 'Crop and delete',
          keys: ['Delete'],
          text: [
            '“Crop to selection” keeps only the selected range and moves it to the start.',
            'Delete removes the selected range from all the tracks closing the gap; with no range it removes the selected clips.',
          ],
        },
        {
          title: 'Crossfade',
          text: [
            'Where a clip ends over another one that starts (on any track, even the same one), the “Crossfade” button writes in the envelopes of the two clips the fade-out of the first and the fade-in of the second, at constant power, so the overall volume does not drop. The fades follow the clips if you move them afterwards.',
            'With two or more clips selected (Ctrl+click) the crossfade is between them, over their whole overlap; otherwise the selected time range applies and, if it holds several pairs, the widest one. With clips and range together, the crossfade is between the clips, clamped to the range.',
            'The rest of the ending clip stays silent, and so does the start of the incoming one before the crossfade.',
          ],
        },
      ],
    },
    {
      title: 'Volume',
      icon: 'show_chart',
      topics: [
        {
          title: 'Clip volume envelope',
          keys: ['E', 'Alt'],
          text: [
            'Each clip has its own volume envelope, for fades and crossfades: it follows the clip when you move it, split it, trim it or change its speed.',
            'With the envelope mode on (button or E key) a click on a clip adds a volume point; points can be dragged inside the clip, a right click removes them.',
            'While dragging, the point snaps to the clip edges, to the envelope points of the other clips and, vertically, to 0 dB; Alt moves it freely. Dragged clips also snap to the envelope points of the other clips.',
            'The dot in the middle of a segment bends it (for natural fades); a double click straightens it. Before the first point and after the last one the volume stays constant.',
          ],
        },
        {
          title: 'Track volume',
          text: ['The slider in the track header sets the volume of the whole track (from −30 to +6 dB); a double click brings it back to 0 dB.'],
        },
      ],
    },
    {
      title: 'Speed, pitch and tempo',
      icon: 'speed',
      topics: [
        {
          title: 'Speed and pitch of a clip',
          text: [
            'Select the clip and use “Speed and pitch” in the bottom bar (or double click the clip). Stretch changes the speed keeping the pitch; varispeed changes it like a tape (faster = higher). The pitch can also be shifted by itself, in semitones.',
          ],
        },
        {
          title: 'Tempo detection and bar grid',
          keys: ['B'],
          text: ['On opening edimus estimates the BPM of each file. The grid (note button or B key) shows the bars as numbered alternate bands, with the beats lighter.'],
        },
        {
          title: 'Correcting the tempo',
          keys: ['T'],
          text: [
            'Select the clip and press the BPM button in the bottom bar: you can choose the meter (2/4, 3/4, 4/4, 6/8), type the BPM, halve or double it, tap the tempo (Tap or T key) and move the first beat.',
            '“Mark a bar” is the most precise way: click the 1 of a bar, a one-bar grid appears that you move by dragging and stretch from its edges until it matches the music; Enter confirms.',
          ],
        },
        {
          title: 'Matching the tempo of several clips',
          text: [
            'The arrows button in the top bar brings several clips to the same tempo: choose the reference clip, the clips to adapt, the tempo to reach and, if you want, the alignment of the bars.',
          ],
        },
      ],
    },
    {
      title: 'Settings and AI assistant',
      icon: 'settings',
      topics: [
        {
          title: 'Settings',
          keys: ['Ctrl+,'],
          text: [
            'The gear button at the top right opens the preferences changed rarely: light, dark or system theme; language; audio output; snap step of the clips on the grid; opening the developer tools at startup (applies from the next start, or with “Restart now”). Every change is saved.',
          ],
        },
        {
          title: 'AI assistant (MCP)',
          text: [
            'An AI assistant (Claude, Cursor, Copilot, Gemini…) can open, listen to, edit and save the montage. The AI assistant tab of this Help sets it up automatically and shows whether an assistant is connected.',
          ],
        },
      ],
    },
  ],
  howto: [
    {
      title: 'Cut a piece out of a track',
      steps: [
        'Move the playhead to the start of the piece and press S to split the clip; repeat at the end of the piece.',
        'Select the middle clip with a click and press Delete.',
        'To close the gap, drag the following clip to the left.',
      ],
      note: 'To remove the same stretch from all the tracks at once, select it by dragging on an empty area and press Delete: the gap closes by itself.',
    },
    {
      title: 'Move (cut and paste) a piece of a track',
      steps: ['Isolate the piece by splitting the clip with S at its start and end.', 'Drag the piece where you need it, also to another track or below the last one to create a new track.'],
      note: 'Copy and paste (duplicating a piece) is not available yet: to reuse a stretch, add the same file again and trim it from its edges.',
    },
    {
      title: 'Keep only part of the song',
      steps: ['Select the range by dragging on an empty area of the tracks.', 'Press the “Crop to selection” button: only the range is left, moved to the start.'],
    },
    {
      title: 'Put several tracks in time with each other',
      steps: [
        'Switch on the grid (B) and check that the bars of each track fall on the hits; if one is wrong, correct it with the BPM button of the clip (best with “Mark a bar”).',
        'Open “Align the tempo of the clips” (arrows button at the top).',
        'Choose the reference clip and the clips to adapt; as tempo use the reference one, or a middle one to stretch each clip less.',
        'Keep the bar alignment on: the clips move so that their “1” fall on the “1” of the reference.',
      ],
      note: 'Stretch keeps the pitch; varispeed sounds more natural for small corrections but changes the pitch.',
    },
    {
      title: 'Put the last track added in time with the existing ones',
      steps: [
        'Add the file (Ctrl+O or by dragging it) and check with the grid that its tempo is detected correctly; correct it if needed.',
        'Open “Align the tempo of the clips”: as reference choose a clip already there, as clip to adapt only the new one.',
        'As tempo choose the reference one, so the existing tracks do not change; switch on the bar alignment.',
        'Loop a stretch to check it and, if needed, move the new clip by one bar by hand.',
      ],
    },
    {
      title: 'Crossfade two songs',
      steps: [
        'Put the two songs on different tracks and overlap the end of the first with the start of the second.',
        'Select the two songs with Ctrl+click (or drag on an empty area a band that contains the overlap).',
        'Press “Crossfade”: the first song fades out, the second fades in, at constant volume.',
        'To retouch it, switch on the envelope mode (E) and move or bend the points created.',
      ],
    },
    {
      title: 'Lower the volume of a track',
      steps: ['Drag left the volume slider in the track header (double click: back to 0 dB).'],
    },
    {
      title: 'Loop a passage',
      steps: ['Select the passage by dragging on an empty area of the tracks.', 'Switch on the loop (bottom right) and press Space.'],
    },
    {
      title: 'Change speed without changing pitch',
      steps: ['Select the clip and open “Speed and pitch” (or double click the clip).', 'Set the speed in stretch mode and confirm.'],
    },
    {
      title: 'Export the result',
      steps: ['Press Ctrl+E (or the export button).', 'Choose format, quality and channels, then the destination file.'],
      note: 'Only the audible tracks are exported: check mute and solo before exporting.',
    },
    {
      title: 'Let an AI assistant work on the montage',
      steps: [
        'Open the Help (? button or F1) and the AI assistant tab.',
        'Choose the installed assistants and press Configure.',
        'Restart the assistant and ask it, for example: “match the tempo of the second track to the first one”.',
      ],
    },
  ],
};

export const HELP_CONTENT: Record<Language, HelpContent> = { it: IT, en: EN };
