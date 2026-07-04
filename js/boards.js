// js/boards.js — Board-Management, Wizard, Duplizieren (lokal, kein Firebase)
import { S, getBoards, createBoard, updateBoard, deleteBoard,
  createColumn, duplicateBoardData } from './state.js';
import { weiblicheNamen } from '../Namen/weiblich.js';
import { maennlicheNamen } from '../Namen/maennlich.js';

// ── ENTER-LISTENER ───────────────────────────────────
addEnterListener('new-board-name', () => wizardNext(2));

// ── BOARD WIZARD ─────────────────────────────────────
window.showNewBoard = () => {
  document.getElementById('new-board-name').value = '';
  S.wizardMemberCount = 1;
  wizardNext(1);
  document.getElementById('modal-new-board').style.display = 'flex';
  setTimeout(() => document.getElementById('new-board-name').focus(), 100);
};

window.wizardNext = (step) => {
  if (step === 2) { const name = document.getElementById('new-board-name').value.trim(); if (!name) { document.getElementById('new-board-name').focus(); return; } }
  [1,2,3].forEach(s => {
    document.getElementById('wizard-step-'+s).style.display = s===step ? 'block' : 'none';
    const ws = document.getElementById('ws-'+s);
    ws.className = 'wizard-step' + (s < step ? ' done' : s === step ? ' active' : '');
  });
  const labels = ['Board benennen', 'Teamgröße wählen', 'Nicknames eingeben'];
  document.getElementById('wizard-label').textContent = labels[step-1];
  if (step === 2) renderMemberCountGrid();
  if (step === 3) renderNicknameInputs();
};

function renderMemberCountGrid() {
  const grid = document.getElementById('member-count-grid');
  const isCustom = S.wizardMemberCount > 10;
  grid.innerHTML = Array.from({length:10}, (_,i) => i+1).map(n => `
    <button class="member-count-btn ${!isCustom && n===S.wizardMemberCount?'selected':''}" onclick="selectMemberCount(${n})">${n}</button>
  `).join('') + `
    <div class="member-count-custom-row">
      <input type="number" id="custom-member-count" class="settings-input"
        min="11" max="40" placeholder="Anzahl eingeben (11–40)"
        value="${isCustom ? S.wizardMemberCount : ''}"
        oninput="selectMemberCountCustom(this.value)"
        style="flex:1; height:40px; font-size:14px; text-align:center;${isCustom?' border-color:var(--accent); background:rgba(77,127,255,0.1);':''}"/>
    </div>
  `;
}

window.selectMemberCount = (n) => {
  S.wizardMemberCount = n;
  const customInput = document.getElementById('custom-member-count');
  if (customInput) customInput.value = '';
  renderMemberCountGrid();
};

window.selectMemberCountCustom = (val) => {
  const n = parseInt(val);
  if (!n || n < 1) return;
  S.wizardMemberCount = Math.min(n, 40);
  document.querySelectorAll('.member-count-btn').forEach(b => b.classList.remove('selected'));
  const input = document.getElementById('custom-member-count');
  if (input) { input.style.borderColor = 'var(--accent)'; input.style.background = 'rgba(77,127,255,0.1)'; }
};

function renderNicknameInputs() {
  const container = document.getElementById('nickname-inputs');
  const wip = Math.max(2, Math.ceil(S.wizardMemberCount * 1.5));
  container.innerHTML = `
    <div style="background:rgba(77,127,255,0.1); border:1px solid rgba(77,127,255,0.2); border-radius:8px; padding:10px 14px; margin-bottom:16px; font-size:12px; color:var(--text-muted);">
      💡 WIP-Limit wird automatisch auf <strong style="color:var(--accent);">${wip}</strong> gesetzt (${S.wizardMemberCount} × 1,5)
    </div>

    <div id="name-mode-toggle" style="display:flex; gap:8px; margin-bottom:16px;">
      <button class="btn-sm btn-sm-primary" id="btn-mode-manual" onclick="setNameMode('manual')" style="flex:1;">✏️ Manuell eingeben</button>
      <button class="btn-sm btn-sm-ghost" id="btn-mode-auto" onclick="setNameMode('auto')" style="flex:1;">🎲 Zufallsnamen</button>
    </div>

    <div id="manual-name-section">
      ${Array.from({length:S.wizardMemberCount}, (_,i) => `
        <div class="nickname-input-row">
          <div class="nickname-avatar" id="nick-avatar-${i}">?</div>
          <input type="text" class="settings-input" id="nickname-${i}" placeholder="Person ${i+1}" oninput="updateNickAvatar(${i})" style="flex:1;"/>
        </div>
      `).join('')}
    </div>

    <div id="auto-name-section" style="display:none;">
      <div style="display:flex; gap:10px; align-items:center; margin-bottom:12px;">
        <div style="flex:1;">
          <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">♀ Weiblich</label>
          <input type="number" id="auto-count-w" class="settings-input" min="0" max="${S.wizardMemberCount}" value="${Math.ceil(S.wizardMemberCount/2)}" oninput="syncAutoCount('w')" style="width:100%; text-align:center; height:40px; font-size:16px;"/>
        </div>
        <div style="flex:1;">
          <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:4px;">♂ Männlich</label>
          <input type="number" id="auto-count-m" class="settings-input" min="0" max="${S.wizardMemberCount}" value="${Math.floor(S.wizardMemberCount/2)}" oninput="syncAutoCount('m')" style="width:100%; text-align:center; height:40px; font-size:16px;"/>
        </div>
      </div>
      <div id="auto-count-error" style="display:none; color:#ef4444; font-size:12px; margin-bottom:8px;"></div>
      <button class="btn-sm btn-sm-primary" onclick="generateRandomNames()" style="width:100%; margin-bottom:14px;">🎲 Namen würfeln</button>
      <div id="auto-name-preview"></div>
    </div>
  `;
}

// ── NAMENS-MODUS UMSCHALTEN ──────────────────────────
window.setNameMode = function(mode) {
  const btnManual = document.getElementById('btn-mode-manual');
  const btnAuto   = document.getElementById('btn-mode-auto');
  const secManual = document.getElementById('manual-name-section');
  const secAuto   = document.getElementById('auto-name-section');
  if (mode === 'manual') {
    btnManual.className = 'btn-sm btn-sm-primary';
    btnAuto.className   = 'btn-sm btn-sm-ghost';
    secManual.style.display = 'block';
    secAuto.style.display   = 'none';
  } else {
    btnManual.className = 'btn-sm btn-sm-ghost';
    btnAuto.className   = 'btn-sm btn-sm-primary';
    secManual.style.display = 'none';
    secAuto.style.display   = 'block';
  }
  S.wizardNameMode = mode;
};

// ── W/M-ZÄHLER SYNCHRONISIEREN ───────────────────────
window.syncAutoCount = function(changed) {
  const total  = S.wizardMemberCount;
  const wInput = document.getElementById('auto-count-w');
  const mInput = document.getElementById('auto-count-m');
  const errEl  = document.getElementById('auto-count-error');
  let w = parseInt(wInput.value) || 0;
  let m = parseInt(mInput.value) || 0;
  if (changed === 'w') { m = total - w; mInput.value = Math.max(0, m); }
  else                 { w = total - m; wInput.value = Math.max(0, w); }
  if (w + m !== total || w < 0 || m < 0) {
    errEl.textContent = `Summe muss ${total} ergeben (aktuell: ${w + m})`;
    errEl.style.display = 'block';
  } else {
    errEl.style.display = 'none';
  }
};

// ── ZUFALLSNAMEN GENERIEREN ──────────────────────────
function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

window.generateRandomNames = function() {
  const total  = S.wizardMemberCount;
  const w      = parseInt(document.getElementById('auto-count-w').value) || 0;
  const m      = parseInt(document.getElementById('auto-count-m').value) || 0;
  const errEl  = document.getElementById('auto-count-error');
  if (w + m !== total) {
    errEl.textContent = `Summe muss ${total} ergeben (aktuell: ${w + m})`;
    errEl.style.display = 'block';
    return;
  }
  errEl.style.display = 'none';
  const wNames   = shuffleArray(weiblicheNamen).slice(0, w);
  const mNames   = shuffleArray(maennlicheNamen).slice(0, m);
  const allNames = shuffleArray([...wNames, ...mNames]);
  S.wizardAutoNames = allNames;
  const preview = document.getElementById('auto-name-preview');
  preview.innerHTML = allNames.map(name => `
    <div class="nickname-input-row">
      <div class="nickname-avatar">${name.slice(0,2).toUpperCase()}</div>
      <span style="flex:1; font-size:13px; color:var(--text);">${name}</span>
    </div>
  `).join('');
};

window.updateNickAvatar = (i) => {
  const val = document.getElementById('nickname-'+i).value.trim();
  document.getElementById('nick-avatar-'+i).textContent = val ? val.slice(0,2).toUpperCase() : '?';
};

// ── BOARDS LADEN ─────────────────────────────────────
window.loadBoards = function(autoSelect = true) {
  document.getElementById('netzplan-overlay')?.remove();
  if (typeof window.resetUBahnStateForBoardChange === 'function') window.resetUBahnStateForBoardChange();

  S.boards = getBoards();
  renderBoardsList();
  if (S.currentBoard && !S.boards.find(b => b.id === S.currentBoard.id)) S.currentBoard = null;
  if (S.boards.length > 0) {
    if (!S.currentBoard) {
      if (autoSelect) selectBoard(S.boards[0].id);
      else showEmptyState();
    }
  } else {
    S.currentBoard = null;
    showEmptyState();
  }
};

window.showEmptyState = function() {
  S.columns = [];
  S.cards = {};
  S.cardsBoardId = null;
  const emptyState = document.getElementById('empty-state');
  if (emptyState) emptyState.style.display = 'flex';
  const boardContent = document.getElementById('board-content');
  if (boardContent) boardContent.style.display = 'none';
  const titleDisplay = document.getElementById('board-title-display');
  if (titleDisplay) titleDisplay.innerHTML = 'Willkommen bei EDUBAN';
  if (typeof updateReflectionButton === 'function') updateReflectionButton();
};

window.renderBoardsList = function() {
  const list = document.getElementById('boards-list');
  list.innerHTML = S.boards.map(b => {
    const boardArg = typeof safeJsArg === 'function'
      ? safeJsArg(b.id)
      : escHtml(JSON.stringify(String(b.id ?? '')));
    return `
    <div class="board-item ${S.currentBoard?.id===b.id?'active':''}" onclick="selectBoard(${boardArg})">
      <div class="board-item-left">
        <div class="board-dot"></div>
        <span class="board-name">${escHtml(b.name)}</span>
      </div>
      <button class="board-delete-btn" onclick="event.stopPropagation(); duplicateBoardLocal(${boardArg})" title="Board duplizieren" style="margin-right:2px;">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg>
      </button>
      <button class="board-delete-btn" onclick="event.stopPropagation(); deleteBoardLocal(${boardArg})" title="Board löschen">
        <svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="M18 6 6 18"/><path d="m6 6 12 12"/></svg>
      </button>
    </div>
  `;
  }).join('');
};

// ── BOARD ERSTELLEN ──────────────────────────────────
window.createBoard = function() {
  const name = document.getElementById('new-board-name').value.trim();
  if (!name) return;
  let members = [];
  if (S.wizardNameMode === 'auto' && S.wizardAutoNames && S.wizardAutoNames.length > 0) {
    members = [...S.wizardAutoNames];
  } else {
    for (let i = 0; i < S.wizardMemberCount; i++) {
      const nick = document.getElementById('nickname-'+i)?.value.trim() || `Person ${i+1}`;
      members.push(nick);
    }
  }
  const wipLimit = Math.max(2, Math.ceil(S.wizardMemberCount * 1.5));
  closeModal('modal-new-board');
  S.wizardAutoNames = null;
  S.wizardNameMode  = 'manual';

  const board = createBoard({
    name,
    members,
    wipLimit,
    ownerName: S.currentUser?.displayName || '',
    groupId:   S.currentUser?.groupId || '',
    groupInfos: {},
  });

  // Standard-Spalten
  const defaults = [
    { name:'— Offen',        color:'#5c6ef8', order:0, wipLimit:0 },
    { name:'— In Bearbeitung',color:'#f59e0b', order:1, wipLimit:wipLimit },
    { name:'— Fertig',       color:'#10b981', order:2, wipLimit:0 },
  ];
  for (const col of defaults) createColumn(board.id, col);

  // Board-Liste neu laden und auswählen
  S.boards = getBoards();
  renderBoardsList();
  selectBoard(board.id);
  showToast(`Board erstellt! WIP-Limit: ${wipLimit}`);
};

// ── BOARD DUPLIZIEREN ────────────────────────────────
window.duplicateBoardLocal = async (boardId) => {
  const src = S.boards.find(b => b.id === boardId);
  if (!src) return;
  showToast('Board wird dupliziert...');
  const newBoard = duplicateBoardData(boardId);
  S.boards = getBoards();
  renderBoardsList();
  if (newBoard) selectBoard(newBoard.id);
  showToast('Board dupliziert!');
};

// ── BOARD LÖSCHEN ────────────────────────────────────
window.deleteBoardLocal = async (boardId) => {
  if (window.isStudentMode && window.isStudentMode()) {
    await window.explainTutorOnly('Du kannst als Schülerin oder Schüler kein komplettes Board löschen.');
    return;
  }
  if (!await showConfirm('Board wirklich löschen? Alle Karten gehen verloren.', 'Löschen', 'Abbrechen')) return;
  deleteBoard(boardId);
  S.boards = getBoards();
  if (S.currentBoard?.id === boardId) {
    S.currentBoard = null;
    if (S.boards.length > 0) selectBoard(S.boards[0].id);
    else showEmptyState();
  }
  renderBoardsList();
  showToast('Board gelöscht');
};

// ── BOARD AUSWÄHLEN ──────────────────────────────────
window.selectBoard = (boardId) => {
  document.getElementById('netzplan-overlay')?.remove();
  if (typeof window.resetUBahnStateForBoardChange === 'function') window.resetUBahnStateForBoardChange();

  S.currentBoard = S.boards.find(b => b.id === boardId) || null;
  if (!S.currentBoard) return;
  if (!S.currentBoard.groupInfos || typeof S.currentBoard.groupInfos !== 'object' || Array.isArray(S.currentBoard.groupInfos)) {
    S.currentBoard.groupInfos = {};
    updateBoard(S.currentBoard.id, { groupInfos: S.currentBoard.groupInfos });
  }
  renderBoardsList();
  loadColumns();
  if (typeof loadIdeas === 'function') loadIdeas();
  if (typeof renderMilestones === 'function') renderMilestones();
  document.getElementById('empty-state').style.display = 'none';
  const boardContent = document.getElementById('board-content');
  boardContent.style.display = 'block';
  boardContent.classList.remove('board-enter-anim');
  void boardContent.offsetWidth;
  boardContent.classList.add('board-enter-anim');
  document.getElementById('board-title-display').innerHTML = escHtml(S.currentBoard.name) + ' <i data-lucide="edit-2" class="title-edit-icon"></i>';
  setTimeout(reloadIcons, 50);
  if (typeof updateAgingPauseButton === 'function') updateAgingPauseButton();
  if (typeof updateReflectionButton === 'function') updateReflectionButton();
  S.undoStack = [];
  if (typeof updateUndoButton === 'function') updateUndoButton();
};

window.editBoardName = () => {
  if (typeof openBoardMetaModal === 'function') openBoardMetaModal(S.currentBoard.id, S.currentBoard.name, S.currentBoard.groupId || '');
};

// ── AGING PAUSE ──────────────────────────────────────
window.updateAgingPauseButton = function() {
  const btn  = document.getElementById('btn-aging-pause');
  const icon = document.getElementById('aging-pause-icon');
  if (!btn || !icon) return;
  const paused = !!S.currentBoard?.agingPaused;
  if (paused) { btn.classList.add('aging-paused'); btn.title = 'Aging ist pausiert'; }
  else        { btn.classList.remove('aging-paused'); btn.title = 'Aging läuft'; }
};

window.toggleAgingPause = async () => {
  if (!S.currentBoard) return;
  if (window.isStudentMode && window.isStudentMode()) {
    await window.explainTutorOnly('Du kannst als Schülerin oder Schüler die Aging-Pause nicht ein- oder ausschalten.');
    return;
  }
  const isPaused = !!S.currentBoard.agingPaused;
  if (!isPaused) {
    const fields = { agingPaused: true, agingPausedAt: new Date().toISOString() };
    updateBoard(S.currentBoard.id, fields);
    Object.assign(S.currentBoard, fields);
    showToast('⏸ Aging pausiert');
  } else {
    const pausedAt      = S.currentBoard.agingPausedAt;
    const pausedDuration = pausedAt ? (Date.now() - new Date(pausedAt).getTime()) : 0;
    const newTotal       = (S.currentBoard.totalPausedMs || 0) + pausedDuration;
    const fields = { agingPaused: false, agingPausedAt: '', totalPausedMs: newTotal };
    updateBoard(S.currentBoard.id, fields);
    Object.assign(S.currentBoard, fields);
    showToast('▶ Aging läuft wieder');
  }
  updateAgingPauseButton();
  S.columns.forEach(col => { if (typeof renderCards === 'function') renderCards(col.id); });
};
