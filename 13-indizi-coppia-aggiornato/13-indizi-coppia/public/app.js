const socket = io();
let state = null;
let selectedSetup = new Set();
let questionSide = 'left';
let activeTab = 'question';
const noteState = JSON.parse(localStorage.getItem('indizi-note-state') || '{}');

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
  if (prevPhase !== 'setup' && s.phase === 'setup') selectedSetup = new Set();
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
  ['Uomo','Donna','Capoluogo','Non capoluogo','Con scritta','Senza scritta'].forEach(v=>questions.push({kind:'trait',value:v,label:v}));
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

function renderNotebook(){
  // Le carte che il giocatore vede sono certamente escluse dal proprio caso.
  const autoExcluded = new Set([
    ...state.opponentMysteryVisible.map(c=>c.id),
    ...state.myPrivate.map(c=>c.id),
    ...state.informants.filter(i=>i.seen).map(i=>i.card.id)
  ]);
  const groups=[['person','Personaggi'],['place','Luoghi'],['object','Oggetti']];
  $('notebook').innerHTML=groups.map(([type,label])=>`<div class="note-group"><h4>${label}</h4><div class="note-items">${state.cards.filter(c=>c.type===type).map(c=>{
    const auto=autoExcluded.has(c.id);
    const v=auto?'excluded':(noteState[c.id]||'normal');
    return `<div class="note-item ${v==='excluded'?'excluded':''} ${v==='suspect'?'suspect':''}" data-note-id="${c.id}" data-auto="${auto?'1':'0'}"><i class="color-dot" style="background:${state.colors[c.color].hex}"></i>${esc(c.name)}${auto?' ✓':''}</div>`;
  }).join('')}</div></div>`).join('');
  $('notebook').querySelectorAll('.note-item').forEach(el=>el.onclick=()=>{
    if(el.dataset.auto==='1') return;
    const id=el.dataset.noteId; const cur=noteState[id]||'normal';
    noteState[id]=cur==='normal'?'excluded':cur==='excluded'?'suspect':'normal';
    localStorage.setItem('indizi-note-state',JSON.stringify(noteState)); renderNotebook();
  });
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

$('rulesBtn').onclick=()=>showSimpleModal('Come si gioca',`
  <p>Questa versione è pensata apposta per <strong>2 giocatori</strong> e usa tutte le 18 carte personalizzate.</p>
  <h3>1. Preparazione</h3>
  <ul class="rule-list"><li>Ognuno riceve 5 carte: almeno 1 Personaggio, 1 Luogo e 1 Oggetto.</li><li>Scegli 1 carta per tipo: saranno il caso segreto dell'altro giocatore.</li><li>Le 2 carte rimaste diventano le tue carte private Sinistra e Destra.</li><li>Le 8 carte non distribuite diventano gli informatori A–H.</li></ul>
  <h3>2. Il tuo turno</h3>
  <ul class="rule-list"><li><strong>Interroga:</strong> chiedi quante carte di un colore o categoria vede l'altro, specificando se deve contare la sua carta privata Sinistra o Destra.</li><li><strong>Informatore:</strong> guarda in segreto una delle 8 carte centrali.</li><li><strong>Accusa:</strong> prova a indovinare Personaggio + Luogo + Oggetto del tuo caso.</li></ul>
  <h3>3. Categorie</h3>
  <p>Personaggi: Uomo / Donna. Luoghi: Capoluogo / Non capoluogo. Oggetti: Con scritta / Senza scritta. Puoi sempre chiedere anche uno dei 6 colori.</p>
  <h3>4. Vittoria</h3>
  <p>Vince chi formula per primo l'accusa corretta.</p>
`);
