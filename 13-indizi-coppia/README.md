# 13 Indizi — Edizione Coppia

Web-app 1 contro 1 online, con le 18 carte personalizzate fornite.

## Avvio sul PC

1. Installa Node.js 18 o superiore.
2. Apri il terminale nella cartella del progetto.
3. Esegui:

```bash
npm install
npm start
```

4. Apri `http://localhost:3000`.

Per giocare da due dispositivi su Internet, pubblica il progetto su Render (o un servizio Node equivalente).

## Deploy su Render

- Crea un nuovo **Web Service** collegato al repository del progetto.
- Build Command: `npm install`
- Start Command: `npm start`
- Node: 18+

Non serve un database. Le stanze restano in memoria finché il server è attivo.

## Regole implementate

La modalità a 2 giocatori segue la struttura di 13 Indizi:

- 18 carte totali.
- 5 carte a ciascun giocatore.
- 8 carte Informatore A–H.
- Ogni giocatore prepara per l'altro un caso con 1 Personaggio, 1 Luogo e 1 Oggetto.
- Le 2 carte rimanenti sono private e hanno posizione Sinistra/Destra.
- A ogni turno si esegue una sola azione: domanda, informatore o accusa.
- Nelle domande si specifica quale delle due carte private dell'avversario deve essere conteggiata.
- Vince chi indovina per primo la propria terna.

### Categorie personalizzate

- Personaggi: Uomo / Donna
- Luoghi: Capoluogo / Non capoluogo
- Oggetti: Con scritta / Senza scritta
- In più si può chiedere uno dei 6 colori: Giallo, Blu, Verde, Rosso, Rosa, Viola.

## Carte

- Gialla: Principessa / Firenze / Girasoli
- Blu: Principe / Trieste / Nippon
- Verde: Angela / Terlizzi / Collana
- Rossa: Pino / Roma / Diario di coppia
- Rosa: Iolanda / Cantalupa / Dipinto
- Viola: Filippo / Populonia / Occhiali da sole


## Aggiornamenti v1.1
- Modalità in chiamata: nasconde il resto del tavolo e mostra solo il foglio degli appunti.
- Foglio appunti 6 colonne × 3 categorie, con colori e carte personalizzate.
- Segni manuali: X = eliminata, ? = possibile, O = sicuramente nelle 5 carte avversarie.
- Nuova categoria Oggetti: Indossabile / Non indossabile.
  - Indossabili: Occhiali da sole, Nippon, Collana.
  - Non indossabili: Diario di coppia, Girasoli, Dipinto.
