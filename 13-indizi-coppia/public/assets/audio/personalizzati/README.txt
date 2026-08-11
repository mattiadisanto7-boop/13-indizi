AUDIO PERSONALIZZATI

Il gioco supporta gli audio personali tramite manifest.json.
I file audio originali del precedente gioco non erano disponibili nel materiale di questa conversazione, quindi non sono stati inventati o sostituiti con voci artificiali.

Quando avrai i file, copiali in questa cartella e inserisci nel manifest.json una mappa come questa:

{
  "domanda": "che-cose-questa-novita.mp3",
  "informatore": "uuuuuuuuuu.mp3",
  "accusa_errata": "ti-meriti-le-botte.mp3",
  "vittoria": "hai-finito-di-vivere.mp3",
  "sconfitta": "scompagnato.mp3",
  "abbandona": "scompagnato.mp3"
}

Sono supportati .mp3, .wav e .ogg. Se un audio non è configurato, il gioco usa automaticamente gli effetti sonori integrati.
