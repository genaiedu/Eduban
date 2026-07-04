// js/ideas.js — Ideenbox pro Board
import {
  S, getBoards, getColumns, createColumn, createCard, updateBoard,
  getIdeaCards, createIdeaCard, updateIdeaCard, deleteIdeaCard,
} from './state.js';

function getSafeHtml() {
  return (typeof window.escHtml === 'function')
    ? window.escHtml
    : (text => String(text || '').replace(/[&<>"']/g, m => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;' }[m])));
}

function getIdeaFormValues(prefix) {
  const d = parseInt(document.getElementById(prefix + '-time-d')?.value || 0, 10) || 0;
  const h = parseInt(document.getElementById(prefix + '-time-h')?.value || 0, 10) || 0;
  const m = parseInt(document.getElementById(prefix + '-time-m')?.value || 0, 10) || 0;
  return {
    text: document.getElementById(prefix + '-text')?.value.trim() || '',
    description: document.getElementById(prefix + '-description')?.value.trim() || '',
    priority: document.getElementById(prefix + '-priority')?.value || '',
    due: document.getElementById(prefix + '-due')?.value || '',
    assignee: document.getElementById(prefix + '-assignee')?.value || '',
    timeEstimate: { d, h, m },
    dependencies: [],
    comments: [],
  };
}

function fillAssigneeSelect(id, selected = '') {
  const select = document.getElementById(id);
  if (!select) return;
  const esc = getSafeHtml();
  const members = S.currentBoard?.members || [];
  select.innerHTML = '<option value="">- Niemand -</option>' +
    members.map(m => `<option value="${esc(m)}" ${m === selected ? 'selected' : ''}>${esc(m)}</option>`).join('');
}

function updateIdeaBadge() {
  const badge = document.getElementById('idea-count-badge');
  if (!badge) return;
  const count = S.ideas?.length || 0;
  badge.textContent = count;
  badge.style.display = count ? 'inline-flex' : 'none';
}

function findOrCreateOpenColumn() {
  let columns = getColumns(S.currentBoard.id);
  let target = columns.find(c => {
    const name = (c.name || '').toLowerCase();
    return name.includes('offen') || name.includes('todo') || name.includes('to do');
  });
  if (target) return target;

  const prerequisiteCol = columns.find(c => (c.name || '').toLowerCase().includes('voraussetzung'));
  const order = prerequisiteCol ? (prerequisiteCol.order || 0) + 0.5 : 0;
  target = createColumn(S.currentBoard.id, {
    name: 'Offen',
    color: '#5c6ef8',
    order,
    wipLimit: 0,
  });
  return target;
}

window.loadIdeas = function() {
  if (!S.currentBoard) return;
  S.ideas = getIdeaCards(S.currentBoard.id);
  updateIdeaBadge();
  if (document.getElementById('modal-ideas')?.style.display === 'flex') {
    window.renderIdeas();
  }
};

window.openIdeas = function() {
  if (!S.currentBoard) {
    showToast('Bitte zuerst ein Board auswählen.', 'error');
    return;
  }
  S.ideas = getIdeaCards(S.currentBoard.id);
  fillAssigneeSelect('new-idea-assignee');
  document.getElementById('modal-ideas').style.display = 'flex';
  window.renderIdeas();
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
};

window.renderIdeas = function() {
  const list = document.getElementById('ideas-list');
  if (!list) return;
  const esc = getSafeHtml();
  const ideas = S.ideas || [];
  updateIdeaBadge();

  if (!ideas.length) {
    list.innerHTML = '<div class="ideas-empty">Noch keine Ideen. Lege links eine Karte an oder sammle hier Aufgaben, bevor sie aufs Board gehen.</div>';
    return;
  }

  let lastCategory = null;
  list.innerHTML = ideas.map(card => {
    const category = card.templateCategory || 'Eigene Ideen';
    const heading = category !== lastCategory
      ? `<div class="idea-category-heading">${esc(category)}</div>`
      : '';
    lastCategory = category;
    const time = card.timeEstimate || {};
    const timeParts = [];
    if (time.d) timeParts.push(`${time.d}T`);
    if (time.h) timeParts.push(`${time.h}h`);
    if (time.m) timeParts.push(`${time.m}m`);
    const meta = [
      card.assignee ? esc(card.assignee) : '',
      card.due ? `faellig ${esc(card.due)}` : '',
      timeParts.length ? timeParts.join(' ') : '',
    ].filter(Boolean).join(' · ');
    const priorityKey = ['hoch', 'mittel', 'niedrig'].includes(String(card.priority || '').toLowerCase())
      ? String(card.priority).toLowerCase()
      : '';
    return `
      ${heading}
      <div class="idea-card" id="idea-${card.id}">
        <div class="idea-card-main">
          <div class="idea-card-title-row">
            <span class="idea-card-title">${esc(card.text)}</span>
            ${priorityKey ? `<span class="card-priority priority-${priorityKey}">${esc(priorityKey.toUpperCase())}</span>` : ''}
          </div>
          ${card.description ? `<div class="idea-card-description">${esc(card.description)}</div>` : ''}
          ${meta ? `<div class="idea-card-meta">${meta}</div>` : ''}
        </div>
        <div class="idea-card-actions">
          <button class="card-btn" onclick="window.openEditIdea('${card.id}')" title="Idee bearbeiten"><i data-lucide="edit-2" style="width:13px;height:13px;"></i></button>
          <button class="card-btn" onclick="window.openCopyIdeaToBoardDialog('${card.id}')" title="In Ideenbox kopieren"><i data-lucide="copy-plus" style="width:14px;height:14px;"></i></button>
          <button class="card-btn idea-push-btn" onclick="window.pushIdeaToPreparation('${card.id}')" title="Nach Offen schieben"><i data-lucide="send-horizontal" style="width:14px;height:14px;"></i></button>
          <button class="card-btn delete" onclick="window.deleteIdea('${card.id}')" title="Idee löschen"><i data-lucide="trash-2" style="width:14px;height:14px;"></i></button>
        </div>
      </div>
    `;
  }).join('');
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
};

window.addIdea = function() {
  if (!S.currentBoard) return;
  const fields = getIdeaFormValues('new-idea');
  if (!fields.text) {
    document.getElementById('new-idea-text')?.focus();
    return;
  }
  createIdeaCard(S.currentBoard.id, fields);
  ['text', 'description', 'due', 'time-d', 'time-h', 'time-m'].forEach(suffix => {
    const el = document.getElementById('new-idea-' + suffix);
    if (el) el.value = '';
  });
  const prio = document.getElementById('new-idea-priority');
  if (prio) prio.value = '';
  const assignee = document.getElementById('new-idea-assignee');
  if (assignee) assignee.value = '';
  window.loadIdeas();
  showToast('Idee gespeichert!');
};

window.openEditIdea = function(cardId) {
  const card = (S.ideas || []).find(c => c.id === cardId);
  if (!card) return;
  document.getElementById('edit-idea-id').value = card.id;
  document.getElementById('edit-idea-text').value = card.text || '';
  document.getElementById('edit-idea-description').value = card.description || '';
  document.getElementById('edit-idea-priority').value = card.priority || '';
  document.getElementById('edit-idea-due').value = card.due || '';
  document.getElementById('edit-idea-time-d').value = card.timeEstimate?.d || '';
  document.getElementById('edit-idea-time-h').value = card.timeEstimate?.h || '';
  document.getElementById('edit-idea-time-m').value = card.timeEstimate?.m || '';
  fillAssigneeSelect('edit-idea-assignee', card.assignee || '');
  document.getElementById('modal-edit-idea').style.display = 'flex';
};

window.saveEditIdea = function() {
  const cardId = document.getElementById('edit-idea-id').value;
  const fields = getIdeaFormValues('edit-idea');
  if (!fields.text) return;
  updateIdeaCard(S.currentBoard.id, cardId, fields);
  window.loadIdeas();
  closeModal('modal-edit-idea');
  showToast('Idee gespeichert!');
};

window.deleteIdea = async function(cardId) {
  if (!await showConfirm('Diese Idee wirklich löschen?', 'Löschen', 'Abbrechen')) return;
  deleteIdeaCard(S.currentBoard.id, cardId);
  window.loadIdeas();
  showToast('Idee gelöscht');
};

window.openCopyIdeaToBoardDialog = function(cardId) {
  const idea = (S.ideas || []).find(c => c.id === cardId);
  if (!idea || !S.currentBoard) return;

  S.boards = getBoards();
  const targetBoards = S.boards || [];
  if (!targetBoards.length) {
    showToast('Es ist kein geöffnetes Board vorhanden.', 'error');
    return;
  }

  document.getElementById('modal-copy-card-board')?.remove();
  const esc = getSafeHtml();
  const overlay = document.createElement('div');
  overlay.id = 'modal-copy-card-board';
  overlay.className = 'modal-overlay';
  overlay.style.display = 'flex';
  overlay.onclick = () => overlay.remove();

  const boardButtons = targetBoards.map(board => `
    <button class="copy-board-option" onclick="event.stopPropagation(); window.copyIdeaToBoardIdeas('${cardId}', '${board.id}')">
      <span class="copy-board-dot"></span>
      <span>
        <strong>${esc(board.name || 'Unbenanntes Board')}</strong>
        <small>${Array.isArray(board.members) && board.members.length ? esc(board.members.join(', ')) : 'Keine Teammitglieder eingetragen'}</small>
      </span>
    </button>
  `).join('');

  overlay.innerHTML = `
    <div class="modal copy-board-modal" onclick="event.stopPropagation()">
      <div class="modal-title">Idee in Ideenstack kopieren</div>
      <p class="copy-board-intro">
        Die Idee bleibt hier erhalten und wird zusätzlich im Ideenstack des Zielboards abgelegt.
      </p>
      <div class="copy-card-preview">
        <strong>${esc(idea.text || 'Ohne Titel')}</strong>
        ${idea.description ? `<span>${esc(idea.description)}</span>` : ''}
      </div>
      <div class="copy-board-list">${boardButtons}</div>
      <div class="modal-actions">
        <button class="btn-sm btn-sm-ghost" onclick="document.getElementById('modal-copy-card-board')?.remove()">Abbrechen</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);
  if (typeof reloadIcons === 'function') reloadIcons();
};

window.copyIdeaToBoardIdeas = function(cardId, targetBoardId) {
  const idea = (S.ideas || []).find(c => c.id === cardId);
  const targetBoard = (getBoards() || []).find(board => board.id === targetBoardId);
  if (!idea || !targetBoard) {
    showToast('Zielboard konnte nicht gefunden werden.', 'error');
    return;
  }

  const targetMembers = Array.isArray(targetBoard.members) ? targetBoard.members : [];
  const assignee = targetMembers.includes(idea.assignee) ? idea.assignee : '';
  createIdeaCard(targetBoardId, {
    text: idea.text || 'Ohne Titel',
    priority: idea.priority || '',
    assignee,
    due: idea.due || '',
    description: idea.description || '',
    result: idea.result || '',
    timeEstimate: idea.timeEstimate || { d: 0, h: 0, m: 0 },
    templateCategory: idea.templateCategory || `Aus Board: ${S.currentBoard?.name || 'Unbenanntes Board'}`,
    label: '',
    dependencies: [],
    groupId: '',
    comments: [],
  });

  document.getElementById('modal-copy-card-board')?.remove();
  showToast(`Idee in die Ideenbox von „${targetBoard.name || 'Board'}“ kopiert`);
};

window.pushIdeaToPreparation = function(cardId) {
  if (!S.currentBoard) return;
  const idea = (S.ideas || []).find(c => c.id === cardId);
  if (!idea) return;

  const target = findOrCreateOpenColumn();
  if (!target) {
    showToast('Zielspalte konnte nicht erstellt werden.', 'error');
    return;
  }

  const board = getBoards().find(b => b.id === S.currentBoard.id);
  const hasReusableLabel = !!String(idea.label || '').trim();
  const currentCounter = board?.cardCounter ?? 0;
  const label = hasReusableLabel
    ? String(idea.label).trim()
    : (typeof window.numberToLabel === 'function' ? window.numberToLabel(currentCounter) : `K${currentCounter}`);
  if (!hasReusableLabel) {
    updateBoard(S.currentBoard.id, { cardCounter: currentCounter + 1 });
    S.currentBoard.cardCounter = currentCounter + 1;
  }

  const targetCards = target.id && S.cards ? (S.cards[target.id] || []) : [];
  createCard(S.currentBoard.id, target.id, {
    ...idea,
    label,
    order: targetCards.length,
    startedAt: '',
    finishedAt: '',
  });
  deleteIdeaCard(S.currentBoard.id, idea.id);
  window.loadIdeas();
  if (typeof loadColumns === 'function') loadColumns();
  showToast('Idee nach "Offen" geschoben!');
};

setTimeout(() => {
  const ideaInput = document.getElementById('new-idea-text');
  if (ideaInput) {
    ideaInput.addEventListener('keydown', e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') window.addIdea();
    });
  }
}, 1000);
