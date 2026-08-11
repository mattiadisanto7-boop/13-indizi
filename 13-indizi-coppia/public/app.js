const socket = io();
let state = null;
let selectedSetup = new Set();
let questionSide = 'left';
let activeTab = 'question';
let callMode = false;
let noteState = {};
let noteStateKey = '';
const sheetColorOrder = ['purple','pink','red','green','yellow','blue'];

const $ = (id) => document.getElementById(id);
const views = ['homeView','lobbyView','setupView','gameView'];

const typeLabel = { person:'Personaggio', place:'Luogo', object:'Oggetto' };
const colorOrder = ['yellow','blue','green','red','pink','purple'];

function showView(id){ views.forEach(v => $(v).classList.toggle('active', v===id)); }
function esc(s){ return String(s).replace(/[&<>"']/g,m=>({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[m])); }
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

$('createBtn').onclick = () => {
  $('homeError').textContent='';
  socket.emit('createRoom',{name:$('nameInput').value},res=>{ if(!res.ok) $('homeError').textContent=res.error; });
};
$('joinBtn').onclick = () => {
  $('homeError').textContent='';
  socket.emit('joinRoom',{code:$('roomInput').value,name:$('nameInput').value},res=>{ if(!res.ok) $('homeError').textContent=res.error; });
};
$('roomInput').addEventListener('input',e=>e.target.value=e.target.value.toUpperCase());
$('startBtn').onclick = () => socket.emit('startGame',{},res=>{ if(!res.ok) alert(res.error); });

socket.on('state', s => {
  const prevPhase = state?.phase;
  state = s;
  if (prevPhase !== 'setup' && s.phase === 'setup') {
    selectedSetup = new Set();
    callMode = false;
    resetNotebookStorage();
  }
  ensureNoteState();
  render();
});

function render(){
  if(!state) return;
  if(state.phase==='lobby') renderLobby();
  if(state.phase==='setup') renderSetup();
  if(state.phase==='play' || state.phase==='finished') renderGame();
}

function renderLobby(){
  showView('lobbyView');
  $('roomCodeText').textContent=state.roomCode;
  $('playersLobby').innerHTML = state.players.map(p=>`<div class="player-row">🕵️ ${esc(p.name)}</div>`).join('') + (state.players.length<2?'<div class="player-row waiting">In attesa del secondo detective…</div>':'');
  $('startBtn').classList.toggle('hidden',!(state.isHost && state.players.length===2));
  $('lobbyHint').textContent = state.players.length<2 ? 'La partita partirà quando sarete in due.' : state.isHost ? 'Siete pronti. Puoi iniziare.' : 'Attendi che chi ha creato la stanza inizi la partita.';
}

function renderSetup(){
  showView('setupView');
  if(state.selectionSubmitted){
    $('setupHand').innerHTML='';
    $('selectionCounter').textContent='3 / 3';
    $('submitSelectionBtn').disabled=true;
    $('setupStatus').textContent=`Caso confermato. In attesa di: ${state.waitingFor.join(', ') || 'nessuno'}`;
    return;
  }
  $('setupStatus').textContent='';
  $('setupHand').innerHTML = state.hand.map(c=>cardHtml(c,{selectable:true,selected:selectedSetup.has(c.id)})).join('');
  $('setupHand').querySelectorAll('.card').forEach(el=>el.onclick=()=>toggleSetupCard(el.dataset.cardId));
  updateSelectionUI();
}

function toggleSetupCard(id){
  if(selectedSetup.has(id)) selectedSetup.delete(id);
  else {
    const card=state.hand.find(c=>c.id===id);
    // Solo una carta per tipo.
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
$('submitSelectionBtn').onclick=()=>socket.emit('submitSelection',{cardIds:[...selectedSetup]},res=>{if(!res.ok) alert(res.error)});

function renderGame(){
  showView('gameView');
  $('gameRoomCode').textContent=state.roomCode;
  const current=state.players.find(p=>p.id===state.currentPlayer);
  $('turnText').textContent = state.phase==='finished' ? 'Partita conclusa' : state.isMyTurn ? 'È il tuo turno' : `Turno di ${current?.name || '…'}`;
  $('playerPills').innerHTML=state.players.map(p=>`<span class="player-pill ${p.id===state.currentPlayer?'current':''}">${esc(p.name)}</span>`).join('');

  if(state.lastAction){
    $('lastActionBox').classList.remove('hidden');
    $('lastActionBox').innerHTML=`${esc(state.lastAction.text)}${state.lastAction.answer!==undefined?` <strong>Risposta: ${state.lastAction.answer}</strong>`:''}`;
  }else $('lastActionBox').classList.add('hidden');

  $('opponentMystery').innerHTML=state.opponentMysteryVisible.map(c=>cardHtml(c)).join('');
  $('privateCards').innerHTML=state.myPrivate.map((c,i)=>`<div class="private-card-wrap"><span class="side-label">${i===0?'← Sinistra':'Destra →'}</span>${cardHtml(c)}</div>`).join('');
  renderInformants();
  renderActions();
  renderNotebook();
  applyCallMode();
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
  const locked=!state.isMyTurn || state.phase!=='play';
  $('actionsLocked').classList.toggle('hidden',!locked);
  $('actionTabs').style.opacity=locked?'.45':'1';
  document.querySelectorAll('.actions-panel button,.actions-panel select').forEach(el=>{
    if(!el.classList.contains('tab')) el.disabled=locked;
  });

  const questions=[];
  colorOrder.forEach(k=>questions.push({kind:'color',value:k,label:`Colore ${state.colors[k].label}`}));
  ['Uomo','Donna','Capoluogo','Non capoluogo','Indossabile','Non indossabile'].forEach(v=>questions.push({kind:'trait',value:v,label:v}));
  $('questionSelect').innerHTML=questions.map(q=>`<option value="${q.kind}|${q.value}">${q.label}</option>`).join('');
  $('informantSelect').innerHTML=state.informants.map(i=>`<option value="${i.letter}">${i.letter}${i.seen?' — già visto':''}</option>`).join('');

  const visibleIds=new Set([
    ...state.opponentMysteryVisible.map(c=>c.id),
    ...state.myPrivate.map(c=>c.id),
    ...state.informants.filter(i=>i.seen).map(i=>i.card.id)
  ]);
  const candidates=state.cards.filter(c=>!visibleIds.has(c.id));
  fillSelect('accusePerson',candidates.filter(c=>c.type==='person'),'Personaggio…');
  fillSelect('accusePlace',candidates.filter(c=>c.type==='place'),'Luogo…');
  fillSelect('accuseObject',candidates.filter(c=>c.type==='object'),'Oggetto…');
}
function fillSelect(id,cards,placeholder){
  $(id).innerHTML=`<option value="">${placeholder}</option>`+cards.map(c=>`<option value="${c.id}">${esc(c.name)} — ${state.colors[c.color].label}</option>`).join('');
}

document.querySelectorAll('.tab').forEach(btn=>btn.onclick=()=>{
  activeTab=btn.dataset.tab;
  document.querySelectorAll('.tab').forEach(x=>x.classList.toggle('active',x.dataset.tab===activeTab));
  ['question','informant','accuse'].forEach(t=>$(t+'Tab').classList.toggle('active',t===activeTab));
});
document.querySelectorAll('.choice').forEach(btn=>btn.onclick=()=>{
  questionSide=btn.dataset.side;
  document.querySelectorAll('.choice').forEach(x=>x.classList.toggle('active',x.dataset.side===questionSide));
});
$('askBtn').onclick=()=>{
  const [kind,value]=$('questionSelect').value.split('|');
  socket.emit('askQuestion',{kind,value,side:questionSide},res=>{
    if(!res.ok) return alert(res.error);
    showSimpleModal('Risposta del testimone',`<div class="winner"><div class="trophy">🔎</div><h2>${res.answer}</h2><p>Il testimone vede <strong>${res.answer}</strong> carte corrispondenti alla tua domanda.</p></div>`);
  });
};
$('consultBtn').onclick=()=>{
  const letter=$('informantSelect').value;
  socket.emit('consultInformant',{letter},res=>{
    if(!res.ok) return alert(res.error);
    showCardModal(res.card,`Informatore ${letter}`);
  });
};
$('accuseBtn').onclick=()=>{
  const person=$('accusePerson').value,place=$('accusePlace').value,object=$('accuseObject').value;
  if(!person||!place||!object) return alert('Scegli Personaggio, Luogo e Oggetto.');
  socket.emit('accuse',{person,place,object},res=>{
    if(!res.ok) return alert(res.error);
    if(!res.correct) showSimpleModal('Accusa errata','<p>Non è la combinazione corretta. Il turno passa all’altro detective.</p>');
  });
};

function notebookStorageKey(){
  if(!state?.roomCode) return 'indizi-note-state';
  return `indizi-note-state:${state.roomCode}:${state.meIndex ?? 0}`;
}
function ensureNoteState(){
  const key=notebookStorageKey();
  if(key===noteStateKey) return;
  noteStateKey=key;
  try { noteState=JSON.parse(localStorage.getItem(key)||'{}'); }
  catch { noteState={}; }
  // Compatibilità con i vecchi appunti.
  Object.keys(noteState).forEach(id=>{
    if(noteState[id]==='excluded') noteState[id]='x';
    if(noteState[id]==='suspect') noteState[id]='question';
  });
}
function saveNoteState(){
  if(!noteStateKey) ensureNoteState();
  localStorage.setItem(noteStateKey,JSON.stringify(noteState));
}
function resetNotebookStorage(){
  const key=state?.roomCode ? `indizi-note-state:${state.roomCode}:${state.meIndex ?? 0}` : noteStateKey;
  noteState={};
  if(key) localStorage.removeItem(key);
  noteStateKey=key||'';
}
function noteMark(v){ return v==='x'?'X':v==='question'?'?':v==='certain'?'O':''; }
function traitBadge(card){
  if(card.type==='person') return card.trait==='Uomo'?'♂':'♀';
  if(card.type==='place') return card.trait==='Capoluogo'?'C':'NC';
  return card.trait==='Indossabile'?'I':'NI';
}
function rowLegend(type){
  if(type==='person') return `<strong>Personaggi</strong><span><b>♂</b> Uomo</span><span><b>♀</b> Donna</span>`;
  if(type==='place') return `<strong>Luoghi</strong><span><b>C</b> Capoluogo</span><span><b>NC</b> Non capoluogo</span>`;
  return `<strong>Oggetti</strong><span><b>I</b> Si indossa</span><span><b>NI</b> Non si indossa</span>`;
}
function notebookHtml(){
  const rows=[['person','Personaggi'],['place','Luoghi'],['object','Oggetti']];
  const head=`<div class="sheet-corner"><div class="sheet-title">13 INDIZI</div><div class="sheet-mini">X • ? • O</div></div>`+
    sheetColorOrder.map(color=>`<div class="sheet-color-head" style="--team:${state.colors[color].hex}"><span>${esc(state.colors[color].label)}</span></div>`).join('');
  const body=rows.map(([type])=>{
    const cells=sheetColorOrder.map(color=>{
      const c=state.cards.find(card=>card.type===type&&card.color===color);
      if(!c) return '<div class="clue-cell empty"></div>';
      const v=noteState[c.id]||'normal';
      return `<button class="clue-cell note-${v}" data-note-id="${c.id}" style="--team:${state.colors[color].hex}" aria-label="${esc(c.name)}: ${noteMark(v)||'nessun segno'}">
        <img class="clue-cell-img" src="${c.image}" alt="">
        <span class="clue-trait">${traitBadge(c)}</span>
        <span class="clue-mark">${noteMark(v)}</span>
        <span class="clue-card-name">${esc(c.name)}</span>
      </button>`;
    }).join('');
    return `<div class="sheet-row-legend">${rowLegend(type)}</div>${cells}`;
  }).join('');
  return `<div class="note-key"><span><b>X</b> Eliminata</span><span><b>?</b> Possibile</span><span><b>O</b> Sicura nelle 5 carte avversarie</span></div><div class="clue-sheet-scroll"><div class="clue-sheet">${head}${body}</div></div>`;
}
function attachNotebookEvents(container){
  container.querySelectorAll('.clue-cell[data-note-id]').forEach(el=>el.onclick=()=>{
    const id=el.dataset.noteId;
    const cur=noteState[id]||'normal';
    noteState[id]=cur==='normal'?'x':cur==='x'?'question':cur==='question'?'certain':'normal';
    saveNoteState();
    renderNotebook();
  });
}
function renderNotebookInto(id){
  const el=$(id); if(!el) return;
  el.innerHTML=notebookHtml();
  attachNotebookEvents(el);
}
function renderNotebook(){
  ensureNoteState();
  renderNotebookInto('notebook');
  renderNotebookInto('callNotebook');
}
function clearNotebook(){
  noteState={};
  saveNoteState();
  renderNotebook();
}
function applyCallMode(){
  document.body.classList.toggle('call-mode',callMode);
  $('callModePanel')?.classList.toggle('hidden',!callMode);
  if($('callModeBtn')) $('callModeBtn').textContent=callMode?'Modalità in chiamata attiva':'📞 Modalità in chiamata';
}

function showWinner(){
  const mine=state.winner?.id===state.players[state.meIndex]?.id;
  showSimpleModal(mine?'Caso risolto!':'Caso risolto dall’altro detective',`<div class="winner"><div class="trophy">${mine?'🏆':'🕵️'}</div><h2>${mine?'Hai vinto!':esc(state.winner?.name||'Ha vinto')}</h2><p>${mine?'Hai trovato Personaggio, Luogo e Oggetto.':'L’altro detective ha risolto il proprio caso per primo.'}</p><button id="restartInside" class="primary">Nuova partita</button></div>`);
  setTimeout(()=>{ const b=$('restartInside'); if(b) b.onclick=()=>{closeModal();socket.emit('restartGame',{},res=>{if(!res.ok)alert(res.error)})}; },0);
}

function showCardModal(card,title){
  showSimpleModal(title,`<div style="max-width:360px;margin:0 auto">${cardHtml(card)}</div>`);
}
function showSimpleModal(title,html){
  $('modalContent').innerHTML=`<div class="eyebrow">13 INDIZI</div><h2>${esc(title)}</h2>${html}`;
  $('modal').classList.remove('hidden');
}
function closeModal(){$('modal').classList.add('hidden')}
$('modalClose').onclick=closeModal;
$('modal').onclick=e=>{if(e.target===$('modal')) closeModal()};


$('callModeBtn').onclick=()=>{ callMode=true; applyCallMode(); renderNotebook(); window.scrollTo({top:0,behavior:'smooth'}); };
$('exitCallModeBtn').onclick=()=>{ callMode=false; applyCallMode(); };
$('resetNotesBtn').onclick=clearNotebook;
$('resetNotesCallBtn').onclick=clearNotebook;

$('rulesBtn').onclick=()=>showSimpleModal('Come si gioca',`
  <p>Questa versione è pensata apposta per <strong>2 giocatori</strong> e usa tutte le 18 carte personalizzate.</p>
  <h3>1. Preparazione</h3>
  <ul class="rule-list"><li>Ognuno riceve 5 carte: almeno 1 Personaggio, 1 Luogo e 1 Oggetto.</li><li>Scegli 1 carta per tipo: saranno il caso segreto dell'altro giocatore.</li><li>Le 2 carte rimaste diventano le tue carte private Sinistra e Destra.</li><li>Le 8 carte non distribuite diventano gli informatori A–H.</li></ul>
  <h3>2. Il tuo turno</h3>
  <ul class="rule-list"><li><strong>Interroga:</strong> chiedi quante carte di un colore o categoria vede l'altro, specificando se deve contare la sua carta privata Sinistra o Destra.</li><li><strong>Informatore:</strong> guarda in segreto una delle 8 carte centrali.</li><li><strong>Accusa:</strong> prova a indovinare Personaggio + Luogo + Oggetto del tuo caso.</li></ul>
  <h3>3. Categorie</h3>
  <p>Personaggi: Uomo / Donna. Luoghi: Capoluogo / Non capoluogo. Oggetti: Indossabile / Non indossabile. Puoi sempre chiedere anche uno dei 6 colori.</p>
  <h3>4. Modalità in chiamata</h3>
  <p>Se siete già in chiamata, attiva <strong>Modalità in chiamata</strong>: le domande le fate a voce e sullo schermo rimane soltanto il foglio degli appunti. Tocca ogni indizio per alternare X, ?, O e nessun segno.</p>
  <h3>5. Vittoria</h3>
  <p>Vince chi formula per primo l'accusa corretta.</p>
`);
