// admin-ohne-datenbank.js — Kopie von admin.js für die DATENBANKFREIE VERSION
// js/admin.js — Admin-Panel (lokal, vereinfacht ohne Firebase/Nutzerverwaltung)
import { S, getBoards, getColumns, getCards, updateBoard, deleteBoard,
  deleteColumn, deleteCard } from './state.js';

// ── ADMIN CHECK ───────────────────────────────────────
window.currentUserIsAdmin = async function() { return S.isAdminMode; };

// ── ADMIN ÖFFNEN ──────────────────────────────────────
window.openAdminArea = async () => {
  // Bereits in dieser Session authentifiziert → direkt öffnen
  if (window._adminAuthenticated) {
    _enterAdminPanel();
    return;
  }

  // INI-Datei nötig für Masterpasswort-Prüfung
  if (!window._loadedIni || !window._loadedIni.encryptedPrivateKey) {
    const ok = await showConfirm(
      'Für den Adminbereich muss EDUBAN dein Masterpasswort prüfen. Dafür wird deine Tutor-INI benötigt.\n\nBitte wähle im nächsten Schritt deine .ini-Datei aus. Sie enthält den verschlüsselten privaten Tutor-Schlüssel und wird nur lokal für diese Sitzung verwendet.',
      'INI-Datei auswählen',
      'Abbrechen'
    );
    if (!ok) return;

    // INI laden, danach Passwort-Dialog zeigen
    if (typeof window.loadTeacherIni === 'function') {
      await window.loadTeacherIni();
    }
    if (!window._loadedIni || !window._loadedIni.encryptedPrivateKey) {
      showToast('Bitte zuerst eine INI-Datei laden.', 'error');
      return;
    }
  }

  // Passwort-Modal öffnen
  const errEl = document.getElementById('admin-login-error');
  const pwEl  = document.getElementById('admin-password-input');
  if (errEl) errEl.textContent = '';
  if (pwEl)  pwEl.value = '';
  document.getElementById('modal-admin-login').style.display = 'flex';
  setTimeout(() => { if (pwEl) pwEl.focus(); }, 100);
};

// ── ADMIN LOGIN (Masterpasswort prüfen) ───────────────
window.doAdminLogin = async () => {
  const pw    = document.getElementById('admin-password-input').value;
  const errEl = document.getElementById('admin-login-error');
  errEl.textContent = '';

  if (!pw) { errEl.textContent = 'Bitte Masterpasswort eingeben.'; return; }

  const btn = document.querySelector('#modal-admin-login .btn-sm-primary');
  if (btn) { btn.disabled = true; btn.textContent = 'Prüfe…'; }

  try {
    // Masterpasswort gegen INI-Datei prüfen (entschlüsselt den privaten Schlüssel)
    const privKey = await window.kfCrypto.getPrivKeyFromIni(window._loadedIni, pw);
    window._tutorPrivKey = privKey; // für Board-Entschlüsselung merken
    window._adminAuthenticated = true;
    closeModal('modal-admin-login');
    _enterAdminPanel();
  } catch(e) {
    errEl.textContent = 'Falsches Masterpasswort.';
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = 'Einloggen'; }
  }
};

function _enterAdminPanel() {
  S.isAdminMode = true;
  const panel = document.getElementById('admin-panel');
  if (panel) panel.style.display = 'block';
  loadAdminBoardList();
  if (typeof showAdminTab === 'function') showAdminTab('group');
}

window.openAdminPanel = () => openAdminArea();
window.closeAdminPanel = () => {
  document.getElementById('admin-panel').style.display = 'none';
};

// Beim Abmelden Admin-Session zurücksetzen
window.resetAdminSession = function() {
  window._adminAuthenticated = false;
  window._tutorPrivKey = null;
  S.isAdminMode = false;
};

// ── ADMIN TABS ────────────────────────────────────────
window.showAdminTab = (tabId) => {
  const tabs = ['group', 'boardtools'];
  tabs.forEach(t => {
    const panel = document.getElementById('admin-tab-' + t);
    const btn   = document.getElementById('admin-tab-' + t + '-btn');
    if (panel) panel.style.display = (t === tabId) ? 'block' : 'none';
    if (btn)   btn.className = (t === tabId) ? 'btn-sm btn-sm-primary' : 'btn-sm btn-sm-ghost';
  });
  if (tabId === 'group') loadAdminBoardList();
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
};

// ── BOARDS LADEN (LOKAL + DATENBANK) ─────────────────
async function loadAdminBoardList() {
  const container = document.getElementById('admin-group-boards-list');
  if (!container) return;
  const boards = getBoards();
  container.innerHTML = '';

  const boardMap = {};
  boards.forEach(b => {
    const key = b.ownerName || 'Meine Boards';
    if (!boardMap[key]) boardMap[key] = [];
    boardMap[key].push(b);
  });

  if (boards.length) {
    renderAdminBoardMap(boardMap, container);
  } else {
    container.innerHTML = '<div style="padding:20px; opacity:0.5;">Keine lokalen Boards vorhanden.</div>';
  }

  const groupTitle = document.getElementById('admin-current-group-label');
  if (groupTitle) groupTitle.textContent = 'Lokale Boards';

  await renderAdminCloudSubmissions(container, boards.length > 0);
}

window.loadAdminBoardList = loadAdminBoardList;

function renderAdminBoardMap(boardMap, container) {
  container.innerHTML = '';
  Object.keys(boardMap).sort().forEach(name => {
    const boards = boardMap[name];
    const div = document.createElement('div');
    div.style.cssText = 'margin-bottom:15px; background:rgba(255,255,255,0.03); border:1px solid var(--border); border-radius:10px; padding:12px;';
    div.innerHTML = `
      <div style="font-weight:700; font-size:14px; color:var(--primary); margin-bottom:10px; display:flex; justify-content:space-between;">
        <span>${escHtml(name)}</span>
        <span style="font-size:10px; opacity:0.5;">${boards.length} Board${boards.length!==1?'s':''}</span>
      </div>
      <div style="display:flex; flex-direction:column; gap:6px;">
        ${boards.map(b => {
          const boardArg = typeof safeJsArg === 'function' ? safeJsArg(b.id) : JSON.stringify(String(b.id || ''));
          const boardNameArg = typeof safeJsArg === 'function' ? safeJsArg(b.name) : JSON.stringify(String(b.name || ''));
          const ownerArg = typeof safeJsArg === 'function' ? safeJsArg(name) : JSON.stringify(String(name || ''));
          return `
          <div style="display:flex; justify-content:space-between; align-items:center; padding:6px 10px; background:var(--surface2); border-radius:6px;">
            <div style="flex:1; cursor:pointer; font-size:13px;" onclick="adminViewBoard(${boardArg})">🗂️ ${escHtml(b.name)}</div>
            <div style="cursor:pointer; padding:4px 8px; border-left:1px solid var(--border); opacity:0.6;" onmouseover="this.style.opacity='1'" onmouseout="this.style.opacity='0.6'" onclick="openBoardToolbox(${boardArg}, ${boardNameArg}, ${ownerArg})" title="Einstellungen"><i data-lucide="wrench" style="width:14px;"></i></div>
          </div>
        `;
        }).join('')}
      </div>`;
    container.appendChild(div);
  });
  if (typeof reloadIcons === 'function') setTimeout(reloadIcons, 50);
}

async function renderAdminCloudSubmissions(container, hasLocalBoards) {
  // DATENBANKFREIE VERSION: keine Datenbank-Abgaben im Admin-Panel
  return;
  const section = document.createElement('div');
  section.style.cssText = hasLocalBoards ? 'margin-top:18px;' : '';
  section.innerHTML = `
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:10px;">
      <div>
        <div style="font-size:12px;font-weight:800;color:var(--text);text-transform:uppercase;letter-spacing:0.4px;">Datenbank: Schülerabgaben</div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">Weitergeleitete Dateien deiner Schülerinnen und Schüler</div>
      </div>
      <button class="btn-sm btn-sm-ghost" onclick="loadAdminBoardList()" style="display:flex;align-items:center;gap:6px;">
        <i data-lucide="refresh-cw" style="width:13px;height:13px;"></i> Aktualisieren
      </button>
    </div>
    <div id="admin-cloud-submissions-list" style="font-size:12px;color:var(--text-muted);padding:12px;border:1px solid var(--border);border-radius:10px;background:rgba(255,255,255,0.03);">
      Datenbank wird geladen...
    </div>
  `;
  container.appendChild(section);
  if (typeof reloadIcons === 'function') reloadIcons();

  const list = section.querySelector('#admin-cloud-submissions-list');
  try {
    const teacherPub = window._loadedIni?.publicKey || null;
    if (!teacherPub) {
      list.innerHTML = 'Bitte zuerst die Tutor-INI laden. Danach kann EDUBAN die Schülerabgaben in der Datenbank zuordnen.';
      return;
    }
    if (!window.kfCloud?.listTeacherFiles) {
      list.innerHTML = 'Die Datenbank-Funktion ist nicht verfügbar.';
      return;
    }

    let files = (await window.kfCloud.listTeacherFiles(teacherPub))
      .filter(file => file.kind !== 'student-private');
    let fallbackByName = false;

    if (!files.length && window.kfCloud.findTeacherFilesByName && window._loadedIni?.teacherName) {
      const byName = (await window.kfCloud.findTeacherFilesByName(window._loadedIni.teacherName))
        .filter(file => file.kind !== 'student-private');
      if (byName.length) {
        files = byName;
        fallbackByName = true;
      }
    }

    window._adminCloudFileCache = files;
    window._adminCloudFileFallbackByName = fallbackByName;

    if (!files.length) {
      list.innerHTML = 'Keine weitergeleiteten Schülerabgaben für die aktuell geladene Tutor-INI gefunden.';
      return;
    }

    const fmt = iso => {
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return 'unbekanntes Datum';
      return d.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' })
        + ' · ' + d.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' }) + ' Uhr';
    };
    const kindLabel = kind => kind === 'tutor-return'
      ? 'Rückgabe'
      : (kind === 'student-submission' ? 'Schülerabgabe' : 'Datenbankdatei');

    list.style.padding = '0';
    list.style.border = '0';
    list.style.background = 'transparent';
    list.innerHTML = `${fallbackByName ? `
      <div style="padding:10px 12px;border:1px solid rgba(245,158,11,0.35);background:rgba(245,158,11,0.12);border-radius:9px;color:#fbbf24;font-size:12px;line-height:1.5;margin-bottom:8px;">
        Es wurden Dateien mit deinem Tutor-Namen gefunden, aber nicht unter dem aktuell geladenen Tutor-Schlüssel. Sehr wahrscheinlich wurde irgendwann eine neue INI erzeugt. Zum Öffnen brauchst du die INI, mit der diese Schülerinnen und Schüler angemeldet wurden.
      </div>
    ` : ''}${files.map((file, idx) => `
      <div style="display:flex;align-items:center;gap:10px;padding:10px 12px;background:var(--surface2);border:1px solid var(--border);border-radius:9px;margin-bottom:7px;">
        <div style="width:30px;height:30px;border-radius:8px;background:rgba(99,102,241,0.15);display:flex;align-items:center;justify-content:center;color:var(--accent);flex-shrink:0;">
          <i data-lucide="${file.kind === 'tutor-return' ? 'send' : 'cloud'}" style="width:15px;height:15px;"></i>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(file.title || file.studentLabel || file.studentId || 'Schülerabgabe')}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${escHtml(kindLabel(file.kind))}${file.studentLabel ? ` · ${escHtml(file.studentLabel)}` : ''} · ${fmt(file.createdAt)}</div>
        </div>
        <button class="btn-sm btn-sm-primary" onclick="adminImportCloudSubmission(${idx})" style="display:flex;align-items:center;gap:6px;">
          <i data-lucide="download" style="width:13px;height:13px;"></i> ${fallbackByName ? 'Laden versuchen' : 'Laden'}
        </button>
      </div>
    `).join('')}`;
  } catch(e) {
    list.innerHTML = `<span style="color:#ef4444;">Datenbank konnte nicht geladen werden: ${escHtml(e.message || 'Unbekannter Fehler')}</span>`;
  }
  if (typeof reloadIcons === 'function') reloadIcons();
}

window.adminImportCloudSubmission = async (index) => {
  const file = window._adminCloudFileCache?.[index];
  if (!file) return;
  if (window._adminCloudFileFallbackByName) {
    const ok = await showConfirm(
      'Diese Datei wurde nicht unter dem aktuell geladenen Tutor-Schlüssel gefunden. Wenn du nicht die ursprüngliche INI verwendest, wird das Entschlüsseln scheitern.\n\nTrotzdem laden versuchen?',
      'Laden versuchen',
      'Abbrechen'
    );
    if (!ok) return;
  }
  if (!window.kfCloud?.encryptedJsonFromCloudFile || typeof window.importDataFromText !== 'function') {
    showToast('Datenbankdatei kann hier nicht geladen werden.', 'error');
    return;
  }
  const encryptedJson = window.kfCloud.encryptedJsonFromCloudFile(file);
  closeAdminPanel();
  await window.importDataFromText(encryptedJson, {
    studentId: file.studentId || '',
    studentLabel: file.studentLabel || '',
    kind: file.kind || '',
  });
};

// ── BOARD IN DER APP ANSEHEN ──────────────────────────
window.adminViewBoard = (boardId) => {
  closeAdminPanel();
  const boards = getBoards();
  const board  = boards.find(b => b.id === boardId);
  if (!board) { showToast('Board nicht gefunden', 'error'); return; }
  S.boards = boards;
  if (typeof selectBoard === 'function') selectBoard(board.id);
  else {
    S.currentBoard = board;
    renderBoardsList();
    loadColumns();
    document.getElementById('empty-state').style.display  = 'none';
    document.getElementById('board-content').style.display = 'block';
    document.getElementById('board-title-display').innerHTML = escHtml(board.name) + ' <i data-lucide="edit-2" class="title-edit-icon"></i>';
    setTimeout(reloadIcons, 50);
  }
  showToast('Board wird angezeigt');
};

// ── BOARD TOOLBOX (Aging, Deadline) ───────────────────
window.openBoardToolbox = (boardId, boardName, userName) => {
  const boards  = getBoards();
  const board   = boards.find(b => b.id === boardId);
  if (!board) return;

  const aging    = board.agingDays || 5;
  const deadline = board.deadline  || '';

  const modal = document.getElementById('modal-board-toolbox') || createToolboxModal();
  document.getElementById('toolbox-board-name').textContent = boardName;
  document.getElementById('toolbox-aging-input').value      = aging;
  document.getElementById('toolbox-deadline-input').value   = deadline;
  document.getElementById('toolbox-board-id').value         = boardId;
  modal.style.display = 'flex';
};

function createToolboxModal() {
  const modal = document.createElement('div');
  modal.id    = 'modal-board-toolbox';
  modal.className = 'modal-overlay';
  modal.innerHTML = `
    <div class="modal-box" style="max-width:420px;">
      <div class="modal-header">
        <span id="toolbox-board-name" style="font-weight:700;"></span>
        <button class="modal-close-btn" onclick="closeModal('modal-board-toolbox')">✕</button>
      </div>
      <input type="hidden" id="toolbox-board-id"/>
      <div style="display:flex; flex-direction:column; gap:16px; padding:16px 0;">
        <div>
          <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:6px;">Aging-Limit (Tage)</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input type="number" id="toolbox-aging-input" min="1" max="999" style="width:70px; background:var(--surface2); border:1px solid var(--border); border-radius:6px; padding:6px 8px; color:var(--text); font-size:13px;"/>
            <button class="btn-sm btn-sm-primary" onclick="saveAgingLimitToolbox()">Speichern</button>
          </div>
        </div>
        <div>
          <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:6px;">Abgabetermin</label>
          <div style="display:flex; gap:8px; align-items:center;">
            <input type="date" id="toolbox-deadline-input" style="flex:1; background:var(--surface2); border:1px solid var(--border); border-radius:6px; padding:6px 8px; color:var(--text); font-size:13px;"/>
            <button class="btn-sm btn-sm-primary" onclick="saveDeadlineToolbox()">Speichern</button>
            <button class="btn-sm btn-sm-ghost" onclick="document.getElementById('toolbox-deadline-input').value=''; saveDeadlineToolbox()">✕</button>
          </div>
        </div>
        <div>
          <label style="font-size:12px; color:var(--text-muted); display:block; margin-bottom:6px;">Noten</label>
          <div id="toolbox-grades-list"></div>
          <button class="btn-sm btn-sm-ghost" onclick="loadToolboxGrades()" style="width:100%; margin-top:6px;">Noten laden</button>
        </div>
      </div>
    </div>`;
  document.body.appendChild(modal);
  return modal;
}

window.saveAgingLimitToolbox = () => {
  const boardId = document.getElementById('toolbox-board-id').value;
  const val     = parseInt(document.getElementById('toolbox-aging-input').value) || 5;
  updateBoard(boardId, { agingDays: val });
  if (S.currentBoard?.id === boardId) S.currentBoard.agingDays = val;
  showToast(`Aging-Limit auf ${val} Tage gesetzt`);
};

window.saveDeadlineToolbox = () => {
  const boardId = document.getElementById('toolbox-board-id').value;
  const inputId = 'toolbox-deadline-input';
  saveDeadline(boardId, inputId);
};

// ── NOTEN (lokal in localStorage) ────────────────────
const GRADES_KEY = 'kanban_grades';

function getGrades(boardId) {
  try { return JSON.parse(localStorage.getItem(GRADES_KEY) || '{}')[boardId] || {}; } catch(e) { return {}; }
}

function saveGrades(boardId, grades) {
  const all = JSON.parse(localStorage.getItem(GRADES_KEY) || '{}');
  all[boardId] = grades;
  localStorage.setItem(GRADES_KEY, JSON.stringify(all));
}

window.loadToolboxGrades = () => {
  const boardId = document.getElementById('toolbox-board-id').value;
  const boards  = getBoards();
  const board   = boards.find(b => b.id === boardId);
  if (!board) return;
  const members  = board.members || [];
  const existing = getGrades(boardId);
  const list     = document.getElementById('toolbox-grades-list');
  if (!members.length) { list.innerHTML = '<div style="font-size:12px;color:var(--text-muted);">Keine Mitglieder.</div>'; return; }
  list.innerHTML = members.map(member => {
    const g = existing[member] || {};
    const safeId = member.replace(/[^a-zA-Z0-9]/g, '_');
    const memberArg = typeof safeJsArg === 'function' ? safeJsArg(member) : JSON.stringify(String(member || ''));
    return `<div style="margin-bottom:8px; background:var(--surface2); border-radius:8px; padding:10px;">
      <div style="display:flex; align-items:center; gap:8px; margin-bottom:6px;">
        <div class="assignee-avatar">${escHtml(member.slice(0,2).toUpperCase())}</div>
        <span style="font-weight:600; flex:1;">${escHtml(member)}</span>
        <select class="grade-select" id="grade-val-${safeId}" style="width:60px;">
          <option value="">–</option>${[1,2,3,4,5,6].map(n => `<option value="${n}" ${(g.grade||'')==n?'selected':''}>${n}</option>`).join('')}
        </select>
      </div>
      <textarea id="grade-comment-${safeId}" placeholder="Kommentar…" rows="2" style="width:100%;background:var(--bg-card);border:1px solid var(--border);border-radius:6px;padding:6px;color:var(--text);font-size:12px;box-sizing:border-box;">${escHtml(g.comment||'')}</textarea>
      <button class="btn-sm btn-sm-primary" style="margin-top:6px;width:100%;" onclick="saveGradeLocal('${boardId}','${safeId}',${memberArg})">💾 Speichern</button>
    </div>`;
  }).join('');
};

window.saveGradeLocal = (boardId, safeId, member) => {
  const grade   = document.getElementById(`grade-val-${safeId}`)?.value || '';
  const comment = document.getElementById(`grade-comment-${safeId}`)?.value.trim() || '';
  const grades  = getGrades(boardId);
  grades[member] = { grade, comment, updatedAt: new Date().toISOString() };
  saveGrades(boardId, grades);
  showToast(`Note für ${member} gespeichert!`);
};

// ── AGING SPEICHERN (Alias für tools.js Kompatibilität) ─
window.saveAgingLimit = (boardId) => {
  const val = parseInt(document.getElementById('aging-' + boardId)?.value) || 5;
  updateBoard(boardId, { agingDays: val });
  if (S.currentBoard?.id === boardId) S.currentBoard.agingDays = val;
  showToast(`Aging-Limit auf ${val} Tage gesetzt`);
};

// ── BOARD META MODAL ──────────────────────────────────
window.openBoardMetaModal = (boardId, boardName, groupId) => {
  const modal = document.getElementById('modal-board-meta');
  if (!modal) return;
  document.getElementById('board-meta-id').value    = boardId;
  document.getElementById('board-meta-name').value  = boardName || '';
  document.getElementById('board-meta-group').value = groupId || '';
  modal.style.display = 'flex';
  setTimeout(() => document.getElementById('board-meta-name').focus(), 100);
};

window.saveBoardMeta = () => {
  const boardId = document.getElementById('board-meta-id').value;
  const name    = document.getElementById('board-meta-name').value.trim();
  const groupId = document.getElementById('board-meta-group')?.value.trim() || '';
  if (!name) return;
  updateBoard(boardId, { name, groupId });
  if (S.currentBoard?.id === boardId) { S.currentBoard.name = name; S.currentBoard.groupId = groupId; }
  S.boards = getBoards();
  renderBoardsList();
  document.getElementById('board-title-display').innerHTML = escHtml(name) + ' <i data-lucide="edit-2" class="title-edit-icon"></i>';
  setTimeout(reloadIcons, 50);
  closeModal('modal-board-meta');
  showToast('Board gespeichert');
};
