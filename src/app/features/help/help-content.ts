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
          title: 'Montaggi recenti',
          text: [
            'Apri (Ctrl+O) mostra gli ultimi montaggi aperti o salvati, il più recente in cima: clicca su uno per riaprirlo (torna al primo posto, senza doppioni) o su Sfoglia… per scegliere altri file.',
            'L’elenco tiene gli ultimi 20 file. Con la puntina blocchi un file: resta in elenco anche aprendone molti altri. La X lo toglie; un file non più trovato esce dall’elenco quando provi a riaprirlo, se non è bloccato.',
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
          title: 'Pacchetto: montaggio con i file audio',
          text: [
            'In “Salva con nome” puoi scegliere il tipo Pacchetto edimus (.edimuspack): un unico file con il montaggio e una copia di tutti i file audio, comodo per spostarlo o condividerlo.',
            'Aprendo un pacchetto, sul desktop i file audio vengono estratti nella cartella “<nome>.sources” accanto al pacchetto; nella versione web restano in memoria finché la pagina è aperta.',
          ],
        },
        {
          title: 'File audio mancanti',
          text: [
            'Se all’apertura di un montaggio qualche file audio non è raggiungibile, si apre la finestra File del montaggio con lo stato di ogni file. Puoi selezionare più file insieme o indicare una cartella (anche con sottocartelle): edimus li riconosce dal contenuto, anche con un altro nome, e li ricollega da solo. Con Trova… indichi il file di una sola traccia.',
            'Le clip dei file mancanti restano al loro posto, disegnate come un riquadro tratteggiato; la finestra si riapre con Trova i file… sotto la traccia in errore. Anche aprire o trascinare il file giusto lo ricollega, senza aggiungere una nuova traccia.',
            'Nella versione web il browser chiede di nuovo il permesso di leggere i file usati in una sessione precedente: basta Consenti l’accesso nella stessa finestra.',
          ],
        },
        {
          title: 'Esportare il mix',
          keys: ['Ctrl+E'],
          text: [
            'Produce un unico file mono o stereo con tutte le tracce udibili, i volumi e le modifiche di velocità: wav, mp3, flac, ogg, opus o m4a, con qualità, frequenza di campionamento e normalizzazione a scelta.',
            'Il file parte sempre dall’inizio della linea temporale e arriva alla fine dell’ultima clip; il silenzio finale (es. 2,450 = 2 secondi e 450 millesimi) aggiunge altro silenzio in fondo.',
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
            'I comandi di ascolto sono in basso a destra, con il tempo corrente e la durata. Spazio avvia e mette in pausa; Home e End portano il cursore all’inizio e alla fine. Durante l’ascolto il cursore si ferma a metà della vista e le tracce scorrono sotto.',
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
          title: 'Durata udibile',
          text: [
            'Accanto al tempo, “udibile” indica quanto dura il mix senza i silenzi iniziale e finale: dal primo suono dell’insieme delle tracce udibili alla fine dell’ultimo, con volumi e inviluppi (sotto −60 dB è silenzio). Il tooltip mostra inizio e fine; un clic seleziona quell’intervallo, per esempio per ritagliarlo o esportarlo.',
          ],
        },
        {
          title: 'Volume d’ascolto e uscita audio',
          text: [
            'Il cursore del volume e il pulsante muto agiscono solo sull’ascolto, non sull’esportazione.',
            'Il dispositivo di uscita (predefinito di sistema, cuffie, scheda audio…) si sceglie nelle Impostazioni. La prima volta Windows chiede il permesso per il microfono: serve anche a leggere i nomi dei dispositivi.',
          ],
        },
        {
          title: 'Registrare dall’ingresso',
          keys: ['Spazio', 'R', 'Esc'],
          text: [
            'Solo nell’app desktop. Il + sotto le tracce aggiunge una traccia vuota. Il pallino rosso nell’intestazione di una traccia la mette in registrazione: l’intestazione mostra solo i comandi per registrare, l’ingresso usato (scelto nelle Impostazioni) e lo stato; la × (o Esc) torna alla traccia normale. Entrando in registrazione l’ascolto si ferma; Spazio avvia e ferma la ripresa invece dell’ascolto, mentre play e stop restano disponibili (spenti solo durante la ripresa) per riascoltare subito.',
            '“Registra” (o Spazio, o R) registra dal cursore mentre il montaggio suona come base: sulla traccia compare la clip in registrazione, che si allunga verso destra finché non premi “Ferma” (Spazio o R). Poi scegli dove e con che nome salvare il file WAV, che diventa la clip della traccia (si annulla con Ctrl+Z); annullando la scelta la registrazione viene scartata.',
            'Prima di partire la base viene preparata come un unico mix (lo stesso dell’esportazione): lo stesso montaggio si sente identico, e la registrazione si allinea alla base togliendo la latenza, cioè il ritardo tra il suono emesso e quello che torna dal microfono. Si misura una volta nelle Impostazioni (pulsante “Misura”: casse accese e microfono vicino); senza misura si usa una stima, meno precisa.',
            'Il segnale si registra così com’è: cancellazione dell’eco, riduzione del rumore e guadagno automatico restano spenti. Ascolta la base in cuffia, se non vuoi che finisca nella registrazione.',
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
            'I pulsanti in alto a destra ingrandiscono, riducono e adattano la vista all’intero montaggio, o all’intervallo selezionato se c’è.',
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
          keys: ['←', '→', 'Shift+← →'],
          text: [
            'Una clip è una porzione di un file audio posata su una traccia. Clic per selezionarla, trascina per spostarla nel tempo o su un’altra traccia; trascinandola sotto l’ultima traccia ne crea una nuova.',
            'Inizio, fine e punti dell’inviluppo della clip si agganciano all’inizio, alla fine e ai punti dell’inviluppo delle altre clip, su qualsiasi traccia, quando ci passano vicino (anche con la griglia visibile). Con la griglia delle battute visibile la clip si sposta a passi (battuta, semiminima o croma, da scegliere nelle Impostazioni): il punto della griglia della clip sotto il puntatore si aggancia al più vicino delle altre clip. Tieni premuto Alt per spostarla liberamente.',
            'Con la tastiera, le frecce ← → spostano le clip selezionate di un pixel (più ingrandisci, più il passo è fine); con Shift saltano al punto di aggancio successivo: inizio, fine o punto d’inviluppo di un’altra clip, oppure il cursore. Tenendo premuta la freccia, o premendola più volte di seguito, lo spostamento è un solo passo di annulla.',
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
            'Canc elimina l’intervallo selezionato da tutte le tracce chiudendo il buco; senza intervallo elimina le clip selezionate (se sono tutte quelle di una traccia, la traccia viene eliminata dopo una conferma).',
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
            'Trascinando, il punto si aggancia ai bordi delle clip, ai punti degli inviluppi delle altre clip e, in verticale, a 0 dB; Alt lo sposta liberamente. Anche le clip trascinate si agganciano ai punti degli inviluppi delle altre clip: ogni punto è segnato da una linea verticale tratteggiata su tutte le tracce.',
            'Il pallino a metà di un segmento lo curva (per dissolvenze naturali); doppio clic lo raddrizza. Prima del primo punto e dopo l’ultimo il volume resta costante.',
          ],
        },
        {
          title: 'Volume della traccia',
          text: ['Il fader verticale sul lato destro dell’intestazione della traccia regola il volume di tutta la traccia (da −30 a +6 dB): trascinalo o clicca lungo la guida, usa la rotellina o le frecce; doppio clic lo riporta a 0 dB.'],
        },
      ],
    },
    {
      title: 'Effetti',
      icon: 'tune',
      topics: [
        {
          title: 'Effetti della traccia',
          text: [
            'Il pulsante con i cursori nell’intestazione della traccia apre a destra il pannello dei suoi effetti (Esc lo chiude); il pulsante è colorato quando la traccia ha effetti attivi. A pannello aperto, selezionando una clip di un’altra traccia il pannello mostra gli effetti di quella traccia.',
            'In fondo all’intestazione la catena degli effetti li mostra in ordine: un quadratino colorato per effetto con la sua sigla (EQ, C compressore, E eco, R riverbero, S saturazione), vuoto se escluso; il tooltip dà nome e valori, un clic apre il pannello.',
            'Gli effetti disponibili sono equalizzatore, compressore, eco, riverbero e saturazione. Agiscono in ordine, dall’alto in basso, sul suono di tutte le clip della traccia e prima del suo volume; l’ordine si cambia trascinando la maniglia. Il menu dei preset offre impostazioni pronte e i valori iniziali; l’interruttore esclude l’effetto senza perderne le impostazioni.',
            'Durante l’ascolto le regolazioni si sentono subito, e un’intera regolazione è un solo passo di annulla. L’esportazione tiene le code di eco e riverbero dopo la fine dell’ultima clip. L’eco va a tempo con la prima clip della traccia (divisioni da 1/2 a 1/16).',
            'Il compressore mostra un grafico che segue i valori: a sinistra la curva di compressione (ingresso → uscita, con la soglia), a destra come la riduzione arriva con l’attacco e se ne va con il rilascio su un colpo forte.',
            'Per mettere un effetto solo su un pezzo, dividi la clip e sposta quel pezzo su una traccia a parte con i suoi effetti.',
          ],
        },
        {
          title: 'Manopole e fader',
          text: [
            'Si regolano trascinando in verticale (con Maiusc più finemente), con la rotellina o con le frecce dopo averli selezionati; doppio clic torna al valore iniziale. Un clic sul valore sotto la manopola permette di scriverlo (es. 1,5k per 1500 Hz).',
          ],
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
          title: 'Brani a tempo non costante',
          text: [
            'Se il brano è stato registrato senza un tempo fisso, la griglia dopo qualche battuta non coincide più con la musica. Puoi far seguire alla griglia l’audio, senza modificarlo: la mappa delle battute appartiene al file, quindi vale per tutte le sue clip.',
            'A mano: con la griglia visibile tieni premuto Maiusc e trascina una linea di battuta sul colpo giusto (si aggancia all’attacco più vicino; Alt per muoverla liberamente). Quella battuta resta fissata, segnata da un triangolino: le battute tra lei e la battuta fissata precedente si allargano o stringono in modo uniforme, quelle successive prendono la nuova durata. Maiusc+clic destro su una battuta fissata la libera.',
            'In automatico: nel dialogo del tempo “Rileva le battute” trova l’inizio di ogni battuta su tutto il file e ne fa un’ancora automatica, partendo dalla battuta segnata o da quelle fissate a mano, che restano. Dove la griglia sbaglia ancora, fissa a mano la battuta giusta e rilancia.',
            'Sempre nel dialogo: “Rimuovi ancore” toglie tutte le battute fissate e torna alla griglia costante di partenza; “Rimuovi ancore automatiche” toglie solo quelle trovate da “Rileva le battute” e tiene le tue; “Tempo costante” toglie la mappa lasciando un tempo costante pari alla sua media.',
            '“Salva le battute” scrive tempo e ancore in un file accanto all’audio, con lo stesso nome e l’estensione .edimusbars (per esempio brano.mp3.edimusbars): quando riapri quell’audio, anche in un altro montaggio, edimus lo usa al posto del tempo rilevato. “Carica le battute” lo ricarica a mano. Nelle Impostazioni puoi farlo salvare da solo a ogni modifica. Nella versione web il file si salva e si apre scegliendolo, e non viene letto da solo.',
            'Allineare il tempo di più clip cambia solo la velocità: non rende costante un brano che accelera o rallenta.',
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
            'Il pulsante ingranaggio in alto a destra apre le preferenze che si cambiano di rado: tema chiaro, scuro o di sistema; lingua; uscita e ingresso audio, latenza di registrazione; passo di aggancio delle clip alla griglia; aggiornamenti (vedi Aggiornamenti); apertura degli strumenti per sviluppatori all’avvio (vale dal prossimo avvio, o con “Riavvia ora”). Ogni modifica resta salvata.',
          ],
        },
        {
          title: 'Aggiornamenti',
          text: [
            'All’avvio l’app desktop cerca una versione più recente tra le release del suo repository GitHub (impostabile nelle Impostazioni, dove si può anche spegnere il controllo o lanciarlo con “Verifica ora”). Se c’è, mostra cosa cambia e chiede se aggiornare: “Salta questa versione” non la propone più all’avvio.',
            'Con “Aggiorna e riavvia” scarica il pacchetto, chiede di salvare le modifiche, chiude edimus, sostituisce l’app e il server MCP e avvia la nuova versione; ffmpeg resta quello installato. Le altre finestre di edimus vanno chiuse prima che i file vengano sostituiti. Se qualcosa va storto torna la versione precedente.',
            'ffmpeg, che edimus usa per leggere ed esportare l’audio, non fa parte dell’app: se all’avvio manca nella cartella, edimus propone di scaricarlo dalla sua distribuzione (build “essentials” di gyan.dev, licenza GPL), alla versione legata a quella di edimus. Se una nuova versione richiede un ffmpeg più recente, il dialogo di aggiornamento offre prima di aggiornare ffmpeg.',
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
    {
      title: 'Versione web',
      icon: 'language',
      topics: [
        {
          title: 'edimus nel browser',
          text: [
            'La versione web lavora tutta sul tuo computer: i file audio non vengono mai caricati su un server.',
            'Con Chrome o Edge i file aperti o trascinati vengono ritrovati anche nelle sessioni successive (il browser chiede di nuovo il permesso, vedi File audio mancanti) e il salvataggio usa le finestre del sistema. Con gli altri browser i file vanno indicati di nuovo a ogni sessione e ogni salvataggio diventa un download.',
            'Esportazione in wav, mp3 e ogg. Velocità e intonazione usano lo stesso motore (Rubber Band) dell’app desktop; i render restano in una cache del browser.',
            'Per collegare un assistente AI, avvia il server MCP sul PC e inserisci porta e token nella scheda Assistente AI di questo Aiuto.',
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
      title: 'Far seguire la griglia a un brano che va fuori tempo',
      steps: [
        'Attiva la griglia (B) e, se serve, segna la battuta all’inizio del brano (pulsante BPM, “Segna la battuta”).',
        'Nel dialogo del tempo premi “Rileva le battute”: la griglia segue il brano su tutto il file.',
        'Scorri il brano: dove una battuta non cade sul colpo, Maiusc+trascina la sua linea sul colpo giusto.',
        'Se le correzioni sono molte, premi di nuovo “Rileva le battute”: le battute fissate a mano restano e guidano la ricerca.',
        'Premi “Salva le battute” per ritrovarle la prossima volta che apri lo stesso audio.',
      ],
      note: 'Maiusc+clic destro su una battuta fissata la libera; “Rimuovi ancore” le toglie tutte.',
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
      steps: ['Trascina verso il basso il fader del volume sul lato destro dell’intestazione della traccia (doppio clic: torna a 0 dB).'],
    },
    {
      title: 'Aggiungere riverbero o eco a una voce',
      steps: [
        'Premi il pulsante con i cursori nell’intestazione della traccia.',
        'Nel pannello a destra premi Aggiungi effetto e scegli Riverbero (o Eco).',
        'Scegli un preset dal menu dell’effetto, poi regola il Mix ascoltando.',
      ],
      note: 'Per una voce più presente aggiungi prima un Equalizzatore e un Compressore con il preset Voce: gli effetti agiscono dall’alto in basso.',
    },
    {
      title: 'Mettere un effetto solo su un pezzo di traccia',
      steps: [
        'Dividi la clip all’inizio e alla fine del pezzo (S).',
        'Trascina il pezzo su una traccia vuota (le strisce in fondo): diventa una traccia nuova.',
        'Aggiungi gli effetti a quella traccia.',
      ],
    },
    {
      title: 'Registrare una voce sulla base',
      steps: [
        'Nell’app desktop, nelle Impostazioni scegli l’ingresso e, la prima volta, misura la latenza.',
        'Aggiungi una traccia con il + sotto le tracce e premi il suo pallino rosso.',
        'Porta il cursore dove vuoi partire (un po’ prima, per avere tempo di prepararti).',
        'Premi “Registra” (o Spazio), registra, e ferma con “Ferma” (o di nuovo Spazio).',
        'Scegli dove e con che nome salvare il file.',
      ],
      note: 'La registrazione è una clip come le altre: si taglia, si sposta e si rifinisce.',
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
      title: 'Aggiungere silenzio all’inizio del file esportato',
      steps: [
        'Seleziona tutte le clip (Ctrl+A).',
        'Trascinale verso destra della durata voluta: l’export parte sempre da 0, quindi lo spazio vuoto iniziale diventa silenzio.',
      ],
      note: 'Il silenzio vale per tutto il mix solo se si spostano le clip di tutte le tracce udibili.',
    },
    {
      title: 'Aggiungere silenzio alla fine del file esportato',
      steps: ['Premi Ctrl+E.', 'In Silenzio finale scrivi i secondi da aggiungere, es. 2,450 (2 secondi e 450 millesimi), poi esporta.'],
    },
    {
      title: 'Condividere un montaggio con i suoi file audio',
      steps: ['Premi Ctrl+Shift+S (salva con nome).', 'Come tipo di file scegli Pacchetto edimus (.edimuspack) e salva.', 'Invia il file .edimuspack: si apre con edimus, desktop o web.'],
      note: 'Chi riceve solo il file .edimus può trascinare i propri file audio: quelli mancanti vengono ricollegati da soli.',
    },
    {
      title: 'Aggiornare edimus',
      steps: [
        'Apri le Impostazioni (Ctrl+,) e premi Verifica ora (all’avvio il controllo è automatico).',
        'Se c’è una nuova versione, salva i montaggi aperti nelle altre finestre e chiudile.',
        'Premi Aggiorna e riavvia: edimus si chiude e si riapre nella nuova versione.',
      ],
      note: 'Se un assistente AI sta usando edimus, riavvialo per usare il nuovo server MCP.',
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
          title: 'Recent montages',
          text: [
            'Open (Ctrl+O) shows the montages opened or saved lately, the most recent at the top: click one to reopen it (it goes back to the top, without duplicates) or Browse… to choose other files.',
            'The list keeps the last 20 files. The pin keeps a file in the list however many others are opened. The X removes it; a file no longer found leaves the list when you try to reopen it, unless pinned.',
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
          title: 'Bundle: montage with the audio files',
          text: [
            'In “Save as” you can choose the type edimus bundle (.edimuspack): one file with the montage and a copy of all its audio files, handy to move or share it.',
            'When a bundle is opened, on the desktop the audio files are extracted into the folder “<name>.sources” next to it; in the web version they stay in memory while the page is open.',
          ],
        },
        {
          title: 'Missing audio files',
          text: [
            'When some audio files cannot be reached as a montage is opened, the Files of the montage window shows the state of each file. Choose several files at once or a folder (subfolders included): edimus recognizes them by their content, also with another name, and relinks them by itself. With Find… you choose the file of a single track.',
            'The clips of the missing files stay in place, drawn as a dashed box; the window opens again with Find the files… below the track in error. Opening or dropping the right file relinks it too, without adding a new track.',
            'In the web version the browser asks again the permission to read the files used in an earlier session: just Allow access in the same window.',
          ],
        },
        {
          title: 'Export the mix',
          keys: ['Ctrl+E'],
          text: [
            'Produces a single mono or stereo file with all the audible tracks, volumes and speed changes: wav, mp3, flac, ogg, opus or m4a, with the quality, sample rate and normalization you choose.',
            'The file always starts at the beginning of the timeline and ends with the last clip; the trailing silence (e.g. 2.450 = 2 seconds and 450 thousandths) adds more silence at the end.',
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
            'The transport is at the bottom right, with the current time and the length. Space plays and pauses; Home and End move the playhead to the start and the end. While playing, the playhead stops in the middle of the view and the tracks scroll under it.',
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
          title: 'Audible length',
          text: [
            'Next to the time, “audible” tells how long the mix lasts without its leading and trailing silences: from the first sound of the audible tracks to the end of the last one, with volumes and envelopes (below −60 dB is silence). The tooltip shows start and end; a click selects that range, for example to crop or export it.',
          ],
        },
        {
          title: 'Listening volume and audio output',
          text: [
            'The volume slider and the mute button affect only listening, not the export.',
            'The output device (system default, headphones, audio interface…) is chosen in the Settings. The first time Windows asks for microphone permission: it is also needed to read the device names.',
          ],
        },
        {
          title: 'Recording from the input',
          keys: ['Space', 'R', 'Esc'],
          text: [
            'Desktop app only. The + below the tracks adds an empty track. The red dot in the header of a track puts it in recording mode: the header shows only the recording commands, the input used (chosen in the Settings) and the state; the × (or Esc) goes back to the normal track. Entering recording mode stops the playback; Space starts and stops the take instead of the playback, while play and stop stay available (off only during the take) to listen back at once.',
            '“Record” (or Space, or R) records from the playhead while the montage plays as the backing: the clip being recorded appears on the track and grows to the right until you press “Stop” (Space or R). Then you choose where and with which name to save the WAV file, which becomes the clip of the track (undone with Ctrl+Z); cancelling the choice discards the recording.',
            'Before starting, the backing is prepared as a single mix (the same as the export): the montage sounds the same, and the recording is lined up with it by removing the latency, that is, the delay between the sound played and the one coming back from the microphone. It is measured once in the Settings (“Measure” button: speakers on and the microphone close); without a measure an estimate is used, less precise.',
            'The signal is recorded as it is: echo cancellation, noise suppression and automatic gain stay off. Listen to the backing on headphones if you do not want it in the recording.',
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
            'The buttons at the top right zoom in, zoom out and fit the whole montage in the view, or the selected range when there is one.',
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
          keys: ['←', '→', 'Shift+← →'],
          text: [
            'A clip is a portion of an audio file placed on a track. Click to select it, drag to move it in time or to another track; dragging it below the last track creates a new one.',
            'The start, end and envelope points of the clip snap to the start, end and envelope points of the other clips, on any track, when they pass close by (also with the grid shown). With the bar grid shown the clip moves by steps (bar, quarter or eighth note, chosen in the Settings): the grid point of the clip under the pointer snaps to the nearest one of the other clips. Hold Alt to move it freely.',
            'With the keyboard, the arrows ← → move the selected clips by one pixel (the more you zoom in, the finer the step); with Shift they jump to the next snap point: start, end or envelope point of another clip, or the playhead. Holding the arrow down, or pressing it several times in a row, makes the move a single undo step.',
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
            'Delete removes the selected range from all the tracks closing the gap; with no range it removes the selected clips (when they are all the clips of a track, the track is removed after a confirmation).',
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
            'While dragging, the point snaps to the clip edges, to the envelope points of the other clips and, vertically, to 0 dB; Alt moves it freely. Dragged clips also snap to the envelope points of the other clips: each point is marked by a dashed vertical line across all the tracks.',
            'The dot in the middle of a segment bends it (for natural fades); a double click straightens it. Before the first point and after the last one the volume stays constant.',
          ],
        },
        {
          title: 'Track volume',
          text: ['The vertical fader on the right of the track header sets the volume of the whole track (from −30 to +6 dB): drag it or click along the rail, use the wheel or the arrow keys; a double click brings it back to 0 dB.'],
        },
      ],
    },
    {
      title: 'Effects',
      icon: 'tune',
      topics: [
        {
          title: 'Track effects',
          text: [
            'The button with the sliders in the track header opens the panel of its effects on the right (Esc closes it); the button is coloured when the track has effects switched on. While the panel is open, selecting a clip of another track shows the effects of that track.',
            'At the bottom of the header the effect chain shows them in order: a coloured square per effect with its letters (EQ, C compressor, E echo, R reverb, S saturation), hollow when bypassed; the tooltip gives name and values, a click opens the panel.',
            'The effects available are equalizer, compressor, echo, reverb and saturation. They act in order, top to bottom, on the sound of all the clips of the track and before its volume; drag the handle to change the order. The presets menu offers ready settings and the default values; the switch bypasses the effect keeping its settings.',
            'While playing, changes are heard at once, and a whole adjustment is one undo step. The export keeps the tails of echoes and reverbs after the end of the last clip. The echo follows the tempo of the first clip of the track (divisions from 1/2 to 1/16).',
            'The compressor shows a graph that follows its values: on the left the compression curve (input → output, with the threshold), on the right how the reduction comes in with the attack and goes away with the release on a loud hit.',
            'To put an effect on a part only, split the clip and move that part to a track of its own with its effects.',
          ],
        },
        {
          title: 'Knobs and faders',
          text: [
            'Drag them vertically (finer with Shift), use the wheel, or the arrow keys once selected; a double click goes back to the default value. A click on the value under a knob lets you type it (e.g. 1.5k for 1500 Hz).',
          ],
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
          title: 'Songs without a steady tempo',
          text: [
            'When a song was recorded without a steady tempo, after a few bars the grid no longer matches the music. You can make the grid follow the audio, without changing it: the bar map belongs to the file, so it holds for all its clips.',
            'By hand: with the grid shown hold Shift and drag a bar line onto the right hit (it snaps to the nearest attack; Alt to move it freely). That bar stays pinned, marked by a small triangle: the bars between it and the previous pinned bar stretch or shrink evenly, the following ones take the new length. Shift+right click on a pinned bar unpins it.',
            'Automatically: in the tempo dialog “Detect bars” finds the start of every bar along the whole file and makes it an automatic anchor, starting from the marked bar or the bars pinned by hand, which stay. Where the grid is still wrong, pin the right bar by hand and run it again.',
            'In the same dialog: “Remove anchors” removes all the pinned bars and goes back to the steady grid the map started from; “Remove automatic anchors” removes only those found by “Detect bars” and keeps yours; “Steady tempo” drops the map leaving a steady tempo equal to its average.',
            '“Save bars” writes tempo and anchors to a file next to the audio, with the same name and the .edimusbars extension (for example song.mp3.edimusbars): when you open that audio again, even in another montage, edimus uses it instead of the detected tempo. “Load bars” loads it by hand. In the Settings you can have it saved by itself at every change. In the web version the file is saved and opened by choosing it, and it is not read by itself.',
            'Aligning the tempo of several clips changes only their speed: it does not make a song that speeds up or slows down steady.',
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
            'The gear button at the top right opens the preferences changed rarely: light, dark or system theme; language; audio output and input, recording latency; snap step of the clips on the grid; updates (see Updates); opening the developer tools at startup (applies from the next start, or with “Restart now”). Every change is saved.',
          ],
        },
        {
          title: 'Updates',
          text: [
            'At startup the desktop app looks for a newer version among the releases of its GitHub repository (set in the Settings, where the check can also be turned off or run with “Check now”). If there is one, it shows what changes and asks whether to update: “Skip this version” no longer offers it at startup.',
            '“Update and restart” downloads the package, asks to save the changes, closes edimus, replaces the app and the MCP server and starts the new version; ffmpeg stays the installed one. The other edimus windows must be closed before the files are replaced. If anything goes wrong the previous version comes back.',
            'ffmpeg, which edimus uses to read and export audio, is not part of the app: when it is missing from the folder at startup, edimus offers to download it from its distribution (gyan.dev “essentials” build, GPL license), at the version tied to that of edimus. When a new version needs a newer ffmpeg, the update dialog first offers to update ffmpeg.',
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
    {
      title: 'Web version',
      icon: 'language',
      topics: [
        {
          title: 'edimus in the browser',
          text: [
            'The web version works entirely on your computer: the audio files are never uploaded to a server.',
            'With Chrome or Edge the files opened or dropped are found again in later sessions (the browser asks the permission again, see Missing audio files) and saving uses the system dialogs. With other browsers the files must be shown again at every session and every save becomes a download.',
            'Export to wav, mp3 and ogg. Speed and pitch use the same engine (Rubber Band) as the desktop app; the renders are kept in a browser cache.',
            'To connect an AI assistant, start the MCP server on the PC and enter its port and token in the AI assistant tab of this Help.',
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
      title: 'Make the grid follow a song that drifts out of time',
      steps: [
        'Switch on the grid (B) and, if needed, mark the bar at the start of the song (BPM button, “Mark a bar”).',
        'In the tempo dialog press “Detect bars”: the grid follows the song along the whole file.',
        'Scroll through the song: where a bar does not fall on the hit, Shift+drag its line onto the right hit.',
        'If there are many corrections, press “Detect bars” again: the bars pinned by hand stay and guide the search.',
        'Press “Save bars” to find them again the next time you open the same audio.',
      ],
      note: 'Shift+right click on a pinned bar unpins it; “Remove anchors” removes them all.',
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
      steps: ['Drag down the volume fader on the right of the track header (double click: back to 0 dB).'],
    },
    {
      title: 'Add reverb or echo to a voice',
      steps: [
        'Press the button with the sliders in the track header.',
        'In the panel on the right press Add effect and choose Reverb (or Echo).',
        'Choose a preset from the menu of the effect, then set the Mix while listening.',
      ],
      note: 'For a more present voice add an Equalizer and a Compressor with the Voice preset first: effects act top to bottom.',
    },
    {
      title: 'Put an effect on part of a track only',
      steps: [
        'Split the clip at the start and at the end of the part (S).',
        'Drag the part onto an empty track (the strips at the bottom): it becomes a new track.',
        'Add the effects to that track.',
      ],
    },
    {
      title: 'Record a voice over the backing',
      steps: [
        'In the desktop app, in the Settings choose the input and, the first time, measure the latency.',
        'Add a track with the + below the tracks and press its red dot.',
        'Move the playhead where you want to start (a little earlier, to have time to get ready).',
        'Press “Record” (or Space), record, and stop with “Stop” (or Space again).',
        'Choose where and with which name to save the file.',
      ],
      note: 'The recording is a clip like the others: it is cut, moved and refined.',
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
      title: 'Add silence at the start of the exported file',
      steps: [
        'Select all the clips (Ctrl+A).',
        'Drag them right by the length you want: the export always starts at 0, so the empty space at the start becomes silence.',
      ],
      note: 'The silence applies to the whole mix only if the clips of all the audible tracks are moved.',
    },
    {
      title: 'Add silence at the end of the exported file',
      steps: ['Press Ctrl+E.', 'In Trailing silence type the seconds to add, e.g. 2.450 (2 seconds and 450 thousandths), then export.'],
    },
    {
      title: 'Share a montage with its audio files',
      steps: ['Press Ctrl+Shift+S (save as).', 'As file type choose edimus bundle (.edimuspack) and save.', 'Send the .edimuspack file: it opens with edimus, desktop or web.'],
      note: 'Whoever gets just the .edimus file can drop their own audio files: the missing ones are relinked by themselves.',
    },
    {
      title: 'Update edimus',
      steps: [
        'Open the Settings (Ctrl+,) and press Check now (at startup the check is automatic).',
        'If there is a new version, save the montages open in the other windows and close them.',
        'Press Update and restart: edimus closes and opens again in the new version.',
      ],
      note: 'If an AI assistant is using edimus, restart it to use the new MCP server.',
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
