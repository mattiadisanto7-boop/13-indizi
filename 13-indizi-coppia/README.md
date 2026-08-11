# 13 Indizi — Edizione Principessa & Principe (v4)

Web app multiplayer 1 contro 1 con 18 carte personalizzate, stanze private e Socket.IO.

## Novità v4
- Sul foglio degli appunti puoi usare **X / ? / O** sulle 18 carte.
- Puoi anche scrivere un numero **0–5** per ciascuno dei 6 colori e delle 6 categorie (Uomo, Donna, Capoluogo, Non capoluogo, Indossabile, Non indossabile).
- Se usi il pulsante **Interroga**, il numero ricevuto viene scritto automaticamente nel foglio; in modalità chiamata puoi inserirlo a mano.
- Dal menù c'è **Classifica e storico**, con vittorie, sconfitte, partite giocate, percentuale di vittorie e ultime partite concluse.
- Restano disponibili Refresh, abbandono, ritorno al menù, riconnessione, modalità in chiamata, musica ed effetti sonori.

## Avvio
```bash
npm install
npm start
```
Poi apri `http://localhost:3000`.

## Render
- Runtime: Node
- Build Command: `npm install`
- Start Command: `npm start`
- Root Directory: `13-indizi-coppia` se il repository contiene questa cartella come livello superiore.
- Health Check Path: `/health`

## Classifica e storico
I risultati vengono salvati in `data/stats.json` quando una partita termina con un'accusa corretta. Puoi impostare la variabile `DATA_DIR` per scegliere una directory dati diversa.

**Nota Render:** il filesystem standard di un servizio può essere effimero. Quindi un deploy/riavvio dell'istanza può azzerare `stats.json`. Per uno storico permanente anche dopo deploy e riavvii, la versione successiva può collegarsi a un database persistente.

## Audio personalizzati
La cartella `public/assets/audio/personalizzati/` contiene il manifest per collegare le registrazioni personali quando vengono aggiunte.


## Novità v5
- Foglio appunti con numeri 0–5 per colori e categorie (es. 2 gialli, 1 capoluogo).
- Classifica e storico delle partite concluse.
- 10 audio personalizzati inseriti come pulsanti durante la partita e in modalità in chiamata.
- I pulsanti audio sono sincronizzati: quando uno li preme, l'audio viene riprodotto su entrambi i dispositivi.

### Nota storico su Render
Lo storico viene salvato in `data/stats.json`. Su istanze Render senza disco persistente può essere perso dopo riavvii/redeploy; con un Persistent Disk impostare `DATA_DIR` sulla cartella montata.
