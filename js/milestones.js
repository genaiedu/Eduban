// js/milestones.js — Projektphasen / Meilensteine
import { S, updateBoard } from './state.js';

function esc(text) {
  if (typeof window.escHtml === 'function') return window.escHtml(text);
  return String(text ?? '').replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m]));
}

function makeId() {
  return 'ms_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function getFinishedLabels() {
  const done = new Set();
  for (const col of S.columns || []) {
    const isFinished = window.isFinishedColumn?.(col);
    const isPrerequisite = (col.name || '').toLowerCase().includes('voraussetzung');
    if (!isFinished && !isPrerequisite) continue;
    for (const card of S.cards?.[col.id] || []) {
      if (card.label) done.add(String(card.label).trim().toUpperCase());
    }
  }
  return done;
}

function normalizeMilestones(list) {
  return (Array.isArray(list) ? list : []).map((m, idx) => ({
    id: m.id || makeId(),
    name: m.name || `Phase ${idx + 1}`,
    description: m.description || '',
    order: m.order ?? idx,
    requiredCardLabels: Array.isArray(m.requiredCardLabels)
      ? m.requiredCardLabels.map(label => String(label || '').trim().toUpperCase()).filter(Boolean)
      : [],
  })).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function persistMilestoneIdsIfNeeded() {
  if (!S.currentBoard || !Array.isArray(S.currentBoard.milestones)) return;
  const needsStableIds = S.currentBoard.milestones.some(m => !m?.id);
  if (!needsStableIds) return;
  const milestones = normalizeMilestones(S.currentBoard.milestones).map((m, idx) => ({ ...m, order: idx }));
  updateBoard(S.currentBoard.id, { milestones });
  S.currentBoard.milestones = milestones;
  const board = S.boards.find(b => b.id === S.currentBoard.id);
  if (board) board.milestones = milestones;
}

window.getMilestoneStatuses = function() {
  const milestones = normalizeMilestones(S.currentBoard?.milestones || []);
  const doneLabels = getFinishedLabels();
  let previousDone = true;
  return milestones.map((m, idx) => {
    const required = m.requiredCardLabels || [];
    const completed = required.filter(label => doneLabels.has(String(label).toUpperCase()));
    const rawDone = required.length > 0 && completed.length === required.length;
    const done = previousDone && rawDone;
    const active = previousDone && !rawDone;
    const locked = !previousDone;
    previousDone = previousDone && rawDone;
    return {
      ...m,
      index: idx,
      status: done ? 'done' : active ? 'active' : 'locked',
      completedCount: completed.length,
      totalCount: required.length,
    };
  });
};

window.getCardMilestoneNames = function(label) {
  const normalizedLabel = String(label || '').trim().toUpperCase();
  if (!normalizedLabel) return [];
  return normalizeMilestones(S.currentBoard?.milestones || [])
    .filter(m => (m.requiredCardLabels || []).some(cardLabel => String(cardLabel || '').trim().toUpperCase() === normalizedLabel))
    .map(m => m.name)
    .filter(Boolean);
};

function saveMilestones(list) {
  const milestones = normalizeMilestones(list).map((m, idx) => ({ ...m, order: idx }));
  updateBoard(S.currentBoard.id, { milestones });
  S.currentBoard.milestones = milestones;
  const board = S.boards.find(b => b.id === S.currentBoard.id);
  if (board) board.milestones = milestones;
  window.renderMilestones();
}

window.renderMilestones = function() {
  const el = document.getElementById('milestones-panel');
  if (!el || !S.currentBoard) return;
  const statuses = window.getMilestoneStatuses();
  const reflectionProgress = S.currentBoard.reflectionCompleted ? 'abgeschlossen' : (S.currentBoard.reflectionStarted ? 'gestartet' : 'freigeschaltet');
  const reflectionChip = S.currentBoard.reflectionUnlocked ? `
    <div class="milestone-chip milestone-reflection" title="Alle Projektkarten sind abgeschlossen. Die Reflexionsphase ist ${reflectionProgress}.">
      <div class="milestone-index">↺</div>
      <div class="milestone-body">
        <div class="milestone-name">Reflexionsphase</div>
        <div class="milestone-progress">${reflectionProgress}</div>
      </div>
    </div>
  ` : '';
  if (!statuses.length) {
    el.innerHTML = `
      <div class="milestones-empty">
        <span>Keine Projektphasen angelegt.</span>
        <button onclick="openMilestonesModal()">Phasen planen</button>
      </div>
      ${reflectionChip}`;
    return;
  }

  el.innerHTML = `
    <div class="milestones-track">
      ${statuses.map((m, idx) => `
        <div class="milestone-chip milestone-${m.status}" title="${esc(m.description || m.name)}">
          <div class="milestone-index">${m.status === 'done' ? '✓' : idx + 1}</div>
          <div class="milestone-body">
            <div class="milestone-name">${esc(m.name)}</div>
            <div class="milestone-progress">${m.completedCount}/${m.totalCount || 0} Karten fertig</div>
          </div>
        </div>
      `).join('<div class="milestone-arrow">→</div>')}
      ${reflectionChip ? `<div class="milestone-arrow">→</div>${reflectionChip}` : ''}
      <button class="milestone-edit-btn" onclick="openMilestonesModal()" title="Projektphasen bearbeiten">
        <i data-lucide="flag" style="width:14px;height:14px;"></i>
      </button>
    </div>`;
  if (typeof reloadIcons === 'function') reloadIcons();
};

function renderMilestoneEditor() {
  const list = document.getElementById('milestone-list');
  const hint = document.getElementById('milestone-card-hint');
  if (!list || !hint) return;
  const milestones = normalizeMilestones(S.currentBoard?.milestones || []);
  const labels = [];
  for (const col of S.columns || []) {
    for (const card of S.cards?.[col.id] || []) {
      if (card.label) labels.push(`[${card.label}] ${card.text || ''}`);
    }
  }
  hint.textContent = labels.length ? `Kartenlabels: ${labels.join(' · ')}` : 'Noch keine Kartenlabels vorhanden.';

  list.innerHTML = milestones.length ? milestones.map((m, idx) => {
    const milestoneArg = typeof safeJsArg === 'function'
      ? safeJsArg(m.id)
      : esc(JSON.stringify(String(m.id ?? '')));
    return `
    <div class="milestone-editor-row">
      <div style="flex:1;min-width:0;">
        <div style="font-weight:800;color:var(--text);">${idx + 1}. ${esc(m.name)}</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${esc((m.requiredCardLabels || []).join(', ') || 'Keine Karten zugeordnet')}</div>
        ${m.description ? `<div style="font-size:12px;color:var(--text-muted);margin-top:6px;">${esc(m.description)}</div>` : ''}
      </div>
      <div style="display:flex;gap:6px;flex-shrink:0;">
        <button class="card-btn" onclick="moveMilestone(${idx}, -1)" title="Nach oben">↑</button>
        <button class="card-btn" onclick="moveMilestone(${idx}, 1)" title="Nach unten">↓</button>
        <button class="card-btn" onclick="editMilestone(${milestoneArg})" title="Bearbeiten"><i data-lucide="edit-2" style="width:13px;height:13px;"></i></button>
        <button class="card-btn delete" onclick="deleteMilestone(${milestoneArg})" title="Löschen"><i data-lucide="trash-2" style="width:13px;height:13px;"></i></button>
      </div>
    </div>
  `;
  }).join('') : '<div style="padding:18px;color:var(--text-muted);text-align:center;">Noch keine Projektphasen angelegt.</div>';
  if (typeof reloadIcons === 'function') reloadIcons();
}

window.openMilestonesModal = function() {
  if (!S.currentBoard) return;
  const modal = document.getElementById('modal-milestones');
  if (!modal) return;
  persistMilestoneIdsIfNeeded();
  ['milestone-edit-id','milestone-name','milestone-description','milestone-labels'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.value = '';
  });
  renderMilestoneEditor();
  modal.style.display = 'flex';
};

window.editMilestone = function(id) {
  const m = normalizeMilestones(S.currentBoard?.milestones || []).find(x => x.id === id);
  if (!m) return;
  document.getElementById('milestone-edit-id').value = m.id;
  document.getElementById('milestone-name').value = m.name || '';
  document.getElementById('milestone-description').value = m.description || '';
  document.getElementById('milestone-labels').value = (m.requiredCardLabels || []).join(', ');
  document.getElementById('milestone-name')?.focus();
};

window.saveMilestone = function() {
  if (!S.currentBoard) return;
  const id = document.getElementById('milestone-edit-id')?.value || '';
  const name = document.getElementById('milestone-name')?.value.trim() || '';
  if (!name) { showToast('Bitte einen Namen für die Phase eingeben.', 'error'); return; }
  const description = document.getElementById('milestone-description')?.value.trim() || '';
  const requiredCardLabels = (document.getElementById('milestone-labels')?.value || '')
    .split(/[,\s]+/)
    .map(label => label.replace(/[\[\]]/g, '').trim().toUpperCase())
    .filter(Boolean);
  const current = normalizeMilestones(S.currentBoard.milestones || []);
  const next = id
    ? current.map(m => m.id === id ? { ...m, name, description, requiredCardLabels } : m)
    : [...current, { id: makeId(), name, description, requiredCardLabels, order: current.length }];
  saveMilestones(next);
  ['milestone-edit-id','milestone-name','milestone-description','milestone-labels'].forEach(inputId => {
    const el = document.getElementById(inputId);
    if (el) el.value = '';
  });
  renderMilestoneEditor();
  showToast(id ? 'Projektphase aktualisiert.' : 'Projektphase angelegt.');
};

window.deleteMilestone = async function(id) {
  const ok = await showConfirm('Projektphase wirklich löschen?', 'Löschen', 'Abbrechen');
  if (!ok) return;
  saveMilestones(normalizeMilestones(S.currentBoard.milestones || []).filter(m => m.id !== id));
  renderMilestoneEditor();
};

window.moveMilestone = function(index, dir) {
  const list = normalizeMilestones(S.currentBoard.milestones || []);
  const target = index + dir;
  if (target < 0 || target >= list.length) return;
  [list[index], list[target]] = [list[target], list[index]];
  saveMilestones(list);
  renderMilestoneEditor();
};
