// js/storage.js — Lokale Datenspeicherung (ersetzt Firebase komplett)
// Alle Daten liegen als JSON in localStorage unter dem Schlüssel 'kanban_data'
// Struktur: { version, user, settings, boards: [{ id, name, ..., columns: [{ id, ..., cards: [] }] }] }

const STORAGE_KEY   = 'kanban_data';
const SETTINGS_KEY  = 'kanban_settings';
const VERSIONS_KEY  = 'kanban_versions';
const MAX_VERSIONS  = 20;

// ── UUID-GENERATOR ────────────────────────────────────
function generateId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

// ── KERN-LADE/SPEICHER-FUNKTIONEN ─────────────────────
function normalizeData(data) {
  const normalized = (data && typeof data === 'object') ? data : {};
  if (!normalized.user || typeof normalized.user !== 'object') {
    normalized.user = { displayName: '', groupId: '' };
  } else {
    normalized.user = {
      displayName: normalized.user.displayName || '',
      groupId: normalized.user.groupId || ''
    };
  }
  if (!Array.isArray(normalized.boards)) normalized.boards = [];
  normalized.version = normalized.version || 1;
  return normalized;
}

function loadData() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return normalizeData(JSON.parse(raw));
  } catch (e) {}
  return normalizeData(null);
}

function saveData(data) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch (e) {
    console.error('Speichern fehlgeschlagen:', e);
    // Nicht mehr still scheitern: Nutzer deutlich warnen (z. B. Speicher voll)
    if (typeof window !== 'undefined' && typeof window.showToast === 'function') {
      window.showToast('❌ SPEICHERN FEHLGESCHLAGEN! Browser-Speicher voll? Bitte sofort "Alles exportieren & sichern" ausführen und alte Versionen im Versionsverlauf löschen.', 'error');
    }
  }
}

function loadSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) return JSON.parse(raw);
  } catch (e) {}
  return { bg: '', overlayOpacity: '72', theme: 'dark' };
}

function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch (e) {}
}

// ── BENUTZER ──────────────────────────────────────────
export function getUser() {
  return loadData().user || { displayName: '', groupId: '' };
}

export function saveUser(user) {
  const data = loadData();
  data.user = { ...(data.user || { displayName: '', groupId: '' }), ...user };
  saveData(data);
}

// ── EINSTELLUNGEN ─────────────────────────────────────
export function getSetting(key) {
  return loadSettings()[key];
}

export function setSetting(key, value) {
  const settings = loadSettings();
  settings[key] = value;
  saveSettings(settings);
}

// ── BOARDS ────────────────────────────────────────────
export function getBoards() {
  return (loadData().boards || []).map(b => ({
    id: b.id,
    name: b.name,
    members: b.members || [],
    wipLimit: b.wipLimit ?? 3,
    agingDays: b.agingDays ?? 5,
    cardCounter: b.cardCounter ?? 0,
    groupId: b.groupId || '',
    ownerName: b.ownerName || '',
    groupInfos: b.groupInfos && typeof b.groupInfos === 'object' && !Array.isArray(b.groupInfos) ? b.groupInfos : {},
    agingPaused: b.agingPaused || false,
    agingPausedAt: b.agingPausedAt || '',
    totalPausedMs: b.totalPausedMs || 0,
    ideas: Array.isArray(b.ideas) ? b.ideas : [],
    ideaLibraryVersion: b.ideaLibraryVersion || 0,
    reflectionUnlocked: b.reflectionUnlocked || false,
    reflectionUnlockedAt: b.reflectionUnlockedAt || '',
    reflectionStarted: b.reflectionStarted || false,
    reflectionStartedAt: b.reflectionStartedAt || '',
    reflectionCompleted: b.reflectionCompleted || false,
    reflectionCompletedAt: b.reflectionCompletedAt || '',
    timelineBlockLabels: b.timelineBlockLabels && typeof b.timelineBlockLabels === 'object' ? b.timelineBlockLabels : {},
    milestones: Array.isArray(b.milestones) ? b.milestones : [],
    createdAt: b.createdAt || new Date().toISOString(),
  }));
}

const IDEA_LIBRARY_VERSION = 1;

function getDefaultIdeaCards() {
  const now = new Date().toISOString();
  const templates = [
    ['Projektorganisation', 'Boardmaster bestimmen', 'hoch', 'Eine Person übernimmt die Pflege des Boards: Karten sortieren, Labels prüfen, WIP-Limits beobachten und offene Fragen sichtbar machen.', { d: 0, h: 0, m: 30 }],
    ['Projektorganisation', 'Rollen im Team verteilen', 'mittel', 'Klärt, wer welche Verantwortung übernimmt, damit Arbeit sichtbar verteilt ist und keine wichtigen Bereiche offen bleiben.', { d: 0, h: 0, m: 20 }],
    ['Projektorganisation', 'Kickoff und Zielklärung durchführen', 'hoch', 'Das Team klärt Ziel, Produkt, Abgabeform, Bewertungsmaßstab und offene Fragen. Ergebnis ist ein gemeinsames Verständnis des Projekts.', { d: 0, h: 0, m: 45 }],
    ['Projektorganisation', 'Zwischencheck einplanen', 'niedrig', 'Legt einen Termin fest, an dem das Team prüft, ob Aufgaben, Abhängigkeiten und Zeitplan noch passen.', { d: 0, h: 0, m: 20 }],
    ['Projektorganisation', 'Nacharbeitskarte anlegen', 'mittel', 'Reserviert bewusst Zeit für Korrekturen, Feedbackschleifen oder Aufgaben, die nach der ersten Abgabe noch verbessert werden müssen.', { d: 0, h: 0, m: 45 }],

    ['Recherche', 'Recherchequellen sammeln', 'mittel', 'Sammelt brauchbare Links, Bücher, Videos oder Materialien und notiert kurz, warum sie für das Projekt hilfreich sind.', { d: 0, h: 1, m: 0 }],
    ['Recherche', 'Quellen prüfen', 'hoch', 'Prüft Autor, Aktualität, Fachlichkeit und Vertrauenswürdigkeit der wichtigsten Quellen. Ungeeignete Quellen werden aussortiert.', { d: 0, h: 0, m: 45 }],
    ['Recherche', 'Kernaussagen zusammenfassen', 'mittel', 'Fasst die wichtigsten Informationen in eigenen Worten zusammen und markiert, welche Aussagen später belegt werden müssen.', { d: 0, h: 1, m: 0 }],
    ['Recherche', 'Begriffe klären', 'mittel', 'Sammelt Fachbegriffe, unbekannte Wörter und zentrale Konzepte und erklärt sie knapp für das Team.', { d: 0, h: 0, m: 45 }],

    ['Präsentation', 'Präsentationsstruktur erstellen', 'hoch', 'Entwirft Einstieg, Hauptteil, Schluss und Übergänge. Am Ende steht eine klare Reihenfolge der Inhalte.', { d: 0, h: 1, m: 0 }],
    ['Präsentation', 'Folien oder Plakat gestalten', 'mittel', 'Erstellt eine übersichtliche Visualisierung mit wenig Text, klaren Bildern und gut lesbaren Überschriften.', { d: 0, h: 1, m: 30 }],
    ['Präsentation', 'Sprechtexte vorbereiten', 'mittel', 'Formuliert kurze Stichpunkte für die Präsentation und verteilt Redeanteile fair im Team.', { d: 0, h: 0, m: 45 }],
    ['Präsentation', 'Probedurchlauf durchführen', 'hoch', 'Das Team präsentiert einmal vollständig auf Zeit, prüft Verständlichkeit und notiert konkrete Verbesserungen.', { d: 0, h: 0, m: 45 }],

    ['Experiment und Labor', 'Materialliste erstellen', 'hoch', 'Listet alle Geräte, Chemikalien, Verbrauchsmaterialien und Ersatzmaterialien vollständig auf.', { d: 0, h: 0, m: 45 }],
    ['Experiment und Labor', 'Sicherheitscheck durchführen', 'hoch', 'Prüft Schutzbrillen, Abstände, Brandschutz, Erste Hilfe, Entsorgung und besondere Risiken vor der Durchführung.', { d: 0, h: 0, m: 45 }],
    ['Experiment und Labor', 'Versuchsaufbau testen', 'hoch', 'Baut den Versuch einmal trocken oder im Kleinen auf und prüft, ob Material, Reihenfolge und Sicherheit funktionieren.', { d: 0, h: 1, m: 0 }],
    ['Experiment und Labor', 'Beobachtungsbogen vorbereiten', 'mittel', 'Erstellt eine Tabelle oder Checkliste, mit der Ergebnisse, Beobachtungen und Messwerte sauber festgehalten werden.', { d: 0, h: 0, m: 30 }],

    ['Medienprodukt', 'Storyboard skizzieren', 'mittel', 'Plant Szenen, Bilder, Texte oder Ton in einer sinnvollen Reihenfolge, bevor die eigentliche Produktion beginnt.', { d: 0, h: 0, m: 45 }],
    ['Medienprodukt', 'Bild- und Tonmaterial sammeln', 'mittel', 'Sammelt oder erstellt Medienmaterial und achtet auf Urheberrecht, Quellenangaben und passende Qualität.', { d: 0, h: 1, m: 0 }],
    ['Medienprodukt', 'Rohfassung erstellen', 'hoch', 'Erstellt eine erste vollständige Version des Produkts, auch wenn Details noch nicht perfekt sind.', { d: 0, h: 1, m: 30 }],
    ['Medienprodukt', 'Endfassung exportieren', 'hoch', 'Prüft Format, Dateiname, Lesbarkeit, Ton/Bild und Abgabeweg und exportiert die finale Version.', { d: 0, h: 0, m: 30 }],

    ['Reflexion und Feedback', 'Feedback einholen', 'mittel', 'Holt gezielt Rückmeldung von Tutor oder Mitschülerinnen und Mitschülern ein und notiert konkrete Verbesserungspunkte.', { d: 0, h: 0, m: 30 }],
    ['Reflexion und Feedback', 'Reflexion schreiben', 'mittel', 'Beschreibt, was gelungen ist, was schwierig war, was gelernt wurde und was beim nächsten Projekt anders laufen sollte.', { d: 0, h: 0, m: 45 }],
    ['Reflexion und Feedback', 'Lernfortschritt belegen', 'mittel', 'Sammelt Belege wie Entwürfe, Fotos, Messwerte, Notizen oder Versionsstände, die den Arbeitsprozess sichtbar machen.', { d: 0, h: 0, m: 45 }],

    ['Abgabe', 'Abgabekriterien prüfen', 'hoch', 'Vergleicht das Ergebnis mit Aufgabenstellung, Bewertungsraster und formalen Vorgaben. Fehlendes wird sichtbar markiert.', { d: 0, h: 0, m: 30 }],
    ['Abgabe', 'Dateien sauber benennen', 'niedrig', 'Benennt Dateien eindeutig mit Projekt, Team, Datum und Version, damit die Abgabe wiedergefunden werden kann.', { d: 0, h: 0, m: 15 }],
    ['Abgabe', 'Finale Abgabe hochladen', 'hoch', 'Lädt die fertige Datei oder das finale Board über den vorgesehenen Weg hoch und prüft, ob die Abgabe angekommen ist.', { d: 0, h: 0, m: 20 }],
  ];

  return templates.map(([templateCategory, text, priority, description, timeEstimate], order) => ({
    id: generateId(),
    text,
    priority,
    assignee: '',
    due: '',
    description,
    result: '',
    timeEstimate,
    templateCategory,
    startOffset: null,
    label: '',
    order,
    startedAt: '',
    finishedAt: '',
    dependencies: [],
    groupId: '',
    comments: [],
    createdAt: now,
  }));
}

// Mitgliedernamen normalisieren: trimmen und Leere entfernen.
// Verhindert Doppel-Personen wie "Anna " vs. "Anna" (z. B. zwei U-Bahn-Linien).
function normalizeMembers(members) {
  if (!Array.isArray(members)) return [];
  return members.map(m => String(m ?? '').trim()).filter(Boolean);
}

export function createBoard(fields) {
  const data = loadData();
  const board = {
    id: generateId(),
    name: fields.name || 'Neues Board',
    members: normalizeMembers(fields.members),
    wipLimit: fields.wipLimit ?? 3,
    agingDays: fields.agingDays ?? 5,
    cardCounter: fields.cardCounter ?? 0,
    groupId: fields.groupId || '',
    ownerName: fields.ownerName || '',
    groupInfos: fields.groupInfos && typeof fields.groupInfos === 'object' && !Array.isArray(fields.groupInfos) ? fields.groupInfos : {},
    agingPaused: false,
    agingPausedAt: '',
    totalPausedMs: 0,
    createdAt: new Date().toISOString(),
    ideas: Array.isArray(fields.ideas) ? fields.ideas : getDefaultIdeaCards(),
    ideaLibraryVersion: fields.ideaLibraryVersion ?? IDEA_LIBRARY_VERSION,
    reflectionUnlocked: fields.reflectionUnlocked || false,
    reflectionUnlockedAt: fields.reflectionUnlockedAt || '',
    reflectionStarted: fields.reflectionStarted || false,
    reflectionStartedAt: fields.reflectionStartedAt || '',
    reflectionCompleted: fields.reflectionCompleted || false,
    reflectionCompletedAt: fields.reflectionCompletedAt || '',
    timelineBlockLabels: fields.timelineBlockLabels && typeof fields.timelineBlockLabels === 'object' ? fields.timelineBlockLabels : {},
    milestones: Array.isArray(fields.milestones) ? fields.milestones : [],
    columns: [],
  };
  data.boards.push(board);
  saveData(data);
  return board;
}

export function updateBoard(boardId, fields) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return;
  if (Array.isArray(fields.members)) fields = { ...fields, members: normalizeMembers(fields.members) };
  Object.assign(board, fields);
  saveData(data);
}

export function deleteBoard(boardId) {
  const data = loadData();
  data.boards = data.boards.filter(b => b.id !== boardId);
  saveData(data);
}

// ── SPALTEN ───────────────────────────────────────────
export function getColumns(boardId) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return [];
  return (board.columns || [])
    .map(c => ({
      id: c.id,
      name: c.name,
      color: c.color || '#5c6ef8',
      order: c.order ?? 0,
      wipLimit: c.wipLimit ?? 0,
      createdAt: c.createdAt || new Date().toISOString(),
    }))
    .sort((a, b) => a.order - b.order);
}

export function createColumn(boardId, fields) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return null;
  const col = {
    id: generateId(),
    name: fields.name || 'Neue Spalte',
    color: fields.color || '#5c6ef8',
    order: fields.order ?? (board.columns.length),
    wipLimit: fields.wipLimit ?? 0,
    createdAt: new Date().toISOString(),
    cards: [],
  };
  board.columns.push(col);
  saveData(data);
  return col;
}

export function updateColumn(boardId, colId, fields) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return;
  const col = board.columns.find(c => c.id === colId);
  if (!col) return;
  Object.assign(col, fields);
  saveData(data);
}

export function deleteColumn(boardId, colId) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return;
  board.columns = board.columns.filter(c => c.id !== colId);
  saveData(data);
}

// ── KARTEN ────────────────────────────────────────────
export function getCards(boardId, colId) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return [];
  const col = board.columns.find(c => c.id === colId);
  if (!col) return [];
  return (col.cards || [])
    .map(c => ({ ...c }))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function createCard(boardId, colId, fields) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return null;
  const col = board.columns.find(c => c.id === colId);
  if (!col) return null;
  const card = {
    id: generateId(),
    text: fields.text || '',
    priority: fields.priority || '',
    assignee: fields.assignee || '',
    due: fields.due || '',
    description: fields.description || '',
    result: fields.result || '',
    timeEstimate: fields.timeEstimate || { d: 0, h: 0, m: 0 },
    phase: fields.phase || '',
    templateCategory: fields.templateCategory || '',
    startOffset: fields.startOffset ?? null,
    label: fields.label || '',
    order: fields.order ?? (col.cards ? col.cards.length : 0),
    startedAt: fields.startedAt || '',
    finishedAt: fields.finishedAt || '',
    dependencies: fields.dependencies || [],
    groupId: fields.groupId || '',
    comments: fields.comments || [],
    createdAt: new Date().toISOString(),
  };
  if (!col.cards) col.cards = [];
  col.cards.push(card);
  saveData(data);
  return card;
}

export function updateCard(boardId, colId, cardId, fields) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return;
  const col = board.columns.find(c => c.id === colId);
  if (!col) return;
  const card = col.cards.find(c => c.id === cardId);
  if (!card) return;
  Object.assign(card, fields);
  saveData(data);
}

export function deleteCard(boardId, colId, cardId) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return;
  const col = board.columns.find(c => c.id === colId);
  if (!col) return;
  col.cards = col.cards.filter(c => c.id !== cardId);
  saveData(data);
}

// Karte von einer Spalte in eine andere verschieben
export function moveCard(boardId, fromColId, toColId, cardId, newOrder) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return;
  const fromCol = board.columns.find(c => c.id === fromColId);
  const toCol = board.columns.find(c => c.id === toColId);
  if (!fromCol || !toCol) return;
  const cardIdx = fromCol.cards.findIndex(c => c.id === cardId);
  if (cardIdx === -1) return;
  const [card] = fromCol.cards.splice(cardIdx, 1);
  card.order = newOrder ?? (toCol.cards ? toCol.cards.length : 0);
  if (!toCol.cards) toCol.cards = [];
  toCol.cards.push(card);
  saveData(data);
  return card;
}

// Alle Karten einer Spalte auf einmal ersetzen (für Undo/Reorder)
export function replaceCards(boardId, colId, cards) {
  const data = loadData();
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return;
  const col = board.columns.find(c => c.id === colId);
  if (!col) return;
  col.cards = cards.map(c => ({ ...c }));
  saveData(data);
}

// ── IDEEN-KARTEN ─────────────────────────────────────
function normalizeIdeaCard(fields, order) {
  return {
    id: fields.id || generateId(),
    text: fields.text || '',
    priority: fields.priority || '',
    assignee: fields.assignee || '',
    due: fields.due || '',
    description: fields.description || '',
    result: fields.result || '',
    timeEstimate: fields.timeEstimate || { d: 0, h: 0, m: 0 },
    phase: fields.phase || '',
    templateCategory: fields.templateCategory || '',
    startOffset: fields.startOffset ?? null,
    label: fields.label || '',
    order: fields.order ?? order,
    startedAt: fields.startedAt || '',
    finishedAt: fields.finishedAt || '',
    dependencies: fields.dependencies || [],
    groupId: fields.groupId || '',
    comments: fields.comments || [],
    createdAt: fields.createdAt || new Date().toISOString(),
  };
}

function getBoardWithIdeas(data, boardId) {
  const board = data.boards.find(b => b.id === boardId);
  if (!board) return null;
  if (!Array.isArray(board.ideas)) {
    board.ideas = getDefaultIdeaCards();
    board.ideaLibraryVersion = IDEA_LIBRARY_VERSION;
    saveData(data);
  } else if ((board.ideaLibraryVersion || 0) < IDEA_LIBRARY_VERSION) {
    const existingTexts = new Set(
      board.ideas
        .map(card => (card.text || '').trim().toLowerCase())
        .filter(Boolean)
    );
    const nextOrder = Math.max(-1, ...board.ideas.map(card => Number(card.order) || 0)) + 1;
    const missingTemplates = getDefaultIdeaCards()
      .filter(card => !existingTexts.has((card.text || '').trim().toLowerCase()))
      .map((card, idx) => ({ ...card, order: nextOrder + idx }));
    board.ideas = [...board.ideas, ...missingTemplates];
    board.ideaLibraryVersion = IDEA_LIBRARY_VERSION;
    saveData(data);
  }
  return board;
}

export function getIdeaCards(boardId) {
  const data = loadData();
  const board = getBoardWithIdeas(data, boardId);
  if (!board) return [];
  return (board.ideas || [])
    .map((c, i) => normalizeIdeaCard(c, i))
    .sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

export function createIdeaCard(boardId, fields) {
  const data = loadData();
  const board = getBoardWithIdeas(data, boardId);
  if (!board) return null;
  const card = normalizeIdeaCard({ ...fields, order: 0 }, 0);
  board.ideas = [card, ...board.ideas.map((c, i) => ({ ...c, order: i + 1 }))];
  saveData(data);
  return card;
}

export function updateIdeaCard(boardId, cardId, fields) {
  const data = loadData();
  const board = getBoardWithIdeas(data, boardId);
  if (!board) return;
  const card = board.ideas.find(c => c.id === cardId);
  if (!card) return;
  Object.assign(card, fields);
  saveData(data);
}

export function deleteIdeaCard(boardId, cardId) {
  const data = loadData();
  const board = getBoardWithIdeas(data, boardId);
  if (!board) return;
  board.ideas = board.ideas.filter(c => c.id !== cardId).map((c, i) => ({ ...c, order: i }));
  saveData(data);
}

// ── LOKALE VERSIONSVERWALTUNG ─────────────────────────
export function saveLocalVersion(boardName) {
  const raw = localStorage.getItem(STORAGE_KEY) || '{}';
  let versions = [];
  try { versions = JSON.parse(localStorage.getItem(VERSIONS_KEY) || '[]'); } catch(e) {}
  const now = new Date();
  const version = {
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    savedAt: now.toISOString(),
    label: boardName || 'Board',
    data: raw,
  };
  versions.unshift(version);
  if (versions.length > MAX_VERSIONS) versions = versions.slice(0, MAX_VERSIONS);
  try { localStorage.setItem(VERSIONS_KEY, JSON.stringify(versions)); } catch(e) {
    console.error('Versionsspeicherung fehlgeschlagen (localStorage voll?):', e);
  }
  return version;
}

export function getLocalVersions() {
  try { return JSON.parse(localStorage.getItem(VERSIONS_KEY) || '[]'); } catch(e) { return []; }
}

export function restoreLocalVersion(id) {
  const versions = getLocalVersions();
  const v = versions.find(v => v.id === id);
  if (!v) return false;
  localStorage.setItem(STORAGE_KEY, v.data);
  return true;
}

export function deleteLocalVersion(id) {
  let versions = getLocalVersions();
  versions = versions.filter(v => v.id !== id);
  localStorage.setItem(VERSIONS_KEY, JSON.stringify(versions));
}

// ── EXPORT / IMPORT ───────────────────────────────────
export function exportAllData() {
  const data = loadData();
  const settings = loadSettings();
  return JSON.stringify({ ...data, settings, exportedAt: new Date().toISOString() }, null, 2);
}

export function importAllData(jsonString) {
  const parsed = JSON.parse(jsonString);
  // Sicherheitsprüfung: muss boards-Array haben
  if (!Array.isArray(parsed.boards)) throw new Error('Ungültiges Dateiformat: boards fehlt.');
  const { settings, exportedAt, ...data } = parsed;
  data.version = 1;
  saveData(data);
  if (settings) saveSettings(settings);
}

// ── BOARD DUPLIZIEREN ─────────────────────────────────
export function duplicateBoardData(boardId, newName) {
  const data = loadData();
  const src = data.boards.find(b => b.id === boardId);
  if (!src) return null;
  const newBoard = {
    ...src,
    id: generateId(),
    name: newName || src.name + ' – Kopie',
    createdAt: new Date().toISOString(),
    columns: (src.columns || []).map(col => ({
      ...col,
      id: generateId(),
      createdAt: new Date().toISOString(),
      cards: (col.cards || []).map(card => ({
        ...card,
        id: generateId(),
        createdAt: new Date().toISOString(),
      })),
    })),
    ideas: (src.ideas || []).map((card, i) => ({
      ...card,
      id: generateId(),
      order: i,
      createdAt: new Date().toISOString(),
    })),
    milestones: (src.milestones || []).map((m, i) => ({
      ...m,
      id: generateId(),
      order: i,
      requiredCardLabels: Array.isArray(m.requiredCardLabels) ? [...m.requiredCardLabels] : [],
    })),
  };
  data.boards.push(newBoard);
  saveData(data);
  return newBoard;
}
