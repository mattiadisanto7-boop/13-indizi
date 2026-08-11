const path = require('path');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: '*' }
});

const PORT = process.env.PORT || 3000;
app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));

const COLORS = {
  yellow: { label: 'Gialla', hex: '#f5c542' },
  blue: { label: 'Blu', hex: '#3d7ee8' },
  green: { label: 'Verde', hex: '#48a868' },
  red: { label: 'Rossa', hex: '#d94b4b' },
  pink: { label: 'Rosa', hex: '#e984b3' },
  purple: { label: 'Viola', hex: '#8866d8' }
};

const CARDS = [
  { id:'principessa', name:'Principessa', type:'person', color:'yellow', trait:'Donna', image:'/assets/cards/principessa.jpg' },
  { id:'firenze', name:'Firenze', type:'place', color:'yellow', trait:'Capoluogo', image:'/assets/cards/firenze.jpg' },
  { id:'girasoli', name:'Girasoli', type:'object', color:'yellow', trait:'Non indossabile', image:'/assets/cards/girasoli.jpg' },

  { id:'principe', name:'Principe', type:'person', color:'blue', trait:'Uomo', image:'/assets/cards/principe.jpg' },
  { id:'trieste', name:'Trieste', type:'place', color:'blue', trait:'Capoluogo', image:'/assets/cards/trieste.jpg' },
  { id:'nippon', name:'Nippon', type:'object', color:'blue', trait:'Indossabile', image:'/assets/cards/nippon.jpg' },

  { id:'iolanda', name:'Iolanda', type:'person', color:'pink', trait:'Donna', image:'/assets/cards/iolanda.jpg' },
  { id:'cantalupa', name:'Cantalupa', type:'place', color:'pink', trait:'Non capoluogo', image:'/assets/cards/cantalupa.jpg' },
  { id:'dipinto', name:'Dipinto', type:'object', color:'pink', trait:'Non indossabile', image:'/assets/cards/dipinto.jpg' },

  { id:'filippo', name:'Filippo', type:'person', color:'purple', trait:'Uomo', image:'/assets/cards/filippo.jpg' },
  { id:'populonia', name:'Populonia', type:'place', color:'purple', trait:'Non capoluogo', image:'/assets/cards/populonia.jpg' },
  { id:'occhiali', name:'Occhiali da sole', type:'object', color:'purple', trait:'Indossabile', image:'/assets/cards/occhiali.jpg' },

  { id:'angela', name:'Angela', type:'person', color:'green', trait:'Donna', image:'/assets/cards/angela.jpg' },
  { id:'terlizzi', name:'Terlizzi', type:'place', color:'green', trait:'Non capoluogo', image:'/assets/cards/terlizzi.jpg' },
  { id:'collana', name:'Collana', type:'object', color:'green', trait:'Indossabile', image:'/assets/cards/collana.jpg' },

  { id:'pino', name:'Pino', type:'person', color:'red', trait:'Uomo', image:'/assets/cards/pino.jpg' },
  { id:'roma', name:'Roma', type:'place', color:'red', trait:'Capoluogo', image:'/assets/cards/roma.jpg' },
  { id:'diario', name:'Diario di coppia', type:'object', color:'red', trait:'Non indossabile', image:'/assets/cards/diario.png' }
];

const CARD_BY_ID = Object.fromEntries(CARDS.map(c => [c.id, c]));
const rooms = new Map();

function shuffle(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function code4() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from({ length: 4 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(name, fallback) {
  const v = String(name || '').trim().slice(0, 24);
  return v || fallback;
}

function makeRoom(hostSocket, hostName) {
  const code = code4();
  const room = {
    code,
    hostId: hostSocket.id,
    players: [{ id: hostSocket.id, name: cleanName(hostName, 'Giocatore 1') }],
    phase: 'lobby',
    hands: {},
    selections: {},
    privateCards: {},
    mysteries: {},
    informants: [],
    informantSeen: {},
    currentPlayer: null,
    winner: null,
    lastAction: null,
    log: []
  };
  rooms.set(code, room);
  hostSocket.join(code);
  hostSocket.data.roomCode = code;
  return room;
}

function playerIndex(room, socketId) {
  return room.players.findIndex(p => p.id === socketId);
}

function otherPlayer(room, socketId) {
  return room.players.find(p => p.id !== socketId);
}

function addLog(room, text) {
  room.log.unshift({ text, at: Date.now() });
  room.log = room.log.slice(0, 18);
}

function startGame(room) {
  const persons = shuffle(CARDS.filter(c => c.type === 'person').map(c => c.id));
  const places = shuffle(CARDS.filter(c => c.type === 'place').map(c => c.id));
  const objects = shuffle(CARDS.filter(c => c.type === 'object').map(c => c.id));

  room.hands = {};
  room.selections = {};
  room.privateCards = {};
  room.mysteries = {};
  room.informantSeen = {};
  room.winner = null;
  room.lastAction = null;
  room.log = [];

  for (const p of room.players) {
    room.hands[p.id] = [];
    room.informantSeen[p.id] = [];
  }

  // Ogni giocatore riceve 1 Persona, 1 Luogo, 1 Oggetto.
  for (let i = 0; i < 2; i++) {
    room.hands[room.players[i].id].push(persons.pop(), places.pop(), objects.pop());
  }

  // Le 12 carte rimanenti vengono mischiate: 2 extra a testa, 8 informatori.
  const rest = shuffle([...persons, ...places, ...objects]);
  for (let i = 0; i < 2; i++) {
    room.hands[room.players[i].id].push(rest.pop(), rest.pop());
  }
  room.informants = rest.map((cardId, idx) => ({ letter: String.fromCharCode(65 + idx), cardId }));
  room.phase = 'setup';
  addLog(room, 'Le carte sono state distribuite. Ognuno deve preparare il caso dell’altro.');
}

function cardMatches(card, query) {
  if (!card) return false;
  if (query.kind === 'color') return card.color === query.value;
  if (query.kind === 'trait') return card.trait === query.value;
  return false;
}

function emitRoom(room) {
  room.players.forEach(p => {
    const socket = io.sockets.sockets.get(p.id);
    if (socket) socket.emit('state', buildState(room, p.id));
  });
}

function buildState(room, socketId) {
  const meIdx = playerIndex(room, socketId);
  const opponent = otherPlayer(room, socketId);
  const base = {
    roomCode: room.code,
    phase: room.phase,
    isHost: room.hostId === socketId,
    meIndex: meIdx,
    players: room.players.map(p => ({ id: p.id, name: p.name })),
    currentPlayer: room.currentPlayer,
    winner: room.winner ? { id: room.winner, name: room.players.find(p => p.id === room.winner)?.name || 'Giocatore' } : null,
    lastAction: room.lastAction,
    log: room.log,
    cards: CARDS,
    colors: COLORS
  };

  if (room.phase === 'setup') {
    base.hand = (room.hands[socketId] || []).map(id => CARD_BY_ID[id]);
    base.selectionSubmitted = !!room.selections[socketId];
    base.waitingFor = room.players.filter(p => !room.selections[p.id]).map(p => p.name);
  }

  if (room.phase === 'play' || room.phase === 'finished') {
    base.myPrivate = (room.privateCards[socketId] || []).map(id => CARD_BY_ID[id]);
    base.opponentMysteryVisible = opponent && room.mysteries[opponent.id]
      ? room.mysteries[opponent.id].map(id => CARD_BY_ID[id])
      : [];
    base.informants = room.informants.map(x => ({
      letter: x.letter,
      seen: (room.informantSeen[socketId] || []).includes(x.letter),
      card: (room.informantSeen[socketId] || []).includes(x.letter) ? CARD_BY_ID[x.cardId] : null
    }));
    base.myMysteryCount = 3;
    base.isMyTurn = room.currentPlayer === socketId && room.phase === 'play';
  }

  return base;
}

io.on('connection', socket => {
  socket.on('createRoom', ({ name } = {}, ack = () => {}) => {
    const room = makeRoom(socket, name);
    ack({ ok: true, code: room.code });
    emitRoom(room);
  });

  socket.on('joinRoom', ({ code, name } = {}, ack = () => {}) => {
    code = String(code || '').trim().toUpperCase();
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: 'Stanza non trovata.' });
    if (room.players.length >= 2) return ack({ ok: false, error: 'La stanza è già piena.' });
    if (room.phase !== 'lobby') return ack({ ok: false, error: 'La partita è già iniziata.' });

    room.players.push({ id: socket.id, name: cleanName(name, 'Giocatore 2') });
    socket.join(code);
    socket.data.roomCode = code;
    addLog(room, `${room.players[1].name} è entrato nella stanza.`);
    ack({ ok: true, code });
    emitRoom(room);
  });

  socket.on('startGame', (_data, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return ack({ ok: false, error: 'Stanza non trovata.' });
    if (room.hostId !== socket.id) return ack({ ok: false, error: 'Solo chi ha creato la stanza può iniziare.' });
    if (room.players.length !== 2) return ack({ ok: false, error: 'Servono esattamente 2 giocatori.' });
    startGame(room);
    ack({ ok: true });
    emitRoom(room);
  });

  socket.on('submitSelection', ({ cardIds } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'setup') return ack({ ok: false, error: 'Non puoi scegliere le carte adesso.' });
    const hand = room.hands[socket.id] || [];
    const ids = Array.isArray(cardIds) ? [...new Set(cardIds)] : [];
    if (ids.length !== 3 || !ids.every(id => hand.includes(id))) {
      return ack({ ok: false, error: 'Scegli esattamente 3 carte della tua mano.' });
    }
    const chosen = ids.map(id => CARD_BY_ID[id]);
    if (new Set(chosen.map(c => c.type)).size !== 3) {
      return ack({ ok: false, error: 'Devi scegliere 1 Personaggio, 1 Luogo e 1 Oggetto.' });
    }

    const opponent = otherPlayer(room, socket.id);
    room.selections[socket.id] = ids;
    room.mysteries[opponent.id] = ids;
    room.privateCards[socket.id] = shuffle(hand.filter(id => !ids.includes(id)));
    addLog(room, `${room.players.find(p => p.id === socket.id).name} ha preparato il caso.`);

    if (room.players.every(p => room.selections[p.id])) {
      room.phase = 'play';
      room.currentPlayer = room.players[Math.floor(Math.random() * 2)].id;
      addLog(room, `Inizia ${room.players.find(p => p.id === room.currentPlayer).name}.`);
    }
    ack({ ok: true });
    emitRoom(room);
  });

  socket.on('askQuestion', ({ kind, value, side } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'play') return ack({ ok: false, error: 'La partita non è in corso.' });
    if (room.currentPlayer !== socket.id) return ack({ ok: false, error: 'Non è il tuo turno.' });
    if (!['left', 'right'].includes(side)) return ack({ ok: false, error: 'Scegli sinistra o destra.' });
    if (!['color', 'trait'].includes(kind)) return ack({ ok: false, error: 'Domanda non valida.' });
    if (kind === 'color' && !COLORS[value]) return ack({ ok: false, error: 'Colore non valido.' });
    const allowedTraits = ['Uomo', 'Donna', 'Capoluogo', 'Non capoluogo', 'Indossabile', 'Non indossabile'];
    if (kind === 'trait' && !allowedTraits.includes(value)) return ack({ ok: false, error: 'Categoria non valida.' });

    const opponent = otherPlayer(room, socket.id);
    const sideIndex = side === 'left' ? 0 : 1;
    const visibleToOpponent = [
      ...(room.mysteries[socket.id] || []),
      room.privateCards[opponent.id]?.[sideIndex]
    ].filter(Boolean).map(id => CARD_BY_ID[id]);
    const count = visibleToOpponent.filter(c => cardMatches(c, { kind, value })).length;
    const label = kind === 'color' ? `colore ${COLORS[value].label}` : value;
    const asker = room.players.find(p => p.id === socket.id);
    room.lastAction = {
      type: 'question',
      playerId: socket.id,
      text: `${asker.name}: “Quante carte ${label} vedi contando la carta alla tua ${side === 'left' ? 'sinistra' : 'destra'}?”`,
      answer: count
    };
    addLog(room, `${asker.name} ha interrogato il testimone: risposta ${count}.`);
    room.currentPlayer = opponent.id;
    ack({ ok: true, answer: count });
    emitRoom(room);
  });

  socket.on('consultInformant', ({ letter } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'play') return ack({ ok: false, error: 'La partita non è in corso.' });
    if (room.currentPlayer !== socket.id) return ack({ ok: false, error: 'Non è il tuo turno.' });
    const info = room.informants.find(x => x.letter === letter);
    if (!info) return ack({ ok: false, error: 'Informatore non valido.' });
    if (!room.informantSeen[socket.id].includes(letter)) room.informantSeen[socket.id].push(letter);
    const asker = room.players.find(p => p.id === socket.id);
    room.lastAction = { type: 'informant', playerId: socket.id, text: `${asker.name} ha consultato in segreto l’informatore ${letter}.` };
    addLog(room, `${asker.name} ha consultato l’informatore ${letter}.`);
    room.currentPlayer = otherPlayer(room, socket.id).id;
    ack({ ok: true, card: CARD_BY_ID[info.cardId] });
    emitRoom(room);
  });

  socket.on('accuse', ({ person, place, object } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'play') return ack({ ok: false, error: 'La partita non è in corso.' });
    if (room.currentPlayer !== socket.id) return ack({ ok: false, error: 'Non è il tuo turno.' });
    const guessed = [person, place, object];
    const cards = guessed.map(id => CARD_BY_ID[id]);
    if (cards.some(c => !c) || cards[0].type !== 'person' || cards[1].type !== 'place' || cards[2].type !== 'object') {
      return ack({ ok: false, error: 'Accusa non valida.' });
    }
    const mystery = room.mysteries[socket.id] || [];
    const correct = guessed.every(id => mystery.includes(id));
    const asker = room.players.find(p => p.id === socket.id);
    if (correct) {
      room.phase = 'finished';
      room.winner = socket.id;
      room.lastAction = { type: 'accuse', playerId: socket.id, correct: true, text: `${asker.name} ha risolto il caso!` };
      addLog(room, `${asker.name} ha formulato l’accusa corretta e ha vinto!`);
    } else {
      room.lastAction = { type: 'accuse', playerId: socket.id, correct: false, text: `${asker.name} ha formulato un’accusa, ma non è corretta.` };
      addLog(room, `${asker.name} ha sbagliato l’accusa.`);
      room.currentPlayer = otherPlayer(room, socket.id).id;
    }
    ack({ ok: true, correct });
    emitRoom(room);
  });

  socket.on('restartGame', (_data, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return ack({ ok: false, error: 'Stanza non trovata.' });
    if (room.players.length !== 2) return ack({ ok: false, error: 'Servono 2 giocatori.' });
    startGame(room);
    ack({ ok: true });
    emitRoom(room);
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    if (!code) return;
    const room = rooms.get(code);
    if (!room) return;
    const name = room.players.find(p => p.id === socket.id)?.name || 'Un giocatore';
    room.players = room.players.filter(p => p.id !== socket.id);
    addLog(room, `${name} si è disconnesso.`);
    if (room.players.length === 0) {
      rooms.delete(code);
      return;
    }
    // Se resta un solo giocatore, la stanza torna alla lobby e può essere riusata.
    room.hostId = room.players[0].id;
    room.phase = 'lobby';
    room.currentPlayer = null;
    room.winner = null;
    emitRoom(room);
  });
});

server.listen(PORT, () => {
  console.log(`13 Indizi online attivo sulla porta ${PORT}`);
});
