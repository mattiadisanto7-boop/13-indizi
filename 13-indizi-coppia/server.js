const path = require('path');
const fs = require('fs');
const http = require('http');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

const PORT = process.env.PORT || 3000;

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');
const STATS_FILE = path.join(DATA_DIR, 'stats.json');

function loadStats() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    if (!fs.existsSync(STATS_FILE)) fs.writeFileSync(STATS_FILE, JSON.stringify({ matches: [] }, null, 2));
    const parsed = JSON.parse(fs.readFileSync(STATS_FILE, 'utf8'));
    return { matches: Array.isArray(parsed.matches) ? parsed.matches : [] };
  } catch (err) {
    console.warn('Impossibile leggere lo storico partite:', err.message);
    return { matches: [] };
  }
}

const statsStore = loadStats();

function saveStats() {
  try {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(STATS_FILE, JSON.stringify(statsStore, null, 2));
  } catch (err) {
    console.warn('Impossibile salvare lo storico partite:', err.message);
  }
}

function statsPayload() {
  const table = new Map();
  for (const match of statsStore.matches) {
    const names = Array.isArray(match.players) ? match.players : [];
    for (const name of names) {
      const key = String(name || '').trim().toLowerCase();
      if (!key) continue;
      if (!table.has(key)) table.set(key, { name, games: 0, wins: 0, losses: 0 });
      const row = table.get(key);
      row.name = name;
      row.games += 1;
      if (String(match.winner || '').trim().toLowerCase() === key) row.wins += 1;
      else row.losses += 1;
    }
  }
  const ranking = [...table.values()]
    .map(x => ({ ...x, winRate: x.games ? Math.round((x.wins / x.games) * 100) : 0 }))
    .sort((a, b) => b.wins - a.wins || a.losses - b.losses || b.games - a.games || a.name.localeCompare(b.name, 'it'));
  const history = [...statsStore.matches].slice(-50).reverse();
  return { ranking, history };
}

function recordCompletedMatch(room, winnerId) {
  if (room.resultRecorded) return;
  const winner = room.players.find(p => p.id === winnerId);
  const loser = room.players.find(p => p.id !== winnerId);
  if (!winner || !loser) return;
  room.resultRecorded = true;
  statsStore.matches.push({
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    at: Date.now(),
    roomCode: room.code,
    players: [winner.name, loser.name],
    winner: winner.name,
    loser: loser.name,
    reason: 'Caso risolto'
  });
  statsStore.matches = statsStore.matches.slice(-500);
  saveStats();
}

app.use(express.static(path.join(__dirname, 'public')));
app.get('/health', (_req, res) => res.json({ ok: true }));
app.get('/api/stats', (_req, res) => res.json(statsPayload()));

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
const disconnectTimers = new Map();
const RECONNECT_GRACE_MS = 20000;
const CUSTOM_AUDIO_IDS = new Set(['vabbe','regalo','stupidi','parideee','smettila','finito','novita','botte','aiaaa','seviziato']);

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

function cleanToken(token) {
  return String(token || '').trim().slice(0, 120);
}

function timerKey(roomCode, token) {
  return `${roomCode}:${token}`;
}

function clearDisconnectTimer(roomCode, token) {
  const key = timerKey(roomCode, token);
  const timer = disconnectTimers.get(key);
  if (timer) clearTimeout(timer);
  disconnectTimers.delete(key);
}

function makeRoom(hostSocket, hostName, token) {
  const code = code4();
  const room = {
    code,
    hostId: hostSocket.id,
    players: [{ id: hostSocket.id, token, name: cleanName(hostName, 'Giocatore 1'), disconnected: false }],
    phase: 'lobby',
    hands: {}, selections: {}, privateCards: {}, mysteries: {},
    informants: [], informantSeen: {}, currentPlayer: null,
    winner: null, lastAction: null, log: [], opponentLeftName: null, resultRecorded: false
  };
  rooms.set(code, room);
  hostSocket.join(code);
  hostSocket.data.roomCode = code;
  hostSocket.data.playerToken = token;
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

function moveKey(obj, oldId, newId) {
  if (!obj || oldId === newId || !(oldId in obj)) return;
  obj[newId] = obj[oldId];
  delete obj[oldId];
}

function replacePlayerSocket(room, player, newSocket) {
  const oldId = player.id;
  const newId = newSocket.id;
  if (oldId !== newId) {
    moveKey(room.hands, oldId, newId);
    moveKey(room.selections, oldId, newId);
    moveKey(room.privateCards, oldId, newId);
    moveKey(room.mysteries, oldId, newId);
    moveKey(room.informantSeen, oldId, newId);
    if (room.currentPlayer === oldId) room.currentPlayer = newId;
    if (room.winner === oldId) room.winner = newId;
    if (room.hostId === oldId) room.hostId = newId;
    player.id = newId;
  }
  player.disconnected = false;
  newSocket.join(room.code);
  newSocket.data.roomCode = room.code;
  newSocket.data.playerToken = player.token;
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
  room.resultRecorded = false;
  room.lastAction = null;
  room.log = [];
  room.opponentLeftName = null;

  for (const p of room.players) {
    room.hands[p.id] = [];
    room.informantSeen[p.id] = [];
  }

  for (let i = 0; i < 2; i++) {
    room.hands[room.players[i].id].push(persons.pop(), places.pop(), objects.pop());
  }

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

function buildState(room, socketId) {
  const meIdx = playerIndex(room, socketId);
  const opponent = otherPlayer(room, socketId);
  const base = {
    roomCode: room.code,
    phase: room.phase,
    isHost: room.hostId === socketId,
    meIndex: meIdx,
    players: room.players.map(p => ({ id: p.id, name: p.name, disconnected: !!p.disconnected })),
    currentPlayer: room.currentPlayer,
    winner: room.winner ? { id: room.winner, name: room.players.find(p => p.id === room.winner)?.name || 'Giocatore' } : null,
    lastAction: room.lastAction,
    log: room.log,
    cards: CARDS,
    colors: COLORS,
    opponentLeftName: room.opponentLeftName
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

function emitRoom(room) {
  room.players.forEach(p => {
    const socket = io.sockets.sockets.get(p.id);
    if (socket) socket.emit('state', buildState(room, p.id));
  });
}

function removePlayerFromRoom(room, socketId, reason = 'abbandonato') {
  const leaving = room.players.find(p => p.id === socketId);
  if (!leaving) return;
  clearDisconnectTimer(room.code, leaving.token);
  const leavingName = leaving.name;
  room.players = room.players.filter(p => p.id !== socketId);
  delete room.hands[socketId];
  delete room.selections[socketId];
  delete room.privateCards[socketId];
  delete room.mysteries[socketId];
  delete room.informantSeen[socketId];

  if (room.players.length === 0) {
    rooms.delete(room.code);
    return;
  }

  room.hostId = room.players[0].id;
  room.phase = 'opponent_left';
  room.opponentLeftName = leavingName;
  room.currentPlayer = null;
  room.winner = null;
  room.lastAction = { type: 'leave', playerId: socketId, text: `${leavingName} ha ${reason} la partita.` };
  addLog(room, `${leavingName} ha ${reason} la partita.`);
  emitRoom(room);
}

io.on('connection', socket => {
  socket.on('getStats', (_data, ack = () => {}) => {
    ack({ ok: true, ...statsPayload() });
  });

  socket.on('playCustomAudio', ({ id } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return ack({ ok: false, error: 'Entra prima in una partita.' });
    id = String(id || '').trim();
    if (!CUSTOM_AUDIO_IDS.has(id)) return ack({ ok: false, error: 'Audio non valido.' });
    const now = Date.now();
    if (socket.data.lastCustomAudioAt && now - socket.data.lastCustomAudioAt < 350) {
      return ack({ ok: false, error: 'Aspetta un attimo prima di premere un altro audio.' });
    }
    socket.data.lastCustomAudioAt = now;
    const playerName = room.players.find(p => p.id === socket.id)?.name || 'Giocatore';
    io.to(room.code).emit('customAudio', { id, playerName });
    ack({ ok: true });
  });

  socket.on('createRoom', ({ name, token } = {}, ack = () => {}) => {
    token = cleanToken(token);
    if (!token) return ack({ ok: false, error: 'Sessione non valida. Ricarica la pagina.' });
    const room = makeRoom(socket, name, token);
    ack({ ok: true, code: room.code });
    emitRoom(room);
  });

  socket.on('joinRoom', ({ code, name, token } = {}, ack = () => {}) => {
    code = String(code || '').trim().toUpperCase();
    token = cleanToken(token);
    if (!token) return ack({ ok: false, error: 'Sessione non valida. Ricarica la pagina.' });
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: 'Stanza non trovata.' });
    if (room.players.length >= 2) return ack({ ok: false, error: 'La stanza è già piena.' });
    if (room.phase !== 'lobby') return ack({ ok: false, error: 'La partita è già iniziata.' });

    room.players.push({ id: socket.id, token, name: cleanName(name, 'Giocatore 2'), disconnected: false });
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerToken = token;
    addLog(room, `${room.players[1].name} è entrato nella stanza.`);
    ack({ ok: true, code });
    emitRoom(room);
  });

  socket.on('reconnectRoom', ({ code, token } = {}, ack = () => {}) => {
    code = String(code || '').trim().toUpperCase();
    token = cleanToken(token);
    const room = rooms.get(code);
    if (!room) return ack({ ok: false, error: 'La stanza non esiste più.' });
    const player = room.players.find(p => p.token === token);
    if (!player) return ack({ ok: false, error: 'La sessione di questa partita non è più valida.' });
    clearDisconnectTimer(code, token);
    replacePlayerSocket(room, player, socket);
    addLog(room, `${player.name} si è ricollegato.`);
    ack({ ok: true, code });
    emitRoom(room);
  });

  socket.on('startGame', (_data, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room) return ack({ ok: false, error: 'Stanza non trovata.' });
    if (room.hostId !== socket.id) return ack({ ok: false, error: 'Solo chi ha creato la stanza può iniziare.' });
    if (room.players.length !== 2) return ack({ ok: false, error: 'Servono esattamente 2 giocatori.' });
    if (room.players.some(p => p.disconnected)) return ack({ ok: false, error: 'Attendi che l’altro giocatore si ricolleghi.' });
    startGame(room);
    ack({ ok: true });
    emitRoom(room);
  });

  socket.on('submitSelection', ({ cardIds } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'setup') return ack({ ok: false, error: 'Non puoi scegliere le carte adesso.' });
    const hand = room.hands[socket.id] || [];
    const ids = Array.isArray(cardIds) ? [...new Set(cardIds)] : [];
    if (ids.length !== 3 || !ids.every(id => hand.includes(id))) return ack({ ok: false, error: 'Scegli esattamente 3 carte della tua mano.' });
    const chosen = ids.map(id => CARD_BY_ID[id]);
    if (new Set(chosen.map(c => c.type)).size !== 3) return ack({ ok: false, error: 'Devi scegliere 1 Personaggio, 1 Luogo e 1 Oggetto.' });

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

  socket.on('askQuestion', ({ kind, value } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'play') return ack({ ok: false, error: 'La partita non è in corso.' });
    if (room.players.some(p => p.disconnected)) return ack({ ok: false, error: 'Attendi che l’altro detective si ricolleghi.' });
    if (room.currentPlayer !== socket.id) return ack({ ok: false, error: 'Non è il tuo turno.' });
    if (!['color', 'trait'].includes(kind)) return ack({ ok: false, error: 'Domanda non valida.' });
    if (kind === 'color' && !COLORS[value]) return ack({ ok: false, error: 'Colore non valido.' });
    const allowedTraits = ['Uomo', 'Donna', 'Capoluogo', 'Non capoluogo', 'Indossabile', 'Non indossabile'];
    if (kind === 'trait' && !allowedTraits.includes(value)) return ack({ ok: false, error: 'Categoria non valida.' });

    const opponent = otherPlayer(room, socket.id);
    // Regola personalizzata: vengono SEMPRE conteggiate entrambe le carte private dell'avversario.
    const visibleToOpponent = [
      ...(room.mysteries[socket.id] || []),
      ...(room.privateCards[opponent.id] || [])
    ].filter(Boolean).map(id => CARD_BY_ID[id]);
    const count = visibleToOpponent.filter(c => cardMatches(c, { kind, value })).length;
    const label = kind === 'color' ? `del colore ${COLORS[value].label}` : value;
    const asker = room.players.find(p => p.id === socket.id);
    room.lastAction = {
      type: 'question', playerId: socket.id,
      text: `${asker.name}: “Quante carte ${label} vedi?”`, answer: count
    };
    addLog(room, `${asker.name} ha fatto una domanda: risposta ${count}.`);
    room.currentPlayer = opponent.id;
    ack({ ok: true, answer: count });
    emitRoom(room);
  });

  socket.on('consultInformant', ({ letter } = {}, ack = () => {}) => {
    const room = rooms.get(socket.data.roomCode);
    if (!room || room.phase !== 'play') return ack({ ok: false, error: 'La partita non è in corso.' });
    if (room.players.some(p => p.disconnected)) return ack({ ok: false, error: 'Attendi che l’altro detective si ricolleghi.' });
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
    if (room.players.some(p => p.disconnected)) return ack({ ok: false, error: 'Attendi che l’altro detective si ricolleghi.' });
    if (room.currentPlayer !== socket.id) return ack({ ok: false, error: 'Non è il tuo turno.' });
    const guessed = [person, place, object];
    const cards = guessed.map(id => CARD_BY_ID[id]);
    if (cards.some(c => !c) || cards[0].type !== 'person' || cards[1].type !== 'place' || cards[2].type !== 'object') return ack({ ok: false, error: 'Accusa non valida.' });
    const mystery = room.mysteries[socket.id] || [];
    const correct = guessed.every(id => mystery.includes(id));
    const asker = room.players.find(p => p.id === socket.id);
    if (correct) {
      room.phase = 'finished';
      room.winner = socket.id;
      room.lastAction = { type: 'accuse', playerId: socket.id, correct: true, text: `${asker.name} ha risolto il caso!` };
      addLog(room, `${asker.name} ha formulato l’accusa corretta e ha vinto!`);
      recordCompletedMatch(room, socket.id);
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

  socket.on('leaveRoom', (_data, ack = () => {}) => {
    const code = socket.data.roomCode;
    const room = rooms.get(code);
    if (!room) {
      socket.data.roomCode = null;
      return ack({ ok: true });
    }
    socket.leave(code);
    removePlayerFromRoom(room, socket.id, 'abbandonato');
    socket.data.roomCode = null;
    ack({ ok: true });
  });

  socket.on('disconnect', () => {
    const code = socket.data.roomCode;
    const token = socket.data.playerToken;
    if (!code || !token) return;
    const room = rooms.get(code);
    if (!room) return;
    const player = room.players.find(p => p.token === token && p.id === socket.id);
    if (!player) return;
    player.disconnected = true;
    emitRoom(room);

    const key = timerKey(code, token);
    clearDisconnectTimer(code, token);
    const timer = setTimeout(() => {
      disconnectTimers.delete(key);
      const freshRoom = rooms.get(code);
      if (!freshRoom) return;
      const freshPlayer = freshRoom.players.find(p => p.token === token);
      if (!freshPlayer || !freshPlayer.disconnected) return;
      removePlayerFromRoom(freshRoom, freshPlayer.id, 'lasciato');
    }, RECONNECT_GRACE_MS);
    disconnectTimers.set(key, timer);
  });
});

server.listen(PORT, () => {
  console.log(`13 Indizi online attivo sulla porta ${PORT}`);
});
