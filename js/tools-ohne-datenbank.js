// js/tools.js — KI-Assistent, Export, Import, Agenda, INI (lokal, kein Firebase)
import { S, getBoards, getColumns, getCards, createBoard, createColumn,
  createCard, deleteCard, updateBoard, replaceCards,
  saveLocalVersion, getLocalVersions, restoreLocalVersion, deleteLocalVersion } from './state.js';

window.showCreateIniModal = function() {
  const modal = document.getElementById('modal-create-ini');
  if (!modal) {
    showToast('INI-Dialog nicht gefunden.', 'error');
    return;
  }

  const profileName = document.getElementById('profile-name')?.value.trim() || S.currentUser?.displayName || '';
  const nameEl = document.getElementById('ini-teacher-name');
  const errEl = document.getElementById('ini-create-error');
  if (nameEl && !nameEl.value.trim()) nameEl.value = profileName;
  if (errEl) { errEl.textContent = ''; errEl.classList.remove('show'); }
  modal.style.display = 'flex';
  setTimeout(() => nameEl?.focus(), 80);
  if (typeof reloadIcons === 'function') reloadIcons();
};

// Datei speichern: Save-Dialog wo verfügbar, sonst Download (iPad/Safari)
async function _saveTextFile(json, suggestedName, description) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description, accept: { 'application/json': ['.ini', '.json'] } }],
      });
      const w = await handle.createWritable();
      await w.write(json);
      await w.close();
      return true;
    } catch(e) {
      if (e.name === 'AbortError') return false;
      /* Fallback unten */
    }
  }
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = suggestedName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  return true;
}

// ── TUTOR-SCHLÜSSEL ERSTELLEN (passwortfrei, zwei Dateien) ──
// 1. Privater Tutor-Schlüssel (bleibt beim Tutor, ersetzt das Masterpasswort)
// 2. Verteil-INI für Schülerinnen und Schüler (nur öffentlicher Schlüssel)
window.createTeacherIniFile = async () => {
  const name  = document.getElementById('ini-teacher-name')?.value.trim() || '';
  const errEl = document.getElementById('ini-create-error');
  errEl.textContent = '';

  if (!name) { errEl.textContent = 'Bitte Namen eingeben.'; return; }

  const btn = document.getElementById('ini-create-btn');
  btn.disabled = true; btn.textContent = 'Schlüssel werden generiert…';

  try {
    const { privateJson, publicJson } = await window.kfCrypto.createTutorKeyFiles(name);
    const iniObj = JSON.parse(privateJson);
    const safeName = name.replace(/\s+/g, '_');
    const privateName = `eduban-tutor-${safeName}-SCHLUESSEL-privat.ini`;
    const publicName  = `eduban-tutor-${safeName}-fuer-schueler.ini`;

    // 1. Privater Schlüssel (zuerst, wichtigste Datei)
    showToast('1/2: Privaten Tutor-Schlüssel speichern (bleibt bei dir!)');
    const ok1 = await _saveTextFile(privateJson, privateName, 'EDUBAN Tutor-Schlüssel (privat)');
    if (!ok1) throw new Error('Speichern abgebrochen.');

    // 2. Verteil-INI für die Schülerinnen und Schüler
    showToast('2/2: Verteil-INI für deine Schülerinnen und Schüler speichern');
    await _saveTextFile(publicJson, publicName, 'EDUBAN Verteil-INI (für Schüler)');

    // Privaten Schlüssel für diese Sitzung und dieses Gerät merken
    window._loadedIni = iniObj;
    try { sessionStorage.setItem('kf_loaded_ini', JSON.stringify(iniObj)); } catch(e) { /* ignorieren */ }
    try { localStorage.setItem('kf_tutor_ini', JSON.stringify(iniObj)); } catch(e) { /* ignorieren */ }

    const setup = document.getElementById('first-run-setup');
    if (setup) setup.style.display = 'none';
    closeModal('modal-create-ini');
    showToast(`✅ Tutor-Schlüssel erstellt und geladen. Gib NUR "${publicName}" an deine Schülerinnen und Schüler weiter!`);

    const el = document.getElementById('ini-teacher-name');
    if (el) el.value = '';
  } catch(e) {
    errEl.textContent = 'Fehler: ' + e.message;
  } finally {
    btn.disabled = false; btn.innerHTML = '<i data-lucide="key-round" style="width:14px;height:14px;"></i> Schlüsseldateien erstellen & speichern'; if(typeof reloadIcons==='function') reloadIcons();
  }
};

// ── KI-PROMPT ─────────────────────────────────────────
// ── KI-ASSISTENT: PROMPT-GENERIERUNG ──────────────────────────────────
window.showAiPrompt = () => {
  if (!S.currentBoard) return;
  const promptEl = document.getElementById('ai-prompt-content');
  document.getElementById('modal-ai-prompt').style.display = 'flex';

  const boardName = S.currentBoard.name;
  const members   = S.currentBoard.members || [];
  const teamInfo  = members.length > 0 ? members.join(', ') : 'Einzelperson';
  const deadline  = S.currentBoard.deadline || 'Keine';

  // Aktuellen Board-Status für die KI textuell aufbereiten
  let currentBoardStateText = '';

  const groupInfos = (S.currentBoard.groupInfos && typeof S.currentBoard.groupInfos === 'object') ? S.currentBoard.groupInfos : {};
  const groupInfoEntries = Object.entries(groupInfos).filter(([key, info]) => key && info && (info.name || info.description));
  if (groupInfoEntries.length) {
    currentBoardStateText += '\nGruppeninfos (keine Aufgaben, nur blaue Infokarten vor Gruppenarbeiten):\n';
    groupInfoEntries.forEach(([key, info]) => {
      const name = info.name || key;
      const desc = info.description ? ` — ${info.description}` : '';
      currentBoardStateText += `   - ${key}: ${name}${desc}\n`;
    });
  }

  const milestones = S.currentBoard.milestones || [];
  if (milestones.length) {
    currentBoardStateText += '\nProjektphasen / Meilensteine:\n';
    milestones
      .slice()
      .sort((a, b) => (a.order ?? 0) - (b.order ?? 0))
      .forEach((m, idx) => {
        const labels = (m.requiredCardLabels || []).map(label => `[${label}]`).join(', ') || 'noch keine Karten zugeordnet';
        const desc = m.description ? ` — ${m.description}` : '';
        currentBoardStateText += `   ${idx + 1}. ${m.name}${desc} (erreicht durch: ${labels})\n`;
      });
  }
  const ideas = S.ideas || [];
  if (ideas.length) {
    currentBoardStateText += '\nIdeenbox (noch nicht im Board):\n';
    ideas.forEach(c => {
      const whoStr  = c.assignee ? ` [Zuständig: ${c.assignee}]` : ' [Zuständig: offen]';
      const descStr = c.description ? `\n      📝 ${c.description}` : '';
      currentBoardStateText += `   - ${c.text}${whoStr}${descStr}\n`;
    });
  }
  for (const col of S.columns) {
    const colWipLimit = col.wipLimit || 0;
    const limitText   = colWipLimit > 0 ? `(WIP-Limit: ${colWipLimit})` : '';
    currentBoardStateText += `\nSpalte: "${col.name}" ${limitText}\n`;
    const colCards = S.cards[col.id] || [];
    
    if (!colCards.length) {
      currentBoardStateText += '   (Aktuell leer)\n';
    } else {
      colCards.forEach(c => {
        const lbl      = c.label ? `[${c.label}] ` : '';
        const depsStr  = (c.dependencies && c.dependencies.length > 0) ? ` (Abhängig von: ${c.dependencies.map(d => `[${d}]`).join(', ')})` : '';
        const grpStr   = c.groupId ? ` (Gruppe: ${c.groupId})` : '';
        const whoStr   = c.assignee ? ` [Zuständig: ${c.assignee}]` : ' [Zuständig: offen]';
        
        // NEU: Dem KI-Assistenten die aktuell eingetragene Zeit mitteilen
        let timeStr = '';
        if (c.timeEstimate && (c.timeEstimate.d > 0 || c.timeEstimate.h > 0 || c.timeEstimate.m > 0)) {
          timeStr = ` [Bearbeitungszeit: ${c.timeEstimate.d}T ${c.timeEstimate.h}h ${c.timeEstimate.m}m]`;
        }
        
        const descStr  = c.description ? `\n      📝 ${c.description}` : '';
        currentBoardStateText += `   - ${lbl}${c.text}${whoStr}${timeStr}${depsStr}${grpStr}${descStr}\n`;
      });
    }
    
    if (colWipLimit > 0 && colCards.length >= colWipLimit) {
      currentBoardStateText += `   ⚠️ HINWEIS: Diese Spalte hat das WIP-Limit erreicht (${colCards.length}/${colWipLimit}).\n`;
    }
  }

  // Der aktualisierte Prompt mit Zeit-Regel
  const prompt = `Du bist ein Projektassistent für das Kanban-Board "${boardName}".

WICHTIGSTE REGELN FÜR DIE PLANUNG:
1. WIP-LIMITS: Diese gelten nur für Fortschritts-Spalten. Spalten wie "Offen" oder "Voraussetzungen" haben kein Limit.
2. EINDEUTIGE LABELS: Jede Karte MUSS ein absolut eindeutiges Kurz-Label haben (z.B. A, B, C). Keine Duplikate!
3. FERTIG-SPALTE: Diese Spalte ist tabu und wird von dir nicht beplant.
4. VORAUSSETZUNGEN: Plane vorbereitende Aufgaben in einer Spalte ganz links ein.
5. LÜCKENLOSES NETZ: Schaffe für alle Karten, die direkt mit dem Produkt zu tun haben, ein möglichst lückenloses Netz von Abhängigkeiten (deps). Jede Produkt-Aufgabe muss logisch im Arbeitsfluss verknüpft sein.
6. BOARD-ADMINISTRATION / ÜBERGEORDNETE AUFGABEN: Übergeordnete Aufgaben wie Boardmaster, Materialwache, Dokumentation, Sicherheitscheck oder Moderationskoordination müssen pro Meilenstein separat angelegt werden. Beispiel: nicht eine einzige Karte "Boardmaster", sondern "Boardmaster Phase 1", "Boardmaster Phase 2", "Boardmaster Phase 3" usw. Nutze diese Wiederholung bewusst, um die Zuständigkeit zwischen Teammitgliedern zu variieren.
7. KEINE ABHÄNGIGKEIT BEI ADMIN: Übergeordnete Aufgaben dürfen KEINE direkten Abhängigkeiten (deps) zu Produkt-Aufgaben haben, außer sie sind fachlich wirklich Voraussetzung für genau diese Phase.
8. VERKETTUNGEN: Nutze das Feld "gruppe" nur für echte Gruppenarbeiten, bei denen mindestens zwei Karten denselben Gruppennamen tragen und parallel zusammengehören. Nutze "gruppe" NICHT als Kategorie, Phase, Experimentname oder Show-Schritt; lasse es dann leer.
8a. GRUPPEN-INFOKARTEN: Für jede echte Gruppenarbeit darfst du zusätzlich im obersten JSON-Feld "gruppen" eine Gruppenbeschreibung anlegen. Diese Gruppen sind KEINE Aufgaben. Sie erzeugen nur blaue Infokarten vor der ersten Karte einer Gruppe.
8b. GRUPPEN-KONSISTENZ: Der Wert in "gruppen[].id" muss exakt dem Wert entsprechen, der bei den Karten im Feld "gruppe" verwendet wird.
9. BESCHREIBUNG: Füge für jede nicht-triviale Aufgabe eine detaillierte Erläuterung im Feld 'beschreibung' hinzu (2–5 Sätze). Bestehende Beschreibungen unbedingt übernehmen! Ergänze immer an welchen Kriterien festgemacht werden kann, dass die Aufgabe gut gelöst wurde.
10. BEARBEITUNGSZEIT: Schätze für jede Aufgabe die REINE NETTO-ARBEITSZEIT in Tagen (d), Stunden (h) und Minuten (m). Berechne KEINE Enddaten/Fälligkeiten daraus, da der Projektstart variabel ist!
12. STARTVERSATZ & LEERLAUF MINIMIEREN: Gib für jede Karte im Feld 'startversatz' an, ab welchem Projekttag (Dezimalzahl, 0.0 = Projektstart, 1.0 = zweiter Tag) mit der Aufgabe begonnen werden soll. Plane so, dass der Leerlauf einzelner Teilnehmer möglichst gering ist: Wenn jemand auf Vorgänger-Aufgaben wartet, belege diese Wartezeit mit sinnvollen Parallelaufgaben dieser Person. Der 'startversatz' darf nie kleiner sein als das Ende aller Vorgänger-Aufgaben (deps) dieser Person.
11. Es darf niemals vorkommen, dass eine Person innerhalb einer Gruppenarbeit mehr als eine Aufgaben übernimmt. Es darf nicht vorkommen, dass eine Task in einer Grppenarbeit in der Verkettungslogig oberhalb oder unterhalb einer anderen Task in der selben Gruppenarbeit ist.
13. Achte darauf, dass es durch die verkettungen keine Zirkelschlüsse gibt.
14. Belasse es bei den Spalten im board, erfinde keine hinzu.
15. Bei der Erstellung eines neuen Boards sortiere alle Karten in Voraussetzungen und in Vorbereitung ein.
16. Du darfst keine weiteren Mitarbeiter dazu erfinden indbesondere nicht so etwas wie "alle Mitarbeiter" Eine einzelne Karte muss immer exekt einer Person zugeordnet werden und auch bei einer Gruppenaufgabe eine spezielle Aufgabe für diese Person enthalten.
17. Falls der aktuelle Stand des Boardes bereits gegen einer dieser Regeln verstösst gebe eine Warnung aus und mache Vorschläge zur Bereinigung.
18. Ausfürliche Beschreibungen der Aufgaben bitte auch immer mit angeben woran man erkannen kann, dass die aufgabe gut gelöst wurde.
19. PROJEKTPHASEN / MEILENSTEINE: Schlage sinnvolle Projektphasen vor, die nacheinander erreicht werden. Jede Phase wird durch konkrete Kartenlabels erfüllt. Typische Phasen sind Vorbereitung, Recherche, Produktentwurf, Präsentation, Reflexion. Alle Karten einer früheren Phase müssen abgeschlossen sein, bevor die nächste Phase beginnen kann. Aufgaben in der Spalte "Voraussetzungen" gelten für Meilensteine als bereits erfüllt, sind aber keine Bewertungsaufgaben.
20. MEILENSTEIN-ZUORDNUNG: Jede Karte, die zu einer Phase gehört, muss im passenden Meilenstein unter "karten" aufgeführt werden. Wenn eine übergeordnete Aufgabe während mehrerer Phasen gebraucht wird, erstelle für jede Phase eine eigene Karte mit eigenem Label und eigener zuständiger Person.

AKTUELLER STAND DES BOARDS:
${currentBoardStateText}

RAHMENDATEN:
- Team: ${teamInfo}
- Deadline: ${deadline}

DEINE AUFGABE:
1. Analysiere den Stand, frage nach fehlenden Infos und optimiere das Netz der Abhängigkeiten.
2. Wenn der Nutzer "FERTIG" sagt oder eine neue Planung wünscht, gib die finale Struktur als JSON-Array aus.

AUSGABEFORMAT (STRENGES JSON):
Gib entweder ein JSON-Array aus, wobei jedes Objekt eine Spalte repräsentiert, oder ein Objekt mit "meilensteine" und "spalten".
Dies ist ein Beispiel:
{
  "gruppen": [
    {
      "id": "Recherche",
      "name": "Recherchegruppe",
      "beschreibung": "Diese Gruppe sammelt Quellen, prüft Material und bereitet die fachlichen Grundlagen vor."
    }
  ],
  "meilensteine": [
    {
      "name": "Vorbereitung",
      "beschreibung": "Grundlagen sind geklärt.",
      "karten": ["A", "B", "D"]
    }
  ],
  "spalten": [
    {
      "spalte": "Name der Spalte",
      "karten": [
        {
          "label": "Eindeutige ID",
          "titel": "Beschreibung der Aufgabe",
          "prio": "hoch/mittel/niedrig",
          "deadline": "YYYY-MM-DD oder leer",
          "wer": "Zuständige Person",
          "deps": ["Label1", "Label2"],
          "gruppe": "Optionaler Gruppenname",
          "beschreibung": "Detaillierte Erläuterung (2-5 Sätze)...",
          "zeit": { "d": 0, "h": 2, "m": 30 },
          "startversatz": 0.0
        }
      ]
    }
  ]
}`;

  promptEl.textContent = prompt;
};

// Hilfsfunktion zum Kopieren (nutzt lokale Lucide-Icons nach dem Timeout)
window.copyAiPrompt = async () => {
  const text = document.getElementById('ai-prompt-content').textContent;
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('ai-prompt-copy-btn');
    btn.textContent = '✓ Kopiert!';
    setTimeout(() => { 
      // Zurück zum Icon-Zustand (Wichtig: Lucide Icons müssen lokal eingebunden sein)
      btn.innerHTML = '<i data-lucide="copy" style="width:13px;height:13px;margin-right:4px;"></i> Prompt kopieren'; 
      if(typeof reloadIcons === 'function') reloadIcons();
    }, 2000);
  } catch(e) {
    alert('Fehler beim Kopieren in die Zwischenablage.');
  }
};

// ── TEXT-EXPORT ───────────────────────────────────────
window.showExport = () => {
  if (!S.currentBoard) return;
  const pre = document.getElementById('export-content');
  document.getElementById('modal-export').style.display = 'flex';

  const deadline = S.currentBoard.deadline || '';
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const fmtDate     = iso => { if (!iso) return ''; const d = new Date(iso); return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()}`; };
  const fmtDateTime = iso => { if (!iso) return ''; const d = new Date(iso); return `${pad(d.getDate())}.${pad(d.getMonth()+1)}.${d.getFullYear()}, ${pad(d.getHours())}:${pad(d.getMinutes())} Uhr`; };
  const daysSince   = iso => { if (!iso) return null; return Math.floor((now - new Date(iso)) / 86400000); };
  const dueStatus   = due => {
    if (!due) return '';
    const d = new Date(due); d.setHours(0,0,0,0); const t = new Date(); t.setHours(0,0,0,0);
    const diff = Math.ceil((d - t) / 86400000);
    if (diff < 0)   return ` [ÜBERFÄLLIG seit ${Math.abs(diff)} Tag${Math.abs(diff)!==1?'en':''}]`;
    if (diff === 0) return ' [FÄLLIG HEUTE]';
    if (diff <= 2)  return ` [fällig in ${diff} Tag${diff!==1?'en':''}]`;
    return '';
  };

  const sep  = '─'.repeat(60);
  const sep2 = '═'.repeat(60);
  let lines  = [];

  lines.push(sep2);
  lines.push(`  KANBAN-BOARD: ${S.currentBoard.name.toUpperCase()}`);
  lines.push(`  Exportiert am: ${fmtDateTime(now.toISOString())}`);
  if (deadline) {
    const dl   = new Date(deadline);
    const diff = Math.ceil((dl - now) / 86400000);
    const cdText = diff < 0 ? ` — Abgabe war vor ${Math.abs(diff)} Tag${Math.abs(diff)!==1?'en':''}!` : diff === 0 ? ' — Abgabe heute!' : ` — noch ${diff} Tag${diff!==1?'e':''}`;
    lines.push(`  Abgabetermin:  ${fmtDate(deadline)}${cdText}`);
  }
  lines.push(sep2); lines.push('');

  const ideas = S.ideas || [];
  lines.push(sep);
  lines.push(`  IDEEN  (${ideas.length} Karte${ideas.length!==1?'n':''})`);
  lines.push(sep);
  if (!ideas.length) {
    lines.push('  (keine Ideen)');
    lines.push('');
  } else {
    ideas.forEach((card, idx) => {
      lines.push(`  ${idx + 1}. ${card.text}`);
      if (card.description) {
        const formattedDesc = card.description.replace(/\n/g, '\n                 ');
        lines.push(`     Beschreibung: ${formattedDesc}`);
      }
      if (card.timeEstimate && (card.timeEstimate.d > 0 || card.timeEstimate.h > 0 || card.timeEstimate.m > 0)) {
        const te = card.timeEstimate;
        const timeParts = [];
        if (te.d > 0) timeParts.push(`${te.d}T`);
        if (te.h > 0) timeParts.push(`${te.h}h`);
        if (te.m > 0) timeParts.push(`${te.m}m`);
        lines.push(`     Geschätzte Zeit: ${timeParts.join(' ')}`);
      }
      if (card.priority) { const pMap = { hoch:'HOCH ▲', mittel:'MITTEL', niedrig:'NIEDRIG ▽' }; lines.push(`     Priorität:   ${pMap[card.priority] || card.priority}`); }
      if (card.assignee) lines.push(`     Zugewiesen:  ${card.assignee}`);
      if (card.due) lines.push(`     Fällig am:   ${fmtDate(card.due)}${dueStatus(card.due)}`);
      lines.push('');
    });
  }

  for (const col of S.columns) {
    const cCards = S.cards[col.id] || [];
    const isProgress = (col.name||'').toLowerCase().match(/bearbeitung|progress|doing/);
    lines.push(sep);
    lines.push(`  ${col.name.toUpperCase()}  (${cCards.length} Karte${cCards.length!==1?'n':''})`);
    lines.push(sep);
    if (!cCards.length) { lines.push('  (keine Karten)'); lines.push(''); continue; }
    
    cCards.forEach((card, idx) => {
      const lbl = card.label ? `[${card.label}] ` : '';
      lines.push(`  ${idx + 1}. ${lbl}${card.text}`);
      
      // NEU: Beschreibung einfügen
      if (card.description) {
        // Macht Einrückungen bei mehrzeiligen Beschreibungen sauberer
        const formattedDesc = card.description.replace(/\n/g, '\n                 ');
        lines.push(`     Beschreibung: ${formattedDesc}`);
      }
      
      // NEU: Bearbeitungszeit einfügen
      if (card.timeEstimate && (card.timeEstimate.d > 0 || card.timeEstimate.h > 0 || card.timeEstimate.m > 0)) {
        const te = card.timeEstimate;
        const timeParts = [];
        if (te.d > 0) timeParts.push(`${te.d}T`);
        if (te.h > 0) timeParts.push(`${te.h}h`);
        if (te.m > 0) timeParts.push(`${te.m}m`);
        lines.push(`     Geschätzte Zeit: ${timeParts.join(' ')}`);
      }

      if (card.priority) { const pMap = { hoch:'HOCH ▲', mittel:'MITTEL', niedrig:'NIEDRIG ▽' }; lines.push(`     Priorität:   ${pMap[card.priority] || card.priority}`); }
      if (card.assignee) lines.push(`     Zugewiesen:  ${card.assignee}`);
      if (card.due) lines.push(`     Fällig am:   ${fmtDate(card.due)}${dueStatus(card.due)}`);
      if (card.dependencies && card.dependencies.length > 0) lines.push(`     Voraussetz.: ${card.dependencies.map(d => `[${d}]`).join(', ')}`);
      if (card.groupId) lines.push(`     Verkettet:   Gruppe ${card.groupId}`);
      if (card.comments && card.comments.length > 0) { lines.push(`     Kommentare:`); card.comments.forEach(c => { const role = c.role === 'teacher' ? 'Tutor' : 'SchülerIn'; lines.push(`       - [${role}] ${c.text}`); }); }
      if (card.createdAt) lines.push(`     Erstellt:    ${fmtDateTime(card.createdAt)}`);
      if (isProgress && card.startedAt) {
        const days = daysSince(card.startedAt);
        const agingLimit = S.currentBoard?.agingDays || 5;
        const aging = days !== null && days >= agingLimit ? ` ⚠ AGING (>${agingLimit} Tage)` : '';
        lines.push(`     In Bearb. seit: ${fmtDate(card.startedAt)}  (${days !== null ? days + (days===1?' Tag':' Tage') : '?'}${aging})`);
      }
      if (card.finishedAt) lines.push(`     Fertiggestellt: ${fmtDate(card.finishedAt)}`);
      lines.push('');
    });
  }

  // Agenda
  lines.push(sep2); lines.push('  AGENDA – ALLE KARTEN NACH FÄLLIGKEIT'); lines.push(sep2); lines.push('');
  const allCards = [];
  S.columns.forEach(col => (S.cards[col.id] || []).forEach(c => allCards.push({ ...c, colName: col.name })));
  const withDue    = allCards.filter(c => c.due).sort((a,b) => new Date(a.due) - new Date(b.due));
  const withoutDue = allCards.filter(c => !c.due);
  if (withDue.length) {
    withDue.forEach(card => {
      const lbl = card.label ? `[${card.label}] ` : '';
      lines.push(`  ${fmtDate(card.due)}${dueStatus(card.due)}`);
      lines.push(`    → ${lbl}${card.text}${card.priority ? ` [${card.priority.toUpperCase()}]` : ''}`);
      lines.push(`       Spalte: ${card.colName}${card.assignee ? ' | Zugewiesen: ' + card.assignee : ''}`);
      lines.push('');
    });
  }
  if (withoutDue.length) {
    lines.push('  Ohne Fälligkeitsdatum:');
    withoutDue.forEach(card => { const lbl = card.label ? `[${card.label}] ` : ''; lines.push(`    · ${lbl}${card.text}${card.priority ? ` [${card.priority.toUpperCase()}]` : ''}  (${card.colName})`); });
    lines.push('');
  }
  const timelineLabels = S.currentBoard.timelineBlockLabels || {};
  const timelineEntries = Object.entries(timelineLabels)
    .filter(([, value]) => String(value || '').trim())
    .sort((a, b) => Number(a[0]) - Number(b[0]));
  if (timelineEntries.length) {
    lines.push('  Timeline-Blöcke:');
    timelineEntries.forEach(([idx, value]) => {
      lines.push(`    Block ${Number(idx) + 1}: ${value}`);
    });
    lines.push('');
  }
  const milestones = (S.currentBoard.milestones || []).slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  if (milestones.length) {
    lines.push('  Projektphasen / Meilensteine:');
    milestones.forEach((m, idx) => {
      const labels = (m.requiredCardLabels || []).map(label => `[${label}]`).join(', ') || 'keine Karten zugeordnet';
      lines.push(`    ${idx + 1}. ${m.name} — ${labels}`);
      if (m.description) lines.push(`       ${m.description}`);
    });
    lines.push('');
  }
  if (!allCards.length) lines.push('  (keine Karten)');

  // System-Backup
  const backupData = {
    isBackup: true, boardName: S.currentBoard.name, cardCounter: S.currentBoard.cardCounter || 0,
    ideaLibraryVersion: S.currentBoard.ideaLibraryVersion || 1,
    reflectionUnlocked: S.currentBoard.reflectionUnlocked || false,
    reflectionUnlockedAt: S.currentBoard.reflectionUnlockedAt || '',
    reflectionStarted: S.currentBoard.reflectionStarted || false,
    reflectionStartedAt: S.currentBoard.reflectionStartedAt || '',
    reflectionCompleted: S.currentBoard.reflectionCompleted || false,
    reflectionCompletedAt: S.currentBoard.reflectionCompletedAt || '',
    timelineBlockLabels: S.currentBoard.timelineBlockLabels || {},
    milestones: milestones.map((m, idx) => ({
      id: m.id || '',
      name: m.name || `Phase ${idx + 1}`,
      description: m.description || '',
      order: m.order ?? idx,
      requiredCardLabels: m.requiredCardLabels || []
    })),
    ideas: (S.ideas || []).map(c => ({
      text: c.text, priority: c.priority, assignee: c.assignee, due: c.due, label: '',
      dependencies: c.dependencies || [], comments: c.comments || [],
      groupId: c.groupId || '', startedAt: '', finishedAt: '', order: c.order,
      description: c.description || '', result: c.result || '', timeEstimate: c.timeEstimate || { d: 0, h: 0, m: 0 },
      phase: c.phase || '',
      templateCategory: c.templateCategory || ''
    })),
    columns: S.columns.map(col => ({
      name: col.name, color: col.color, order: col.order, wipLimit: col.wipLimit,
      cards: (S.cards[col.id] || []).map(c => ({
        text: c.text, priority: c.priority, assignee: c.assignee, due: c.due, label: c.label,
        dependencies: c.dependencies || [], comments: c.comments || [],
        groupId: c.groupId || '', startedAt: c.startedAt || '', finishedAt: c.finishedAt || '', order: c.order,
        // NEU: Daten ins Backup-Objekt aufnehmen
        description: c.description || '', result: c.result || '', timeEstimate: c.timeEstimate || { d: 0, h: 0, m: 0 },
        phase: c.phase || ''
      }))
    }))
  };
  lines.push(sep2); lines.push(''); lines.push('  === SYSTEM-BACKUP (FÜR IMPORT) ===');
  lines.push('  ' + JSON.stringify(backupData));

  pre.textContent = lines.join('\n');
};

window.copyExportToClipboard = async () => {
  const text = document.getElementById('export-content').textContent;
  try {
    await navigator.clipboard.writeText(text);
    const btn = document.getElementById('export-copy-btn');
    btn.textContent = '✓ Kopiert!';
    setTimeout(() => { btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect width="14" height="14" x="8" y="8" rx="2"/><path d="M4 16c-1.1 0-2-.9-2-2V4c0-1.1.9-2 2-2h10c1.1 0 2 .9 2 2"/></svg> In Zwischenablage kopieren'; }, 2000);
  } catch(e) { showToast('Kopieren fehlgeschlagen – bitte manuell markieren.', 'error'); }
};

// ── IMPORT ────────────────────────────────────────────
window.showImport = () => {
  document.getElementById('import-textarea').value = '';
  document.getElementById('import-preview').style.display   = 'none';
  document.getElementById('import-error').style.display     = 'none';
  document.getElementById('import-confirm-btn').style.display = 'none';
  S.importParsedData = null;
  document.getElementById('modal-import').style.display = 'flex';
};

function parseExportText(raw) {
  try {
    const normalizeAiJson = (text) => String(text || '')
      .replace(/^\s*```(?:json)?/i, '')
      .replace(/```\s*$/i, '')
      .replace(/[\u201c\u201d\u201e\u201f\u2033]/g, '"')
      .replace(/[\u2018\u2019\u201a\u201b\u2032]/g, "'")
      .replace(/\u00a0/g, ' ');
    const parseJsonLoose = (text) => JSON.parse(normalizeAiJson(text));
    const backupMarker = '=== SYSTEM-BACKUP';
    const backupIndex  = raw.indexOf(backupMarker);
    if (backupIndex !== -1) {
      const jsonStart = raw.indexOf('{', backupIndex);
      const jsonEnd   = raw.lastIndexOf('}') + 1;
      if (jsonStart !== -1 && jsonEnd > jsonStart) return parseJsonLoose(raw.slice(jsonStart, jsonEnd));
    }
    const arrStart = raw.indexOf('[');
    const objStart = raw.indexOf('{');
    const starts = [arrStart, objStart].filter(i => i !== -1);
    if (!starts.length) throw new Error('Kein gültiger JSON-Code oder System-Backup gefunden.');
    const start = Math.min(...starts);
    const end = raw[start] === '{' ? raw.lastIndexOf('}') + 1 : raw.lastIndexOf(']') + 1;
    if (end <= start) throw new Error('Kein gültiger JSON-Code oder System-Backup gefunden.');
    const data = parseJsonLoose(raw.slice(start, end));
    const rawColumns = Array.isArray(data) ? data : (data.spalten || data.columns || []);
    const rawMilestones = Array.isArray(data) ? [] : (data.meilensteine || data.milestones || []);
    const rawGroups = Array.isArray(data) ? [] : (data.gruppen || data.groups || data.groupInfos || {});
    const groupInfos = {};
    if (Array.isArray(rawGroups)) {
      rawGroups.forEach(g => {
        const key = String(g.id || g.gruppe || g.groupId || g.key || g.name || g.titel || '').trim();
        if (!key) return;
        groupInfos[key] = {
          name: String(g.name || g.titel || key).trim() || key,
          description: String(g.beschreibung || g.description || '').trim()
        };
      });
    } else if (rawGroups && typeof rawGroups === 'object') {
      Object.entries(rawGroups).forEach(([key, g]) => {
        const cleanKey = String(key || '').trim();
        if (!cleanKey) return;
        if (g && typeof g === 'object') {
          groupInfos[cleanKey] = {
            name: String(g.name || g.titel || cleanKey).trim() || cleanKey,
            description: String(g.beschreibung || g.description || '').trim()
          };
        } else {
          groupInfos[cleanKey] = { name: String(g || cleanKey).trim() || cleanKey, description: '' };
        }
      });
    }
    const milestones = rawMilestones.map((m, idx) => ({
      id: m.id || '',
      name: m.name || m.titel || `Phase ${idx + 1}`,
      description: m.beschreibung || m.description || '',
      order: m.order ?? idx,
      requiredCardLabels: (m.karten || m.cards || m.requiredCardLabels || [])
        .map(label => String(label || '').replace(/[\[\]]/g, '').trim().toUpperCase())
        .filter(Boolean)
    }));
    const columns = rawColumns.map(col => ({
      name: col.spalte || col.name || 'Neue Spalte', wipLimit: col.wipLimit || 0,
      cards: (col.karten || col.cards || []).map(card => ({
        label: card.label || '', text: card.titel || card.text || 'Aufgabe',
        priority: (card.prio || card.priority || '').toLowerCase(),
        due: card.deadline || card.due || '', assignee: card.wer || card.assignee || '',
        dependencies: Array.isArray(card.deps || card.dependencies) ? (card.deps || card.dependencies) : [],
        groupId: card.gruppe || card.groupId || '',
        
        description: card.beschreibung || card.description || '',
        result: card.ergebnis || card.result || '',
        timeEstimate: card.zeit || card.timeEstimate || { d: 0, h: 0, m: 0 },
        startOffset: card.startversatz ?? card.startOffset ?? null,

        comments: card.comments || [], startedAt: card.startedAt || '', finishedAt: card.finishedAt || ''
      }))
    }));
    const groupCounts = {};
    columns.forEach(col => col.cards.forEach(card => {
      if (!card.groupId) return;
      groupCounts[card.groupId] = (groupCounts[card.groupId] || 0) + 1;
    }));
    columns.forEach(col => col.cards.forEach(card => {
      if (card.groupId && groupCounts[card.groupId] < 2) card.groupId = '';
      if (card.groupId && !groupInfos[card.groupId]) {
        groupInfos[card.groupId] = { name: card.groupId, description: '' };
      }
    }));
    const boardName = Array.isArray(data)
      ? 'KI Planung'
      : (data.boardName || data.boardname || data.name || data.titel || 'KI Planung');
    return { isBackup: false, boardName, columns, milestones, groupInfos };
  } catch (e) { throw new Error('Das Format war nicht korrekt. Bitte kopiere den gesamten Text inkl. JSON.'); }
}

function getMembersFromImportColumns(columns) {
  const seen = new Set();
  const members = [];
  (columns || []).forEach(col => (col.cards || []).forEach(card => {
    const name = String(card.assignee || '').trim();
    const norm = name.toLowerCase();
    if (!name || ['-', '–', 'niemand', 'keine', 'offen'].includes(norm) || seen.has(norm)) return;
    seen.add(norm);
    members.push(name);
  }));
  return members;
}

function importLabelToNumber(label) {
  const s = String(label || '').trim().toUpperCase();
  if (!/^[A-Z]+$/.test(s)) return null;
  let num = 0;
  for (const ch of s) num = num * 26 + (ch.charCodeAt(0) - 64);
  return num - 1;
}

function getImportColumnsWithLabels(columns, startCounter = 0) {
  let counter = startCounter || 0;
  return (columns || []).map(col => ({
    ...col,
    cards: (col.cards || []).map((card, idx) => {
      let label = card.label || '';
      if (!label) {
        label = window.numberToLabel ? window.numberToLabel(counter) : `K${counter}`;
        counter++;
      }
      return { ...card, label, order: card.order ?? idx };
    })
  }));
}

function getImportCardCounter(columns, startCounter = 0) {
  let highest = startCounter || 0;
  (columns || []).forEach(col => (col.cards || []).forEach(card => {
    const label = String(card.label || '').trim().toUpperCase();
    const n = importLabelToNumber(label);
    if (Number.isFinite(n)) highest = Math.max(highest, n + 1);
  }));
  return highest;
}

function createBoardFromImport(parsed, { isBackup = false } = {}) {
  const rawColumns = parsed.columns || [];
  const columns = getImportColumnsWithLabels(rawColumns, parsed.cardCounter || 0);
  const members = getMembersFromImportColumns(columns);
  const importedWip = parsed.wipLimit ?? S.currentBoard?.wipLimit;
  const wipLimit = importedWip ?? Math.max(2, Math.ceil(Math.max(1, members.length) * 1.5));
  const board = createBoard({
    name: isBackup ? `${parsed.boardName || 'Backup'} (Backup)` : (parsed.boardName || 'KI Planung'),
    members,
    wipLimit,
    cardCounter: getImportCardCounter(columns, parsed.cardCounter || 0),
    ownerName: S.currentUser?.displayName || '',
    groupId: S.currentUser?.groupId || '',
    ideas: Array.isArray(parsed.ideas) ? parsed.ideas : undefined,
    ideaLibraryVersion: parsed.ideaLibraryVersion,
    reflectionUnlocked: parsed.reflectionUnlocked || false,
    reflectionUnlockedAt: parsed.reflectionUnlockedAt || '',
    reflectionStarted: parsed.reflectionStarted || false,
    reflectionStartedAt: parsed.reflectionStartedAt || '',
    reflectionCompleted: parsed.reflectionCompleted || false,
    reflectionCompletedAt: parsed.reflectionCompletedAt || '',
    timelineBlockLabels: parsed.timelineBlockLabels || {},
    milestones: parsed.milestones || [],
    groupInfos: (parsed.groupInfos && typeof parsed.groupInfos === 'object') ? parsed.groupInfos : {}
  });

  let colOrder = 0;
  let importedCardsCount = 0;
  for (const importCol of columns) {
    if (!importCol || !importCol.name) continue;
    const newCol = createColumn(board.id, {
      name: importCol.name,
      color: importCol.color || '#5c6ef8',
      order: importCol.order ?? colOrder++,
      wipLimit: importCol.wipLimit || 0
    });
    for (const card of (importCol.cards || [])) {
      createCard(board.id, newCol.id, {
        text: card.text || 'Ohne Titel',
        priority: card.priority || '',
        assignee: card.assignee || '',
        due: card.due || '',
        label: card.label || '',
        dependencies: card.dependencies || [],
        groupId: card.groupId || '',
        description: card.description || '',
        result: card.result || '',
        timeEstimate: card.timeEstimate || { d: 0, h: 0, m: 0 },
        phase: card.phase || '',
        startOffset: card.startOffset ?? null,
        comments: card.comments || [],
        order: card.order ?? importedCardsCount,
        startedAt: card.startedAt || '',
        finishedAt: card.finishedAt || ''
      });
      importedCardsCount++;
    }
  }

  return { board, importedCardsCount, membersCount: members.length };
}

window.parseImportPreview = () => {
  const raw    = document.getElementById('import-textarea').value.trim();
  const errEl  = document.getElementById('import-error');
  const preEl  = document.getElementById('import-preview');
  const btnEl  = document.getElementById('import-confirm-btn');
  errEl.style.display = preEl.style.display = btnEl.style.display = 'none';
  S.importParsedData = null;
  if (!raw) { errEl.textContent = 'Bitte zuerst den Text oder JSON-Code einfügen.'; errEl.style.display = 'block'; return; }
  let parsed;
  try { parsed = parseExportText(raw); } catch(e) { errEl.textContent = 'Fehler beim Lesen: ' + e.message; errEl.style.display = 'block'; return; }
  S.importParsedData = parsed;
  const totalCards = parsed.columns.reduce((s, c) => s + c.cards.length, 0);
  const milestoneCount = (parsed.milestones || []).length;
  const groupInfoEntries = Object.entries(parsed.groupInfos || {});
  const members = getMembersFromImportColumns(parsed.columns);
  let html = `<strong>${parsed.isBackup ? 'Sicherungskopie' : 'KI-Planung'} erkannt:</strong> ${parsed.columns.length} Spalte(n), ${totalCards} Karte(n), ${members.length} Beteiligte${milestoneCount ? `, ${milestoneCount} Meilenstein(e)` : ''}${groupInfoEntries.length ? `, ${groupInfoEntries.length} Gruppeninfo(s)` : ''}<br><br>`;
  html += `<div style="color:var(--accent); font-weight:bold; margin-bottom:10px;">${parsed.isBackup ? '⚠️ Dies ist ein Backup.' : 'ℹ️ KI-Import'} Es wird immer ein neues Board angelegt und danach automatisch geöffnet.</div>`;
  if (members.length) html += `<div style="margin-bottom:10px;"><strong>Beteiligte:</strong> ${members.map(m => escHtml(m)).join(', ')}</div>`;
  if (groupInfoEntries.length) {
    html += `<div style="margin-bottom:10px;"><strong>Gruppen:</strong> ${groupInfoEntries.map(([key, info]) => `${escHtml(info.name || key)}${info.description ? ` <span style="opacity:0.65;">(${escHtml(info.description)})</span>` : ''}`).join(', ')}</div>`;
  }
  parsed.columns.forEach(col => {
    html += `<div style="margin-bottom:8px;"><strong style="color:var(--accent);">${escHtml(col.name)}</strong> (${col.cards.length})<br>`;
    col.cards.forEach(c => {
      const prio = c.priority ? ` <span class="card-priority priority-${c.priority}" style="font-size:9px;">${c.priority}</span>` : '';
      const lbl  = c.label ? `<strong>[${c.label}]</strong> ` : '<strong style="color:var(--accent);">[NEU]</strong> ';
      const desc = c.description ? `<div style="font-size:11px; margin-left:18px; opacity:0.65; font-style:italic; margin-top:2px;">📝 ${escHtml(c.description)}</div>` : '';
      html += `<div style="font-size:12px; margin-left:10px; opacity:0.9;">→ ${lbl}${escHtml(c.text)}${prio}${c.due ? ` · 📅 ${c.due}` : ''}${c.assignee ? ` · 👤 ${escHtml(c.assignee)}` : ''}</div>${desc}`;
    });
    html += '</div>';
  });
  preEl.innerHTML = html; preEl.style.display = 'block'; btnEl.style.display = 'inline-flex';
};

window.confirmImport = () => {
  if (!S.importParsedData) return;
  const btn = document.getElementById('import-confirm-btn');
  btn.disabled = true;
  const isBackup = S.importParsedData.isBackup;

  try {
    btn.textContent = isBackup ? 'Erstelle neues Board aus Backup…' : 'Erstelle neues Board aus KI-Planung…';
    const { board, importedCardsCount, membersCount } = createBoardFromImport(S.importParsedData, { isBackup });
    closeModal('modal-import');
    S.boards = getBoards();
    if (typeof renderBoardsList === 'function') renderBoardsList();
    if (typeof selectBoard === 'function') selectBoard(board.id);
    showToast(isBackup
      ? `✅ Backup als neues Board wiederhergestellt!`
      : `✅ KI-Planung als neues Board erstellt: ${importedCardsCount} Karte(n), ${membersCount} Beteiligte.`);
  } catch(e) {
    console.error('Fehler beim Importieren:', e);
    showToast('Fehler beim Import: ' + e.message, 'error');
  }
  btn.disabled = false;
  btn.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="margin-right:4px;"><path d="M20 6 9 17l-5-5"/></svg> Jetzt importieren';
};


// ── PASSWORT-DIALOG (Tutor-Exporte) ─────────────────────
let _teacherSessionPassword = null;

// Einfacher Passwort-Dialog für SchülerInnen (bei zurückgegebener Datei mit anderem Passwort)
function _showStudentPasswordDialog(teacherName) {
  return new Promise(resolve => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.65);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px;';
    const box = document.createElement('div');
    box.style.cssText = 'background:rgba(var(--panel-rgb),0.97);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:28px 24px 20px;max-width:380px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.5);';
    box.innerHTML = `
      <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:8px;display:flex;align-items:center;gap:8px;"><i data-lucide="lock" style="width:18px;height:18px;"></i> Datei entschlüsseln</div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:16px;line-height:1.5;">
        Diese Datei wurde mit einem anderen Passwort exportiert.<br>
        Gib das Passwort ein, das du beim Export verwendet hast${teacherName ? ` (Tutor: <strong>${teacherName}</strong>)` : ''}.
      </div>
      <div style="margin-bottom:16px;">
        <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Dein Export-Passwort</label>
        <input id="_stu-pw-i" type="password" placeholder="Passwort eingeben"
          style="width:100%;box-sizing:border-box;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);font-size:14px;outline:none;"/>
      </div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="_stu-pw-cancel" style="padding:8px 18px;font-size:13px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer;">Abbrechen</button>
        <button id="_stu-pw-ok" style="padding:8px 18px;font-size:13px;border-radius:10px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-weight:600;display:flex;align-items:center;gap:6px;"><i data-lucide="unlock" style="width:14px;height:14px;"></i> Entschlüsseln</button>
      </div>`;
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    if (typeof reloadIcons === 'function') reloadIcons();
    const inp = box.querySelector('#_stu-pw-i');
    setTimeout(() => inp?.focus(), 50);
    const done = (val) => { document.body.removeChild(overlay); resolve(val); };
    box.querySelector('#_stu-pw-cancel').onclick = () => done(null);
    box.querySelector('#_stu-pw-ok').onclick = () => done(inp.value || null);
    inp.addEventListener('keydown', e => { if (e.key === 'Enter') done(inp.value || null); });
  });
}

function _showPasswordDialog(mode) {
  return new Promise(resolve => {
    const isSave = mode === 'save';
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.65);z-index:10001;display:flex;align-items:center;justify-content:center;padding:20px;';
    const box = document.createElement('div');
    box.style.cssText = 'background:rgba(var(--panel-rgb),0.97);backdrop-filter:blur(24px);-webkit-backdrop-filter:blur(24px);border:1px solid rgba(255,255,255,0.12);border-radius:16px;padding:28px 24px 20px;max-width:400px;width:100%;box-shadow:0 20px 60px rgba(0,0,0,0.5);';
    box.innerHTML = `
      <div style="font-size:16px;font-weight:600;color:var(--text);margin-bottom:12px;">
        <i data-lucide="lock" style="width:18px;height:18px;"></i> ${isSave ? 'Export verschlüsseln' : 'Import entschlüsseln'}
      </div>
      ${isSave ? `<div style="background:rgba(239,68,68,0.12);border:1px solid rgba(239,68,68,0.35);border-radius:8px;padding:10px 12px;font-size:12px;color:#ef4444;margin-bottom:16px;line-height:1.5;">
        <i data-lucide="alert-triangle" style="width:13px;height:13px;vertical-align:-1px;"></i> <strong>Achtung:</strong> Ohne dieses Passwort kann die Datei <strong>nicht importiert</strong> werden!
      </div>` : `<div style="font-size:13px;color:var(--text-muted);margin-bottom:16px;">Gib das Passwort ein, mit dem diese Datei exportiert wurde.</div>`}
      <div style="margin-bottom:12px;">
        <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Passwort</label>
        <input id="_pw-i" type="password" placeholder="Passwort eingeben"
          style="width:100%;box-sizing:border-box;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);font-size:14px;outline:none;"/>
      </div>
      ${isSave ? `<div style="margin-bottom:16px;">
        <label style="font-size:12px;color:var(--text-muted);display:block;margin-bottom:4px;">Passwort bestätigen</label>
        <input id="_pw-c" type="password" placeholder="Passwort wiederholen"
          style="width:100%;box-sizing:border-box;padding:9px 12px;border-radius:8px;border:1px solid var(--border);background:var(--bg-card);color:var(--text);font-size:14px;outline:none;"/>
      </div>` : '<div style="margin-bottom:16px;"></div>'}
      <div id="_pw-e" style="color:#ef4444;font-size:12px;min-height:18px;margin-bottom:10px;"></div>
      <div style="display:flex;gap:10px;justify-content:flex-end;">
        <button id="_pw-cancel" style="padding:8px 18px;font-size:13px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text);cursor:pointer;">Abbrechen</button>
        <button id="_pw-ok" style="padding:8px 18px;font-size:13px;border-radius:10px;border:none;background:var(--accent);color:#fff;cursor:pointer;font-weight:600;">
          <i data-lucide="${isSave ? 'lock' : 'unlock'}" style="width:14px;height:14px;"></i> ${isSave ? 'Verschlüsselt speichern' : 'Entschlüsseln'}
        </button>
      </div>`;
    overlay.appendChild(box); document.body.appendChild(overlay);
    if (typeof reloadIcons === 'function') reloadIcons();
    const pwI = box.querySelector('#_pw-i'), pwC = box.querySelector('#_pw-c'), errEl = box.querySelector('#_pw-e');
    setTimeout(() => pwI.focus(), 50);
    const close = v => { overlay.remove(); resolve(v); };
    const submit = () => {
      const pw = pwI.value; errEl.textContent = '';
      if (!pw) { errEl.textContent = 'Bitte Passwort eingeben.'; return; }
      if (isSave && pw.length < 4) { errEl.textContent = 'Mindestens 4 Zeichen.'; return; }
      if (isSave && pw !== (pwC?.value||'')) { errEl.textContent = 'Passwörter stimmen nicht überein.'; return; }
      close(pw);
    };
    box.querySelector('#_pw-ok').onclick = submit;
    box.querySelector('#_pw-cancel').onclick = () => close(null);
    pwI.addEventListener('keydown', e => { if (e.key==='Enter') { isSave && pwC ? pwC.focus() : submit(); } });
    if (pwC) pwC.addEventListener('keydown', e => { if (e.key==='Enter') submit(); });
    overlay.addEventListener('click', e => { if (e.target===overlay) close(null); });
    const onEsc = e => { if (e.key==='Escape') { document.removeEventListener('keydown', onEsc); close(null); } };
    document.addEventListener('keydown', onEsc);
  });
}

const ASSESSMENT_CARD_FIELDS = ['grade', 'effort', 'gradeComment', 'gradedAt'];

function stripAssessmentDataForStudent(exportObj) {
  const clean = JSON.parse(JSON.stringify(exportObj || {}));
  delete clean.grades;

  for (const board of clean.boards || []) {
    for (const col of board.columns || []) {
      for (const card of col.cards || []) {
        ASSESSMENT_CARD_FIELDS.forEach(field => delete card[field]);
      }
    }
  }

  return clean;
}

// Gibt es lokal bereits Noten (Kartenbewertungen oder Ergebnisnoten), die
// zu den Boards des Imports gehören? Grundlage für die Übernahme-Rückfrage.
function hasLocalAssessmentData(importObj) {
  try {
    const importedBoardIds = new Set((importObj?.boards || []).map(b => b.id).filter(Boolean));
    const importedCardIds = new Set();
    for (const board of importObj?.boards || []) {
      for (const col of board.columns || []) {
        for (const card of col.cards || []) if (card.id) importedCardIds.add(card.id);
      }
    }

    const grades = JSON.parse(localStorage.getItem('kanban_grades') || '{}');
    for (const boardId of importedBoardIds) {
      if (grades[boardId] && Object.keys(grades[boardId]).length > 0) return true;
    }

    const current = JSON.parse(localStorage.getItem('kanban_data') || '{}');
    for (const board of current.boards || []) {
      for (const col of board.columns || []) {
        for (const card of col.cards || []) {
          if (!importedCardIds.has(card.id)) continue;
          if (ASSESSMENT_CARD_FIELDS.some(field => card[field] !== undefined)) return true;
        }
      }
    }
  } catch(e) { /* im Zweifel keine Rückfrage */ }
  return false;
}

function mergeLocalAssessmentData(importObj) {
  const merged = JSON.parse(JSON.stringify(importObj || {}));
  const existingByCardId = {};

  try {
    const current = JSON.parse(localStorage.getItem('kanban_data') || '{}');
    for (const board of current.boards || []) {
      for (const col of board.columns || []) {
        for (const card of col.cards || []) {
          const assessment = {};
          ASSESSMENT_CARD_FIELDS.forEach(field => {
            if (card[field] !== undefined) assessment[field] = card[field];
          });
          if (card.id && Object.keys(assessment).length > 0) {
            existingByCardId[card.id] = assessment;
          }
        }
      }
    }
  } catch(e) { /* keine lokalen Bewertungsdaten vorhanden */ }

  for (const board of merged.boards || []) {
    for (const col of board.columns || []) {
      for (const card of col.cards || []) {
        if (!card.id || !existingByCardId[card.id]) continue;
        Object.assign(card, existingByCardId[card.id]);
      }
    }
  }

  delete merged.grades;
  return merged;
}

function readFullExportObject() {
  const raw = localStorage.getItem('kanban_data') || '{}';
  const settings = localStorage.getItem('kanban_settings') || '{}';
  const gradesRaw = localStorage.getItem('kanban_grades') || '{}';
  let data, settingsObj, gradesObj;
  try { data = JSON.parse(raw); } catch(e) { data = {}; }
  try { settingsObj = JSON.parse(settings); } catch(e) { settingsObj = {}; }
  try { gradesObj = JSON.parse(gradesRaw); } catch(e) { gradesObj = {}; }
  return { ...data, settings: settingsObj, grades: gradesObj, exportedAt: new Date().toISOString(), appVersion: 'standalone-1.0' };
}

async function ensureStudentSession() {
  let session = window._kfSession;
  if (session?.isStudent && session.teacherPublicKeyJwk) return session;
  const studentRole = sessionStorage.getItem('kf_role') === 'schueler' || localStorage.getItem('kf_role') === 'schueler';
  if (!studentRole) return session || null;

  try {
    const cfg = JSON.parse(localStorage.getItem('kf_student_config') || 'null');
    if (cfg?.publicKeyJwk && cfg?.studentSecret) {
      session = { isStudent: true, studentPassword: cfg.studentSecret, teacherPublicKeyJwk: cfg.publicKeyJwk, teacherName: cfg.teacherName };
      window._kfSession = session;
      return session;
    }
    if (cfg?.publicKeyJwk) {
      showToast('Bitte melde dich mit deiner Schüler-INI-Datei neu an.', 'error');
      return null;
    }
  } catch(e) { /* kein Schülerprofil */ }
  return session || null;
}

async function buildStudentEncryptedExport(title = '', kind = 'student-private') {
  const session = await ensureStudentSession();
  if (!session?.isStudent || !session.teacherPublicKeyJwk) {
    throw new Error('Diese Datenbank-Speicherung ist für Schülerdateien vorgesehen.');
  }
  const fileKind = kind === 'student-submission' ? 'student-submission' : 'student-private';

  const exportObj = stripAssessmentDataForStudent(readFullExportObject());
  const teacherPubKey = await window.kfCrypto.importPubJwk(session.teacherPublicKeyJwk);
  const json = await window.kfCrypto.encryptDual(
    JSON.stringify(exportObj), session.studentPassword, teacherPubKey, session.teacherName
  );

  const date = new Date().toISOString().slice(0, 10);
  const who = session.teacherName ? `${session.teacherName}-` : '';
  const name = (S.currentUser?.displayName || '').replace(/\s+/g,'_') || 'nutzer';
  const defaultTitle = title || `${S.currentBoard?.reflectionCompleted ? 'fertig - ' : ''}${S.currentBoard?.name || 'Meine Abgabe'}`;
  const studentLabel = S.currentUser?.displayName || '';
  const studentId = window.kfCloud?.getStableStudentId
    ? await window.kfCloud.getStableStudentId({ teacherPublicKeyJwk: session.teacherPublicKeyJwk, studentLabel })
    : window.kfCloud?.getStudentId?.();
  const passwordShareId = window.kfCloud?.getPasswordShareId
    ? await window.kfCloud.getPasswordShareId({ teacherPublicKeyJwk: session.teacherPublicKeyJwk, studentPassword: session.studentPassword })
    : '';
  return {
    json,
    suggestedName: `eduban-${who}${name}-${date}.json`,
    teacherPublicKeyJwk: session.teacherPublicKeyJwk,
    studentId,
    studentLabel,
    title: defaultTitle,
    kind: fileKind,
    passwordShareId,
  };
}

// ── BACKUP-ERINNERUNG ─────────────────────────────────────
// Alle Daten liegen im Browser-Speicher; der Browser darf sie löschen
// (z. B. Safari nach 7 Tagen Nichtnutzung). Deshalb regelmäßig erinnern.
const BACKUP_TS_KEY = 'kf_last_backup_at';
const BACKUP_REMIND_DAYS = 7;

window.markBackupDone = function() {
  try { localStorage.setItem(BACKUP_TS_KEY, new Date().toISOString()); } catch(e) { /* ignorieren */ }
};

window.checkBackupReminder = function() {
  try {
    if (sessionStorage.getItem('kf_backup_reminder_shown')) return;
    const data = JSON.parse(localStorage.getItem('kanban_data') || '{}');
    if (!Array.isArray(data.boards) || data.boards.length === 0) return;

    const ts = localStorage.getItem(BACKUP_TS_KEY);
    const ageDays = ts ? (Date.now() - new Date(ts).getTime()) / 86400000 : Infinity;
    if (ageDays < BACKUP_REMIND_DAYS) return;

    sessionStorage.setItem('kf_backup_reminder_shown', '1');
    const msg = ts
      ? `💾 Deine letzte Datei-Sicherung ist ${Math.floor(ageDays)} Tage her. Bitte "Alles exportieren & sichern" ausführen – der Browser kann lokale Daten jederzeit löschen!`
      : '💾 Noch keine Datei-Sicherung gefunden. Bitte regelmäßig "Alles exportieren & sichern" ausführen – der Browser kann lokale Daten jederzeit löschen!';
    showToast(msg, 'warning');
  } catch(e) { /* ignorieren */ }
};

// Tutor-Geheimnis aus dem geladenen privaten Tutor-Schlüssel (neues Format).
// Ersetzt das frühere Export-Passwort – die INI-Datei ist der Schlüssel.
function _getTutorSecret() {
  return window._loadedIni?.tutorSecret || null;
}

async function buildTutorEncryptedExport() {
  let pw = _getTutorSecret() || _teacherSessionPassword;
  if (!pw) {
    // Altformat/keine INI geladen: einmalig Passwort erfragen (Kompatibilität)
    pw = await _showPasswordDialog('save');
    if (!pw) return null;
    _teacherSessionPassword = pw;
  }
  const exportObj = readFullExportObject();
  const enc = await window.kfCrypto.encryptStr(JSON.stringify(exportObj), pw);
  const json = JSON.stringify({ kanbanfluss: true, encrypted: true, version: 1, ...enc, exportedAt: new Date().toISOString() });
  const date = new Date().toISOString().slice(0, 10);
  const name = (S.currentUser?.displayName || '').replace(/\s+/g,'_') || 'nutzer';
  return { json, suggestedName: `eduban-${name}-${date}.json` };
}

async function buildTutorReturnExport() {
  const keys = window._studentReturnKeys;
  if (!keys) {
    throw new Error('Bitte zuerst ein Image einer Schülerin oder eines Schülers importieren.');
  }
  const ini = window._loadedIni;
  if (!ini) {
    throw new Error('Bitte zuerst die Tutor-INI laden.');
  }

  const teacherPubKey = await window.kfCrypto.importPubJwk(ini.publicKey);
  const exportObj = stripAssessmentDataForStudent(readFullExportObject());
  const json = await window.kfCrypto.encryptDualReturn(
    JSON.stringify(exportObj), keys.dataKeyB64, keys.stuKeyEnc,
    teacherPubKey, keys.teacherName || ini.teacherName
  );
  const date = new Date().toISOString().slice(0, 10);
  const name = (S.currentUser?.displayName || '').replace(/\s+/g,'_') || 'tutor';
  const studentLabel = window._lastStudentCloudMeta?.studentLabel || keys.studentLabel || '';
  return {
    json,
    suggestedName: `eduban-rueckgabe-${name}-${date}.json`,
    teacherPublicKeyJwk: ini.publicKey,
    studentId: window._lastStudentCloudMeta?.studentId || keys.studentId || 'unbekannt',
    studentLabel,
    title: `fertig - ${studentLabel || S.currentBoard?.name || 'Board'}`,
    kind: 'tutor-return',
  };
}

function collectAssessmentBackup() {
  const data = JSON.parse(localStorage.getItem('kanban_data') || '{}');
  const productGrades = JSON.parse(localStorage.getItem('kanban_grades') || '{}');
  const boards = [];

  for (const board of data.boards || []) {
    const backupBoard = { id: board.id, name: board.name, cards: [] };
    for (const col of board.columns || []) {
      for (const card of col.cards || []) {
        const assessment = {};
        ASSESSMENT_CARD_FIELDS.forEach(field => {
          if (card[field] !== undefined) assessment[field] = card[field];
        });
        if (Object.keys(assessment).length === 0) continue;
        backupBoard.cards.push({
          id: card.id,
          label: card.label || '',
          text: card.text || '',
          columnId: col.id,
          ...assessment
        });
      }
    }
    if (backupBoard.cards.length > 0 || productGrades[board.id]) {
      boards.push(backupBoard);
    }
  }

  return {
    kanbanfluss_assessment_backup: true,
    version: 1,
    exportedAt: new Date().toISOString(),
    boards,
    productGrades
  };
}

function applyAssessmentBackup(backup) {
  if (!backup?.kanbanfluss_assessment_backup || !Array.isArray(backup.boards)) {
    throw new Error('Keine gültige EDUBAN-Notensicherung.');
  }

  const data = JSON.parse(localStorage.getItem('kanban_data') || '{}');
  const assessmentByCardId = {};
  backup.boards.forEach(board => {
    (board.cards || []).forEach(card => {
      if (!card.id) return;
      const assessment = {};
      ASSESSMENT_CARD_FIELDS.forEach(field => {
        if (card[field] !== undefined) assessment[field] = card[field];
      });
      if (Object.keys(assessment).length > 0) assessmentByCardId[card.id] = assessment;
    });
  });

  let restoredCards = 0;
  for (const board of data.boards || []) {
    for (const col of board.columns || []) {
      for (const card of col.cards || []) {
        if (!assessmentByCardId[card.id]) continue;
        Object.assign(card, assessmentByCardId[card.id]);
        restoredCards++;
      }
    }
  }
  const safeUser = data.user || { displayName: '', groupId: '' };
  localStorage.setItem('kanban_data', JSON.stringify({ ...data, user: safeUser, boards: data.boards || [], version: 1 }));

  if (backup.productGrades && typeof backup.productGrades === 'object') {
    const existingGrades = JSON.parse(localStorage.getItem('kanban_grades') || '{}');
    localStorage.setItem('kanban_grades', JSON.stringify({ ...existingGrades, ...backup.productGrades }));
  }

  return restoredCards;
}

window.exportAssessmentBackupAsFile = async function() {
  if (window._kfSession?.isStudent) {
    showToast('Noten-Sicherungen sind nur im Tutor-Modus verfügbar.', 'error');
    return;
  }

  let pw = _getTutorSecret() || _teacherSessionPassword;
  if (!pw) {
    pw = await _showPasswordDialog('save');
    if (!pw) return;
    _teacherSessionPassword = pw;
  }

  const backup = collectAssessmentBackup();
  let json;
  try {
    const enc = await window.kfCrypto.encryptStr(JSON.stringify(backup), pw);
    json = JSON.stringify({
      kanbanfluss: true,
      assessmentBackup: true,
      encrypted: true,
      version: 1,
      ...enc,
      exportedAt: backup.exportedAt
    }, null, 2);
  } catch(e) {
    showToast('Noten-Sicherung fehlgeschlagen: ' + e.message, 'error');
    return;
  }

  const date = new Date().toISOString().slice(0, 10);
  const name = (S.currentUser?.displayName || 'tutor').replace(/\s+/g, '_');
  const suggestedName = `eduban-noten-${name}-${date}.json`;

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'EDUBAN Notensicherung', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      window.markBackupDone();
  showToast('🔒 Noten-Sicherung gespeichert.');
      return;
    } catch(e) { if (e.name === 'AbortError') return; }
  }

  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = suggestedName; a.click();
  URL.revokeObjectURL(url);
  window.markBackupDone();
  showToast('🔒 Noten-Sicherung gespeichert.');
};

window.importAssessmentBackupFromFile = async function(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;

  if (window._kfSession?.isStudent) {
    showToast('Noten-Sicherungen sind nur im Tutor-Modus verfügbar.', 'error');
    return;
  }

  let parsed;
  try { parsed = JSON.parse(await file.text()); }
  catch(e) { showToast('Ungültige JSON-Datei.', 'error'); return; }

  if (!parsed.assessmentBackup || parsed.encrypted !== true) {
    showToast('Keine gültige verschlüsselte EDUBAN-Notensicherung.', 'error');
    return;
  }

  let backup = null;

  // Zuerst passwortfrei mit dem Tutor-Schlüssel versuchen
  const secret = _getTutorSecret();
  if (secret) {
    try { backup = JSON.parse(await window.kfCrypto.decryptStr(parsed, secret)); } catch(e) { /* Altdatei */ }
  }

  if (!backup) {
    let pw = _teacherSessionPassword;
    if (!pw) {
      pw = await _showPasswordDialog('load');
      if (!pw) return;
    }
    try {
      backup = JSON.parse(await window.kfCrypto.decryptStr(parsed, pw));
      _teacherSessionPassword = pw;
    } catch(e) {
      showToast('❌ Falsches Passwort oder beschädigte Notensicherung.', 'error');
      return;
    }
  }

  try {
    const restoredCards = applyAssessmentBackup(backup);
    showToast(`Noten wiederhergestellt (${restoredCards} Karten). Seite wird neu geladen…`);
    setTimeout(() => location.reload(), 1200);
  } catch(e) {
    showToast('Wiederherstellung fehlgeschlagen: ' + e.message, 'error');
  }
};

// ── JSON-DATEI EXPORT ─────────────────────────────────────
window.exportDataAsFile = async () => {
  // Lokale Version sofort sichern (nur Tutoren), BEVOR die Session geprüft wird.
  // S.isAdminMode ist zuverlässiger als session?.isStudent, da das Session-Objekt
  // durch eine vorhandene kf_student_config überschrieben werden kann.
  if (S.isAdminMode) {
    saveLocalVersion(S.currentBoard?.name || 'Board');
  }

  let built;
  try {
    const session = await ensureStudentSession();
    built = session?.isStudent ? await buildStudentEncryptedExport() : await buildTutorEncryptedExport();
  } catch(e) {
    showToast('Verschlüsselungsfehler: ' + e.message, 'error');
    return;
  }
  if (!built) return;
  const { json, suggestedName } = built;

  // (Versionsspeicherung erfolgt bereits am Anfang dieser Funktion via S.isAdminMode)

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'EDUBAN Datei', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      window.markBackupDone();
    showToast('🔒 Datei exportiert & Version gespeichert!');
      return;
    } catch(e) { if (e.name === 'AbortError') return; }
  }
  const blob = new Blob([json], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = suggestedName; a.click();
  URL.revokeObjectURL(url);
  window.markBackupDone();
    showToast('🔒 Datei exportiert & Version gespeichert!');
};

// ── JSON-DATEI IMPORT ─────────────────────────────────────
window.importDataFromFile = async (event) => {
  const file = event.target.files[0];
  if (!file) return;
  event.target.value = '';

  let text;
  try { text = await file.text(); } catch(e) { showToast('Datei konnte nicht gelesen werden.', 'error'); return; }
  await importDataFromText(text, null);
};

// Vergibt neue IDs für Boards, Spalten, Karten und Ideen eines Imports.
// Wichtig beim Schüler-Erstimport einer verteilten Startdatei: Starten mehrere
// Gruppen mit derselben Datei, hätten alle identische Karten-IDs – beim Tutor
// könnten dadurch Noten der einen Gruppe an der Abgabe der anderen anhaften.
// Abhängigkeiten und Meilensteine referenzieren Labels und bleiben intakt.
function regenerateImportIds(data) {
  const newId = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  for (const board of data.boards || []) {
    board.id = newId();
    for (const col of board.columns || []) {
      col.id = newId();
      for (const card of col.cards || []) card.id = newId();
    }
    if (Array.isArray(board.ideas)) for (const idea of board.ideas) idea.id = newId();
    if (Array.isArray(board.milestones)) for (const m of board.milestones) if (m.id) m.id = newId();
  }
}

async function importDataFromText(text, cloudMeta) {
  let parsed;
  try { parsed = JSON.parse(text); } catch(e) { showToast('Ungültige JSON-Datei.', 'error'); return; }

  // Merkt sich, ob die Datei eine persönliche Schülerdatei ist (eigene
  // Sicherung oder Tutor-Rückgabe). Nur dann bleiben die IDs erhalten.
  let isStudentOwnedFile = false;

  if (parsed.encrypted === true) {
    if (parsed.version === 2) {
      let decrypted = null;
      const session = window._kfSession;
      const isStudentSession = session?.isStudent === true;

      if (isStudentSession) {
        // ── SCHÜLER importiert zurückgegebene Datei ──
        // Erst mit Sitzungs-Passwort versuchen
        if (session.studentPassword) {
          try { decrypted = await window.kfCrypto.decryptDualStudent(parsed, session.studentPassword); } catch(e) { /* weiter */ }
        }
        // Scheitert das (z.B. anderes Gerät / Passwort vergessen): explizit nach Passwort fragen
        if (!decrypted) {
          const pw = await _showStudentPasswordDialog(parsed.teacherName);
          if (!pw) return;
          try { decrypted = await window.kfCrypto.decryptDualStudent(parsed, pw); }
          catch(e) { showToast('❌ Falsches Passwort – diese Datei wurde mit einem anderen Passwort exportiert.', 'error'); return; }
        }

        // Eigene Sicherung oder Rückgabe des Tutors → IDs bleiben erhalten
        isStudentOwnedFile = true;

      } else {
        // ── TUTOR öffnet Schüler-Image mit INI + Masterpasswort ──
        let iniObj = window._loadedIni || null;

        if (!iniObj) {
          iniObj = await new Promise(resolve => {
            const input = document.createElement('input');
            // iPad-Fix: KEIN accept-Attribut setzen — iPadOS stuft .ini-Dateien
            // sonst als nicht auswählbar ein (ausgegraut in der Dateiauswahl).
            input.type = 'file';
            input.style.display = 'none';
            document.body.appendChild(input);
            input.onchange = async (e) => {
              const f = e.target.files[0];
              document.body.removeChild(input);
              if (!f) { resolve(null); return; }
              try {
                const obj = JSON.parse(await f.text());
                resolve(obj.kanbanfluss_ini ? obj : null);
              } catch(e) { resolve(null); }
            };
            showToast(`Bitte INI-Datei von "${parsed.teacherName || 'Tutor'}" auswählen`);
            input.click();
          });
        }

        if (!iniObj) { showToast('INI-Datei ungültig oder abgebrochen.', 'error'); return; }

        // Neues Format (Tutor-Schlüssel): kein Passwort nötig.
        // Altformat: einmalig Masterpasswort erfragen.
        let pw = '';
        if (window.kfCrypto.iniNeedsPassword(iniObj)) {
          pw = _teacherSessionPassword || await _showPasswordDialog('load');
          if (!pw) return;
        }
        try {
          const privKey = await window.kfCrypto.getPrivKeyFromIni(iniObj, pw);
          const result  = await window.kfCrypto.decryptDualTeacherFull(parsed, privKey);
          decrypted = result.data;
          window._studentReturnKeys = {
            dataKeyB64:  result.dataKeyB64,
            stuKeyEnc:   result.stuKeyEnc,
            teacherName: parsed.teacherName,
            studentId: cloudMeta?.studentId || '',
            studentLabel: cloudMeta?.studentLabel || '',
          };
          window._lastStudentCloudMeta = cloudMeta ? {
            studentId: cloudMeta.studentId || '',
            studentLabel: cloudMeta.studentLabel || ''
          } : null;
          window._loadedIni = iniObj;
          _teacherSessionPassword = pw;
        } catch(e) {
          showToast('❌ Falsches Masterpasswort oder falsche INI-Datei.', 'error'); return;
        }
      }
      try { parsed = JSON.parse(decrypted); } catch(e) { showToast('Entschlüsselung fehlgeschlagen.', 'error'); return; }

    } else {
      // ── Version 1: symmetrisch verschlüsselt (Tutor-Backup) ──
      // Zuerst passwortfrei mit dem Tutor-Schlüssel versuchen, dann Passwort (Altdateien)
      let decrypted = null;
      const secret = _getTutorSecret();
      if (secret) {
        try { decrypted = await window.kfCrypto.decryptStr(parsed, secret); } catch(e) { /* Altdatei */ }
      }
      if (decrypted === null) {
        let pw = _teacherSessionPassword;
        if (!pw) { pw = await _showPasswordDialog('load'); if (!pw) return; }
        try {
          decrypted = await window.kfCrypto.decryptStr(parsed, pw);
          _teacherSessionPassword = pw;
        } catch(e) { showToast('❌ Falsches Passwort oder beschädigte Datei.', 'error'); return; }
      }
      try { parsed = JSON.parse(decrypted); } catch(e) { showToast('Entschlüsselung fehlgeschlagen.', 'error'); return; }
    }
  }

  if (!Array.isArray(parsed.boards)) { showToast('Keine gültige EDUBAN-Datei.', 'error'); return; }

  const ok = await showConfirm(
    `Export vom ${parsed.exportedAt ? new Date(parsed.exportedAt).toLocaleString('de-DE') : 'unbekanntem Datum'} importieren?\n\nDies ersetzt ALLE aktuellen Daten!`,
    'Importieren', 'Abbrechen'
  );
  if (!ok) return;

  const isStudentImport = window._kfSession?.isStudent === true
    || sessionStorage.getItem('kf_role') === 'schueler'
    || localStorage.getItem('kf_role') === 'schueler';
  const isStudentReturnForTutor = !isStudentImport && !!window._studentReturnKeys;

  // Schutz vor Noten-Verwechslung: Wenn mehrere Gruppen mit derselben
  // verteilten Datei gestartet sind, haben ihre Karten identische IDs.
  // Vorhandene lokale Noten werden deshalb nur nach Rückfrage übernommen.
  let keepLocalAssessments = true;
  if (isStudentReturnForTutor && hasLocalAssessmentData(parsed)) {
    keepLocalAssessments = await showConfirm(
      'Für dieses Board sind lokal bereits Noten vorhanden.\n\nStammt diese Abgabe von DERSELBEN Gruppe wie die vorhandenen Noten? Dann übernehmen. Stammt sie von einer ANDEREN Gruppe (gleiche Startvorlage), bitte ablehnen – sonst würden fremde Noten an den Karten hängen.',
      'Ja, Noten übernehmen',
      'Nein, ohne Noten importieren'
    );
  }

  const importObj = isStudentImport
    ? stripAssessmentDataForStudent(parsed)
    : (isStudentReturnForTutor && keepLocalAssessments ? mergeLocalAssessmentData(parsed) : parsed);

  const { settings, grades, exportedAt, appVersion, ...data } = importObj;

  // Schüler-Erstimport einer verteilten Startdatei: neue IDs vergeben,
  // damit jede Gruppe eindeutige Karten-IDs hat (verhindert Noten-Kollisionen
  // beim Tutor). Persönliche Dateien (Rückgabe/eigene Sicherung) behalten IDs.
  if (isStudentImport && !isStudentOwnedFile) {
    regenerateImportIds(data);
  }
  const currentUser = (() => {
    try { return JSON.parse(localStorage.getItem('kanban_data') || '{}').user || null; }
    catch(e) { return null; }
  })();
  const safeUser = data.user || currentUser || { displayName: '', groupId: '' };
  localStorage.setItem('kanban_data', JSON.stringify({ ...data, user: safeUser, boards: data.boards || [], version: 1 }));
  if (settings) localStorage.setItem('kanban_settings', JSON.stringify(settings));
  if (isStudentImport) {
    localStorage.removeItem('kanban_grades');
  } else if (isStudentReturnForTutor) {
    if (keepLocalAssessments) {
      // Ergebnisnoten des Tutors BLEIBEN erhalten (wie die Prozessnoten, die
      // per mergeLocalAssessmentData übernommen werden). Früher wurden sie hier
      // gelöscht – dadurch gingen beim Re-Import einer überarbeiteten Abgabe
      // alle bereits vergebenen Ergebnisnoten verloren.
    } else {
      // Andere Gruppe: Ergebnisnoten der importierten Boards NICHT anhaften lassen
      try {
        const importedBoardIds = new Set((data.boards || []).map(board => board.id).filter(Boolean));
        const localGrades = JSON.parse(localStorage.getItem('kanban_grades') || '{}');
        importedBoardIds.forEach(boardId => delete localGrades[boardId]);
        if (Object.keys(localGrades).length > 0) localStorage.setItem('kanban_grades', JSON.stringify(localGrades));
        else localStorage.removeItem('kanban_grades');
      } catch(e) { /* ignorieren */ }
    }
  } else if (grades && Object.keys(grades).length > 0) {
    localStorage.setItem('kanban_grades', JSON.stringify(grades));
  }

  // Vor Reload: Sitzungsdaten in sessionStorage retten (überleben den Reload)
  if (window._studentReturnKeys) {
    sessionStorage.setItem('kf_return_keys', JSON.stringify(window._studentReturnKeys));
  }
  if (window._lastStudentCloudMeta) {
    sessionStorage.setItem('kf_last_student_cloud_meta', JSON.stringify(window._lastStudentCloudMeta));
  }
  if (window._loadedIni) {
    sessionStorage.setItem('kf_loaded_ini', JSON.stringify(window._loadedIni));
  }
  // Hinweis: Schüler-Anmeldung überlebt den Reload automatisch,
  // da das Schüler-Geheimnis aus der INI in kf_student_config gespeichert ist.

  showToast('Import erfolgreich! Seite wird neu geladen…');
  setTimeout(() => location.reload(), 1200);
}

window.importDataFromText = importDataFromText;

// ── OFFENE BOARD-VORLAGEN ───────────────────────────────
const TEMPLATE_VERSION = 1;
const TEMPLATE_CARD_FIELDS = [
  'text', 'priority', 'assignee', 'due', 'description', 'result', 'timeEstimate',
  'phase', 'templateCategory', 'startOffset', 'label', 'order', 'dependencies', 'groupId'
];

function isStudentMode() {
  return window._kfSession?.isStudent === true
    || sessionStorage.getItem('kf_role') === 'schueler'
    || localStorage.getItem('kf_role') === 'schueler';
}

async function askForOptionalName(message, fallback = '', title = 'Name festlegen') {
  if (typeof window.showTextInputDialog === 'function') {
    return window.showTextInputDialog({
      title,
      message,
      value: fallback || '',
      placeholder: fallback || 'Name',
      okText: 'Weiter',
      maxLength: 90,
    });
  }
  const value = prompt(message, fallback || '');
  if (value === null) return null;
  return value.trim().slice(0, 90);
}

function sanitizeTemplateCard(card, order = 0) {
  const clean = {};
  TEMPLATE_CARD_FIELDS.forEach(field => {
    if (card?.[field] !== undefined) clean[field] = JSON.parse(JSON.stringify(card[field]));
  });
  clean.text = clean.text || '';
  clean.priority = clean.priority || '';
  clean.assignee = clean.assignee || '';
  clean.due = clean.due || '';
  clean.description = clean.description || '';
  clean.result = clean.result || '';
  clean.timeEstimate = clean.timeEstimate || { d: 0, h: 0, m: 0 };
  clean.phase = clean.phase || '';
  clean.templateCategory = clean.templateCategory || '';
  clean.startOffset = clean.startOffset ?? null;
  clean.label = clean.label || '';
  clean.order = clean.order ?? order;
  clean.dependencies = Array.isArray(clean.dependencies) ? clean.dependencies : [];
  clean.groupId = clean.groupId || '';
  return clean;
}

function buildTemplateExportObject(customName = '') {
  if (!S.currentBoard) throw new Error('Bitte zuerst ein Board auswählen.');
  const templateName = customName || S.currentBoard.name || 'EDUBAN Vorlage';
  const columns = getColumns(S.currentBoard.id).map(col => ({
    name: col.name || 'Spalte',
    color: col.color || '#5c6ef8',
    order: col.order ?? 0,
    wipLimit: col.wipLimit ?? 0,
    cards: getCards(S.currentBoard.id, col.id).map((card, idx) => sanitizeTemplateCard(card, idx)),
  }));

  return {
    kanbanfluss_template: true,
    version: TEMPLATE_VERSION,
    boardName: templateName,
    createdAt: new Date().toISOString(),
    teacherName: S.currentUser?.displayName || '',
    template: {
      name: templateName,
      members: Array.isArray(S.currentBoard.members) ? [...S.currentBoard.members] : [],
      wipLimit: S.currentBoard.wipLimit ?? 3,
      agingDays: S.currentBoard.agingDays ?? 5,
      cardCounter: S.currentBoard.cardCounter ?? 0,
      groupId: S.currentBoard.groupId || '',
      groupInfos: (S.currentBoard.groupInfos && typeof S.currentBoard.groupInfos === 'object') ? JSON.parse(JSON.stringify(S.currentBoard.groupInfos)) : {},
      ownerName: '',
      ideaLibraryVersion: S.currentBoard.ideaLibraryVersion || 1,
      reflectionUnlocked: S.currentBoard.reflectionUnlocked || false,
      reflectionUnlockedAt: S.currentBoard.reflectionUnlockedAt || '',
      reflectionStarted: S.currentBoard.reflectionStarted || false,
      reflectionStartedAt: S.currentBoard.reflectionStartedAt || '',
      reflectionCompleted: S.currentBoard.reflectionCompleted || false,
      reflectionCompletedAt: S.currentBoard.reflectionCompletedAt || '',
      ideas: Array.isArray(S.currentBoard.ideas)
        ? S.currentBoard.ideas.map((idea, idx) => sanitizeTemplateCard(idea, idx))
        : [],
      timelineBlockLabels: S.currentBoard.timelineBlockLabels && typeof S.currentBoard.timelineBlockLabels === 'object'
        ? { ...S.currentBoard.timelineBlockLabels }
        : {},
      milestones: Array.isArray(S.currentBoard.milestones)
        ? S.currentBoard.milestones.map((m, idx) => ({
            id: m.id || '',
            name: m.name || `Phase ${idx + 1}`,
            description: m.description || '',
            order: m.order ?? idx,
            requiredCardLabels: m.requiredCardLabels || []
          }))
        : [],
      columns,
    }
  };
}

function normalizeTemplateObject(obj) {
  if (!obj?.kanbanfluss_template || !obj?.template || !Array.isArray(obj.template.columns)) {
    throw new Error('Keine gültige EDUBAN-Vorlage.');
  }
  return obj.template;
}

async function downloadJsonFile(json, suggestedName, toastMessage) {
  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'EDUBAN Vorlage', accept: { 'application/json': ['.json'] } }],
      });
      const writable = await handle.createWritable();
      await writable.write(json);
      await writable.close();
      showToast(toastMessage);
      return;
    } catch(e) { if (e.name === 'AbortError') return; }
  }
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = suggestedName; a.click();
  URL.revokeObjectURL(url);
  showToast(toastMessage);
}

function createBoardFromTemplateObject(templateObj) {
  const template = normalizeTemplateObject(templateObj);
  const board = createBoard({
    name: template.name || templateObj.boardName || 'EDUBAN Vorlage',
    members: Array.isArray(template.members) ? template.members : [],
    wipLimit: template.wipLimit ?? 3,
    agingDays: template.agingDays ?? 5,
    cardCounter: template.cardCounter ?? 0,
    groupId: template.groupId || S.currentUser?.groupId || '',
    groupInfos: (template.groupInfos && typeof template.groupInfos === 'object') ? template.groupInfos : {},
    ownerName: S.currentUser?.displayName || '',
    ideaLibraryVersion: template.ideaLibraryVersion,
    reflectionUnlocked: template.reflectionUnlocked || false,
    reflectionUnlockedAt: template.reflectionUnlockedAt || '',
    reflectionStarted: template.reflectionStarted || false,
    reflectionStartedAt: template.reflectionStartedAt || '',
    reflectionCompleted: template.reflectionCompleted || false,
    reflectionCompletedAt: template.reflectionCompletedAt || '',
    ideas: Array.isArray(template.ideas) ? template.ideas.map((idea, idx) => sanitizeTemplateCard(idea, idx)) : [],
    timelineBlockLabels: template.timelineBlockLabels && typeof template.timelineBlockLabels === 'object' ? template.timelineBlockLabels : {},
    milestones: Array.isArray(template.milestones) ? template.milestones : [],
  });

  (template.columns || []).forEach((col, colIdx) => {
    const newCol = createColumn(board.id, {
      name: col.name || `Spalte ${colIdx + 1}`,
      color: col.color || '#5c6ef8',
      order: col.order ?? colIdx,
      wipLimit: col.wipLimit ?? 0,
    });
    (col.cards || []).forEach((card, cardIdx) => {
      createCard(board.id, newCol.id, sanitizeTemplateCard(card, cardIdx));
    });
  });

  S.boards = getBoards();
  if (typeof renderBoardsList === 'function') renderBoardsList();
  if (typeof selectBoard === 'function') selectBoard(board.id);
  if (typeof closeFilemanagementPanel === 'function') closeFilemanagementPanel();
  return board;
}

window.exportTemplateBoardAsFile = async function() {
  if (isStudentMode()) {
    showToast('Vorlagen erstellen ist nur im Tutor-Modus verfügbar.', 'error');
    return;
  }
  try {
    const templateName = await askForOptionalName('Wie soll diese Vorlage heißen?', S.currentBoard?.name || 'EDUBAN Vorlage', 'Vorlage benennen');
    if (templateName === null) return;
    const template = buildTemplateExportObject(templateName || 'EDUBAN Vorlage');
    const date = new Date().toISOString().slice(0, 10);
    const safeName = (template.boardName || 'vorlage').replace(/[^\wäöüÄÖÜß-]+/g, '_');
    await downloadJsonFile(
      JSON.stringify(template, null, 2),
      `eduban-vorlage-${safeName}-${date}.json`,
      'Offene Board-Vorlage gespeichert.'
    );
  } catch(e) {
    showToast(e.message || 'Vorlage konnte nicht erstellt werden.', 'error');
  }
};

window.importTemplateFromFile = async function(event) {
  const file = event.target.files[0];
  event.target.value = '';
  if (!file) return;

  let parsed;
  try { parsed = JSON.parse(await file.text()); }
  catch(e) { showToast('Ungültige JSON-Datei.', 'error'); return; }

  try {
    const board = createBoardFromTemplateObject(parsed);
    showToast(`Vorlage als neues Board geladen: ${board.name}`);
  } catch(e) {
    showToast(e.message || 'Vorlage konnte nicht geladen werden.', 'error');
  }
};

window.saveTemplateBoardToCloud = async function() {
  if (!window.kfCloud) { showToast('Firebase-Modul nicht geladen.', 'error'); return; }
  if (isStudentMode()) {
    showToast('Vorlagen in der Datenbank speichern ist nur im Tutor-Modus verfügbar.', 'error');
    return;
  }
  try {
    const teacherPub = getTeacherPublicKeyForCloud();
    if (!teacherPub) throw new Error('Bitte zuerst die Tutor-INI laden.');
    const templateName = await askForOptionalName('Wie soll diese Vorlage in der Datenbank heißen?', S.currentBoard?.name || 'EDUBAN Vorlage', 'Datenbank-Vorlage benennen');
    if (templateName === null) return;
    const template = buildTemplateExportObject(templateName || 'EDUBAN Vorlage');
    await window.kfCloud.saveTemplate({
      teacherPublicKeyJwk: teacherPub,
      template,
      title: template.boardName,
      teacherName: template.teacherName,
      appVersion: 'standalone-1.0',
    });
    showToast('Offene Board-Vorlage in der Datenbank gespeichert.');
  } catch(e) {
    showToast(e.message || 'Vorlage konnte nicht gespeichert werden.', 'error');
  }
};

window.showCloudTemplates = async function() {
  const modal = document.getElementById('modal-cloud-files');
  const title = document.getElementById('cloud-files-title');
  const list = document.getElementById('cloud-files-list');
  if (!modal || !list) return;
  if (title) title.textContent = 'Board-Vorlagen';
  modal.style.display = 'flex';
  list.innerHTML = '<div style="padding:28px;text-align:center;color:var(--text-muted);">Vorlagen werden geladen…</div>';
  if (typeof reloadIcons === 'function') reloadIcons();

  try {
    const teacherPub = getTeacherPublicKeyForCloud();
    if (!teacherPub) {
      list.innerHTML = '<div style="padding:22px;border:1px solid var(--border);border-radius:12px;color:var(--text-muted);line-height:1.5;">Bitte zuerst die Tutor-INI laden. Danach kann die App die Vorlagen dieses Tutors finden.</div>';
      return;
    }
    const templates = await window.kfCloud.listTemplates(teacherPub);
    renderCloudTemplates(templates);
  } catch(e) {
    list.innerHTML = `<div style="padding:22px;border:1px solid rgba(239,68,68,0.35);background:rgba(239,68,68,0.08);border-radius:12px;color:#ef4444;line-height:1.5;">${escHtml(e.message || 'Vorlagen konnten nicht gelesen werden.')}</div>`;
  }
};

function renderCloudTemplates(templates) {
  const list = document.getElementById('cloud-files-list');
  if (!list) return;
  window._cloudTemplateCache = templates;
  if (!templates.length) {
    list.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-muted);">Noch keine Vorlagen in der Datenbank.</div>';
    return;
  }

  const fmt = iso => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'unbekanntes Datum';
    return d.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' })
      + ' · ' + d.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' }) + ' Uhr';
  };
  const canDeleteTemplates = !isStudentMode();

  list.innerHTML = templates.map((entry, idx) => {
    const template = entry.template?.template || {};
    const colCount = Array.isArray(template.columns) ? template.columns.length : 0;
    const cardCount = (template.columns || []).reduce((sum, col) => sum + ((col.cards || []).length), 0);
    return `
      <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--surface);border:1px solid var(--border);border-radius:12px;margin-bottom:8px;">
        <div style="width:34px;height:34px;border-radius:10px;background:rgba(16,185,129,0.14);display:flex;align-items:center;justify-content:center;color:#34d399;flex-shrink:0;">
          <i data-lucide="layout-template" style="width:17px;height:17px;"></i>
        </div>
        <div style="flex:1;min-width:0;">
          <div style="font-weight:700;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(entry.title || entry.template?.boardName || 'EDUBAN Vorlage')}</div>
          <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${colCount} Spalten · ${cardCount} Karten · ${fmt(entry.createdAt)}</div>
        </div>
        <button class="btn-sm btn-sm-primary" onclick="importCloudTemplate(${idx})" style="display:flex;align-items:center;gap:6px;">
          <i data-lucide="download" style="width:13px;height:13px;"></i> Laden
        </button>
        ${canDeleteTemplates ? `
          <button class="btn-sm btn-sm-ghost" onclick="deleteCloudTemplateFromDatabase(${idx})" title="Vorlage löschen" style="display:flex;align-items:center;gap:6px;color:var(--danger) !important;border-color:rgba(240,82,82,0.35) !important;">
            <i data-lucide="trash-2" style="width:13px;height:13px;"></i> Löschen
          </button>
        ` : ''}
      </div>
    `;
  }).join('');
  if (typeof reloadIcons === 'function') reloadIcons();
}

window.importCloudTemplate = async function(index) {
  const entry = window._cloudTemplateCache?.[index];
  if (!entry?.template) return;
  try {
    closeModal('modal-cloud-files');
    const board = createBoardFromTemplateObject(entry.template);
    showToast(`Vorlage als neues Board geladen: ${board.name}`);
  } catch(e) {
    showToast(e.message || 'Vorlage konnte nicht geladen werden.', 'error');
  }
};

window.deleteCloudTemplateFromDatabase = async function(index) {
  if (isStudentMode()) {
    showToast('Vorlagen können nur im Tutor-Modus gelöscht werden.', 'error');
    return;
  }
  const entry = window._cloudTemplateCache?.[index];
  if (!entry) return;
  const label = entry.title || entry.template?.boardName || 'diese Vorlage';
  const ok = await showConfirm(`Vorlage "${label}" wirklich aus der Datenbank löschen?\n\nDiese Aktion kann nicht rückgängig gemacht werden.`, 'Löschen', 'Abbrechen');
  if (!ok) return;

  try {
    const teacherPub = getTeacherPublicKeyForCloud();
    if (!teacherPub) throw new Error('Bitte zuerst die Tutor-INI laden.');
    await window.kfCloud.deleteTemplate({
      teacherPublicKeyJwk: teacherPub,
      templateId: entry._id,
    });
    showToast('Vorlage gelöscht.');
    await window.showCloudTemplates();
  } catch(e) {
    showToast(e.message || 'Vorlage konnte nicht gelöscht werden.', 'error');
  }
};

// ── DEADLINE SPEICHERN ────────────────────────────────
window.saveDeadline = (boardId, inputId) => {
  const value = document.getElementById(inputId)?.value || '';
  updateBoard(boardId, { deadline: value });
  if (S.currentBoard?.id === boardId) S.currentBoard.deadline = value;
  showToast(value ? 'Abgabetermin gesetzt' : 'Abgabetermin entfernt');
};

// ── DATEIVERWALTUNGS-PANEL ────────────────────────────────
window.toggleFilemanagementPanel = function() {
  const panel = document.getElementById('filemanagement-panel');
  if (!panel) return;
  const isOpen = panel.style.display !== 'none';
  panel.style.display = isOpen ? 'none' : 'block';
  if (!isOpen && typeof reloadIcons === 'function') reloadIcons();
};

window.closeFilemanagementPanel = function() {
  const panel = document.getElementById('filemanagement-panel');
  if (panel) panel.style.display = 'none';
};

// ── SESSION ZURÜCKSETZEN (wird von logoutUser in auth.js aufgerufen) ──
window.resetToolsSession = function() {
  _teacherSessionPassword = null;
  window._loadedIni = null;
  window._studentReturnKeys = null;
  window._lastStudentCloudMeta = null;
};

// ── RÜCKGABE-EXPORT AN SCHÜLER (Tutor-only) ──────────────
window.exportForStudent = async function() {
  let built;
  try {
    built = await buildTutorReturnExport();
  } catch(e) { showToast('Verschlüsselungsfehler: ' + e.message, 'error'); return; }
  const { json, suggestedName } = built;

  if (window.showSaveFilePicker) {
    try {
      const handle = await window.showSaveFilePicker({
        suggestedName,
        types: [{ description: 'EDUBAN Datei', accept: { 'application/json': ['.json'] } }],
      });
      const w = await handle.createWritable();
      await w.write(json); await w.close();
      showToast('📤 Datei gespeichert! Die Schülerin oder der Schüler kann sie mit dem eigenen Passwort öffnen.');
      return;
    } catch(e) { if (e.name === 'AbortError') return; }
  }
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = suggestedName; a.click();
  URL.revokeObjectURL(url);
  showToast('📤 Datei gespeichert! Die Schülerin oder der Schüler kann sie mit dem eigenen Passwort öffnen.');
};

// ── DATENBANK-SPEICHERUNG (nur verschlüsselte Pakete) ───────────────
window.saveCurrentFileToCloud = async function() {
  if (!window.kfCloud) { showToast('Firebase-Modul nicht geladen.', 'error'); return; }

  if (window._kfSession?.isStudent !== true) {
    if (window._studentReturnKeys) {
      await returnForStudentToCloud();
    } else {
      showToast('Die Datenbank-Speicherung ist hier für Schülerdateien gedacht. Für Tutor-Rückgaben bitte zuerst eine Schülerdatei importieren.', 'error');
    }
    return;
  }

  try {
    const fallbackName = S.currentBoard?.name || 'Meine Sicherung';
    const title = await askForOptionalName('Wie soll deine private Sicherung heißen?', fallbackName, 'Private Datenbank-Datei benennen');
    if (title === null) return;
    const built = await buildStudentEncryptedExport(title || fallbackName, 'student-private');
    const saved = await window.kfCloud.saveEncryptedFile(built);
    window.markBackupDone();
    showToast(`🔒 Privat in der Datenbank gespeichert (${saved.title || 'Schülerdatei'}).`);
  } catch(e) {
    showToast(e.message || 'Speichern in der Datenbank fehlgeschlagen.', 'error');
  }
};

window.forwardCurrentFileToTutor = async function() {
  if (!window.kfCloud) { showToast('Firebase-Modul nicht geladen.', 'error'); return; }
  if (window._kfSession?.isStudent !== true) {
    showToast('Diese Funktion ist für Schülerinnen und Schüler gedacht.', 'error');
    return;
  }

  try {
    const fallbackName = `${S.currentBoard?.reflectionCompleted ? 'fertig - ' : ''}${S.currentBoard?.name || 'Meine Abgabe'}`;
    const title = await askForOptionalName('Wie soll diese Weiterleitung an den Tutor heißen?', fallbackName, 'An den Tutor weiterleiten');
    if (title === null) return;
    const built = await buildStudentEncryptedExport(title || fallbackName, 'student-submission');
    const saved = await window.kfCloud.saveEncryptedFile(built);
    window.markBackupDone();
    showToast(`📤 An den Tutor weitergeleitet (${saved.title || saved.studentLabel || 'Schülerdatei'}).`);
  } catch(e) {
    showToast(e.message || 'Weiterleiten an den Tutor fehlgeschlagen.', 'error');
  }
};

// ── ABGABE ALS LOKALE DATEI (z. B. zum Verschicken per Mail) ──
// Erzeugt dasselbe verschlüsselte Image wie die Datenbank-Weiterleitung,
// speichert es aber als Datei. Funktioniert auch auf iPad (Download-Fallback).
window.saveSubmissionAsFile = async function() {
  if (window._kfSession?.isStudent !== true && !isStudentMode()) {
    showToast('Diese Funktion ist für Schülerinnen und Schüler gedacht.', 'error');
    return;
  }

  try {
    const built = await buildStudentEncryptedExport('', 'student-submission');
    if (!built) return;
    await downloadJsonFile(
      built.json,
      built.suggestedName,
      '🔒 Abgabe als Datei gespeichert. Du kannst sie jetzt z. B. per Mail an deinen Tutor schicken.'
    );
    window.markBackupDone();
  } catch(e) {
    showToast(e.message || 'Speichern der Abgabe fehlgeschlagen.', 'error');
  }
};

window.returnForStudentToCloud = async function() {
  if (!window.kfCloud) { showToast('Firebase-Modul nicht geladen.', 'error'); return; }
  try {
    const built = await buildTutorReturnExport();
    await window.kfCloud.saveEncryptedFile(built);
    showToast('🔒 Rückgabe verschlüsselt in der Datenbank gespeichert.');
  } catch(e) {
    showToast(e.message || 'Rückgabe in die Datenbank fehlgeschlagen.', 'error');
  }
};

function getTeacherPublicKeyForCloud() {
  if (window._kfSession?.isStudent && window._kfSession.teacherPublicKeyJwk) {
    return window._kfSession.teacherPublicKeyJwk;
  }
  if (window._loadedIni?.publicKey) return window._loadedIni.publicKey;
  return null;
}

async function canDecryptWithStudentPassword(file, studentPassword) {
  if (!studentPassword || !file?.payload?.stuKeyEnc) return false;
  try {
    await window.kfCrypto.decryptStr(file.payload.stuKeyEnc, studentPassword);
    return true;
  } catch(e) {
    return false;
  }
}

async function filterFilesByStudentPassword(files, studentPassword) {
  const results = [];
  for (const file of files || []) {
    if (await canDecryptWithStudentPassword(file, studentPassword)) results.push(file);
  }
  return results;
}

function mergeCloudFileLists(...lists) {
  const seen = new Set();
  const merged = [];
  lists.flat().filter(Boolean).forEach(file => {
    const key = file._path || `${file._privateFile ? 'private' : 'teacher'}:${file._id || file.createdAt || file.title || Math.random()}`;
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(file);
  });
  return merged.sort((a, b) => String(b.createdAt || '').localeCompare(String(a.createdAt || '')));
}

window.showCloudFiles = async function() {
  const modal = document.getElementById('modal-cloud-files');
  const title = document.getElementById('cloud-files-title');
  const list = document.getElementById('cloud-files-list');
  if (!modal || !list) return;
  if (title) title.textContent = 'Datenbank-Dateien';
  modal.style.display = 'flex';
  list.innerHTML = '<div style="padding:28px;text-align:center;color:var(--text-muted);">Datenbank wird geladen…</div>';
  if (typeof reloadIcons === 'function') reloadIcons();

  try {
    const teacherPub = getTeacherPublicKeyForCloud();
    if (!teacherPub) {
      list.innerHTML = '<div style="padding:22px;border:1px solid var(--border);border-radius:12px;color:var(--text-muted);line-height:1.5;">Bitte zuerst die Tutor-INI laden. Danach kann die App erkennen, welche verschlüsselten Dateien zu diesem Tutor gehören.</div>';
      return;
    }
    let files = await window.kfCloud.listTeacherFiles(teacherPub);
    let fallbackByName = false;
    if (!files.length && !window._kfSession?.isStudent && window.kfCloud.findTeacherFilesByName && window._loadedIni?.teacherName) {
      const byName = await window.kfCloud.findTeacherFilesByName(window._loadedIni.teacherName);
      if (byName.length) {
        files = byName;
        fallbackByName = true;
      }
    }
    window._cloudFileFallbackByName = fallbackByName;
    if (window._kfSession?.isStudent) {
      const session = await ensureStudentSession();
      const studentPassword = session?.studentPassword || '';
      const studentLabel = S.currentUser?.displayName || '';
      let privateCandidates = [];
      if (window.kfCloud.listStudentPasswordFiles) {
        privateCandidates = await window.kfCloud.listStudentPasswordFiles({ teacherPublicKeyJwk: teacherPub, studentPassword });
      }
      if (!privateCandidates.length && window.kfCloud.listStudentPrivateFiles) {
        privateCandidates = await window.kfCloud.listStudentPrivateFiles({ teacherPublicKeyJwk: teacherPub, studentLabel });
      }
      const teacherFilesForPassword = await filterFilesByStudentPassword(files, studentPassword);
      const privateFilesForPassword = await filterFilesByStudentPassword(privateCandidates, studentPassword);
      files = mergeCloudFileLists(privateFilesForPassword, teacherFilesForPassword);
    } else {
      files = files.filter(file => file.kind !== 'student-private');
    }
    renderCloudFiles(files);
  } catch(e) {
    list.innerHTML = `<div style="padding:22px;border:1px solid rgba(239,68,68,0.35);background:rgba(239,68,68,0.08);border-radius:12px;color:#ef4444;line-height:1.5;">${escHtml(e.message || 'Datenbank konnte nicht gelesen werden.')}</div>`;
  }
};

function renderCloudFiles(files) {
  const list = document.getElementById('cloud-files-list');
  if (!list) return;
  window._cloudFileCache = files;
  if (!files.length) {
    list.innerHTML = '<div style="padding:32px;text-align:center;color:var(--text-muted);">Noch keine passenden Dateien in der Datenbank.</div>';
    return;
  }

  const fmt = iso => {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'unbekanntes Datum';
    return d.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' })
      + ' · ' + d.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' }) + ' Uhr';
  };
  const kindLabel = kind => {
    if (kind === 'tutor-return') return 'Rückgabe vom Tutor';
    if (kind === 'student-submission') return 'An Tutor weitergeleitet';
    if (kind === 'student-private') return 'Private Sicherung';
    return 'Datenbank-Datei';
  };
  const canDeleteCloudFiles = true;
  const isStudentView = isStudentMode();

  const byStudent = {};
  files.forEach(file => {
    const key = file.studentId || file.studentLabel || 'unknown';
    if (!byStudent[key]) byStudent[key] = { latestSubmission: '', latestReturn: '' };
    if (file.kind === 'student-submission' && String(file.createdAt || '') > byStudent[key].latestSubmission) {
      byStudent[key].latestSubmission = String(file.createdAt || '');
    }
    if (file.kind === 'tutor-return' && String(file.createdAt || '') > byStudent[key].latestReturn) {
      byStudent[key].latestReturn = String(file.createdAt || '');
    }
  });

  const statusFor = file => {
    const key = file.studentId || file.studentLabel || 'unknown';
    const meta = byStudent[key] || {};
    const hasReturnAfterThis = meta.latestReturn && String(meta.latestReturn) > String(file.createdAt || '');
    const hasReturnAfterLatestSubmission = meta.latestReturn && meta.latestSubmission && String(meta.latestReturn) > String(meta.latestSubmission);
    if (file.kind === 'tutor-return') {
      return { text: isStudentView ? 'Rückgabe vorhanden' : 'Rückgabe bereit', color: '#38bdf8', bg: 'rgba(56,189,248,0.14)', border: 'rgba(56,189,248,0.35)' };
    }
    if (file.kind === 'student-private') {
      return { text: 'Privat gespeichert', color: '#c4b5fd', bg: 'rgba(139,92,246,0.14)', border: 'rgba(139,92,246,0.32)' };
    }
    if (isStudentView) {
      if (hasReturnAfterThis) return { text: 'Rückgabe vorhanden', color: '#38bdf8', bg: 'rgba(56,189,248,0.14)', border: 'rgba(56,189,248,0.35)' };
      return { text: 'Abgabe gespeichert', color: '#a7f3d0', bg: 'rgba(16,185,129,0.14)', border: 'rgba(16,185,129,0.32)' };
    }
    if (hasReturnAfterLatestSubmission || hasReturnAfterThis) {
      return { text: 'Rückgabe erstellt', color: '#a7f3d0', bg: 'rgba(16,185,129,0.14)', border: 'rgba(16,185,129,0.32)' };
    }
    return { text: 'Neu eingereicht', color: '#fde68a', bg: 'rgba(245,158,11,0.16)', border: 'rgba(245,158,11,0.35)' };
  };

  const fallbackNotice = window._cloudFileFallbackByName ? `
    <div style="padding:12px 14px;border:1px solid rgba(245,158,11,0.35);background:rgba(245,158,11,0.12);border-radius:12px;color:#fbbf24;font-size:12px;line-height:1.5;margin-bottom:8px;">
      Es wurden Dateien mit deinem Tutor-Namen gefunden, aber nicht unter dem aktuell geladenen Tutor-Schlüssel. Vermutlich wurde eine neue INI erzeugt. Zum Öffnen brauchst du die ursprüngliche INI dieser Schülergruppe.
    </div>
  ` : '';

  list.innerHTML = fallbackNotice + files.map((file, idx) => {
    const status = statusFor(file);
    return `
    <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:var(--surface);border:1px solid var(--border);border-radius:12px;margin-bottom:8px;">
      <div style="width:34px;height:34px;border-radius:10px;background:rgba(99,102,241,0.14);display:flex;align-items:center;justify-content:center;color:var(--accent);flex-shrink:0;">
        <i data-lucide="${file.kind === 'tutor-return' ? 'send' : 'cloud'}" style="width:17px;height:17px;"></i>
      </div>
      <div style="flex:1;min-width:0;">
        <div style="display:flex;align-items:center;gap:8px;min-width:0;flex-wrap:wrap;">
          <div style="font-weight:700;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;min-width:120px;max-width:100%;">${escHtml(file.title || file.studentLabel || file.studentId || 'Unbekannte Schülerkennung')}</div>
          <span style="display:inline-flex;align-items:center;padding:3px 8px;border-radius:999px;border:1px solid ${status.border};background:${status.bg};color:${status.color};font-size:10px;font-weight:900;text-transform:uppercase;letter-spacing:0.4px;white-space:nowrap;">${escHtml(status.text)}</span>
        </div>
        <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${escHtml(kindLabel(file.kind))}${file.title && file.studentLabel ? ` · ${escHtml(file.studentLabel)}` : ''} · ${fmt(file.createdAt)}</div>
      </div>
      <button class="btn-sm btn-sm-primary" onclick="importCloudFile(${idx})" style="display:flex;align-items:center;gap:6px;">
        <i data-lucide="download" style="width:13px;height:13px;"></i> Laden
      </button>
      ${canDeleteCloudFiles ? `
        <button class="btn-sm btn-sm-ghost" onclick="deleteCloudFileFromDatabase(${idx})" title="Datenbankdatei löschen" style="display:flex;align-items:center;gap:6px;color:var(--danger) !important;border-color:rgba(240,82,82,0.35) !important;">
          <i data-lucide="trash-2" style="width:13px;height:13px;"></i> Löschen
        </button>
      ` : ''}
    </div>
  `;
  }).join('');
  if (typeof reloadIcons === 'function') reloadIcons();
}

window.importCloudFile = async function(index) {
  const file = window._cloudFileCache?.[index];
  if (!file) return;
  try {
    if (window._cloudFileFallbackByName) {
      const ok = await showConfirm(
        'Diese Datei gehört wahrscheinlich zu einer anderen Tutor-INI. Wenn du nicht die ursprüngliche INI verwendest, wird das Entschlüsseln scheitern.\n\nTrotzdem laden versuchen?',
        'Laden versuchen',
        'Abbrechen'
      );
      if (!ok) return;
    }
    const encryptedJson = window.kfCloud.encryptedJsonFromCloudFile(file);
    closeModal('modal-cloud-files');
    await importDataFromText(encryptedJson, {
      studentId: file.studentId || '',
      studentLabel: file.studentLabel || '',
      kind: file.kind || '',
    });
  } catch(e) {
    showToast(e.message || 'Datenbankdatei konnte nicht geladen werden.', 'error');
  }
};

window.deleteCloudFileFromDatabase = async function(index) {
  const file = window._cloudFileCache?.[index];
  if (!file) return;
  if (window._kfSession?.isStudent) {
    const teacherPub = getTeacherPublicKeyForCloud();
    const studentLabel = S.currentUser?.displayName || '';
    const stableStudentId = window.kfCloud?.getStableStudentId && teacherPub
      ? await window.kfCloud.getStableStudentId({ teacherPublicKeyJwk: teacherPub, studentLabel })
      : '';
    const legacyStudentId = window.kfCloud?.getStudentId?.() || '';
    const normalizedStudentLabel = studentLabel.trim().toLowerCase();
    const fileLabel = String(file.studentLabel || '').trim().toLowerCase();
    const isOwnFile = file.studentId === stableStudentId
      || file.studentId === legacyStudentId
      || (normalizedStudentLabel && fileLabel === normalizedStudentLabel);
    if (!isOwnFile) {
      showToast('Du kannst nur eigene Datenbankdateien löschen.', 'error');
      return;
    }
  }
  const label = file.title || file.studentLabel || file.studentId || 'diese Datei';
  const ok = await showConfirm(`Datenbankdatei von "${label}" wirklich löschen?\n\nDiese Aktion kann nicht rückgängig gemacht werden.`, 'Löschen', 'Abbrechen');
  if (!ok) return;

  try {
    const teacherPub = getTeacherPublicKeyForCloud();
    if (!teacherPub) throw new Error('Bitte zuerst die Tutor-INI laden.');
    await window.kfCloud.deleteCloudFile({
      teacherPublicKeyJwk: teacherPub,
      fileId: file._id,
      studentId: file.studentId || '',
      privateFile: file._privateFile === true,
    });
    showToast('Datenbankdatei gelöscht.');
    await window.showCloudFiles();
  } catch(e) {
    showToast(e.message || 'Datenbankdatei konnte nicht gelöscht werden.', 'error');
  }
};

// ── LOKALER VERSIONSVERLAUF (nur Lehrer) ──────────────
window.showVersionHistory = function() {
  const versions = getLocalVersions();

  const fmt = iso => {
    const d = new Date(iso);
    return d.toLocaleDateString('de-DE', { day:'2-digit', month:'2-digit', year:'numeric' })
      + ' · ' + d.toLocaleTimeString('de-DE', { hour:'2-digit', minute:'2-digit' }) + ' Uhr';
  };

  let rows = '';
  if (!versions.length) {
    rows = `<div style="text-align:center;color:var(--text-muted);padding:32px 0;font-size:14px;">Noch keine gespeicherten Versionen.<br>Exportiere das Board, um eine Version zu speichern.</div>`;
  } else {
    versions.forEach((v, i) => {
      rows += `
        <div style="display:flex;align-items:center;gap:12px;padding:12px 16px;background:var(--surface);border-radius:12px;margin-bottom:8px;">
          <div style="flex:1;min-width:0;">
            <div style="font-weight:700;font-size:13px;color:var(--text);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${escHtml(v.label)}</div>
            <div style="font-size:11px;color:var(--text-muted);margin-top:2px;">${fmt(v.savedAt)}${i === 0 ? ' <span style="background:var(--accent);color:#fff;font-size:9px;padding:1px 6px;border-radius:8px;margin-left:4px;font-weight:700;">AKTUELL</span>' : ''}</div>
          </div>
          <button onclick="window._restoreVersion('${v.id}')" style="padding:6px 14px;border-radius:8px;border:1px solid var(--accent);background:transparent;color:var(--accent);font-size:12px;font-weight:700;cursor:pointer;white-space:nowrap;">Laden</button>
          <button onclick="window._deleteVersion('${v.id}',this)" style="padding:6px 10px;border-radius:8px;border:1px solid var(--border);background:transparent;color:var(--text-muted);font-size:12px;cursor:pointer;">✕</button>
        </div>`;
    });
  }

  document.getElementById('modal-versions')?.remove();
  const modal = document.createElement('div');
  modal.id = 'modal-versions';
  modal.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.6);backdrop-filter:blur(6px);z-index:20010;display:flex;align-items:center;justify-content:center;';
  modal.onclick = e => { if (e.target === modal) modal.remove(); };
  modal.innerHTML = `
    <div style="background:rgba(var(--panel-rgb),1);border-radius:20px;width:92%;max-width:520px;border:1px solid var(--border);padding:28px;position:relative;box-shadow:0 30px 90px rgba(0,0,0,0.5);max-height:80vh;display:flex;flex-direction:column;">
      <button onclick="document.getElementById('modal-versions').remove()" style="position:absolute;right:18px;top:18px;background:none;border:none;color:var(--text-muted);font-size:22px;cursor:pointer;">✕</button>
      <div style="font-size:18px;font-weight:900;margin-bottom:4px;">Versionsverlauf</div>
      <div style="font-size:12px;color:var(--text-muted);margin-bottom:20px;">${getLocalVersions().length} von max. 20 Versionen gespeichert. Wird beim Export automatisch aktualisiert.</div>
      <div style="overflow-y:auto;flex:1;">${rows}</div>
    </div>`;
  document.body.appendChild(modal);
};

window._restoreVersion = async function(id) {
  const ok = await showConfirm(
    'Diese Version laden?\n\nDas aktuelle Board wird überschrieben. Du kannst vorher noch eine neue Version speichern (Exportieren).',
    'Laden', 'Abbrechen'
  );
  if (!ok) return;
  const success = restoreLocalVersion(id);
  if (success) {
    document.getElementById('modal-versions')?.remove();
    showToast('Version geladen! Seite wird neu geladen…');
    setTimeout(() => location.reload(), 1200);
  } else {
    showToast('Version konnte nicht geladen werden.', 'error');
  }
};

window._deleteVersion = function(id, btn) {
  deleteLocalVersion(id);
  btn.closest('div[style]').remove();
  const versions = getLocalVersions();
  if (!versions.length) {
    document.querySelector('#modal-versions [style*="overflow-y"]').innerHTML =
      `<div style="text-align:center;color:var(--text-muted);padding:32px 0;font-size:14px;">Keine gespeicherten Versionen mehr.</div>`;
  }
};


// ═══════════════════════════════════════════════════════════════
// DATENBANKFREIE VERSION (tools-ohne-datenbank.js)
// Alle Firebase-/Datenbank-Funktionen sind hier deaktiviert.
// Boards werden ausschließlich verschlüsselt als Datei gespeichert
// und wieder geladen.
// ═══════════════════════════════════════════════════════════════
function _keineDatenbank() {
  showToast('Diese Version arbeitet ohne Datenbank. Bitte nutze "Alles exportieren & sichern" bzw. "Abgabe als Datei speichern".', 'error');
}

window.saveCurrentFileToCloud       = _keineDatenbank;
window.showCloudFiles               = _keineDatenbank;
window.importCloudFile              = _keineDatenbank;
window.deleteCloudFileFromDatabase  = _keineDatenbank;
window.saveTemplateBoardToCloud     = _keineDatenbank;
window.showCloudTemplates           = _keineDatenbank;
window.importCloudTemplate          = _keineDatenbank;
window.deleteCloudTemplateFromDatabase = _keineDatenbank;
window.returnForStudentToCloud      = _keineDatenbank;

// "An den Tutor weiterleiten" (z. B. aus dem Reflexions-Dialog) speichert
// in dieser Version die verschlüsselte Abgabe als lokale Datei.
window.forwardCurrentFileToTutor = function() {
  return window.saveSubmissionAsFile();
};
