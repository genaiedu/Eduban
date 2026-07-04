// js/auth.js — Authentifizierung (Tutor normal, Schüler mit INI + Passwort)
import { S, getUser, saveUser, getBoards, createBoard, createColumn, createCard } from './state.js';

const STUDENT_CFG_KEY = 'kf_student_config';
const ROLE_KEY = 'kf_role';
const GUEST_MODE_KEY = 'kf_guest_mode';

function safeGet(storage, key) {
  try { return storage.getItem(key); } catch(e) { return null; }
}

function safeSet(storage, key, value) {
  try { storage.setItem(key, value); } catch(e) { /* ignorieren */ }
}

function safeRemove(storage, key) {
  try { storage.removeItem(key); } catch(e) { /* ignorieren */ }
}

function isStudentHost() {
  return location.hostname === 'eduban.vercel.app';
}

function getStoredRole() {
  return safeGet(sessionStorage, ROLE_KEY) || safeGet(localStorage, ROLE_KEY) || (isStudentHost() ? 'schueler' : '');
}

function setStoredRole(role) {
  if (role === 'schueler') {
    safeSet(sessionStorage, ROLE_KEY, 'schueler');
    safeSet(localStorage, ROLE_KEY, 'schueler');
  } else {
    safeRemove(sessionStorage, ROLE_KEY);
    safeRemove(localStorage, ROLE_KEY);
  }
}

function getGuestMode() {
  return safeGet(sessionStorage, GUEST_MODE_KEY) || safeGet(localStorage, GUEST_MODE_KEY) || '';
}

function setGuestMode(mode) {
  if (mode) {
    safeSet(sessionStorage, GUEST_MODE_KEY, mode);
    safeSet(localStorage, GUEST_MODE_KEY, mode);
  } else {
    safeRemove(sessionStorage, GUEST_MODE_KEY);
    safeRemove(localStorage, GUEST_MODE_KEY);
  }
}

function getStudentConfig() {
  try { return JSON.parse(localStorage.getItem(STUDENT_CFG_KEY) || 'null'); } catch(e) { return null; }
}

function saveStudentConfig(cfg) {
  localStorage.setItem(STUDENT_CFG_KEY, JSON.stringify(cfg));
}

function prepareIniFileInput(input) {
  if (!input) return;
  input.removeAttribute('accept');
  input.setAttribute('type', 'file');
}

// ── APP STARTEN ──────────────────────────────────────────
window.initApp = function() {
  document.getElementById('loading-screen').style.display = 'none';

  try {
    const savedKeys = sessionStorage.getItem('kf_return_keys');
    if (savedKeys) {
      window._studentReturnKeys = JSON.parse(savedKeys);
      sessionStorage.removeItem('kf_return_keys');
    }

    const savedIni = sessionStorage.getItem('kf_loaded_ini');
    if (savedIni) {
      window._loadedIni = JSON.parse(savedIni);
      sessionStorage.removeItem('kf_loaded_ini');
    }

    // Neuer passwortfreier Tutor-Schlüssel: bleibt auf diesem Gerät geladen
    // (wie die Schüler-INI), damit Speichern/Öffnen ohne Passwort läuft.
    if (!window._loadedIni) {
      const persistedIni = localStorage.getItem('kf_tutor_ini');
      if (persistedIni) window._loadedIni = JSON.parse(persistedIni);
    }

    const savedCloudMeta = sessionStorage.getItem('kf_last_student_cloud_meta');
    if (savedCloudMeta) {
      window._lastStudentCloudMeta = JSON.parse(savedCloudMeta);
      sessionStorage.removeItem('kf_last_student_cloud_meta');
    }
  } catch(e) { /* ignorieren */ }

  const forcedTutorMode = safeGet(sessionStorage, ROLE_KEY) === 'lehrer';
  if (forcedTutorMode) {
    setStoredRole('');
    setGuestMode('');
  }

  const isStudent = !forcedTutorMode && getStoredRole() === 'schueler';

  if (isStudent) {
    if (getGuestMode() === 'student') {
      const user = { displayName: 'Gast', groupId: 'Demo' };
      window._kfSession = { isStudent: true, guest: true };
      saveUser(user);
      const board = createGuestBoardIfNeeded();

      enterApp(user, true);

      setTimeout(() => {
        S.boards = getBoards();
        if (typeof renderBoardsList === 'function') renderBoardsList();
        if (board?.id && typeof selectBoard === 'function') selectBoard(board.id);
      }, 250);

      return;
    }

    initStudentAuth();
  } else {
    const user = getUser();

    if (user.displayName) {
      enterApp(user, false);
    } else {
      document.getElementById('auth-screen').style.display = 'flex';
      showFirstRunSetupIfNeeded();
      setTimeout(() => {
        const el = document.getElementById('profile-name');
        if (el) el.focus();
      }, 100);
    }
  }
};

// ── SCHÜLER-AUTHENTIFIZIERUNG ────────────────────────────
// Neues Konzept: Die Schüler-INI-Datei ist der Schlüssel.
// Sie enthält Infos zu Tutor UND SchülerIn plus ein zufälliges
// Geheimnis (studentSecret). Kein Passwort mehr nötig.
async function initStudentAuth() {
  document.getElementById('student-auth-screen').style.display = 'flex';

  ['ini-file-input', 'student-ini-file-input'].forEach(id => {
    prepareIniFileInput(document.getElementById(id));
  });

  const config = getStudentConfig();

  // Auf diesem Gerät bereits mit Schüler-INI angemeldet → direkt rein
  if (config?.studentSecret && config?.publicKeyJwk) {
    window._kfSession = {
      studentPassword: config.studentSecret,
      teacherPublicKeyJwk: config.publicKeyJwk,
      teacherName: config.teacherName,
      isStudent: true
    };

    enterApp(getUser(), true);
    return;
  }

  // Altes Passwort-Profil (ohne studentSecret) → Neuanmeldung per INI nötig
  if (config) localStorage.removeItem(STUDENT_CFG_KEY);

  showStudentIniLogin();
}

// Anmeldeschritt: Schüler-INI laden
function showStudentIniLogin() {
  _setStudentStep('login');

  const errEl = document.getElementById('student-ini-load-error');
  if (errEl) errEl.textContent = '';

  const input = document.getElementById('student-ini-file-input');
  if (input) {
    prepareIniFileInput(input);
    input.value = '';
  }
}

window.showStudentIniLogin = showStudentIniLogin;

// Schüler-INI-Datei einlesen → sofort angemeldet
window.loadStudentIniFromFile = async function(event) {
  const input = event?.target;
  prepareIniFileInput(input);

  const file = input?.files?.[0];
  const errEl = document.getElementById('student-ini-load-error');

  if (errEl) errEl.textContent = '';
  if (!file) return;

  try {
    const text = await readTextFile(file);
    const iniObj = JSON.parse(text);

    if (iniObj.kanbanfluss_ini) {
      throw new Error('Das ist eine Tutor-Datei. Bitte wähle deine persönliche Schüler-INI – oder registriere dich unten neu.');
    }

    if (!window.kfCrypto.isValidStudentIni(iniObj)) {
      throw new Error('Keine gültige EDUBAN-Schüler-INI-Datei.');
    }

    saveStudentConfig({
      teacherName: iniObj.teacherName || '',
      publicKeyJwk: iniObj.teacherPublicKey,
      studentSecret: iniObj.studentSecret,
      studentName: iniObj.studentName
    });

    const existingUser = getUser();
    if (!existingUser.displayName || existingUser.displayName !== iniObj.studentName) {
      saveUser({ displayName: iniObj.studentName, groupId: existingUser.groupId || '' });
    }

    setStoredRole('schueler');
    setGuestMode('');

    window._kfSession = {
      studentPassword: iniObj.studentSecret,
      teacherPublicKeyJwk: iniObj.teacherPublicKey,
      teacherName: iniObj.teacherName || '',
      isStudent: true
    };

    enterApp(getUser(), true);
  } catch(e) {
    if (errEl) errEl.textContent = 'Fehler: ' + e.message;
    if (input) input.value = '';
  }
};

let _pendingIni = null;

function readTextFile(file) {
  if (file && typeof file.text === 'function') return file.text();

  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => resolve(String(reader.result || ''));
    reader.onerror = () => reject(reader.error || new Error('Datei konnte nicht gelesen werden.'));

    reader.readAsText(file);
  });
}

window.showTeacherSelection = showTeacherSelection;

async function showTeacherSelection() {
  _setStudentStep('teacher');
  _pendingIni = null;

  const errEl = document.getElementById('ini-load-error');
  if (errEl) errEl.textContent = '';

  const input = document.getElementById('ini-file-input');
  if (input) {
    prepareIniFileInput(input);
    input.value = '';
  }
}

window.loadIniFromFile = async function(event) {
  const input = event?.target;
  prepareIniFileInput(input);

  const file = input?.files?.[0];
  const errEl = document.getElementById('ini-load-error');

  if (errEl) errEl.textContent = '';
  if (!file) return;

  try {
    const text = await readTextFile(file);
    const iniObj = JSON.parse(text);

    if (!iniObj.kanbanfluss_ini) {
      throw new Error('Keine gültige EDUBAN-INI-Datei.');
    }

    if (!iniObj.publicKey) {
      throw new Error('Diese INI-Datei enthält keinen öffentlichen Schlüssel.');
    }

    // Schutz: Der PRIVATE Tutor-Schlüssel gehört nicht in Schülerhände!
    if (iniObj.privateKey || iniObj.tutorSecret || iniObj.kanbanfluss_tutor_key) {
      throw new Error('Das ist der PRIVATE Tutor-Schlüssel! Bitte gib deinem Tutor Bescheid – Schülerinnen und Schüler erhalten nur die Verteil-INI („…fuer-schueler.ini").');
    }

    _pendingIni = iniObj;

    _setStudentStep('register');

    const label = document.getElementById('student-teacher-label');
    if (label) label.textContent = iniObj.teacherName || file.name.replace(/\.ini$/i, '');

    const regError = document.getElementById('student-reg-error');
    if (regError) regError.textContent = '';

    setTimeout(() => document.getElementById('student-reg-name')?.focus(), 100);
  } catch(e) {
    if (errEl) errEl.textContent = 'Fehler: ' + e.message;
    if (input) input.value = '';
  }
};

// Registrierung: Name eingeben → Schüler-INI wird erzeugt und
// als Datei gespeichert (funktioniert auch auf iPad via Download).
window.submitStudentRegister = async function() {
  const name = document.getElementById('student-reg-name').value.trim();
  const errEl = document.getElementById('student-reg-error');

  errEl.textContent = '';

  if (!_pendingIni) {
    errEl.textContent = 'Bitte zuerst die Tutor-INI-Datei auswählen.';
    return;
  }

  if (!name) {
    errEl.textContent = 'Bitte Namen eingeben.';
    return;
  }

  const btn = document.getElementById('student-reg-submit');
  btn.disabled = true;
  btn.textContent = 'Schüler-INI wird erstellt…';

  try {
    const iniObj = _pendingIni;
    const teacherName = iniObj.teacherName || '';

    const studentIniJson = window.kfCrypto.createStudentIni(name, teacherName, iniObj.publicKey);
    const studentIni = JSON.parse(studentIniJson);
    const suggestedName = `eduban-schueler-${name.replace(/\s+/g, '_')}.ini`;

    // Datei speichern: Save-Dialog wo verfügbar, sonst Download (iPad/Safari)
    let saved = false;
    if (window.showSaveFilePicker) {
      try {
        const handle = await window.showSaveFilePicker({
          suggestedName,
          types: [{ description: 'EDUBAN Schüler-INI', accept: { 'application/json': ['.ini'] } }],
        });
        const w = await handle.createWritable();
        await w.write(studentIniJson);
        await w.close();
        saved = true;
      } catch(e) {
        if (e.name === 'AbortError') {
          btn.disabled = false;
          btn.textContent = 'Schüler-INI erstellen & anmelden';
          return;
        }
        // Fallback unten versuchen
      }
    }

    if (!saved) {
      const blob = new Blob([studentIniJson], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = suggestedName;
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 4000);
    }

    saveStudentConfig({
      teacherName,
      publicKeyJwk: iniObj.publicKey,
      studentSecret: studentIni.studentSecret,
      studentName: name
    });

    saveUser({ displayName: name, groupId: '' });
    setStoredRole('schueler');
    setGuestMode('');

    window._kfSession = {
      studentPassword: studentIni.studentSecret,
      teacherPublicKeyJwk: iniObj.publicKey,
      teacherName,
      isStudent: true
    };

    enterApp(getUser(), true);

    if (typeof showToast === 'function') {
      showToast(`✅ Deine Schüler-INI "${suggestedName}" wurde gespeichert. Bewahre sie gut auf – sie ist dein Schlüssel!`);
    }
  } catch(e) {
    errEl.textContent = 'Fehler: ' + e.message;
    btn.disabled = false;
    btn.textContent = 'Schüler-INI erstellen & anmelden';
  }
};

window.resetStudentAuth = async function() {
  const ok = await showConfirm(
    'Neu anmelden?\n\nDeine Boards bleiben gespeichert. Zum Anmelden brauchst du deine Schüler-INI-Datei (oder du registrierst dich mit der Tutor-INI neu).',
    'Ja, neu anmelden',
    'Abbrechen'
  );

  if (!ok) return;

  localStorage.removeItem(STUDENT_CFG_KEY);
  setGuestMode('');
  setStoredRole('schueler');

  window._kfSession = null;

  showStudentIniLogin();
};

function _setStudentStep(step) {
  ['teacher', 'register', 'login'].forEach(s => {
    const el = document.getElementById(`student-step-${s}`);
    if (el) el.style.display = s === step ? 'block' : 'none';
  });
}

function createGuestBoardIfNeeded() {
  const demoBoard = {
    name: "Beispielboard: Feuer-Show",
    groups: [
      {
        id: "Sicherheitskonzept",
        name: "Sicherheitskonzept",
        description: "Diese Gruppe klärt alle sicherheitsrelevanten Grundlagen der Feuer-Show. Dazu gehören Gefährdungsbeurteilung, Brandschutz, Erste Hilfe, Raumabstände und Schutzmaßnahmen für die Grundschülerinnen und Grundschüler."
      },
      {
        id: "Materialbeschaffung",
        name: "Materialbeschaffung",
        description: "Diese Gruppe sorgt dafür, dass Chemikalien, Verbrauchsmaterialien, Glasgeräte und Hardware vollständig, geprüft und einsatzbereit vorliegen. Die Aufgaben laufen parallel und bilden die Grundlage für alle späteren Experimentproben."
      },
      {
        id: "Skript & Storytelling",
        name: "Skript und Storytelling",
        description: "Diese Gruppe entwickelt den roten Faden der Show. Begrüßung, Feuerdreieck und Überleitungen zwischen den Experimenten werden so formuliert, dass Grundschülerinnen und Grundschüler dem Ablauf gut folgen können."
      },
      {
        id: "Teebeutel-Rakete",
        name: "Teebeutel-Rakete",
        description: "Diese Gruppe bereitet das erste Experiment der Show vor. Aufbau, Zündung und Konvektion werden getrennt geprobt, damit der Effekt sicher, sichtbar und kindgerecht erklärt werden kann."
      },
      {
        id: "Brennendes Eisen",
        name: "Brennendes Eisen",
        description: "Diese Gruppe demonstriert den Unterschied zwischen kompaktem und fein verteiltem Eisen. Ziel ist es, den Einfluss der Oberfläche auf die Brennbarkeit anschaulich zu zeigen."
      },
      {
        id: "Elefantenzahnpasta",
        name: "Elefantenzahnpasta",
        description: "Diese Gruppe bereitet den Schaumeffekt aus Wasserstoffperoxid, Spülmittel und Katalysator vor. Lösung, Katalysator und Auffangwanne werden getrennt verantwortet, damit der Versuch spektakulär, aber kontrolliert abläuft."
      },
      {
        id: "Glimmspanprobe",
        name: "Glimmspanprobe",
        description: "Diese Gruppe nutzt den Sauerstoff aus der Elefantenzahnpasta für einen Nachweis mit dem Glimmspan. Vorbereitung und Durchführung werden getrennt geprobt, damit der Nachweis zuverlässig sichtbar wird."
      },
      {
        id: "Unsichtbarer Feuerlöscher",
        name: "Unsichtbarer Feuerlöscher",
        description: "Diese Gruppe erzeugt Kohlenstoffdioxid und nutzt es zum Löschen von Teelichtern. Das Experiment erklärt anschaulich, wie Sauerstoffentzug Feuer beendet."
      },
      {
        id: "Buntes Magierfeuer",
        name: "Buntes Magierfeuer",
        description: "Diese Gruppe bereitet die Flammenfärbung mit verschiedenen Metallsalzen vor. Lösungen, Brenneraufbau und Sprühtechnik werden getrennt geprobt, damit kräftige Farben bei sicherem Abstand entstehen."
      },
      {
        id: "Drachenatem",
        name: "Drachenatem",
        description: "Diese Gruppe bereitet die Bärlappsporen-Explosion vor. Apparatur, Dosierung und Pusttechnik werden getrennt verantwortet, damit der Feuerball eindrucksvoll, aber kontrolliert bleibt."
      },
      {
        id: "Feuerhand",
        name: "Feuerhand",
        description: "Diese Gruppe bereitet das Finale mit brennendem Butanschaum auf der nassen Hand vor. Schaumbad, Gasblasen und Zündung werden getrennt geplant, damit der Effekt sicher durchgeführt werden kann."
      }
    ],
    milestones: [
      {
        name: "Projektorganisation und Sicherheit",
        description: "Die sicherheitsrelevanten und organisatorischen Grundlagen sind abgeschlossen. Die Voraussetzungen gelten als bereits erfüllt und sind keine Bewertungsaufgaben.",
        cards: ["BM1", "S1", "S2", "S3"]
      },
      {
        name: "Materialbasis und Skript stehen",
        description: "Alle Materialien, Chemikalien, Geräte und Moderationstexte sind vorbereitet. Danach kann ohne Leerlauf mit den konkreten Experimentproben begonnen werden.",
        cards: ["BM2", "M1", "M2", "M3", "D1", "D2"]
      },
      {
        name: "Experimente vorbereitet und geprobt",
        description: "Alle acht Experimente sind arbeitsteilig vorbereitet und so geprobt, dass sie sicher, sichtbar und kindgerecht vorgeführt werden können.",
        cards: ["BM3", "E1A", "E1B", "E2A", "E2B", "E3A", "E3B", "E3C", "E4A", "E4B", "E5A", "E5B", "E6A", "E6B", "E6C", "E7A", "E7B", "E7C", "E8A", "E8B", "E8C"]
      },
      {
        name: "Show durchgeführt",
        description: "Die Experimente wurden in einer geschlossenen Reihenfolge präsentiert. Das Feuerdreieck wurde für die Grundschülerinnen und Grundschüler nachvollziehbar erklärt.",
        cards: ["BM4", "V1", "V2", "V3", "V4", "V5", "V6", "V7", "V8"]
      },
      {
        name: "Reflexion abgeschlossen",
        description: "Die Show wurde ausgewertet. Stärken, Schwächen und konkrete Verbesserungen für den nächsten Tag der offenen Tür wurden dokumentiert.",
        cards: ["BM5", "R1"]
      }
    ],
    columns: [
      {
        spalte: "Voraussetzungen",
        karten: [
          {
            label: "BM1",
            titel: "Boardmaster Phase 1: Organisation und Sicherheit",
            wer: "Anna",
            prio: "mittel",
            deps: [],
            gruppe: "",
            beschreibung: "Anna übernimmt in der ersten Phase die Pflege des Boards und achtet darauf, dass Sicherheitskarten, Zuständigkeiten und Labels sauber angelegt sind. Diese Aufgabe hat keine direkten Abhängigkeiten zu Produktaufgaben, damit sie den Arbeitsfluss nicht blockiert. Die Aufgabe ist gut gelöst, wenn alle Voraussetzungen eindeutig im Board stehen, keine Label-Duplikate vorhanden sind und alle Beteiligten ihre ersten Aufgaben erkennen können.",
            zeit: { d: 0, h: 0, m: 30 },
            startversatz: 0.0
          },
          {
            label: "S1",
            titel: "Gefährdungsbeurteilung schreiben",
            wer: "Karl",
            prio: "hoch",
            deps: [],
            gruppe: "Sicherheitskonzept",
            beschreibung: "Erstellung der offiziellen Gefährdungsbeurteilung für alle acht Experimente der Show. Beinhaltet die Risikoabschätzung für offenes Feuer vor Grundschülerinnen und Grundschülern. Die Aufgabe ist gut gelöst, wenn das Dokument fehlerfrei vorliegt und vom Sicherheitsbeauftragten der Schule abgezeichnet wurde.",
            zeit: { d: 0, h: 4, m: 0 },
            startversatz: 0.0
          },
          {
            label: "S2",
            titel: "Brandschutz und Erste Hilfe prüfen",
            wer: "Luca",
            prio: "hoch",
            deps: [],
            gruppe: "Sicherheitskonzept",
            beschreibung: "Kontrolle aller Feuerlöscher, Löschdecken und des Erste-Hilfe-Koffers auf Vollständigkeit und Prüfdatum. Die Materialien werden im Vorführraum griffbereit bereitgestellt. Die Aufgabe ist gut gelöst, wenn alle Sicherheitsmaterialien funktionstüchtig, sichtbar und am richtigen Ort platziert sind.",
            zeit: { d: 0, h: 2, m: 0 },
            startversatz: 0.0
          },
          {
            label: "S3",
            titel: "Raumaufbau und Abstände abkleben",
            wer: "Adrian",
            prio: "hoch",
            deps: [],
            gruppe: "Sicherheitskonzept",
            beschreibung: "Ausmessen und Abkleben der Sicherheitsabstände für die erste Sitzreihe. Zusätzlich werden Schutzbrillen für die erste Reihe gezählt und bereitgelegt. Die Aufgabe ist gut gelöst, wenn die Sicherheitszone klar markiert ist, die Laufwege frei bleiben und ausreichend Schutzbrillen bereitliegen.",
            zeit: { d: 0, h: 2, m: 0 },
            startversatz: 0.0
          }
        ]
      },
      {
        spalte: "— Offen",
        karten: [
          {
            label: "BM2",
            titel: "Boardmaster Phase 2: Material und Skript koordinieren",
            wer: "Aaron",
            prio: "mittel",
            deps: [],
            gruppe: "",
            beschreibung: "Aaron überprüft in der zweiten Phase, ob Materialbeschaffung und Skriptarbeit sichtbar, eindeutig und ohne Doppelarbeit im Board stehen. Er achtet besonders darauf, dass Materialkarten nicht unbemerkt liegen bleiben und dass D1 und D2 fachlich zusammenpassen. Die Aufgabe ist gut gelöst, wenn alle Material- und Skriptkarten aktuell sind und offene Blockaden im Board sichtbar gemacht wurden.",
            zeit: { d: 0, h: 0, m: 30 },
            startversatz: 0.5
          },
          {
            label: "M1",
            titel: "Chemikalien beschaffen und prüfen",
            wer: "Aaron",
            prio: "hoch",
            deps: ["S1"],
            gruppe: "Materialbeschaffung",
            beschreibung: "Heraussuchen und Bereitstellen aller chemischen Substanzen: H2O2, Kaliumiodid, Metallsalze, Lycopodium, Natron und Essig. Zusätzlich wird die Schulzulassung für das verwendete Wasserstoffperoxid geprüft. Die Aufgabe ist gut gelöst, wenn alle Chemikalien in den benötigten Mengen beschriftet, sicher verpackt und auf dem Transportwagen bereitgestellt sind.",
            zeit: { d: 0, h: 3, m: 0 },
            startversatz: 0.5
          },
          {
            label: "M2",
            titel: "Verbrauchsmaterialien einkaufen",
            wer: "Ylvi",
            prio: "hoch",
            deps: ["S1"],
            gruppe: "Materialbeschaffung",
            beschreibung: "Einkauf und Sammlung der Alltagsmaterialien: Teebeutel ohne Kleber, Spülmittel, Glimmspan, Butangas und Teelichter. Außerdem werden Eisenwolle Grad 00 und 9V-Batterien beschafft. Die Aufgabe ist gut gelöst, wenn alle Verbrauchsmaterialien vollständig in der Vorbereitungskiste liegen und direkt für die Proben verwendet werden können.",
            zeit: { d: 0, h: 3, m: 0 },
            startversatz: 0.5
          },
          {
            label: "M3",
            titel: "Glasgeräte und Hardware sammeln",
            wer: "Victoria",
            prio: "hoch",
            deps: ["S1"],
            gruppe: "Materialbeschaffung",
            beschreibung: "Zusammenstellung der Glasgeräte wie Standzylinder, Erlenmeyerkolben und Bechergläser sowie der Hardware wie Brenner, Stativmaterial, Wannen und Sprühflaschen. Alle Geräte werden auf Sauberkeit, Risse und Funktion geprüft. Die Aufgabe ist gut gelöst, wenn alle Geräte bruchfrei, sauber und funktionstüchtig bereitgestellt sind.",
            zeit: { d: 0, h: 3, m: 0 },
            startversatz: 0.5
          },
          {
            label: "BM3",
            titel: "Boardmaster Phase 3: Experimentproben koordinieren",
            wer: "Victoria",
            prio: "mittel",
            deps: [],
            gruppe: "",
            beschreibung: "Victoria prüft in der dritten Phase, ob alle Experimentkarten sauber vorbereitet, eindeutig verteilt und korrekt voneinander abhängig sind. Sie achtet darauf, dass innerhalb echter Gruppenarbeiten keine Person doppelt eingesetzt wird und dass keine zirkulären Abhängigkeiten entstehen. Die Aufgabe ist gut gelöst, wenn alle Experimentproben im Board nachvollziehbar miteinander verknüpft sind und keine Gruppe gegen die Verkettungsregeln verstößt.",
            zeit: { d: 0, h: 0, m: 30 },
            startversatz: 0.88
          },
          {
            label: "E1A",
            titel: "Exp1: Zylinder-Aufbau üben",
            wer: "Luca",
            prio: "mittel",
            deps: ["M2"],
            gruppe: "Teebeutel-Rakete",
            beschreibung: "Üben der korrekten Präparation der Teebeutel: Klammer entfernen, Inhalt leeren und den Teebeutel sauber als Zylinder aufstellen. Wichtig ist, dass der Zylinder nicht kippt und gleichmäßig abbrennt. Die Aufgabe ist gut gelöst, wenn fünf Teebeutel in Folge stabil stehen und sicher gezündet werden können.",
            zeit: { d: 0, h: 1, m: 0 },
            startversatz: 0.88
          },
          {
            label: "E1B",
            titel: "Exp1: Zündung und Konvektion",
            wer: "Adrian",
            prio: "mittel",
            deps: ["M2"],
            gruppe: "Teebeutel-Rakete",
            beschreibung: "Üben des passenden Zündzeitpunkts und der Beobachtung der Thermik. Dabei wird darauf geachtet, dass der Teebeutel gleichmäßig abbrennt und erst dann aufsteigt, wenn die warme Luftsäule stabil genug ist. Die Aufgabe ist gut gelöst, wenn die Rakete zielsicher bis unter die Decke fliegt und sicher als kalte Asche landet.",
            zeit: { d: 0, h: 1, m: 0 },
            startversatz: 0.88
          },
          {
            label: "E2A",
            titel: "Exp2: Eisenwolle auflockern",
            wer: "Aaron",
            prio: "mittel",
            deps: ["M1", "M2"],
            gruppe: "Brennendes Eisen",
            beschreibung: "Präparieren der Eisenwolle durch vorsichtiges Zupfen zur Vergrößerung der Oberfläche. Zusätzlich wird eine feuerfeste Ablage vorbereitet, damit die Reaktion kontrolliert gezeigt werden kann. Die Aufgabe ist gut gelöst, wenn die Wolle so locker ist, dass die Batterie sie sofort durchzünden kann.",
            zeit: { d: 0, h: 1, m: 0 },
            startversatz: 0.88
          },
          {
            label: "E2B",
            titel: "Exp2: Zündung per Batterie",
            wer: "Ylvi",
            prio: "mittel",
            deps: ["M1", "M2"],
            gruppe: "Brennendes Eisen",
            beschreibung: "Testen der 9V-Batterie am Eisennagel als Negativprobe und anschließendes Durchglühen der präparierten Eisenwolle. Der Unterschied zwischen kompakter und fein verteilter Oberfläche wird sichtbar herausgearbeitet. Die Aufgabe ist gut gelöst, wenn der Kontrast zwischen kompaktem und feinem Brennstoff klar demonstriert wurde.",
            zeit: { d: 0, h: 1, m: 0 },
            startversatz: 0.88
          },
          {
            label: "E3A",
            titel: "Exp3: Peroxidlösung ansetzen",
            wer: "Victoria",
            prio: "mittel",
            deps: ["M1", "M3"],
            gruppe: "Elefantenzahnpasta",
            beschreibung: "Abmessen des Wasserstoffperoxids und Mischen mit Spülmittel sowie Lebensmittelfarbe im Standzylinder. Dabei werden Schutzbrille, sichere Handhabung und genaue Mengenführung beachtet. Die Aufgabe ist gut gelöst, wenn die Mengen exakt stimmen und die Mischung sicher im Zylinder vorbereitet ist.",
            zeit: { d: 0, h: 1, m: 0 },
            startversatz: 0.88
          },
          {
            label: "E3B",
            titel: "Exp3: Katalysator dosieren",
            wer: "Elisa",
            prio: "mittel",
            deps: ["M1", "M3"],
            gruppe: "Elefantenzahnpasta",
            beschreibung: "Abwiegen des Kaliumiodids und Vorbereiten der Zugabe, um die Zersetzung des Wasserstoffperoxids gezielt zu starten. Die Dosierung muss so gewählt sein, dass der Effekt deutlich, aber kontrollierbar bleibt. Die Aufgabe ist gut gelöst, wenn die Schaumsäule sofort nach Zugabe in optimaler Geschwindigkeit aufsteigt.",
            zeit: { d: 0, h: 1, m: 0 },
            startversatz: 0.88
          },
          {
            label: "E3C",
            titel: "Exp3: Auffangwanne präparieren",
            wer: "Karl",
            prio: "mittel",
            deps: ["M2", "M3"],
            gruppe: "Elefantenzahnpasta",
            beschreibung: "Aufbau der großen Auffangwanne und Platzierung des Zylinders, um Überlaufen auf den Boden zu verhindern. Der Standzylinder wird so positioniert, dass der Effekt gut sichtbar bleibt und nichts aus dem Sicherheitsbereich herausläuft. Die Aufgabe ist gut gelöst, wenn der gesamte entstehende Schaum sicher in der Wanne landet.",
            zeit: { d: 0, h: 1, m: 0 },
            startversatz: 0.88
          },
          {
            label: "E4A",
            titel: "Exp4: Holzspäne präparieren",
            wer: "Victoria",
            prio: "mittel",
            deps: ["E3A", "E3B", "E3C"],
            gruppe: "Glimmspanprobe",
            beschreibung: "Anzünden und Auspusten langer Glimmspäne, sodass nur noch die Spitze rot glüht. Die Glimmspäne müssen so vorbereitet werden, dass sie beim Sauerstoffnachweis zuverlässig reagieren. Die Aufgabe ist gut gelöst, wenn der Span stabil glüht, ohne eine offene Flamme zu werfen.",
            zeit: { d: 0, h: 1, m: 0 },
            startversatz: 1.0
          },
          {
            label: "E4B",
            titel: "Exp4: Sauerstoffnachweis",
            wer: "Elisa",
            prio: "mittel",
            deps: ["E3A", "E3B", "E3C"],
            gruppe: "Glimmspanprobe",
            beschreibung: "Einführen des glühenden Spans in den Schaum der Elefantenzahnpasta, um den frei werdenden Sauerstoff nachzuweisen. Die Bewegung muss ruhig und gut sichtbar erfolgen, damit der Nachweis für die Kinder nachvollziehbar ist. Die Aufgabe ist gut gelöst, wenn der Span sich hell und verlässlich im Schaum entzündet.",
            zeit: { d: 0, h: 1, m: 0 },
            startversatz: 1.0
          },
          {
            label: "E5A",
            titel: "Exp5: CO2 herstellen",
            wer: "Luca",
            prio: "mittel",
            deps: ["M1", "E1A"],
            gruppe: "Unsichtbarer Feuerlöscher",
            beschreibung: "Mischen von Natron und Essig in einem großen, hohen Becherglas, sodass sich ausreichend unsichtbares CO2 am Boden sammelt. Die Reaktion muss kräftig genug sein, ohne zu überschäumen. Die Aufgabe ist gut gelöst, wenn genug Gas entsteht und die Flüssigkeit im Becherglas bleibt.",
            zeit: { d: 0, h: 1, m: 0 },
            startversatz: 1.0
          },
          {
            label: "E5B",
            titel: "Exp5: Teelichter löschen",
            wer: "Adrian",
            prio: "mittel",
            deps: ["M1", "E1B"],
            gruppe: "Unsichtbarer Feuerlöscher",
            beschreibung: "Vorsichtiges Gießen des schweren CO2-Gases aus dem Becherglas über eine Reihe brennender Teelichter. Dabei darf keine Flüssigkeit auslaufen, weil sonst der Effekt nicht mehr als unsichtbares Gas erkennbar wäre. Die Aufgabe ist gut gelöst, wenn alle Kerzen nacheinander erlöschen, ohne dass ein Tropfen Flüssigkeit vergossen wird.",
            zeit: { d: 0, h: 1, m: 0 },
            startversatz: 1.0
          },
          {
            label: "E6A",
            titel: "Exp6: Salzlösungen anmischen",
            wer: "Aaron",
            prio: "mittel",
            deps: ["M1", "E2A"],
            gruppe: "Buntes Magierfeuer",
            beschreibung: "Lösen von Kupfer-, Strontium- und Natriumsalzen im Wasser/Ethanol-Gemisch. Anschließend werden die Lösungen in farbkodierte Sprühflaschen abgefüllt. Die Aufgabe ist gut gelöst, wenn sich die Salze rückstandslos gelöst haben und die Pumpen nicht verstopfen.",
            zeit: { d: 0, h: 1, m: 0 },
            startversatz: 1.0
          },
          {
            label: "E6B",
            titel: "Exp6: Brenner ausrichten",
            wer: "Ylvi",
            prio: "mittel",
            deps: ["M3", "E2B"],
            gruppe: "Buntes Magierfeuer",
            beschreibung: "Aufbau und sicheres Zünden des Gasbrenners sowie Einstellung einer heißen, nicht leuchtenden Flamme. Der Brenner muss stabil stehen und für die Flammenfärbung geeignet ausgerichtet sein. Die Aufgabe ist gut gelöst, wenn der Brenner sturmsicher steht und die Flamme die Salze optimal ionisiert.",
            zeit: { d: 0, h: 1, m: 0 },
            startversatz: 1.0
          },
          {
            label: "E6C",
            titel: "Exp6: Sprühtechnik proben",
            wer: "Victoria",
            prio: "mittel",
            deps: ["M3", "E4A"],
            gruppe: "Buntes Magierfeuer",
            beschreibung: "Üben des seitlichen Sprühens der Lösungen in die Flamme, um kräftige Farben in Grün, Rot und Gelb zu erzeugen. Dabei werden Windrichtung, Abstand und Tropfenbildung beachtet. Die Aufgabe ist gut gelöst, wenn die Farben kräftig erscheinen und keine Tropfen auf den Tisch fallen.",
            zeit: { d: 0, h: 1, m: 0 },
            startversatz: 1.13
          },
          {
            label: "E7A",
            titel: "Exp7: Pust-Apparatur",
            wer: "Elisa",
            prio: "mittel",
            deps: ["M2", "E4B"],
            gruppe: "Drachenatem",
            beschreibung: "Aufbau des Trichters und Schlauchs im korrekten Winkel zu einer offenen Brennerflamme. Der Apparat wird so fixiert, dass der Vorführer ausreichend Abstand zur Flamme hält. Die Aufgabe ist gut gelöst, wenn der Apparat stabil steht und eine sichere Staubwolke in Richtung Flamme erzeugt werden kann.",
            zeit: { d: 0, h: 1, m: 0 },
            startversatz: 1.13
          },
          {
            label: "E7B",
            titel: "Exp7: Bärlappsporen dosieren",
            wer: "Karl",
            prio: "mittel",
            deps: ["M1", "E4B"],
            gruppe: "Drachenatem",
            beschreibung: "Abmessen der idealen Menge Lycopodium-Pulver im Trichter für einen optimalen Feuerball. Die Menge muss so gewählt sein, dass die Staubwolke brennbar ist, aber nicht zu dicht wird. Die Aufgabe ist gut gelöst, wenn die Staubwolke weder verstopft noch zu dünn ist und zuverlässig zündet.",
            zeit: { d: 0, h: 1, m: 0 },
            startversatz: 1.13
          },
          {
            label: "E7C",
            titel: "Exp7: Feuerball pusten",
            wer: "Luca",
            prio: "mittel",
            deps: ["M2", "E5A"],
            gruppe: "Drachenatem",
            beschreibung: "Üben des kräftigen, stoßartigen Pustens in den Schlauch, um die Sporen als Staubwolke durch die Flamme zu treiben. Dabei werden Abstand, Atemstoß und Sicherheitsrichtung kontrolliert. Die Aufgabe ist gut gelöst, wenn ein kontrollierter und beeindruckender Feuerball entsteht.",
            zeit: { d: 0, h: 1, m: 0 },
            startversatz: 1.13
          },
          {
            label: "E8A",
            titel: "Exp8: Schaumbad mischen",
            wer: "Adrian",
            prio: "mittel",
            deps: ["M1", "E5B"],
            gruppe: "Feuerhand",
            beschreibung: "Füllen der großen Glasschüssel mit Wasser und reichlich Spülmittel für das finale Experiment. Der Schaum muss dicht genug sein, um Gasblasen aufzunehmen und stabil an der Oberfläche zu bleiben. Die Aufgabe ist gut gelöst, wenn der Schaum dicht und langlebig ist.",
            zeit: { d: 0, h: 1, m: 0 },
            startversatz: 1.13
          },
          {
            label: "E8B",
            titel: "Exp8: Gas einleiten",
            wer: "Aaron",
            prio: "mittel",
            deps: ["M1", "E6A"],
            gruppe: "Feuerhand",
            beschreibung: "Einleiten des Butangases unter Wasser, um gasgefüllte Seifenblasen an der Oberfläche zu erzeugen. Die Gasmenge wird so kontrolliert, dass eine sichtbare, aber beherrschbare Schaummenge entsteht. Die Aufgabe ist gut gelöst, wenn ein großer Berg stabiler, brennbarer Schaumblasen entsteht.",
            zeit: { d: 0, h: 1, m: 0 },
            startversatz: 1.13
          },
          {
            label: "E8C",
            titel: "Exp8: Zündung und Sicherheit",
            wer: "Ylvi",
            prio: "hoch",
            deps: ["M2", "E6B"],
            gruppe: "Feuerhand",
            beschreibung: "Der Vorführer macht die Hände komplett nass und schöpft den Schaum. Ylvi zündet den Schaum an und hält ein nasses Handtuch bereit. Die Aufgabe ist gut gelöst, wenn die Stichflamme spektakulär brennt und die Hand des Vorführers absolut unversehrt bleibt.",
            zeit: { d: 0, h: 1, m: 0 },
            startversatz: 1.13
          },
          {
            label: "BM4",
            titel: "Boardmaster Phase 4: Show-Ablauf überwachen",
            wer: "Elisa",
            prio: "mittel",
            deps: [],
            gruppe: "",
            beschreibung: "Elisa überwacht während der Show-Phase, ob die Reihenfolge der Vorführkarten eindeutig bleibt und keine Showkarte vor ihren Voraussetzungen beginnt. Sie achtet auf sichtbare Blockaden, ohne selbst eine Produktaufgabe zu blockieren. Die Aufgabe ist gut gelöst, wenn die Showkarten sauber von V1 bis V8 verkettet sind und alle Teammitglieder ihre Einsatzpunkte erkennen können.",
            zeit: { d: 0, h: 0, m: 30 },
            startversatz: 1.25
          },
          {
            label: "V1",
            titel: "Show: Exp 1 - Rakete zünden",
            wer: "Luca",
            prio: "hoch",
            deps: ["S2", "S3", "D1", "D2", "E1A", "E1B"],
            gruppe: "",
            beschreibung: "Durchführung des ersten Experiments live vor den Grundschülerinnen und Grundschülern inklusive didaktischer Erklärung. Die Show darf erst beginnen, wenn Brandschutz, Raumabstände, Begrüßung, Überleitung und beide Vorbereitungsteile der Teebeutel-Rakete abgeschlossen sind. Die Aufgabe ist gut gelöst, wenn die Kinder das Konzept der aufsteigenden warmen Luft verstanden haben und die Rakete sicher fliegt.",
            zeit: { d: 0, h: 0, m: 5 },
            startversatz: 1.25
          },
          {
            label: "V2",
            titel: "Show: Exp 2 - Eisen brennen",
            wer: "Aaron",
            prio: "hoch",
            deps: ["V1", "E2A", "E2B"],
            gruppe: "",
            beschreibung: "Vorführung von Nagel und Eisenwolle als Vergleich zwischen kompakter und stark vergrößerter Oberfläche. Das Experiment baut auf dem ersten Show-Schritt auf und führt den Brennstoff-Aspekt des Feuerdreiecks weiter. Die Aufgabe ist gut gelöst, wenn die Schülerinnen und Schüler begreifen, dass Oberfläche beim Brennstoff entscheidend ist und der Versuch sicher am Pult durchgeführt wird.",
            zeit: { d: 0, h: 0, m: 5 },
            startversatz: 1.26
          },
          {
            label: "V3",
            titel: "Show: Exp 3 - Zahnpasta schäumen",
            wer: "Victoria",
            prio: "hoch",
            deps: ["V2", "E3A", "E3B", "E3C"],
            gruppe: "",
            beschreibung: "Sicheres Starten der exothermen Reaktion am Vorführtisch. Die Karte hängt von allen drei Vorbereitungsteilen der Elefantenzahnpasta ab, damit Lösung, Katalysator und Auffangwanne bereit sind. Die Aufgabe ist gut gelöst, wenn die Schaumsäule spektakulär aufsteigt und vollständig in der Wanne bleibt.",
            zeit: { d: 0, h: 0, m: 5 },
            startversatz: 1.27
          },
          {
            label: "V4",
            titel: "Show: Exp 4 - Sauerstoff nachweisen",
            wer: "Elisa",
            prio: "hoch",
            deps: ["V3", "E4A", "E4B"],
            gruppe: "",
            beschreibung: "Einführen des Glimmspans in den frischen Schaum als Sauerstoffnachweis. Die Vorführung schließt direkt an die Elefantenzahnpasta an und erklärt den Sauerstoffanteil des Feuerdreiecks. Die Aufgabe ist gut gelöst, wenn der Span sich gut sichtbar entzündet und das Thema Sauerstoff verstanden wird.",
            zeit: { d: 0, h: 0, m: 5 },
            startversatz: 1.28
          },
          {
            label: "V5",
            titel: "Show: Exp 5 - Feuer löschen",
            wer: "Adrian",
            prio: "hoch",
            deps: ["V4", "E5A", "E5B"],
            gruppe: "",
            beschreibung: "Gießen des CO2-Gases über die Kerzen als Demonstration des Sauerstoffentzugs. Die Durchführung setzt sowohl die CO2-Erzeugung als auch die eingeübte Löschtechnik voraus. Die Aufgabe ist gut gelöst, wenn alle Flammen nacheinander erlöschen und das Prinzip des Sauerstoff-Entzugs visuell klar wird.",
            zeit: { d: 0, h: 0, m: 5 },
            startversatz: 1.29
          },
          {
            label: "V6",
            titel: "Show: Exp 6 - Farben sprühen",
            wer: "Ylvi",
            prio: "hoch",
            deps: ["V5", "E6A", "E6B", "E6C"],
            gruppe: "",
            beschreibung: "Sprühen der verschiedenen Metallsalze in die Brennerflamme. Die Karte hängt von Lösung, Brenneraufbau und Sprühtechnik ab, damit der Versuch sichtbar und sicher gelingt. Die Aufgabe ist gut gelöst, wenn die drei Farben kräftig leuchten und alle Sicherheitsabstände eingehalten werden.",
            zeit: { d: 0, h: 0, m: 5 },
            startversatz: 1.3
          },
          {
            label: "V7",
            titel: "Show: Exp 7 - Drachenatem",
            wer: "Karl",
            prio: "hoch",
            deps: ["V6", "E7A", "E7B", "E7C"],
            gruppe: "",
            beschreibung: "Pusten der Bärlappsporen durch die Flamme als eindrucksvolle Demonstration der Wirkung einer großen Oberfläche. Die Durchführung setzt Apparatur, Dosierung und Pusttechnik voraus. Die Aufgabe ist gut gelöst, wenn der Feuerball als extreme Steigerung der Oberflächendiskussion sicher und kontrolliert gelingt.",
            zeit: { d: 0, h: 0, m: 5 },
            startversatz: 1.31
          },
          {
            label: "V8",
            titel: "Show: Exp 8 - Finale Feuerhand",
            wer: "Luca",
            prio: "hoch",
            deps: ["V7", "E8A", "E8B", "E8C"],
            gruppe: "",
            beschreibung: "Das Finale der Show mit brennendem Schaum auf der nassen Hand. Die Karte hängt von Schaumbad, Gasblasen und Sicherheitszündung ab, damit der Effekt eindrucksvoll und kontrolliert bleibt. Die Aufgabe ist gut gelöst, wenn die Stichflamme sicher abbrennt, die Hand unversehrt bleibt und das Feuerdreieck abschließend zusammengefasst wird.",
            zeit: { d: 0, h: 0, m: 10 },
            startversatz: 1.32
          },
          {
            label: "BM5",
            titel: "Boardmaster Phase 5: Reflexion dokumentieren",
            wer: "Karl",
            prio: "mittel",
            deps: [],
            gruppe: "",
            beschreibung: "Karl achtet in der Reflexionsphase darauf, dass Rückmeldungen, offene Fragen und Verbesserungen nicht nur mündlich bleiben, sondern im Board oder in einer kurzen Auswertung festgehalten werden. Die Karte hat keine direkte Produktabhängigkeit, weil sie eine übergeordnete Koordinationsaufgabe ist. Die Aufgabe ist gut gelöst, wenn klar dokumentiert ist, welche Erkenntnisse aus der Show für eine Wiederholung übernommen werden.",
            zeit: { d: 0, h: 0, m: 30 },
            startversatz: 1.35
          },
          {
            label: "R1",
            titel: "Reflexion und Auswertung",
            wer: "Anna",
            prio: "mittel",
            deps: ["V8"],
            gruppe: "",
            beschreibung: "Nach der Show werden Ablauf, Sicherheit, Verständlichkeit für die Grundschülerinnen und Grundschüler und Materialorganisation kurz ausgewertet. Dabei werden konkrete Beobachtungen gesammelt, nicht nur allgemeine Eindrücke. Die Aufgabe ist gut gelöst, wenn mindestens drei Stärken, drei Verbesserungsmöglichkeiten und konkrete Hinweise für den nächsten Tag der offenen Tür dokumentiert sind.",
            zeit: { d: 0, h: 1, m: 0 },
            startversatz: 1.35
          }
        ]
      },
      {
        spalte: "— In Bearbeitung",
        karten: [
          {
            label: "D1",
            titel: "Ablaufplan und Begrüßung",
            wer: "Elisa",
            prio: "hoch",
            deps: ["S1"],
            gruppe: "Skript & Storytelling",
            beschreibung: "Schreiben des Skripts für die Begrüßung der Grundschülerinnen und Grundschüler und die kindgerechte Einführung in das Feuerdreieck. Dabei wird festgelegt, wer wann spricht und wie die Kinder aktiviert werden. Die Aufgabe ist gut gelöst, wenn das Intro flüssig lesbar ist, die Grundschülerinnen und Grundschüler motivierend einbindet und inhaltlich direkt zur Show überleitet.",
            zeit: { d: 0, h: 4, m: 0 },
            startversatz: 0.5,
            started: true
          },
          {
            label: "D2",
            titel: "Didaktische Überleitungen",
            wer: "Karl",
            prio: "hoch",
            deps: ["S1"],
            gruppe: "Skript & Storytelling",
            beschreibung: "Verfassen der Moderationstexte und Überleitungen zwischen den acht Experimenten. Die Texte stellen immer wieder den Bezug zum Feuerdreieck her und verbinden die Einzelversuche zu einer zusammenhängenden Show. Die Aufgabe ist gut gelöst, wenn der rote Faden für das Publikum jederzeit verständlich bleibt.",
            zeit: { d: 0, h: 4, m: 0 },
            startversatz: 0.5,
            started: true
          }
        ]
      },
      {
        spalte: "— Fertig",
        karten: []
      }
    ]
  };

  const existing = getBoards().find(board => board.name === demoBoard.name);
  if (existing) return existing;

  const groupInfos = {};

  (demoBoard.groups || []).forEach(g => {
    if (!g?.id) return;

    groupInfos[g.id] = {
      name: g.name || g.id,
      description: g.description || ''
    };
  });

  const members = Array.from(new Set(
    (demoBoard.columns || [])
      .flatMap(col => col.karten || [])
      .map(card => card.wer)
      .filter(Boolean)
  ));

  const board = createBoard({
    name: demoBoard.name,
    members,
    wipLimit: Math.max(2, Math.ceil(members.length * 1.5)),
    agingDays: 3,
    ownerName: 'Gast',
    groupId: 'Demo',
    groupInfos,
    milestones: (demoBoard.milestones || []).map((m, index) => ({
      id: `demo_ms_${index}_${String(m.name || 'phase').toLowerCase().replace(/[^a-z0-9]+/g, '_')}`,
      name: m.name || `Phase ${index + 1}`,
      description: m.description || '',
      order: index,
      requiredCardLabels: Array.isArray(m.cards) ? m.cards : [],
    })),
  });

  const defaultColors = ['#5c6ef8', '#4d7fff', '#f59e0b', '#10b981'];

  (demoBoard.columns || []).forEach((col, colIndex) => {
    const column = createColumn(board.id, {
      name: col.spalte || `Spalte ${colIndex + 1}`,
      color: defaultColors[colIndex] || '#5c6ef8',
      order: colIndex,
      wipLimit: String(col.spalte || '').toLowerCase().includes('bearbeitung') ? board.wipLimit : 0
    });

    (col.karten || []).forEach((k, order) => {
      createCard(board.id, column.id, {
        label: k.label || '',
        text: k.titel || '',
        assignee: k.wer || '',
        priority: k.prio || '',
        dueDate: k.deadline || '',
        dependencies: Array.isArray(k.deps) ? k.deps : [],
        groupId: k.gruppe || '',
        description: k.beschreibung || '',
        timeEstimate: k.zeit || { d: 0, h: 0, m: 0 },
        startOffset: k.startversatz ?? null,
        startedAt: k.started ? new Date().toISOString() : undefined,
        finishedAt: k.finished ? new Date().toISOString() : undefined,
        order
      });
    });
  });

  return board;
}

window.loginAsGuest = function(mode) {
  const isStudentGuest = mode === 'student' || getStoredRole() === 'schueler';
  const user = { displayName: 'Gast', groupId: 'Demo' };

  if (isStudentGuest) {
    setStoredRole('schueler');
    setGuestMode('student');
    window._kfSession = { isStudent: true, guest: true };
  } else {
    setStoredRole('');
    setGuestMode('teacher');
    window._kfSession = { isStudent: false, guest: true };
  }

  saveUser(user);

  const board = createGuestBoardIfNeeded();

  enterApp(user, isStudentGuest);

  setTimeout(() => {
    S.boards = getBoards();
    if (typeof renderBoardsList === 'function') renderBoardsList();
    if (board?.id && typeof selectBoard === 'function') selectBoard(board.id);
    if (typeof startTour === 'function') startTour();
  }, 250);
};

// ── TUTOR: NEU ANMELDEN (Profil zurücksetzen, Boards bleiben) ──
window.resetTutorProfile = async function() {
  const ok = await showConfirm(
    'Neu anmelden?\n\nDein Profil (Name) wird zurückgesetzt. Deine Boards und Daten bleiben erhalten.',
    'Ja, neu anmelden',
    'Abbrechen'
  );

  if (!ok) return;

  saveUser({ displayName: '', groupId: '' });

  document.getElementById('app-screen').classList.remove('visible');

  const nameEl = document.getElementById('profile-name');
  const groupEl = document.getElementById('profile-group');

  if (nameEl) nameEl.value = '';
  if (groupEl) groupEl.value = '';

  const hint = document.getElementById('tutor-relogin-hint');
  if (hint) hint.style.display = 'block';

  document.getElementById('auth-screen').style.display = 'flex';

  setTimeout(() => {
    document.getElementById('profile-name')?.focus();
  }, 100);
};

// ── SEITENLEISTE: HART IN DEN SCHÜLERBEREICH WECHSELN ──
window.loginAsStudentFromSidebar = async function() {
  const ok = await showConfirm(
    'Neu als Schüler anmelden?\n\nDu wechselst in den Schülerbereich. Deine vorhandenen Boards bleiben auf diesem Gerät gespeichert.',
    'Ja, Schülerbereich öffnen',
    'Abbrechen'
  );

  if (!ok) return;

  setStoredRole('schueler');
  setGuestMode('');
  localStorage.removeItem(STUDENT_CFG_KEY);

  window._kfSession = null;
  window._tutorSession = null;

  document.getElementById('app-screen')?.classList.remove('visible');

  const teacherScreen = document.getElementById('auth-screen');
  if (teacherScreen) teacherScreen.style.display = 'none';

  const studentScreen = document.getElementById('student-auth-screen');
  if (studentScreen) studentScreen.style.display = 'flex';

  showStudentIniLogin();
};

// ── TUTOR: ZURÜCK ZUR APP (nach ungewolltem Neuanmelden) ──
window.resumeTutorSession = function() {
  const user = getUser();

  if (user.displayName) {
    document.getElementById('auth-screen').style.display = 'none';
    document.getElementById('app-screen').classList.add('visible');
  }
};

// ── TUTOR: PROFIL SPEICHERN ──────────────────────────────
window.saveProfile = function() {
  const name = document.getElementById('profile-name')?.value.trim() || '';
  const group = document.getElementById('profile-group')?.value.trim() || '';

  if (!name) {
    showError('profile-error', 'Bitte gib deinen Namen ein.');
    return;
  }

  const hasIni = window._loadedIni && (window._loadedIni.privateKey || window._loadedIni.encryptedPrivateKey);

  if (!hasIni) {
    const firstRunSetup = document.getElementById('first-run-setup');

    if (firstRunSetup) {
      firstRunSetup.style.display = 'block';
      showError('profile-error', '⚠️ Als Tutor bitte zuerst unten deinen Tutor-Schlüssel erstellen oder laden!');

      setTimeout(() => {
        document.getElementById('first-run-setup')?.scrollIntoView({
          behavior: 'smooth',
          block: 'center'
        });
      }, 100);

      return;
    }
  }

  const user = {
    displayName: name,
    groupId: group || 'default'
  };

  saveUser(user);
  enterApp(user, false);
};

// ── ERSTEINRICHTUNG ANZEIGEN ────────────────────────────
window.showFirstRunSetupIfNeeded = function() {
  if (getStoredRole() === 'schueler') return;

  const user = getUser();

  if (!user.displayName) {
    const firstRunSetup = document.getElementById('first-run-setup');
    if (firstRunSetup) firstRunSetup.style.display = 'block';
  }
};

// ── IN DIE APP WECHSELN ──────────────────────────────────
function enterApp(user, isStudent) {
  const studentShellActive = getStoredRole() === 'schueler';

  if (!isStudent && studentShellActive) {
    initStudentAuth();
    return;
  }

  if (isStudent) setStoredRole('schueler');
  else setStoredRole('');

  S.currentUser = user;

  const ss = document.getElementById('student-auth-screen');
  if (ss) ss.style.display = 'none';

  document.getElementById('auth-screen').style.display = 'none';
  document.getElementById('app-screen').classList.add('visible');

  const nameDisplay = document.getElementById('user-name-display');
  const groupDisplay = document.getElementById('sidebar-user-group');

  if (nameDisplay) nameDisplay.textContent = user.displayName || 'Nutzer';
  if (groupDisplay) groupDisplay.textContent = user.groupId || '';

  const adminBtn = document.getElementById('sidebar-admin-btn');
  const snapshotsBtn = document.getElementById('sidebar-snapshots-btn');
  const versionsBtn = document.getElementById('sidebar-versions-btn');
  const iniBtn = document.getElementById('sidebar-ini-btn');
  const loadIniBtn = document.getElementById('sidebar-load-ini-btn');
  const templateExportBtn = document.getElementById('sidebar-template-export-btn');
  const templateCloudSaveBtn = document.getElementById('sidebar-template-cloud-save-btn');
  const cloudSaveLabel = document.getElementById('sidebar-cloud-save-label');
  const forwardTutorBtn = document.getElementById('sidebar-forward-tutor-btn');
  const submissionFileBtn = document.getElementById('sidebar-submission-file-btn');
  const abgabeLabel = document.getElementById('fm-abgabe-label'); // nur in der datenbankfreien Version vorhanden
  const returnBtn = document.getElementById('sidebar-return-to-student-btn');
  const returnCloudBtn = document.getElementById('sidebar-return-cloud-btn');
  const fmIniLabel = document.getElementById('fm-ini-label');
  const fmAssessment = document.getElementById('fm-assessment-section');
  const badge = document.getElementById('sidebar-role-badge');

  if (isStudent) {
    if (adminBtn) adminBtn.style.display = 'none';
    if (snapshotsBtn) snapshotsBtn.style.display = 'none';
    if (versionsBtn) versionsBtn.style.display = 'none';
    if (iniBtn) iniBtn.style.display = 'none';
    if (loadIniBtn) loadIniBtn.style.display = 'none';
    if (templateExportBtn) templateExportBtn.style.display = 'none';
    if (templateCloudSaveBtn) templateCloudSaveBtn.style.display = 'none';
    if (cloudSaveLabel) cloudSaveLabel.textContent = 'Privat in Datenbank speichern';
    if (forwardTutorBtn) forwardTutorBtn.style.display = '';
    if (submissionFileBtn) submissionFileBtn.style.display = '';
    if (abgabeLabel) abgabeLabel.style.display = '';
    if (returnBtn) returnBtn.style.display = 'none';
    if (returnCloudBtn) returnCloudBtn.style.display = 'none';
    if (fmIniLabel) fmIniLabel.style.display = 'none';
    if (fmAssessment) fmAssessment.style.display = 'none';

    if (badge) {
      badge.textContent = 'SchülerIn';
      badge.style.background = 'rgba(34,197,94,0.15)';
      badge.style.color = '#4ade80';
      badge.style.borderColor = 'rgba(34,197,94,0.35)';
    }

    S.isAdminMode = false;
  } else {
    if (adminBtn) adminBtn.style.display = '';
    if (snapshotsBtn) snapshotsBtn.style.display = '';
    if (versionsBtn) versionsBtn.style.display = '';
    if (iniBtn) iniBtn.style.display = '';
    if (loadIniBtn) loadIniBtn.style.display = '';
    if (templateExportBtn) templateExportBtn.style.display = '';
    if (templateCloudSaveBtn) templateCloudSaveBtn.style.display = '';
    if (cloudSaveLabel) cloudSaveLabel.textContent = 'Verschlüsselt in Datenbank speichern';
    if (forwardTutorBtn) forwardTutorBtn.style.display = 'none';
    if (submissionFileBtn) submissionFileBtn.style.display = 'none';
    if (abgabeLabel) abgabeLabel.style.display = 'none';
    if (returnBtn) returnBtn.style.display = '';
    if (returnCloudBtn) returnCloudBtn.style.display = '';
    if (fmIniLabel) fmIniLabel.style.display = '';
    if (fmAssessment) fmAssessment.style.display = '';

    if (badge) {
      badge.textContent = 'Tutor';
      badge.style.background = 'rgba(99,102,241,0.2)';
      badge.style.color = '#818cf8';
      badge.style.borderColor = 'rgba(99,102,241,0.35)';
    }

    S.isAdminMode = true;
  }

  const sidebar = document.getElementById('sidebar-el');

  if (sidebar) {
    if (window.innerWidth <= 640) sidebar.classList.add('collapsed');
    else sidebar.classList.remove('collapsed');
  }

  S.currentBoard = null;

  if (typeof showEmptyState === 'function') showEmptyState();

  if (typeof loadSavedBg === 'function') loadSavedBg();
  if (typeof loadSavedOverlay === 'function') loadSavedOverlay();
  if (typeof loadSavedTheme === 'function') loadSavedTheme();
  if (typeof loadImageCount === 'function') loadImageCount();
  if (typeof loadAgingUnit === 'function') loadAgingUnit();
  if (typeof loadBoards === 'function') loadBoards(true);

  // Nach dem Einstieg ggf. an die Datei-Sicherung erinnern
  if (typeof window.checkBackupReminder === 'function') {
    setTimeout(() => window.checkBackupReminder(), 3500);
  }
}

// ── PROFIL BEARBEITEN (Tutor) ────────────────────────────
window.openProfileEdit = function() {
  const user = getUser();
  const modal = document.getElementById('modal-profile-edit');

  if (!modal) return;

  document.getElementById('edit-profile-name').value = user.displayName || '';
  document.getElementById('edit-profile-group').value = user.groupId || '';

  modal.style.display = 'flex';
};

window.saveProfileEdit = function() {
  const name = document.getElementById('edit-profile-name')?.value.trim() || '';
  const group = document.getElementById('edit-profile-group')?.value.trim() || '';

  if (!name) return;

  const user = {
    displayName: name,
    groupId: group || 'default'
  };

  saveUser(user);

  S.currentUser = user;

  const nd = document.getElementById('user-name-display');
  const gd = document.getElementById('sidebar-user-group');

  if (nd) nd.textContent = name;
  if (gd) gd.textContent = group;

  closeModal('modal-profile-edit');
  showToast('Profil gespeichert');
};

// ── INI-DATEI LADEN ──────────────────────────────────────
// iPad-Fix:
// Für INI-Dateien wird absichtlich kein accept-Attribut gesetzt.
// iPadOS stuft .ini-Dateien sonst häufig als nicht auswählbar ein.
window.loadTeacherIni = function() {
  let input = document.getElementById('teacher-ini-file-input');

  if (!input) {
    input = document.createElement('input');
    input.type = 'file';
    input.id = 'teacher-ini-file-input';
    input.style.position = 'absolute';
    input.style.left = '-9999px';
    input.style.width = '1px';
    input.style.height = '1px';
    input.style.opacity = '0';
    input.addEventListener('change', window.loadTeacherIniFromFile);
    document.body.appendChild(input);
  }

  prepareIniFileInput(input);

  input.value = '';
  input.click();
};

window.loadTeacherIniFromFile = async function(event) {
  const input = event?.target;
  prepareIniFileInput(input);

  const file = input?.files?.[0];

  if (!file) return;

  try {
    const text = await readTextFile(file);
    const iniObj = JSON.parse(text);

    if (!iniObj.kanbanfluss_ini) {
      throw new Error('Keine gültige INI-Datei.');
    }

    if (!iniObj.encryptedPrivateKey && !iniObj.publicKey) {
      throw new Error('Diese INI-Datei enthält keinen passenden Schlüssel.');
    }

    window._loadedIni = iniObj;

    try {
      sessionStorage.setItem('kf_loaded_ini', JSON.stringify(iniObj));
    } catch(e) { /* ignorieren */ }

    // Neuer Tutor-Schlüssel (mit privatem Schlüssel): auf dem Gerät merken,
    // damit Speichern/Öffnen dauerhaft ohne Passwort funktioniert.
    if (iniObj.privateKey) {
      try { localStorage.setItem('kf_tutor_ini', JSON.stringify(iniObj)); } catch(e) { /* ignorieren */ }
    }

    const session = window._kfSession;

    if (session?.isStudent) {
      session.teacherPublicKeyJwk = iniObj.publicKey;
      session.teacherName = iniObj.teacherName;

      const cfg = getStudentConfig() || {};
      cfg.publicKeyJwk = iniObj.publicKey;
      cfg.teacherName = iniObj.teacherName;
      saveStudentConfig(cfg);
    }

    const firstRunSetup = document.getElementById('first-run-setup');
    const profileError = document.getElementById('profile-error');

    if (profileError) profileError.textContent = '';
    if (firstRunSetup) firstRunSetup.style.display = 'block';

    showToast(`INI von "${iniObj.teacherName || 'Tutor'}" geladen`);
  } catch(e) {
    showToast('Fehler beim Laden der INI-Datei: ' + e.message, 'error');
  } finally {
    if (input) input.value = '';
  }
};

// ── ABMELDEN ─────────────────────────────────────────────
window.logoutUser = async function() {
  const isStudent = window._kfSession?.isStudent || getStoredRole() === 'schueler';

  const ok = await showConfirm(
    '⚠️ Abmelden?\n\nAlle Boards und Daten werden von diesem Gerät gelöscht.\nVorher exportieren falls nötig!',
    'Ja, abmelden & löschen',
    'Abbrechen'
  );

  if (!ok) return;

  localStorage.removeItem('kf_user');
  localStorage.removeItem('kanban_data');
  localStorage.removeItem('kanban_settings');
  localStorage.removeItem(STUDENT_CFG_KEY);
  localStorage.removeItem('kf_tutor_ini');

  window._kfSession = null;
  window._tutorSession = null;

  sessionStorage.removeItem('kf_auto_login');
  sessionStorage.removeItem('kf_return_keys');
  sessionStorage.removeItem('kf_loaded_ini');
  sessionStorage.removeItem('kf_last_student_cloud_meta');

  setGuestMode('');

  if (isStudent) setStoredRole('schueler');
  else setStoredRole('');

  if (typeof window.resetToolsSession === 'function') window.resetToolsSession();
  if (typeof window.resetAdminSession === 'function') window.resetAdminSession();

  S.currentBoard = null;
  S.currentUser = null;

  if (typeof showEmptyState === 'function') showEmptyState();

  document.getElementById('app-screen').classList.remove('visible');

  if (isStudent) {
    document.getElementById('auth-screen').style.display = 'none';

    const ss = document.getElementById('student-auth-screen');
    if (ss) ss.style.display = 'flex';

    showStudentIniLogin();
  } else {
    const ss = document.getElementById('student-auth-screen');
    if (ss) ss.style.display = 'none';

    document.getElementById('auth-screen').style.display = 'flex';

    const el = document.getElementById('profile-name');

    if (el) {
      el.value = '';
      setTimeout(() => el.focus(), 100);
    }
  }
};

// ── ENTER-TASTEN ──────────────────────────────────────────
document.addEventListener('DOMContentLoaded', () => {
  [
    ['profile-name', () => saveProfile()],
    ['edit-profile-name', () => saveProfileEdit()],
    ['student-reg-name', () => submitStudentRegister()],
    ['admin-password-input', () => doAdminLogin()],
  ].forEach(([id, fn]) => {
    const el = document.getElementById(id);

    if (el) {
      el.addEventListener('keydown', e => {
        if (e.key === 'Enter') fn();
      });
    }
  });

  [
    'ini-file-input',
    'student-ini-file-input',
    'teacher-ini-file-input',
    'teacher-ini-file-input-first-run'
  ].forEach(id => {
    const input = document.getElementById(id);
    prepareIniFileInput(input);
  });
});