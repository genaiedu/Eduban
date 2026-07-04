// js/columns.js — Spalten-Management, Rendering (lokal, kein Firebase)
import { S, getColumns, createColumn, deleteColumn } from './state.js';

// ── 1. SPALTEN LADEN ─────────────────────────────────
window.loadColumns = function() {
  if (!S.unsubCards) S.unsubCards = {};
  if (!S.columns)    S.columns    = [];
  if (!S.currentBoard?.id) {
    S.columns = [];
    S.cards = {};
    S.cardsBoardId = null;
    if (typeof window.renderColumns === 'function') window.renderColumns();
    return;
  }

  S.cards = {};
  S.cardsBoardId = S.currentBoard.id;
  S.columns = getColumns(S.currentBoard.id);
  if (window.knownColumnBoardId !== S.currentBoard.id) {
    window.knownColumnIds = new Set(S.columns.map(c => c.id));
    window.knownColumnBoardId = S.currentBoard.id;
  }
  if (typeof window.renderColumns === 'function') window.renderColumns();
  S.columns.forEach(col => {
    if (typeof window.loadCards === 'function') window.loadCards(col.id);
  });
};

// ── 2. SPALTEN ZEICHNEN ──────────────────────────────
window.renderColumns = function() {
  const container = document.getElementById('columns-container');
  if (!container) return;

  if (!window.knownColumnIds) {
    window.knownColumnIds = new Set(S.columns.map(c => c.id));
  }

  setTimeout(reloadIcons, 50);

  container.innerHTML = S.columns.map(col => {
    const wip        = window.getWipStatus(col);
    const isFinished = window.isFinishedColumn(col);

    const wipLabel = (!isFinished && col.wipLimit)
      ? `<span class="wip-badge ${wip.cls}">${wip.badge}</span>`
      : '';

    const isNew    = !window.knownColumnIds.has(col.id);
    if (isNew) window.knownColumnIds.add(col.id);
    const animClass = isNew ? 'column-animate-drop' : '';

    return `
    <div class="column ${isFinished ? 'column-finished' : ''} ${wip.colCls} ${animClass}" id="col-${col.id}">
      <div class="column-header">
        <div class="column-title-row">
          <div class="column-dot" style="background:${col.color || 'var(--accent)'}"></div>
          <span class="column-title">${typeof escHtml === 'function' ? escHtml(col.name) : col.name}</span>
          <span class="column-count" id="count-${col.id}">0</span>
          ${wipLabel}
        </div>
        <div class="column-actions">
          <button class="col-btn" onclick="window.deleteColumnLocal('${col.id}')" title="Spalte löschen">
            <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="M3 6h18"/><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"/><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"/></svg>
          </button>
        </div>
      </div>

      <div class="cards-list" id="cards-${col.id}"
           ondragover="window.onDragOver(event,'${col.id}')"
           ondragleave="window.onDragLeave(event,'${col.id}')"
           ondrop="window.onDrop(event,'${col.id}')">
      </div>

      ${!isFinished ? `
      <button class="btn-show-add" onclick="window.showAddCard('${col.id}')">
        <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none"><path d="M5 12h14"/><path d="M12 5v14"/></svg> Karte hinzufügen
      </button>
      ` : ''}

      <div class="add-card-form" id="add-form-${col.id}" style="display:none;">
        <textarea class="add-card-textarea" id="card-text-${col.id}" placeholder="Aufgabe beschreiben…" rows="3"></textarea>
        <div class="add-card-controls" style="display: flex; gap: 4px; align-items: center;">
          <select class="priority-select" id="card-prio-${col.id}" style="width: 75px; flex-shrink: 0; padding: 0 4px; font-size: 11px; height: 32px;">
            <option value="">Prio</option>
            <option value="hoch">Hoch</option>
            <option value="mittel">Mittel</option>
            <option value="niedrig">Niedrig</option>
          </select>
          <button class="btn-add-card" onclick="window.addCard('${col.id}')" style="flex: 1; padding: 6px 2px; white-space: nowrap; justify-content: center; height: 32px;">Hinzufügen</button>
          <button class="btn-cancel-card" onclick="window.hideAddCard('${col.id}')" style="flex: 1; padding: 6px 2px; white-space: nowrap; justify-content: center; height: 32px;">Abbrechen</button>
        </div>
      </div>
    </div>
  `; }).join('') + `
    <button class="add-column-btn" onclick="window.handleAddColumnClick()">
      <svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none;"><path d="M5 12h14"/><path d="M12 5v14"/></svg>
      <span>Spalte hinzufügen</span>
    </button>
  `;
};

// ── 3. KLICK AUF "SPALTE HINZUFÜGEN" ────────────────
window.handleAddColumnClick = async () => {
  const hasVoraussetzungen = S.columns.some(c => c.name.toLowerCase().includes('voraussetzung'));

  if (!hasVoraussetzungen) {
    const makeVor = await showConfirm(
      'Möchtest du eine spezielle "Voraussetzungen"-Spalte anlegen?',
      'Ja, Voraussetzungen',
      'Nein, normale Spalte'
    );
    if (makeVor) {
      const minOrder = S.columns.length > 0 ? Math.min(...S.columns.map(c => c.order || 0)) : 0;
      createColumn(S.currentBoard.id, { name: 'Voraussetzungen', color: '#5c6ef8', order: minOrder - 1, wipLimit: 0 });
      loadColumns();
      showToast('Voraussetzungen-Spalte hinzugefügt!');
      return;
    }
  }

  const modal = document.getElementById('modal-new-column');
  if (modal) {
    modal.style.display = 'flex';
    const input = document.getElementById('new-column-name');
    if (input) { input.value = ''; setTimeout(() => input.focus(), 100); }
  }
};

// ── 4. NORMALE SPALTE SPEICHERN ──────────────────────
window.createColumn = function() {
  const input = document.getElementById('new-column-name');
  if (!input) return;
  const name = input.value.trim();
  if (!name) return;

  const minOrder = S.columns.length > 0 ? Math.min(...S.columns.map(c => c.order || 0)) : 0;
  const maxOrder = S.columns.length > 0 ? Math.max(...S.columns.map(c => c.order || 0)) : 0;
  const finalOrder = name.toLowerCase().includes('voraussetzung') ? minOrder - 1 : maxOrder + 1;

  createColumn(S.currentBoard.id, { name, color: '#5c6ef8', order: finalOrder, wipLimit: 0 });
  input.value = '';
  loadColumns();
  showToast('Spalte hinzugefügt!');
  closeModal('modal-new-column');
};

// ── 5. HILFSFUNKTIONEN ───────────────────────────────
window.isFinishedColumn = function(col) {
  const name = (col.name||'').toLowerCase();
  return name.includes('fertig') || name.includes('done') || name.includes('erledigt') || name.includes('abgeschlossen');
};

window.getWipStatus = function(col) {
  const limit = col.wipLimit || 0;
  const count = (S.cards && S.cards[col.id]) ? S.cards[col.id].length : 0;
  if (!limit || window.isFinishedColumn(col)) return { cls:'wip-ok', badge:'', colCls:'' };
  if (count >= limit) return { cls:'wip-exceed', badge:`${count}/${limit}`, colCls:'wip-exceeded' };
  if (count >= Math.max(1, limit - 1)) return { cls:'wip-warn', badge:`${count}/${limit}`, colCls:'wip-warning' };
  return { cls:'wip-ok', badge:`${count}/${limit}`, colCls:'' };
};

// ── 6. SPALTE LÖSCHEN ────────────────────────────────
window.deleteColumnLocal = async (colId) => {
  if (window.isStudentMode && window.isStudentMode()) {
    await window.explainTutorOnly('Du kannst als Schülerin oder Schüler keine komplette Spalte löschen.');
    return;
  }
  const confirmed = await showConfirm('Spalte und alle Karten darin wirklich löschen?', 'Löschen', 'Abbrechen');
  if (!confirmed) return;
  deleteColumn(S.currentBoard.id, colId);
  loadColumns();
  showToast('Spalte gelöscht');
};

setTimeout(() => {
  const colInput = document.getElementById('new-column-name');
  if (colInput) colInput.addEventListener('keydown', e => { if (e.key === 'Enter') window.createColumn(); });
}, 1000);
