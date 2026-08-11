const socket = io();
let state = null;
let selectedSetup = new Set();
let activeTab = 'question';
let callMode = false;
let noteState = {};
let noteStateKey = '';
let noteNumbers = {};
let noteNumbersKey = '';
let lastWinnerShown = null;

const sheetColorOrder = ['purple','pink','red','green','yellow','blue'];
const colorOrder = ['yellow','blue','green','red','pink','purple'];
const typeLabel = { person:'Personaggio', place:'Luogo', object:'Oggetto' };
const views = ['homeView','lobbyView','setupView','opponentLeftView','gameView'];
const $ = (id) => document.getElementById(id);

// Sessione locale: serve a far funzionare il tasto Refresh senza perdere subito la partita.
const sessionToken = (() => {
  let token = sessionStorage.getItem('indizi-client-token');
  if (!token) {
    token = (globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random()}`).replace(/[^a-zA-Z0-9-]/g,'');
    sessionStorage.setItem('indizi-client-token', token);
  }
  return token;
})();

function saveRoomSession(code) { sessionStorage.setItem('indizi-room-code', code); }
function clearRoomSession() { sessionStorage.removeItem('indizi-room-code'); }
function savedRoomSession() { return sessionStorage.getItem('indizi-room-code') || ''; }

function showView(id){ views.forEach(v => $(v)?.classList.toggle('active', v===id)); }
function esc(s){ return String(s ?? '').replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
function teamHex(card){ return state?.colors?.[card.color]?.hex || '#888'; }
function teamName(card){ return state?.colors?.[card.color]?.label || card.color; }

function cardHtml(card, opts={}){
  const cls = ['card',card.type,opts.selectable?'selectable':'',opts.selected?'selected':''].filter(Boolean).join(' ');
  return `<article class="${cls}" data-card-id="${card.id}" style="--team:${teamHex(card)}">
    <div class="card-img-wrap"><img src="${card.image}" alt="${esc(card.name)}"></div>
    <div class="card-meta">
      <div class="card-name">${esc(card.name)}</div>
      <div class="card-sub"><span><i class="color-dot"></i>${esc(teamName(card))}</span><span>${typeLabel[card.type]}</span></div>
    </div>
  </article>`;
}

function renderHomePreview(){
  const preview = [
    ['Gialla','Principessa · Firenze · Girasoli','#f5c542'],
    ['Blu','Principe · Trieste · Nippon','#3d7ee8'],
    ['Verde','Angela · Terlizzi · Collana','#48a868'],
    ['Rossa','Pino · Roma · Diario','#d94b4b'],
    ['Rosa','Iolanda · Cantalupa · Dipinto','#e984b3'],
    ['Viola','Filippo · Populonia · Occhiali','#8866d8']
  ];
  $('teamsPreview').innerHTML = preview.map(x=>`<div class="team-strip" style="--team:${x[2]}"><strong>${x[0]}</strong><span>${x[1]}</span></div>`).join('');
}
renderHomePreview();

function formatMatchDate(ms){
  try { return new Date(ms).toLocaleString('it-IT',{day:'2-digit',month:'2-digit',year:'numeric',hour:'2-digit',minute:'2-digit'}); }
  catch { return ''; }
}
function showStats(){
  actionGesture();
  socket.emit('getStats',{},res=>{
    if(!res?.ok) return alert('Non riesco a caricare classifica e storico.');
    const ranking=res.ranking||[], history=res.history||[];
    const rankingHtml=ranking.length ? `<div class="stats-table-wrap"><table class="stats-table"><thead><tr><th>#</th><th>Giocatore</th><th>V</th><th>S</th><th>Partite</th><th>% vittorie</th></tr></thead><tbody>${ranking.map((r,i)=>`<tr><td>${i+1}</td><td><strong>${esc(r.name)}</strong></td><td>${r.wins}</td><td>${r.losses}</td><td>${r.games}</td><td>${r.winRate}%</td></tr>`).join('')}</tbody></table></div>` : '<p class="muted">Nessuna partita conclusa ancora.</p>';
    const historyHtml=history.length ? `<div class="match-history">${history.map(m=>`<div class="history-row"><div><strong>${esc(m.winner)}</strong> ha vinto contro ${esc(m.loser)}</div><span>${formatMatchDate(m.at)}</span></div>`).join('')}</div>` : '<p class="muted">Lo storico è ancora vuoto.</p>';
    showSimpleModal('Classifica e storico',`<div class="stats-section"><h3>🏆 Classifica</h3>${rankingHtml}<h3>🕘 Storico partite</h3>${historyHtml}<p class="stats-note">Le partite vengono registrate quando qualcuno risolve correttamente il caso.</p></div>`);
  });
}
$('statsBtn').onclick=showStats;

/* ---------------- AUDIO ---------------- */
let audioCtx = null;
let musicTimer = null;
let musicStep = 0;
let musicOn = localStorage.getItem('indizi-music') !== 'off';
let soundOn = localStorage.getItem('indizi-sound') !== 'off';
let personalAudioManifest = {};
let soundboardItems = [];

fetch('/assets/audio/personalizzati/soundboard.json')
  .then(r => r.ok ? r.json() : [])
  .then(x => { soundboardItems = Array.isArray(x) ? x : []; renderSoundboards(); })
  .catch(() => { soundboardItems = []; renderSoundboards(); });

fetch('/assets/audio/personalizzati/manifest.json')
  .then(r => r.ok ? r.json() : {})
  .then(x => { personalAudioManifest = x || {}; })
  .catch(() => {});

function ensureAudio(){
  if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  if (audioCtx.state === 'suspended') audioCtx.resume().catch(()=>{});
}

function tone(freq=440, duration=.08, volume=.035, type='sine', delay=0){
  if (!soundOn && volume > .03) return;
  ensureAudio();
  const t = audioCtx.currentTime + delay;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.setValueAtTime(freq,t);
  gain.gain.setValueAtTime(0.0001,t);
  gain.gain.exponentialRampToValueAtTime(Math.max(.0002,volume),t+.012);
  gain.gain.exponentialRampToValueAtTime(.0001,t+duration);
  osc.connect(gain).connect(audioCtx.destination);
  osc.start(t); osc.stop(t+duration+.03);
}

function sfx(kind){
  if (!soundOn) return;
  ensureAudio();
  const sets = {
    click:[[420,.05,.028,'sine',0]],
    join:[[440,.07,.04,'sine',0],[660,.09,.035,'sine',.07]],
    start:[[330,.08,.04,'triangle',0],[440,.08,.04,'triangle',.09],[660,.13,.04,'triangle',.18]],
    select:[[520,.06,.025,'sine',0]],
    note:[[360,.045,.02,'square',0]],
    question:[[520,.07,.035,'sine',0],[390,.11,.03,'sine',.08]],
    informant:[[280,.08,.035,'triangle',0],[560,.12,.032,'triangle',.08]],
    wrong:[[220,.1,.04,'sawtooth',0],[165,.18,.04,'sawtooth',.1]],
    win:[[523,.1,.045,'triangle',0],[659,.1,.045,'triangle',.11],[784,.22,.05,'triangle',.22]],
    leave:[[330,.08,.035,'sine',0],[220,.16,.03,'sine',.09]]
  };
  (sets[kind] || sets.click).forEach(args=>tone(...args));
}

function startMusic(){
  if (!musicOn || musicTimer) return;
  ensureAudio();
  const melody=[220,261.63,329.63,293.66,246.94,293.66,261.63,196];
  const play=()=>{
    if (!musicOn || !audioCtx) return;
    const f=melody[musicStep++ % melody.length];
    const t=audioCtx.currentTime;
    const osc=audioCtx.createOscillator();
    const gain=audioCtx.createGain();
    osc.type='sine'; osc.frequency.value=f;
    gain.gain.setValueAtTime(.0001,t);
    gain.gain.exponentialRampToValueAtTime(.012,t+.06);
    gain.gain.exponentialRampToValueAtTime(.0001,t+.72);
    osc.connect(gain).connect(audioCtx.destination);
    osc.start(t); osc.stop(t+.78);
  };
  play();
  musicTimer=setInterval(play,900);
}

function stopMusic(){ if(musicTimer){clearInterval(musicTimer);musicTimer=null;} }
function updateAudioButtons(){
  $('musicBtn').textContent = musicOn ? '🎵 Musica ON' : '🎵 Musica OFF';
  $('soundBtn').textContent = soundOn ? '🔊 Suoni ON' : '🔇 Suoni OFF';
}
updateAudioButtons();

async function playPersonal(key, fallbackSfx){
  const src = personalAudioManifest?.[key];
  if (soundOn && src) {
    try {
      const a = new Audio(`/assets/audio/personalizzati/${src}`);
      a.volume=.75;
      await a.play();
      return;
    } catch {}
  }
  if (fallbackSfx) sfx(fallbackSfx);
}

function soundboardButtonHtml(item){
  return `<button class="soundboard-btn" data-sound-id="${esc(item.id)}" title="Riproduci: ${esc(item.label)}"><span class="soundboard-icon">🔊</span><span>${esc(item.label)}</span></button>`;
}
function attachSoundboardEvents(container){
  if(!container) return;
  container.querySelectorAll('.soundboard-btn[data-sound-id]').forEach(btn=>{
    btn.onclick=()=>{
      actionGesture();
      socket.emit('playCustomAudio',{id:btn.dataset.soundId},res=>{
        if(!res?.ok) alert(res?.error || 'Non riesco a riprodurre questo audio.');
      });
    };
  });
}
function renderSoundboardInto(id){
  const container=$(id); if(!container) return;
  if(!soundboardItems.length){
    container.innerHTML='<span class="muted">Caricamento audio…</span>';
    return;
  }
  container.innerHTML=soundboardItems.map(soundboardButtonHtml).join('');
  attachSoundboardEvents(container);
}
function renderSoundboards(){
  renderSoundboardInto('soundboard');
  renderSoundboardInto('callSoundboard');
}
async function playSoundboardItem(id){
  if(!soundOn) return;
  const item=soundboardItems.find(x=>x.id===id);
  if(!item) return;
  try {
    const a=new Audio(`/assets/audio/personalizzati/${item.file}`);
    a.volume=.92;
    await a.play();
  } catch {}
}
socket.on('customAudio',payload=>{
  playSoundboardItem(payload?.id);
});

$('musicBtn').onclick=()=>{
  ensureAudio(); musicOn=!musicOn; localStorage.setItem('indizi-music',musicOn?'on':'off');
  if(musicOn) startMusic(); else stopMusic(); updateAudioButtons();
};
$('soundBtn').onclick=()=>{ ensureAudio(); soundOn=!soundOn; localStorage.setItem('indizi-sound',soundOn?'on':'off'); updateAudioButtons(); if(soundOn)sfx('click'); };

/* ---------------- NAVIGAZIONE / STANZA ---------------- */
function actionGesture(){ ensureAudio(); if(musicOn && !musicTimer) startMusic(); }

$('createBtn').onclick = () => {
  actionGesture(); $('homeError').textContent='';
  socket.emit('createRoom',{name:$('nameInput').value,token:sessionToken},res=>{
    if(!res.ok) return $('homeError').textContent=res.error;
    saveRoomSession(res.code); sfx('join');
  });
};
$('joinBtn').onclick = () => {
  actionGesture(); $('homeError').textContent='';
  socket.emit('joinRoom',{code:$('roomInput').value,name:$('nameInput').value,token:sessionToken},res=>{
    if(!res.ok) return $('homeError').textContent=res.error;
    saveRoomSession(res.code); sfx('join');
  });
};
$('roomInput').addEventListener('input',e=>e.target.value=e.target.value.toUpperCase());
$('startBtn').onclick = () => { actionGesture(); socket.emit('startGame',{},res=>{ if(!res.ok) alert(res.error); else sfx('start'); }); };

function refreshPage(){ location.reload(); }
$('refreshBtn').onclick=refreshPage;
$('refreshCallBtn').onclick=refreshPage;
$('refreshOpponentBtn').onclick=refreshPage;

function leaveRoom({confirmLeave=true}={}){
  if(confirmLeave && !confirm('Vuoi davvero abbandonare la partita?')) return;
  actionGesture();
  socket.emit('leaveRoom',{},()=>{
    playPersonal('abbandona','leave');
    clearRoomSession(); state=null; callMode=false; document.body.classList.remove('call-mode'); closeModal(); showView('homeView');
  });
}
function backToMenu(){ leaveRoom({confirmLeave:false}); }
$('backMenuLobbyBtn').onclick=backToMenu;
$('backMenuOpponentBtn').onclick=backToMenu;
$('leaveSetupBtn').onclick=()=>leaveRoom();
$('leaveGameBtn').onclick=()=>leaveRoom();
$('leaveCallBtn').onclick=()=>leaveRoom();

socket.on('connect',()=>{
  const code=savedRoomSession();
  if(!code) return;
  socket.emit('reconnectRoom',{code,token:sessionToken},res=>{
    if(!res.ok){ clearRoomSession(); state=null; showView('homeView'); }
  });
});

socket.on('state', s => {
  const prevPhase = state?.phase;
  const prevPlayers = state?.players?.length || 0;
  state = s;
  saveRoomSession(s.roomCode);
  if (prevPhase !== 'setup' && s.phase === 'setup') {
    selectedSetup = new Set(); callMode = false; resetNotebookStorage(); lastWinnerShown=null;
  }
  if(prevPlayers===1 && s.players.length===2) sfx('join');
  ensureNoteState(); render();
});

function render(){
  if(!state) return showView('homeView');
  if(state.phase==='lobby') renderLobby();
  else if(state.phase==='setup') renderSetup();
  else if(state.phase==='play' || state.phase==='finished') renderGame();
  else if(state.phase==='opponent_left') renderOpponentLeft();
}

function renderLobby(){
  showView('lobbyView');
  $('roomCodeText').textContent=state.roomCode;
  $('playersLobby').innerHTML = state.players.map(p=>`<div class="player-row">🕵️ ${esc(p.name)}${p.disconnected?' <span class="disconnect-badge">si sta ricollegando…</span>':''}</div>`).join('') + (state.players.length<2?'<div class="player-row waiting">In attesa del secondo detective…</div>':'');
  $('startBtn').classList.toggle('hidden',!(state.isHost && state.players.length===2 && !state.players.some(p=>p.disconnected)));
  $('lobbyHint').textContent = state.players.length<2 ? 'La partita partirà quando sarete in due.' : state.players.some(p=>p.disconnected) ? 'Attendi qualche secondo: l’altro detective si sta ricollegando.' : state.isHost ? 'Siete pronti. Puoi iniziare.' : 'Attendi che chi ha creato la stanza inizi la partita.';
}

function renderOpponentLeft(){
  callMode=false; document.body.classList.remove('call-mode'); closeModal(); showView('opponentLeftView');
  $('opponentLeftText').textContent = state.opponentLeftName ? `${state.opponentLeftName} ha lasciato la partita. Puoi tornare al menù e crearne una nuova.` : 'La partita non può continuare. Puoi tornare al menù.';
  playPersonal('scompagnato','leave');
}

function renderSetup(){
  showView('setupView');
  if(state.selectionSubmitted){
    $('setupHand').innerHTML=''; $('selectionCounter').textContent='3 / 3'; $('submitSelectionBtn').disabled=true;
    $('setupStatus').textContent=`Caso confermato. In attesa di: ${state.waitingFor.join(', ') || 'nessuno'}`;
    return;
  }
  $('setupStatus').textContent='';
  $('setupHand').innerHTML = state.hand.map(c=>cardHtml(c,{selectable:true,selected:selectedSetup.has(c.id)})).join('');
  $('setupHand').querySelectorAll('.card').forEach(el=>el.onclick=()=>toggleSetupCard(el.dataset.cardId));
  updateSelectionUI();
}

function toggleSetupCard(id){
  actionGesture(); sfx('select');
  if(selectedSetup.has(id)) selectedSetup.delete(id);
  else {
    const card=state.hand.find(c=>c.id===id);
    [...selectedSetup].forEach(sel=>{ if(state.hand.find(c=>c.id===sel)?.type===card.type) selectedSetup.delete(sel); });
    selectedSetup.add(id);
  }
  renderSetup();
}
function updateSelectionUI(){
  $('selectionCounter').textContent=`${selectedSetup.size} / 3`;
  const cards=[...selectedSetup].map(id=>state.hand.find(c=>c.id===id));
  $('submitSelectionBtn').disabled = selectedSetup.size!==3 || new Set(cards.map(c=>c.type)).size!==3;
}
$('submitSelectionBtn').onclick=()=>{ actionGesture(); socket.emit('submitSelection',{cardIds:[...selectedSetup]},res=>{if(!res.ok) alert(res.error); else sfx('start');}); };

function renderGame(){
  showView('gameView');
  $('gameRoomCode').textContent=state.roomCode;
  const disconnected=state.players.find(p=>p.disconnected);
  const current=state.players.find(p=>p.id===state.currentPlayer);
  $('turnText').textContent = disconnected ? `${disconnected.name} si sta ricollegando…` : state.phase==='finished' ? 'Partita conclusa' : state.isMyTurn ? 'È il tuo turno' : `Turno di ${current?.name || '…'}`;
  $('playerPills').innerHTML=state.players.map(p=>`<span class="player-pill ${p.id===state.currentPlayer?'current':''} ${p.disconnected?'offline':''}">${esc(p.name)}${p.disconnected?' ⟳':''}</span>`).join('');

  if(state.lastAction){
    $('lastActionBox').classList.remove('hidden');
    $('lastActionBox').innerHTML=`${esc(state.lastAction.text)}${state.lastAction.answer!==undefined?` <strong>Risposta: ${state.lastAction.answer}</strong>`:''}`;
  } else $('lastActionBox').classList.add('hidden');

  $('opponentMystery').innerHTML=state.opponentMysteryVisible.map(c=>cardHtml(c)).join('');
  $('privateCards').innerHTML=state.myPrivate.map(c=>`<div class="private-card-wrap">${cardHtml(c)}</div>`).join('');
  renderInformants(); renderActions(); renderNotebook(); renderSoundboards(); applyCallMode();
  $('gameLog').innerHTML=(state.log||[]).map(x=>`<div class="log-entry">${esc(x.text)}</div>`).join('');

  if(state.phase==='finished') showWinner();
}

function renderInformants(){
  $('informants').innerHTML=state.informants.map(i=>{
    if(!i.seen) return `<div class="info-card" data-letter="${i.letter}">${i.letter}</div>`;
    const c=i.card; return `<div class="info-card seen ${c.type}" data-letter="${i.letter}" title="${esc(c.name)}"><span class="info-letter">${i.letter}</span><img src="${c.image}" alt="${esc(c.name)}"></div>`;
  }).join('');
  $('informants').querySelectorAll('.info-card').forEach(el=>el.onclick=()=>{
    const item=state.informants.find(i=>i.letter===el.dataset.letter);
    if(item?.seen) showCardModal(item.card,`Informatore ${item.letter}`);
  });
}

function renderActions(){
  const disconnected=state.players.some(p=>p.disconnected);
  const locked=!state.isMyTurn || state.phase!=='play' || disconnected;
  $('actionsLocked').classList.toggle('hidden',!locked);
  $('actionsLocked').textContent=disconnected?'Attendi: l’altro detective si sta ricollegando.':'Attendi il turno dell’altro giocatore.';
  $('actionTabs').style.opacity=locked?'.45':'1';
  document.querySelectorAll('.actions-panel button,.actions-panel select').forEach(el=>{ if(!el.classList.contains('tab')) el.disabled=locked; });

  const questions=[];
  colorOrder.forEach(k=>questions.push({kind:'color',value:k,label:`Colore ${state.colors[k].label}`}));
  ['Uomo','Donna','Capoluogo','Non capoluogo','Indossabile','Non indossabile'].forEach(v=>questions.push({kind:'trait',value:v,label:v}));
  $('questionSelect').innerHTML=questions.map(q=>`<option value="${q.kind}|${q.value}">${q.label}</option>`).join('');
  $('informantSelect').innerHTML=state.informants.map(i=>`<option value="${i.letter}">${i.letter}${i.seen?' — già visto':''}</option>`).join('');

  const visibleIds=new Set([...state.opponentMysteryVisible.map(c=>c.id),...state.myPrivate.map(c=>c.id),...state.informants.filter(i=>i.seen).map(i=>i.card.id)]);
  const candidates=state.cards.filter(c=>!visibleIds.has(c.id));
  fillSelect('accusePerson',candidates.filter(c=>c.type==='person'),'Personaggio…');
  fillSelect('accusePlace',candidates.filter(c=>c.type==='place'),'Luogo…');
  fillSelect('accuseObject',candidates.filter(c=>c.type==='object'),'Oggetto…');
}
function fillSelect(id,cards,placeholder){
  $(id).innerHTML=`<option value="">${placeholder}</option>`+cards.map(c=>`<option value="${c.id}">${esc(c.name)} — ${state.colors[c.color].label}</option>`).join('');
}

document.querySelectorAll('.tab').forEach(btn=>btn.onclick=()=>{
  actionGesture(); sfx('click'); activeTab=btn.dataset.tab;
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===activeTab));
  ['question','informant','accuse'].forEach(t=>$(t+'Tab').classList.toggle('active',t===activeTab));
});

$('askBtn').onclick=()=>{
  actionGesture(); const [kind,value]=$('questionSelect').value.split('|');
  socket.emit('askQuestion',{kind,value},res=>{
    if(!res.ok) return alert(res.error);
    playPersonal('domanda','question');
    ensureNoteNumbers();
    noteNumbers[`${kind}:${value}`]=String(res.answer);
    saveNoteNumbers();
    renderNotebook();
    showSimpleModal('Risposta del testimone',`<div class="winner"><div class="trophy">🔎</div><h2>${res.answer}</h2><p>Il testimone vede <strong>${res.answer}</strong> carte corrispondenti alla tua domanda, contando anche entrambe le sue carte private.</p><p class="muted">Ho scritto automaticamente <strong>${res.answer}</strong> anche nel foglio degli appunti.</p></div>`);
  });
};
$('consultBtn').onclick=()=>{
  actionGesture(); const letter=$('informantSelect').value;
  socket.emit('consultInformant',{letter},res=>{
    if(!res.ok) return alert(res.error);
    playPersonal('informatore','informant'); showCardModal(res.card,`Informatore ${letter}`);
  });
};
$('accuseBtn').onclick=()=>{
  actionGesture(); const person=$('accusePerson').value,place=$('accusePlace').value,object=$('accuseObject').value;
  if(!person||!place||!object) return alert('Scegli Personaggio, Luogo e Oggetto.');
  socket.emit('accuse',{person,place,object},res=>{
    if(!res.ok) return alert(res.error);
    if(!res.correct){ playPersonal('accusa_errata','wrong'); showSimpleModal('Accusa errata','<p>Non è la combinazione corretta. Il turno passa all’altro detective.</p>'); }
  });
};

/* ---------------- FOGLIO APPUNTI ---------------- */
function notebookStorageKey(){
  if(!state?.roomCode) return 'indizi-note-state';
  return `indizi-note-state:${state.roomCode}:${state.meIndex ?? 0}`;
}
function notebookNumbersStorageKey(){
  if(!state?.roomCode) return 'indizi-note-numbers';
  return `indizi-note-numbers:${state.roomCode}:${state.meIndex ?? 0}`;
}
function ensureNoteState(){
  const key=notebookStorageKey();
  if(key!==noteStateKey){
    noteStateKey=key;
    try { noteState=JSON.parse(localStorage.getItem(key)||'{}'); } catch { noteState={}; }
    Object.keys(noteState).forEach(id=>{ if(noteState[id]==='excluded') noteState[id]='x'; if(noteState[id]==='suspect') noteState[id]='question'; });
  }
  ensureNoteNumbers();
}
function ensureNoteNumbers(){
  const key=notebookNumbersStorageKey();
  if(key===noteNumbersKey) return;
  noteNumbersKey=key;
  try { noteNumbers=JSON.parse(localStorage.getItem(key)||'{}'); } catch { noteNumbers={}; }
}
function saveNoteState(){ if(!noteStateKey) ensureNoteState(); localStorage.setItem(noteStateKey,JSON.stringify(noteState)); }
function saveNoteNumbers(){ if(!noteNumbersKey) ensureNoteNumbers(); localStorage.setItem(noteNumbersKey,JSON.stringify(noteNumbers)); }
function resetNotebookStorage(){
  const key=state?.roomCode ? `indizi-note-state:${state.roomCode}:${state.meIndex ?? 0}` : noteStateKey;
  const nkey=state?.roomCode ? `indizi-note-numbers:${state.roomCode}:${state.meIndex ?? 0}` : noteNumbersKey;
  noteState={}; noteNumbers={};
  if(key) localStorage.removeItem(key); if(nkey) localStorage.removeItem(nkey);
  noteStateKey=key||''; noteNumbersKey=nkey||'';
}
function noteMark(v){ return v==='x'?'X':v==='question'?'?':v==='certain'?'O':''; }
function traitBadge(card){
  if(card.type==='person') return card.trait==='Uomo'?'♂':'♀';
  if(card.type==='place') return card.trait==='Capoluogo'?'C':'NC';
  return card.trait==='Indossabile'?'I':'NI';
}
function countInput(key,label){
  const value=noteNumbers[key] ?? '';
  return `<label class="count-note-wrap" title="Numero comunicato per ${esc(label)}"><span>N°</span><input class="count-note" data-count-key="${esc(key)}" inputmode="numeric" pattern="[0-5]*" maxlength="1" min="0" max="5" value="${esc(value)}" placeholder="–" aria-label="Numero per ${esc(label)}"></label>`;
}
function rowLegend(type){
  if(type==='person') return `<strong>Personaggi</strong><span class="legend-line"><b>♂</b> Uomo ${countInput('trait:Uomo','Uomo')}</span><span class="legend-line"><b>♀</b> Donna ${countInput('trait:Donna','Donna')}</span>`;
  if(type==='place') return `<strong>Luoghi</strong><span class="legend-line"><b>C</b> Capoluogo ${countInput('trait:Capoluogo','Capoluogo')}</span><span class="legend-line"><b>NC</b> Non capoluogo ${countInput('trait:Non capoluogo','Non capoluogo')}</span>`;
  return `<strong>Oggetti</strong><span class="legend-line"><b>I</b> Si indossa ${countInput('trait:Indossabile','Indossabile')}</span><span class="legend-line"><b>NI</b> Non si indossa ${countInput('trait:Non indossabile','Non indossabile')}</span>`;
}
function notebookHtml(){
  ensureNoteNumbers();
  const rows=[['person','Personaggi'],['place','Luoghi'],['object','Oggetti']];
  const head=`<div class="sheet-corner"><div class="sheet-title">13 INDIZI</div><div class="sheet-mini">X • ? • O • NUMERI</div></div>`+
    sheetColorOrder.map(color=>`<div class="sheet-color-head" style="--team:${state.colors[color].hex}"><span>${esc(state.colors[color].label)}</span>${countInput(`color:${color}`,`colore ${state.colors[color].label}`)}</div>`).join('');
  const body=rows.map(([type])=>{
    const cells=sheetColorOrder.map(color=>{
      const c=state.cards.find(card=>card.type===type&&card.color===color);
      if(!c) return '<div class="clue-cell empty"></div>';
      const v=noteState[c.id]||'normal';
      return `<button class="clue-cell note-${v}" data-note-id="${c.id}" style="--team:${state.colors[color].hex}" aria-label="${esc(c.name)}: ${noteMark(v)||'nessun segno'}">
        <img class="clue-cell-img" src="${c.image}" alt=""><span class="clue-trait">${traitBadge(c)}</span><span class="clue-mark">${noteMark(v)}</span><span class="clue-card-name">${esc(c.name)}</span>
      </button>`;
    }).join('');
    return `<div class="sheet-row-legend">${rowLegend(type)}</div>${cells}`;
  }).join('');
  return `<div class="note-key"><span><b>X</b> Eliminata</span><span><b>?</b> Possibile</span><span><b>O</b> Sicura nelle 5 carte avversarie</span><span><b>2</b> Numero della risposta</span></div><div class="clue-sheet-scroll"><div class="clue-sheet">${head}${body}</div></div>`;
}
function attachNotebookEvents(container){
  container.querySelectorAll('.clue-cell[data-note-id]').forEach(el=>el.onclick=()=>{
    actionGesture(); sfx('note'); const id=el.dataset.noteId; const cur=noteState[id]||'normal';
    noteState[id]=cur==='normal'?'x':cur==='x'?'question':cur==='question'?'certain':'normal';
    saveNoteState(); renderNotebook();
  });
  container.querySelectorAll('.count-note[data-count-key]').forEach(input=>{
    input.onclick=e=>e.stopPropagation();
    input.oninput=()=>{
      let v=String(input.value||'').replace(/[^0-5]/g,'').slice(0,1);
      input.value=v;
      const key=input.dataset.countKey;
      if(v==='') delete noteNumbers[key]; else noteNumbers[key]=v;
      saveNoteNumbers();
    };
    input.onchange=()=>sfx('note');
  });
}
function renderNotebookInto(id){ const el=$(id); if(!el) return; el.innerHTML=notebookHtml(); attachNotebookEvents(el); }
function renderNotebook(){ ensureNoteState(); renderNotebookInto('notebook'); renderNotebookInto('callNotebook'); }
function clearNotebook(){ if(!confirm('Vuoi azzerare tutti gli appunti, compresi i numeri?')) return; noteState={}; noteNumbers={}; saveNoteState(); saveNoteNumbers(); sfx('click'); renderNotebook(); }
function applyCallMode(){
  document.body.classList.toggle('call-mode',callMode); $('callModePanel')?.classList.toggle('hidden',!callMode);
  if($('callModeBtn')) $('callModeBtn').textContent=callMode?'Modalità in chiamata attiva':'📞 Modalità in chiamata';
}

function showWinner(){
  if(lastWinnerShown===state.winner?.id) return;
  lastWinnerShown=state.winner?.id;
  const mine=state.winner?.id===state.players[state.meIndex]?.id;
  playPersonal(mine?'vittoria':'sconfitta',mine?'win':'wrong');
  showSimpleModal(mine?'Caso risolto!':'Caso risolto dall’altro detective',`<div class="winner"><div class="trophy">${mine?'🏆':'🕵️'}</div><h2>${mine?'Hai vinto!':esc(state.winner?.name||'Ha vinto')}</h2><p>${mine?'Hai trovato Personaggio, Luogo e Oggetto.':'L’altro detective ha risolto il proprio caso per primo.'}</p><button id="restartInside" class="primary">Nuova partita</button><button id="menuInside" class="ghost">Torna al menù</button></div>`);
  setTimeout(()=>{
    const b=$('restartInside'); if(b) b.onclick=()=>{closeModal();lastWinnerShown=null;socket.emit('restartGame',{},res=>{if(!res.ok)alert(res.error);else sfx('start')})};
    const m=$('menuInside'); if(m) m.onclick=()=>{closeModal();backToMenu();};
  },0);
}

function showCardModal(card,title){ showSimpleModal(title,`<div style="max-width:360px;margin:0 auto">${cardHtml(card)}</div>`); }
function showSimpleModal(title,html){ $('modalContent').innerHTML=`<div class="eyebrow">13 INDIZI</div><h2>${esc(title)}</h2>${html}`; $('modal').classList.remove('hidden'); }
function closeModal(){$('modal').classList.add('hidden')}
$('modalClose').onclick=closeModal;
$('modal').onclick=e=>{if(e.target===$('modal')) closeModal()};

$('callModeBtn').onclick=()=>{ actionGesture();sfx('click');callMode=true;applyCallMode();renderNotebook();window.scrollTo({top:0,behavior:'smooth'}); };
$('exitCallModeBtn').onclick=()=>{ callMode=false;applyCallMode();sfx('click'); };
$('resetNotesBtn').onclick=clearNotebook;
$('resetNotesCallBtn').onclick=clearNotebook;

$('rulesBtn').onclick=()=>showSimpleModal('Come si gioca',`
  <p>Questa versione è pensata per <strong>2 giocatori</strong> e usa tutte le 18 carte personalizzate.</p>
  <h3>1. Preparazione</h3>
  <ul class="rule-list"><li>Ognuno riceve 5 carte: almeno 1 Personaggio, 1 Luogo e 1 Oggetto.</li><li>Scegli 1 carta per tipo: saranno il caso segreto dell'altro giocatore.</li><li>Le 2 carte rimaste diventano le tue carte private.</li><li>Le 8 carte non distribuite diventano gli informatori A–H.</li></ul>
  <h3>2. Il tuo turno</h3>
  <ul class="rule-list"><li><strong>Interroga:</strong> chiedi quante carte di un colore o categoria vede l'altro. Nel conteggio entrano sempre le 3 carte del tuo caso e <strong>entrambe</strong> le sue carte private.</li><li><strong>Informatore:</strong> guarda in segreto una delle 8 carte centrali.</li><li><strong>Accusa:</strong> prova a indovinare Personaggio + Luogo + Oggetto del tuo caso.</li></ul>
  <h3>3. Categorie</h3>
  <p>Personaggi: Uomo / Donna. Luoghi: Capoluogo / Non capoluogo. Oggetti: Indossabile / Non indossabile. Puoi sempre chiedere anche uno dei 6 colori.</p>
  <h3>4. Modalità in chiamata</h3>
  <p>Se siete già in chiamata, attiva <strong>Modalità in chiamata</strong>: le domande le fate a voce e sullo schermo rimane il foglio degli appunti. Tocca ogni indizio per alternare X, ?, O e nessun segno. Nei riquadri <strong>N°</strong> puoi scrivere anche le risposte numeriche, per esempio 2 sui gialli oppure 1 sui capoluoghi.</p>
  <h3>5. Refresh e abbandono</h3>
  <p>Se l'interfaccia si blocca usa <strong>↻ Refresh</strong>. La sessione prova a ricollegarsi automaticamente alla stessa stanza. Se uno abbandona, l'altro vedrà una schermata dedicata con il pulsante per tornare al menù.</p>
  <h3>6. Audio</h3>
  <p>Musica e suoni si possono attivare o disattivare dalla barra in alto. Gli audio personalizzati vengono usati automaticamente quando i file sono presenti nella cartella audio del progetto.</p>
  <h3>7. Classifica e storico</h3><p>Dal menù puoi aprire la classifica delle vittorie e lo storico delle partite concluse.</p>
  <h3>8. Vittoria</h3><p>Vince chi formula per primo l'accusa corretta.</p>
`);
