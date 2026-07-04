// js/gantt.js — Projekt-Timeline mit Drag-to-Schedule
import { S, updateBoard } from './state.js';

export function showGanttView(data, grid) {
    const people = data.people || [];
    const placed = grid.placedCards || [];
    const colors = data.lineColors || {};
    const SCHOOL_HOUR_H = 0.75;      // 45 Minuten
    const DOUBLE_HOUR_H = 1.5;       // 90 Minuten
    const labelWidth = 150;
    const getDoubleLessonFitWidth = () => {
        const viewportW = Math.max(window.innerWidth || 0, 820);
        const overlayPadding = viewportW * 0.04;
        const modalW = Math.min(1400, Math.max(760, viewportW - overlayPadding));
        const visibleTimelineW = Math.max(420, modalW - 40 - labelWidth);
        return Math.round(visibleTimelineW / 2);
    };
    const zoomLevels = {
        compact: 40,
        normal: 58,
        detail: 92,
        hour: getDoubleLessonFitWidth(),
    };
    const zoom = window._ganttZoom || 'normal';
    const schoolHourWidth = zoomLevels[zoom] || zoomLevels.normal;
    const pxPerHour = schoolHourWidth / SCHOOL_HOUR_H;
    const gridStepH = zoom === 'hour' ? 0.25 : SCHOOL_HOUR_H;
    const minReadableWidth = zoom === 'hour' ? 54 : (zoom === 'detail' ? 30 : 22);
    const groupCounts = {};
    placed.forEach(task => {
        if (!task.gruppe) return;
        groupCounts[task.gruppe] = (groupCounts[task.gruppe] || 0) + 1;
    });
    const isRealGroup = (task) => !!task.gruppe && groupCounts[task.gruppe] > 1;
    const taskLabel = (task) => String(task.label || '').trim().toUpperCase();
    const getGroupTasks = (gruppe) => placed.filter(task => task.gruppe === gruppe);
    const getCascadeTasks = (gruppe, startHours) => {
        const groupTasks = getGroupTasks(gruppe);
        const groupLabels = new Set(groupTasks.map(taskLabel));
        const affectedPeople = new Set(groupTasks.map(task => task.wer).filter(Boolean));
        const cascade = new Map();
        placed.forEach(task => {
            const startsLater = (task.simStart || 0) > startHours + 0.001;
            if (!startsLater || !affectedPeople.has(task.wer) || groupLabels.has(taskLabel(task))) return;
            if (isRealGroup(task)) {
                getGroupTasks(task.gruppe).forEach(member => cascade.set(taskLabel(member), member));
            } else {
                cascade.set(taskLabel(task), task);
            }
        });
        return Array.from(cascade.values());
    };

    // Scroll-Position retten, bevor altes Overlay entfernt wird
    const existingScroll = document.getElementById('gantt-scroll-area');
    const previousPxPerHour = parseFloat(existingScroll?.dataset?.pxPerHour || '');
    const savedScrollHours = existingScroll && previousPxPerHour
        ? existingScroll.scrollLeft / previousPxPerHour
        : null;
    const savedScrollLeft = existingScroll ? existingScroll.scrollLeft : 0;
    const savedScrollTop  = existingScroll ? existingScroll.scrollTop  : 0;

    // Globale Referenz für Refresh nach Drag
    window._lastGanttData = { data, grid };

    // Altes Overlay entfernen
    document.getElementById('gantt-overlay')?.remove();

    const overlay = document.createElement('div');
    overlay.id = 'gantt-overlay';
    overlay.style.cssText = `
        position: fixed; inset: 0; background: rgba(0,0,0,0.4);
        backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px);
        z-index: 30000; display: flex; align-items: center;
        justify-content: center; padding: 2vw;
    `;
    overlay.onclick = e => { if(e.target === overlay) overlay.remove(); };

    let rawMaxTime = 0;
for (const c of placed) {
    const end = c.simEnd;
    if (typeof end === 'number' && isFinite(end) && end > rawMaxTime) rawMaxTime = end;
}
if (rawMaxTime <= 0) rawMaxTime = 10;
const maxTime = Math.max(rawMaxTime + 4, 8);

    const laneHeight = 64;   // Höhe einer Sub-Lane
    const totalSchoolHours = Math.ceil(maxTime / SCHOOL_HOUR_H) + 2;
    const totalWidth = totalSchoolHours * schoolHourWidth;
    const timelineBlockLabels = S.currentBoard?.timelineBlockLabels || {};

    // ── Constraint-Berechnung ──────────────────────────
    function getConstraints(task) {
        const ownDur = Math.max((task.simEnd || 0) - (task.simStart || 0), 1 / 60);
        const depEnds = (task.deps || []).map(depLabel => {
            const dep = placed.find(p => (p.label||'').toUpperCase() === String(depLabel).toUpperCase());
            return dep ? (dep.simEnd || 0) : 0;
        });
        const earliest = depEnds.length ? Math.max(...depEnds) : 0;
        const dependents = placed.filter(p =>
            (p.deps || []).some(d => String(d).toUpperCase() === (task.label||'').toUpperCase())
        );
        const depStarts = dependents.map(p => p.simStart || 0);
        const latest = depStarts.length ? Math.min(...depStarts) - ownDur : Infinity;
        return { earliest, latest: isFinite(latest) ? Math.max(earliest, latest) : null, ownDur };
    }

    // ── Stunden → Schulstunden-Label ──────────────────
    function fmtH(h) {
        const schoolHours = h / SCHOOL_HOUR_H;
        const whole = Math.floor(schoolHours);
        const minutes = Math.round((schoolHours - whole) * 45);
        if (whole > 0 && minutes > 0) return `${whole} Schulstd. + ${minutes} Min.`;
        if (whole > 0) return `${whole} Schulstd.`;
        return `${Math.round(h * 60)} Min.`;
    }

    function snapToGrid(hours) {
        return Math.max(0, Math.round(hours / gridStepH) * gridStepH);
    }

    // ── Sub-Lane-Zuweisung (verhindert Überlappung in einer Zeile) ────
    function assignLanes(tasks) {
        // Jeder Task bekommt eine Lane-Nummer; überlappende Tasks in verschiedene Lanes
        tasks.forEach(t => { t._lane = 0; });
        for (let i = 0; i < tasks.length; i++) {
            const ti = tasks[i];
            const tiS = ti.simStart || 0, tiE = ti.simEnd || tiS + 0.01;
            let lane = 0;
            let conflict = true;
            while (conflict) {
                conflict = false;
                for (let j = 0; j < i; j++) {
                    const tj = tasks[j];
                    if (tj._lane !== lane) continue;
                    const tjS = tj.simStart || 0, tjE = tj.simEnd || tjS + 0.01;
                    if (tiS < tjE && tiE > tjS) { conflict = true; lane++; break; }
                }
            }
            ti._lane = lane;
        }
    }

    // ── Header ────────────────────────────────────────
    const blockCells = Array.from({length: Math.ceil(totalSchoolHours / 2)}).map((_, blockIdx) => {
        const value = timelineBlockLabels[blockIdx] || '';
        return `<div style="width:${schoolHourWidth * 2}px;flex-shrink:0;border-left:2px solid rgba(99,102,241,0.32);box-sizing:border-box;padding:6px;">
            <div style="font-size:9px;color:var(--text-muted);font-weight:900;text-transform:uppercase;letter-spacing:0.6px;margin-bottom:4px;">Block ${blockIdx + 1}</div>
            <input value="${escHtml(value)}" placeholder="Datum / Stunde"
                   onblur="window.saveGanttBlockLabel(${blockIdx}, this.value)"
                   onkeydown="if(event.key==='Enter') this.blur()"
                   style="width:100%;box-sizing:border-box;border:1px solid var(--border);border-radius:7px;background:var(--surface);color:var(--text);font-size:10px;padding:5px 6px;outline:none;"/>
        </div>`;
    }).join('');

    const headerCells = Array.from({length: totalSchoolHours}).map((_, i) => {
        const isDoubleStart = i % 2 === 0;
        const label = isDoubleStart ? '0–45' : '45–90';
        const quarterTicks = zoom === 'hour'
            ? `<div style="display:grid;grid-template-columns:repeat(3,1fr);gap:0;margin-top:5px;color:var(--text-muted);font-size:8px;font-weight:700;">
                <span>0</span><span>15</span><span>30</span>
              </div>`
            : '';
        return `<div style="width:${schoolHourWidth}px;flex-shrink:0;font-size:9px;color:${isDoubleStart?'var(--text)':'var(--text-muted)'};
            padding:8px 4px;font-weight:${isDoubleStart?'900':'500'};border-left:${isDoubleStart?'2px solid var(--accent)':'1px dashed rgba(148,163,184,0.38)'};
            text-align:center;box-sizing:border-box;">${label}${quarterTicks}</div>`;
    }).join('');

    const milestoneStatuses = typeof window.getMilestoneStatuses === 'function' ? window.getMilestoneStatuses() : [];
    const milestoneData = milestoneStatuses.map((m, idx) => {
        const labelSet = new Set((m.requiredCardLabels || []).map(label => String(label).toUpperCase()));
        const related = placed.filter(task => labelSet.has(String(task.label || '').toUpperCase()));
        if (!related.length && idx > 0) return null;
        const markerTime = related.length ? Math.max(...related.map(task => task.simEnd || 0)) : 0;
        return { ...m, idx, markerTime, left: markerTime * pxPerHour, hasFlowTasks: related.length > 0 };
    }).filter(Boolean);
    const milestoneMarkers = milestoneData.map(m => {
        const color = m.status === 'done' ? '#10b981' : m.status === 'active' ? '#f59e0b' : '#94a3b8';
        const left = Math.max(0, Math.min(m.left, totalWidth - 2));
        return `<div style="position:absolute;left:${left}px;top:0;height:100%;border-left:2px dashed ${color};z-index:4;pointer-events:none;"></div>`;
    }).join('');
    const milestoneShadeBands = milestoneData.map((m, idx) => {
        const start = idx === 0 ? 0 : Math.max(0, Math.min(milestoneData[idx - 1].left, totalWidth));
        const end = Math.max(start, Math.min(m.left, totalWidth));
        if (end <= start) return '';
        const opacity = idx % 2 === 0 ? 0.36 : 0.46;
        return `<div style="position:absolute;left:${start}px;top:0;width:${end - start}px;height:100%;background:rgba(2,6,23,${opacity});z-index:0;pointer-events:none;"></div>`;
    }).join('');
    const milestoneHeader = milestoneData.length ? `
        <div style="display:flex;position:relative;width:${totalWidth}px;height:72px;border-top:1px solid rgba(148,163,184,0.18);border-bottom:1px solid rgba(148,163,184,0.18);background:rgba(var(--panel-rgb),0.78);">
            ${milestoneShadeBands}
            <div style="position:absolute;left:0;top:0;width:${totalWidth}px;height:72px;">
                ${milestoneData.map(m => {
                    const left = Math.max(0, Math.min(m.left + 6, totalWidth - 190));
                    const color = m.status === 'done' ? '#10b981' : m.status === 'active' ? '#f59e0b' : '#94a3b8';
                    const top = 7 + (m.idx % 2) * 31;
                    return `<div title="${escHtml(m.description || m.name)}" style="position:absolute;left:${left}px;top:${top}px;max-width:230px;background:${color};color:${m.status === 'active' ? '#111827' : '#fff'};border-radius:999px;padding:6px 10px;font-size:10px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;box-shadow:0 4px 12px rgba(0,0,0,0.25);">
                        ${m.status === 'done' ? '✓' : m.idx + 1} ${escHtml(m.name)}${m.hasFlowTasks ? '' : ' · Start'}
                    </div>`;
                }).join('')}
            </div>
        </div>` : '';

    // ── Zeilen ────────────────────────────────────────
    const rows = people.map(p => {
        const myTasks = placed.filter(c => c.wer === p);
        const taskColor = colors[p] || '#666';

        assignLanes(myTasks);
        const maxLane  = myTasks.reduce((m, t) => Math.max(m, t._lane), 0);
        const rowH     = (maxLane + 1) * laneHeight;

        const bars = myTasks.map(task => {
            const { earliest, latest, ownDur } = getConstraints(task);
            const left     = (task.simStart || 0) * pxPerHour;
            const scaledWidth = Math.max(ownDur * pxPerHour, 2);
            const showOutsideLabel = scaledWidth < minReadableWidth;
            const isGroup  = isRealGroup(task);
            const hasOffset = task.startOffset !== null && task.startOffset !== undefined;
            const isSelected = taskLabel(task) === String(window._ganttSelectedLabel || '').trim().toUpperCase();
            const laneTop  = task._lane * laneHeight;

            // ── Kritischer Pfad & Fortschritt ──
            const isCritical = !!task._kritisch;
            const isDone     = !!task.finishedAt;
            const isStarted  = !!task.startedAt && !isDone;
            // Reihenfolge-Warnung: gestartet, obwohl ein Vorgänger noch nicht fertig ist
            const openDeps = isStarted
                ? (task.deps || []).filter(depLabel => {
                    const dep = placed.find(p => taskLabel(p) === String(depLabel).trim().toUpperCase());
                    return dep && !dep.finishedAt;
                  })
                : [];
            const orderWarning = openDeps.length > 0;
            const statusIcon = isDone ? '✓ ' : (orderWarning ? '⚠ ' : (isStarted ? '▶ ' : ''));
            const pufferInfo = isCritical
                ? ' | KRITISCH (Puffer 0)'
                : (task._puffer !== undefined ? ` | Puffer ${fmtH(task._puffer)}` : '');
            const statusInfo = isDone ? ' | erledigt' : (orderWarning ? ` | ⚠ gestartet, obwohl offen: ${openDeps.join(', ')}` : (isStarted ? ' | in Arbeit' : ''));

            const taskShadow = isSelected
                ? `box-shadow:0 0 0 3px #fff, 0 0 0 6px ${taskColor};`
                : hasOffset ? `box-shadow:0 0 0 2px ${taskColor};` : '';
            const criticalStripe = isCritical
                ? `<span style="position:absolute;left:0;top:0;bottom:0;width:5px;background:#ef4444;border-radius:8px 0 0 8px;"></span>`
                : '';

            const cMin = earliest * pxPerHour;
            const cMax = latest !== null ? (latest + ownDur) * pxPerHour : totalWidth;
            const cW   = Math.max(cMax - cMin, 0);
            const constraintZone = `<div style="position:absolute;left:${cMin}px;top:${laneTop+8}px;width:${cW}px;height:48px;
                background:rgba(16,185,129,0.06);border-left:2px dashed rgba(16,185,129,0.4);
                border-right:${latest !== null ? '2px dashed rgba(239,68,68,0.4)' : 'none'};
                border-radius:4px;pointer-events:none;z-index:1;"></div>`;

            const taskLabelArg = typeof safeJsArg === 'function'
                ? safeJsArg(task.label)
                : escHtml(JSON.stringify(String(task.label ?? '')));

            return `
                ${constraintZone}
                <div class="gantt-task-bar"
                     data-label="${escHtml(task.label)}"
                     data-gruppe="${escHtml(isGroup ? task.gruppe : '')}"
                     data-person="${escHtml(task.wer || '')}"
                     data-sim-start="${task.simStart || 0}"
                     data-color="${escHtml(taskColor)}"
                     data-earliest="${earliest}"
                     data-latest="${latest !== null ? latest : ''}"
                     data-dur="${ownDur}"
                     title="${escHtml(task.label)}: ${escHtml(task.titel||'')} | ${fmtH(task.simStart||0)} – ${fmtH(task.simEnd||0)}${escHtml(pufferInfo)}${escHtml(statusInfo)}"
                     tabindex="-1"
                     onclick="this.blur(); if(!window._ganttDragged && window.ganttSelectTask) window.ganttSelectTask(${taskLabelArg})"
                     style="position:absolute;left:${left}px;top:${laneTop+14}px;width:${scaledWidth}px;height:36px;
                            background:${isDone ? `${taskColor}11` : `${taskColor}22`};border:2px solid ${taskColor};border-radius:10px;
                            display:flex;align-items:center;padding:0 10px;font-size:11px;color:var(--text);
                            white-space:nowrap;overflow:hidden;box-sizing:border-box;z-index:3;
                            cursor:grab;user-select:none;transition:box-shadow 0.15s;outline:none;
                            ${isGroup ? 'border-style:dashed;' : ''}
                            ${isDone ? 'opacity:0.55;' : ''}
                            ${taskShadow}">
                    ${criticalStripe}
                    ${statusIcon ? `<b style="color:${isDone ? '#10b981' : (orderWarning ? '#ef4444' : taskColor)};margin-right:3px;font-size:12px;flex-shrink:0;">${statusIcon}</b>` : ''}
                    <b style="color:${taskColor};margin-right:6px;font-size:12px;flex-shrink:0;">${escHtml(task.label)}</b>
                    <span style="font-weight:600;opacity:0.9;overflow:hidden;text-overflow:ellipsis;${showOutsideLabel ? 'display:none;' : ''}${isDone ? 'text-decoration:line-through;' : ''}">${escHtml(task.titel||'')}</span>
                    ${hasOffset ? '<span style="margin-left:4px;font-size:9px;opacity:0.6;flex-shrink:0;">📌</span>' : ''}
                </div>`;
        }).join('');

        return `
            <div style="display:flex;align-items:flex-start;border-bottom:1px dotted var(--border);
                        min-height:${rowH}px;position:relative;">
                <div style="width:${labelWidth}px;flex-shrink:0;font-size:11px;font-weight:900;
                            color:${taskColor};position:sticky;left:0;background:var(--bg-panel);z-index:6;
                            padding-right:16px;padding-top:${laneHeight/2 - 8}px;text-align:right;
                            text-transform:uppercase;letter-spacing:1.5px;
                            border-right:1px solid var(--border);height:${rowH}px;box-sizing:border-box;">
                    ${escHtml(p)}
                </div>
                <div style="position:relative;flex:1;height:${rowH}px;overflow:visible;">${bars}</div>
            </div>`;
    }).join('');

    // ── Fortschritts-Statistik ──
    const doneTasks  = placed.filter(t => t.finishedAt);
    const doneHours  = doneTasks.reduce((s, t) => s + Math.max((t.simEnd||0) - (t.simStart||0), 0), 0);
    const totalHours = placed.reduce((s, t) => s + Math.max((t.simEnd||0) - (t.simStart||0), 0), 0);
    const progressInfo = placed.length
        ? ` · Erledigt: <strong>${doneTasks.length}/${placed.length}</strong> Aufgaben (${fmtH(doneHours)} von ${fmtH(totalHours)})`
        : '';

    overlay.innerHTML = `
        <div class="gantt-modal" style="width:100%;max-width:1400px;max-height:90vh;overflow:hidden;
                display:flex;flex-direction:column;color:var(--text);
                box-shadow:0 30px 90px rgba(0,0,0,0.4);background:var(--bg-app);">
            <div style="padding:20px 24px;border-bottom:1px solid var(--border);display:flex;
                        justify-content:space-between;align-items:center;gap:16px;background:rgba(var(--panel-rgb),0.3);flex-wrap:wrap;">
                <div>
                    <h2 style="margin:0;font-size:20px;letter-spacing:1px;text-transform:uppercase;font-weight:900;">Projekt-Timeline</h2>
                    <div style="font-size:12px;color:var(--text-muted);margin-top:3px;">
    Maßstab: 1 Schulstunde = 45 Minuten · 1 Block = 90 Minuten · Drag rastet auf ${zoom === 'hour' ? '15' : '45'} Minuten · Projektdauer: <strong>${fmtH(rawMaxTime)}</strong>${rawMaxTime !== maxTime ? ` (Zeitleiste: ${fmtH(maxTime)})` : ''}${progressInfo}
</div>
                </div>
                <div style="display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
                    <div style="display:flex;gap:4px;align-items:center;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:4px;">
                        ${Object.entries({compact:'Kompakt', normal:'Normal', detail:'Detail', hour:'Stunden'}).map(([key, label]) => `
                            <button onclick="window.setGanttZoom('${key}')"
                                    title="${key === 'hour' ? 'Zeigt genau eine Doppelstunde pro Bildschirmbreite' : ''}"
                                    style="background:${zoom === key ? 'var(--accent)' : 'transparent'};border:none;color:${zoom === key ? '#fff' : 'var(--text-muted)'};
                                           padding:6px 10px;border-radius:8px;cursor:pointer;font-weight:800;font-size:11px;">${label}</button>
                        `).join('')}
                    </div>
                    <button onclick="window.ganttClearOffsets()"
                            title="Hebt alle manuellen Start-Fixierungen in der Timeline auf"
                            style="background:var(--surface);border:1px solid var(--border);color:var(--text);
                                   padding:10px 16px;border-radius:12px;cursor:pointer;font-weight:bold;
                                   font-size:13px;">Fixierungen lösen</button>
                    <button onclick="window.ganttShiftSelectedToNextSchoolHour(0)"
                            title="Verschiebt den markierten Task, parallele Tasks und alle späteren Tasks auf die nächste Schulstunde"
                            style="background:var(--surface);border:1px solid var(--border);color:var(--text);
                                   padding:10px 16px;border-radius:12px;cursor:pointer;font-weight:bold;
                                   font-size:13px;">Auswahl → nächste Std.</button>
                    <button onclick="window.ganttShiftSelectedToNextSchoolHour(1)"
                            title="Wie nächste Schulstunde, aber eine Schulstunde weiter"
                            style="background:var(--surface);border:1px solid var(--border);color:var(--text);
                                   padding:10px 16px;border-radius:12px;cursor:pointer;font-weight:bold;
                                   font-size:13px;">+ 1 Std.</button>
                    <button onclick="window.ganttOpenSelectedTask()"
                            title="Öffnet die markierte Karte"
                            style="background:var(--surface);border:1px solid var(--border);color:var(--text);
                                   padding:10px 16px;border-radius:12px;cursor:pointer;font-weight:bold;
                                   font-size:13px;">Details</button>
                    <button onclick="window.ganttOptimize(window._lastGanttData?.grid?.placedCards || [])"
                            title="Berechnet den schnellstmöglichen Ablaufplan — alle starten so früh wie möglich"
                            style="background:linear-gradient(135deg,#6366f1,#8b5cf6);border:none;color:#fff;
                                   padding:10px 20px;border-radius:12px;cursor:pointer;font-weight:bold;
                                   font-size:13px;letter-spacing:0.3px;">⚡ Optimieren</button>
                    <button onclick="window.ganttStundenzettel()"
                            title="Druckbare Aufgabenliste pro Person und Unterrichtsblock"
                            style="background:var(--surface);border:1px solid var(--border);color:var(--text);
                                   padding:10px 18px;border-radius:12px;cursor:pointer;font-weight:bold;">📋 Stundenzettel</button>
                    <button onclick="window.ganttPrint()"
                            title="Zeitplan drucken"
                            style="background:var(--surface);border:1px solid var(--border);color:var(--text);
                                   padding:10px 18px;border-radius:12px;cursor:pointer;font-weight:bold;">🖨 Drucken</button>
                    <button onclick="document.getElementById('gantt-overlay').remove()"
                            style="background:var(--surface);border:1px solid var(--border);color:var(--text);
                                   padding:10px 24px;border-radius:12px;cursor:pointer;font-weight:bold;">Schließen</button>
                </div>
            </div>
            <div id="gantt-scroll-area" style="flex:1;overflow:auto;padding:16px 20px;position:relative;">
                <div style="margin-left:${labelWidth}px;position:sticky;top:0;background:var(--bg-panel);z-index:10;border-bottom:1px solid var(--border);">
                    <div style="position:relative;width:${totalWidth}px;">
                        <div style="position:absolute;inset:0;pointer-events:none;">${milestoneShadeBands}</div>
                        <div style="display:flex;align-items:stretch;border-bottom:1px solid rgba(148,163,184,0.18);position:relative;z-index:1;">${blockCells}</div>
                        <div style="display:flex;position:relative;z-index:1;">${headerCells}</div>
                    </div>
                    ${milestoneHeader}
                </div>
                <div style="min-width:${labelWidth + totalWidth}px;background-image:
    ${zoom === 'hour' ? `linear-gradient(90deg, transparent ${schoolHourWidth/3-1}px, rgba(148,163,184,0.13) ${schoolHourWidth/3-1}px, rgba(148,163,184,0.13) ${schoolHourWidth/3}px, transparent ${schoolHourWidth/3}px),` : ''}
    linear-gradient(90deg, transparent ${schoolHourWidth-1}px, rgba(148,163,184,0.20) ${schoolHourWidth-1}px, rgba(148,163,184,0.20) ${schoolHourWidth}px, transparent ${schoolHourWidth}px),
    linear-gradient(90deg, transparent ${schoolHourWidth*2-2}px, rgba(99,102,241,0.22) ${schoolHourWidth*2-2}px, rgba(99,102,241,0.22) ${schoolHourWidth*2}px, transparent ${schoolHourWidth*2}px);
    background-size:${zoom === 'hour' ? `${schoolHourWidth/3}px 100%, ` : ''}${schoolHourWidth}px 100%, ${schoolHourWidth*2}px 100%;
    background-position: ${labelWidth}px 0;
    background-repeat: repeat-x;
    position:relative;">
                    <div style="position:absolute;left:${labelWidth}px;top:0;width:${totalWidth}px;height:100%;pointer-events:none;">${milestoneShadeBands}${milestoneMarkers}</div>
                    ${rows}
                </div>
            </div>
            <div style="padding:12px 24px;background:rgba(var(--panel-rgb),0.2);border-top:1px solid var(--border);
                        display:flex;gap:24px;font-size:10px;color:var(--text-muted);font-weight:bold;letter-spacing:0.5px;flex-wrap:wrap;">
                <div style="display:flex;align-items:center;gap:6px;">
                    <div style="width:16px;height:10px;border:1px solid var(--text-muted);border-radius:2px;"></div> Einzelaufgabe
                </div>
                <div style="display:flex;align-items:center;gap:6px;">
                    <div style="width:16px;height:10px;border:1px dashed var(--text-muted);border-radius:2px;"></div> Gruppenarbeit
                </div>
                <div style="display:flex;align-items:center;gap:6px;">
                    <div style="width:20px;height:10px;background:rgba(16,185,129,0.12);border-left:2px dashed rgba(16,185,129,0.5);"></div> Möglicher Bereich
                </div>
                <div style="display:flex;align-items:center;gap:6px;">📌 Manuell festgelegt</div>
                <div style="display:flex;align-items:center;gap:6px;">
                    <div style="width:5px;height:12px;background:#ef4444;border-radius:2px;"></div> Kritischer Pfad (Puffer 0)
                </div>
                <div style="display:flex;align-items:center;gap:6px;">✓ erledigt · ▶ in Arbeit · ⚠ Vorgänger noch offen</div>
                <div style="flex:1;text-align:right;opacity:0.6;">Klick = markieren · Auswahl verschiebt parallele und spätere Tasks · Doppelklick = Kartendetails · Rechtsklick = Fixierung aufheben</div>
            </div>
        </div>`;

    document.body.appendChild(overlay);
    const ganttModal = overlay.querySelector('.gantt-modal');
    if (ganttModal) ganttModal.classList.add('gantt-enter-anim');

    // Scroll-Position wiederherstellen
    const newScrollArea = document.getElementById('gantt-scroll-area');
    if (newScrollArea) newScrollArea.dataset.pxPerHour = String(pxPerHour);
    if (newScrollArea && (savedScrollLeft || savedScrollTop)) {
        newScrollArea.scrollLeft = savedScrollHours !== null ? savedScrollHours * pxPerHour : savedScrollLeft;
        newScrollArea.scrollTop  = savedScrollTop;
    }

    // ── Drag-Logik ────────────────────────────────────
    let dragState = null;
    window._ganttDragged = false;

    overlay.querySelectorAll('.gantt-task-bar').forEach(bar => {
        bar.addEventListener('mousedown', e => {
            if (e.button !== 0) return;
            e.preventDefault();
            const scrollArea  = document.getElementById('gantt-scroll-area');
            let earliest    = parseFloat(bar.dataset.earliest) || 0;
            const latestRaw   = bar.dataset.latest;
            let latest      = latestRaw !== '' ? parseFloat(latestRaw) : null;
            const dur         = parseFloat(bar.dataset.dur) || 1;
            const gruppe      = bar.dataset.gruppe || '';
            const groupTasks  = gruppe ? getGroupTasks(gruppe) : [];
            if (groupTasks.length) {
                earliest = Math.max(...groupTasks.map(t => {
                    const depEnds = (t.deps || []).map(depLabel => {
                        const dep = placed.find(p => taskLabel(p) === String(depLabel).trim().toUpperCase());
                        return dep ? (dep.simEnd || 0) : 0;
                    });
                    return depEnds.length ? Math.max(...depEnds) : 0;
                }));
                latest = null;
            }
            const groupStart = groupTasks.length ? Math.min(...groupTasks.map(t => t.simStart || 0)) : 0;
            dragState = {
                bar,
                label:       bar.dataset.label,
                gruppe,
                startClientX: e.clientX,
                originalLeft: parseFloat(bar.style.left) || 0,
                earliest, latest, dur,
                groupStart,
                moved: false,
                scrollArea,
            };
            bar.style.cursor  = 'grabbing';
            bar.style.zIndex  = '20';
            bar.style.opacity = '0.85';
            window._ganttDragged = false;
        });

        // Doppelklick → exakte Startzeit in Minuten, unabhängig vom Raster
// Doppelklick → Detail-Overlay der Karte öffnen (aus ubahn.js)
bar.addEventListener('dblclick', e => {
    e.preventDefault();
    e.stopPropagation();
    const label = bar.dataset.label;
    if (label && typeof window.showUBahnCardDetail === 'function') {
        window.showUBahnCardDetail(label);
    } else if (typeof window.showToast === 'function') {
        window.showToast('Detailansicht nicht verfügbar.', 'error');
    }
});

        // Rechtsklick → Fixierung aufheben (alle Gruppen-Members)
        bar.addEventListener('contextmenu', e => {
            e.preventDefault();
            if (!window.saveCardStartOffset) return;
            const gruppe = bar.dataset.gruppe;
            if (gruppe) {
                placed.filter(t => t.gruppe === gruppe).forEach(t => {
                    window.saveCardStartOffset(t.label, null);
                });
                window.showToast && window.showToast(`Gruppe: Zeitfixierung aufgehoben`);
            } else {
                window.saveCardStartOffset(bar.dataset.label, null);
                window.showToast && window.showToast(`${bar.dataset.label}: Zeitfixierung aufgehoben`);
            }
            if (window._lastGanttData) window.showGanttView(window._lastGanttData.data, window._lastGanttData.grid);
        });
    });

    const onMouseMove = e => {
        if (!dragState) return;
        const dx = e.clientX - dragState.startClientX;
        if (Math.abs(dx) < 3 && !dragState.moved) return;
        dragState.moved = true;
        window._ganttDragged = true;

        const rawLeft = dragState.originalLeft + dx;
        const rawHours = rawLeft / pxPerHour;
        const snappedHours = snapToGrid(rawHours);
        const newLeft = snappedHours * pxPerHour;
        const minLeft    = dragState.earliest * pxPerHour;
        const maxLeft    = dragState.latest !== null ? dragState.latest * pxPerHour : Infinity;
        const clampedLeft = Math.max(minLeft, Math.min(newLeft, maxLeft));

        // Gezogenen Balken verschieben
        dragState.bar.style.left = clampedLeft + 'px';

        // Alle Balken der gleichen Gruppe mitverschieben
        if (dragState.gruppe) {
            const delta = clampedLeft - dragState.originalLeft;
            const deltaHours = delta / pxPerHour;
            const cascadeLabels = deltaHours > 0.001
                ? new Set(getCascadeTasks(dragState.gruppe, dragState.groupStart).map(taskLabel))
                : new Set();
            overlay.querySelectorAll('.gantt-task-bar').forEach(b => {
                if (b !== dragState.bar && (b.dataset.gruppe === dragState.gruppe || cascadeLabels.has(String(b.dataset.label || '').trim().toUpperCase()))) {
                    const orig = parseFloat(b.dataset.origLeft ?? b.style.left) || 0;
                    if (!b.dataset.origLeft) b.dataset.origLeft = orig;
                    b.style.left = Math.max(0, orig + delta) + 'px';
                }
            });
        }

        // Tooltip
        let tip = document.getElementById('gantt-drag-tip');
        if (!tip) {
            tip = document.createElement('div');
            tip.id = 'gantt-drag-tip';
            tip.style.cssText = 'position:fixed;background:rgba(0,0,0,0.85);color:#fff;font-size:11px;font-weight:700;padding:5px 10px;border-radius:8px;pointer-events:none;z-index:40000;';
            document.body.appendChild(tip);
        }
        const newHours = clampedLeft / pxPerHour;
        const label = dragState.gruppe
            ? `Gruppe (${placed.filter(t => t.gruppe === dragState.gruppe).map(t => t.label).join(', ')})`
            : dragState.label;
        tip.textContent = `${label} → ${fmtH(newHours)}`;
        tip.style.left = (e.clientX + 14) + 'px';
        tip.style.top  = (e.clientY - 10) + 'px';

        const outOfRange = dragState.latest !== null && newLeft > dragState.latest * pxPerHour + 2;
        dragState.bar.style.borderColor = outOfRange ? '#ef4444' : (dragState.bar.dataset.color || '');
    };

    const onMouseUp = e => {
        document.getElementById('gantt-drag-tip')?.remove();
        if (!dragState) return;
        const { bar, label, gruppe, moved } = dragState;
        bar.style.cursor  = 'grab';
        bar.style.zIndex  = '3';
        bar.style.opacity = '1';
        bar.style.borderColor = bar.dataset.color || '';

        if (moved && window.saveCardStartOffset) {
            const newHours = parseFloat(bar.style.left) / pxPerHour;
            const offsetDays = newHours / 8;

            if (gruppe) {
                // Alle Gruppen-Members auf denselben Start setzen
                const groupTasks = getGroupTasks(gruppe);
                groupTasks.forEach(t => window.saveCardStartOffset(t.label, offsetDays));
                const deltaHours = newHours - (dragState.groupStart || 0);
                let cascadeCount = 0;
                if (deltaHours > 0.001) {
                    const cascadeTasks = getCascadeTasks(gruppe, dragState.groupStart || 0);
                    cascadeTasks.forEach(t => {
                        window.saveCardStartOffset(t.label, ((t.simStart || 0) + deltaHours) / 8);
                    });
                    cascadeCount = cascadeTasks.length;
                }
                window.showToast && window.showToast(cascadeCount
                    ? `Gruppe verschoben, ${cascadeCount} Folgeaufgaben mitgeschoben`
                    : `Gruppe: ${groupTasks.length} Tasks → ${fmtH(newHours)}`);
            } else {
                window.saveCardStartOffset(label, offsetDays);
                window.showToast && window.showToast(`${label}: Start → ${fmtH(newHours)}`);
            }

            // Sofort neu zeichnen (saveCardStartOffset ist synchron und aktualisiert _lastGanttData)
            if (window._lastGanttData) {
                window.showGanttView(window._lastGanttData.data, window._lastGanttData.grid);
            }
        }

        dragState = null;
        setTimeout(() => { window._ganttDragged = false; }, 50);
    };

    overlay.addEventListener('mousemove', onMouseMove);
    overlay.addEventListener('mouseup',   onMouseUp);
    overlay.addEventListener('mouseleave', onMouseUp);
}

function escHtml(t) {
    return String(t).replace(/[&<>"']/g, m => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' }[m]));
}

window.setGanttZoom = function(level) {
    window._ganttZoom = level;
    if (window._lastGanttData) {
        window.showGanttView(window._lastGanttData.data, window._lastGanttData.grid);
    }
};

window.saveGanttBlockLabel = function(blockIndex, value) {
    if (!S.currentBoard) return;
    const labels = { ...(S.currentBoard.timelineBlockLabels || {}) };
    const text = String(value || '').trim();
    if (text) labels[blockIndex] = text;
    else delete labels[blockIndex];
    S.currentBoard.timelineBlockLabels = labels;
    updateBoard(S.currentBoard.id, { timelineBlockLabels: labels });
};

window.ganttSelectTask = function(label) {
    const newLabel = String(label || '').trim().toUpperCase();
    const oldLabel = window._ganttSelectedLabel;
    if (oldLabel === newLabel) return; // bereits markiert

    // Alte Markierung entfernen
    if (oldLabel) {
        const oldBar = document.querySelector(`.gantt-task-bar[data-label="${oldLabel}"]`);
        if (oldBar) oldBar.style.boxShadow = '';
    }

    // Neue Markierung setzen
    const newBar = document.querySelector(`.gantt-task-bar[data-label="${newLabel}"]`);
    if (newBar) {
        const taskColor = newBar.dataset.color || '#666';
        newBar.style.boxShadow = `0 0 0 3px #fff, 0 0 0 6px ${taskColor}`;
    }

    window._ganttSelectedLabel = newLabel;
};

window.ganttOpenSelectedTask = function() {
    const label = String(window._ganttSelectedLabel || '').trim();
    if (!label) {
        window.showToast && window.showToast('Bitte zuerst eine Karte in der Timeline markieren.', 'error');
        return;
    }
    if (typeof window.showUBahnCardDetail === 'function') window.showUBahnCardDetail(label);
};

window.ganttShiftSelectedToNextSchoolHour = function(extraSchoolHours = 0) {
    const selectedLabel = String(window._ganttSelectedLabel || '').trim().toUpperCase();
    const placed = window._lastGanttData?.grid?.placedCards || [];
    if (!selectedLabel || !placed.length || typeof window.saveCardStartOffset !== 'function') {
        window.showToast && window.showToast('Bitte zuerst eine Karte in der Timeline markieren.', 'error');
        return;
    }
    const norm = task => String(task.label || '').trim().toUpperCase();
    const selected = placed.find(task => norm(task) === selectedLabel);
    if (!selected) {
        window.showToast && window.showToast('Die markierte Karte wurde nicht mehr gefunden.', 'error');
        return;
    }

    const schoolHour = 0.75;
    const cutStart = selected.simStart || 0;
    const nextSchoolStart = (Math.floor(cutStart / schoolHour) + 1 + Math.max(0, Number(extraSchoolHours) || 0)) * schoolHour;
    const delta = nextSchoolStart - cutStart;
    if (delta <= 0.001) return;

    const groupCounts = {};
    placed.forEach(task => {
        if (!task.gruppe) return;
        groupCounts[task.gruppe] = (groupCounts[task.gruppe] || 0) + 1;
    });
    const affected = new Map();
    placed.forEach(task => {
        const start = task.simStart || 0;
        const end = task.simEnd || start;
        const startsLater = start >= cutStart - 0.001;
        const overlapsCut = start < cutStart && end > cutStart + 0.001;
        if (startsLater || overlapsCut) affected.set(norm(task), task);
    });

    let expanded = true;
    while (expanded) {
        expanded = false;
        placed.forEach(task => {
            if (!task.gruppe || groupCounts[task.gruppe] <= 1 || !affected.has(norm(task))) return;
            placed
                .filter(member => member.gruppe === task.gruppe)
                .forEach(member => {
                    const key = norm(member);
                    if (!affected.has(key)) {
                        affected.set(key, member);
                        expanded = true;
                    }
                });
        });
    }

    Array.from(affected.values()).forEach(task => {
        window.saveCardStartOffset(task.label, ((task.simStart || 0) + delta) / 8);
    });
    if (window._lastGanttData) {
        window.showGanttView(window._lastGanttData.data, window._lastGanttData.grid);
    }
    window.showToast && window.showToast(`${affected.size} Tasks ab ${selected.label} auf die neue Schulstunde verschoben.`);
};

window.ganttClearOffsets = function() {
    const placed = window._lastGanttData?.grid?.placedCards || [];
    if (!placed.length) {
        window.showToast && window.showToast('Keine Timeline-Karten gefunden.', 'error');
        return;
    }
    const labels = placed.map(t => t.label).filter(Boolean);
    const changed = typeof window.clearCardStartOffsets === 'function'
        ? window.clearCardStartOffsets(labels)
        : 0;
    if (window._lastGanttData) {
        window.showGanttView(window._lastGanttData.data, window._lastGanttData.grid);
    }
    window.showToast && window.showToast(changed
        ? `${changed} Zeitfixierungen gelöst.`
        : 'Es gab keine Zeitfixierungen zu lösen.');
};

window.ganttOptimize = function(placed) {
    if (!placed || placed.length === 0) {
        window.showToast && window.showToast('Keine Tasks zum Optimieren.', 'error');
        return;
    }
    window.showToast && window.showToast('Zeitplan wird optimiert…');

    const labels = placed.map(t => t.label).filter(Boolean);
    if (typeof window.clearCardStartOffsets === 'function') {
        window.clearCardStartOffsets(labels);
        placed = window._lastGanttData?.grid?.placedCards || placed;
    }

    const groupCounts = {};
    placed.forEach(task => {
        if (!task.gruppe) return;
        groupCounts[task.gruppe] = (groupCounts[task.gruppe] || 0) + 1;
    });
    const isGrouped = task => !!task.gruppe && groupCounts[task.gruppe] > 1;

    const byLabel = {};
    placed.forEach(t => { byLabel[(t.label||'').toUpperCase()] = t; });
    const taskDur = t => Math.max((t.simEnd||0) - (t.simStart||0), 1 / 60);
    const visited = new Set();
    const order   = [];
    function visit(t) {
        if (visited.has(t.label)) return;
        visited.add(t.label);
        (t.deps||[]).forEach(d => { const dep = byLabel[String(d).toUpperCase()]; if (dep) visit(dep); });
        order.push(t);
    }
    placed.forEach(t => visit(t));

    const endTime    = {};
    const personAvail = {};
    const groupStart  = {};
    order.forEach(t => {
        const d = taskDur(t);
        let depEarliest = 0;
        (t.deps||[]).forEach(dep => {
            const depT = byLabel[String(dep).toUpperCase()];
            if (depT) depEarliest = Math.max(depEarliest, endTime[depT.label] || 0);
        });
        if (isGrouped(t) && groupStart[t.gruppe] !== undefined) {
            const start = groupStart[t.gruppe];
            endTime[t.label] = start + d;
            personAvail[t.wer] = Math.max(personAvail[t.wer] || 0, start + d);
        } else if (isGrouped(t)) {
            const groupMembers = placed.filter(gt => gt.gruppe === t.gruppe);
            let gs = depEarliest;
            groupMembers.forEach(gt => {
                (gt.deps||[]).forEach(dep => {
                    const depT = byLabel[String(dep).toUpperCase()];
                    if (depT) gs = Math.max(gs, endTime[depT.label] || 0);
                });
                gs = Math.max(gs, personAvail[gt.wer] || 0);
            });
            groupStart[t.gruppe] = gs;
            endTime[t.label] = gs + d;
            personAvail[t.wer] = Math.max(personAvail[t.wer] || 0, gs + d);
        } else {
            const start = Math.max(depEarliest, personAvail[t.wer] || 0);
            endTime[t.label] = start + d;
            personAvail[t.wer] = start + d;
        }
    });

    // Offsets speichern: Karten speichern Startversatz weiterhin als 8h-Tagesbruchteil.
    placed.forEach(t => {
        const start = (endTime[t.label] || 0) - taskDur(t);
        const days  = start / 8;
        if (window.saveCardStartOffset) window.saveCardStartOffset(t.label, days);
    });

    const totalH = Math.max(...placed.map(t => endTime[t.label] || 0));
    const totalSchoolHours = (totalH / 0.75).toFixed(1);
    window.showToast && window.showToast(`⚡ Optimiert! Gesamtdauer: ${totalSchoolHours} Schulstunden`);

    if (window._lastGanttData) {
        window.showGanttView(window._lastGanttData.data, window._lastGanttData.grid);
    }
};

window.ganttPrint = function() {
    const scrollArea = document.getElementById('gantt-scroll-area');
    if (!scrollArea) return;
    const styles = Array.from(document.styleSheets).map(s => {
        try { return Array.from(s.cssRules).map(r => r.cssText).join(''); } catch(e) { return ''; }
    }).join('');
    const printWindow = window.open('', '_blank');
    if (!printWindow) { 
        window.showToast && window.showToast('Popup-Fenster blockiert — bitte erlauben.', 'error'); 
        return; 
    }
    printWindow.document.write(`<!DOCTYPE html>
    <html>
    <head>
        <title>Projekt-Timeline</title>
        <style>
            /* Alle vorhandenen Stile übernehmen */
            ${styles}
            
            /* Druck-spezifische Anpassungen */
            body { 
                background: #1a1a1a !important; 
                margin: 0; 
                padding: 20px; 
                font-family: sans-serif; 
            }
            h2 { 
                color: #fff; 
                font-size: 15px; 
                font-weight: 900; 
                letter-spacing: 2px; 
                text-transform: uppercase; 
                margin: 0 0 16px; 
            }
            #gantt-print-area {
                width: 100%;
                overflow: visible;
            }
            /* Erzwinge, dass der gesamte Timeline-Container auf die Seitenbreite skaliert */
            #gantt-print-area .gantt-modal,
            #gantt-print-area > div {
                max-width: 100% !important;
                height: auto !important;
                transform: scale(0.98);
                transform-origin: top left;
            }
            /* Entferne feste Breiten aus dem inneren Container */
            #gantt-print-area [style*="min-width"] {
                min-width: auto !important;
                width: 100% !important;
            }
            @media print {
                @page { 
                    size: landscape; 
                    margin: 0.5cm; 
                }
                body { 
                    -webkit-print-color-adjust: exact; 
                    print-color-adjust: exact; 
                }
                /* Verhindere Seitenumbrüche innerhalb von Zeilen */
                .gantt-task-bar {
                    break-inside: avoid;
                }
            }
        </style>
    </head>
    <body>
        <h2>Projekt-Timeline</h2>
        <div id="gantt-print-area">${scrollArea.innerHTML}</div>
        <script>
            window.onload = function() {
                setTimeout(function() {
                    window.print();
                    window.close();
                }, 500);
            };
        <\/script>
    </body>
    </html>`);
    printWindow.document.close();
};

// ── STUNDENZETTEL: druckbare Aufgabenliste pro Unterrichtsblock & Person ──
// Als eigene Builder-Funktion, damit sie testbar ist.
window._buildStundenzettelHtml = function(data, grid) {
    const placed = grid?.placedCards || [];
    const people = data?.people || [];
    if (!placed.length || !people.length) return '';

    const BLOCK_H = 1.5; // 90 Minuten
    const blockLabels = S.currentBoard?.timelineBlockLabels || {};
    const boardName = S.currentBoard?.name || 'Projekt';
    const maxEnd = Math.max(...placed.map(t => t.simEnd || 0), BLOCK_H);
    const blockCount = Math.ceil(maxEnd / BLOCK_H - 0.001);
    const minutesIn = h => Math.round(h * 60);

    const blocks = Array.from({ length: blockCount }).map((_, blockIdx) => {
        const bStart = blockIdx * BLOCK_H;
        const bEnd = bStart + BLOCK_H;
        const customLabel = blockLabels[blockIdx] ? ` – ${escHtml(blockLabels[blockIdx])}` : '';

        const personSections = people.map(person => {
            const tasks = placed
                .filter(t => t.wer === person && (t.simStart || 0) < bEnd - 0.001 && (t.simEnd || 0) > bStart + 0.001)
                .sort((a, b) => (a.simStart || 0) - (b.simStart || 0));
            if (!tasks.length) return '';
            const items = tasks.map(t => {
                const from = minutesIn(Math.max((t.simStart || 0) - bStart, 0));
                const to = minutesIn(Math.min((t.simEnd || 0) - bStart, BLOCK_H));
                const continues = (t.simEnd || 0) > bEnd + 0.001 ? ' →' : '';
                const started = (t.simStart || 0) < bStart - 0.001 ? '… ' : '';
                const box = t.finishedAt ? '☑' : '☐';
                const crit = t._kritisch ? ' <span style="color:#dc2626;font-weight:800;">KRITISCH</span>' : '';
                const grp = t.gruppe ? ` <span style="color:#555;">[Gruppe: ${escHtml(t.gruppe)}]</span>` : '';
                return `<li style="margin:3px 0;">${box} <b>${escHtml(t.label || '')}</b> ${escHtml(t.titel || '')} <span style="color:#555;">(${started}${from}–${to} Min.${continues})</span>${grp}${crit}</li>`;
            }).join('');
            return `<div style="margin:8px 0 4px;"><div style="font-weight:800;">${escHtml(person)}</div><ul style="margin:2px 0 0 18px;padding:0;">${items}</ul></div>`;
        }).filter(Boolean).join('');

        if (!personSections) return '';
        return `<div class="sz-block" style="border:1px solid #999;border-radius:8px;padding:10px 14px;margin-bottom:14px;break-inside:avoid;">
            <div style="font-weight:900;font-size:14px;border-bottom:1px solid #ccc;padding-bottom:4px;">Block ${blockIdx + 1}${customLabel} <span style="font-weight:500;color:#555;">(Schulstd. ${blockIdx * 2 + 1}–${blockIdx * 2 + 2})</span></div>
            ${personSections}
        </div>`;
    }).filter(Boolean).join('');

    return `<h1 style="font-size:18px;margin:0 0 4px;">Stundenzettel – ${escHtml(boardName)}</h1>
        <div style="font-size:11px;color:#555;margin-bottom:14px;">1 Block = 90 Minuten · ☐ offen · ☑ erledigt · „…" begonnen im vorherigen Block · „→" geht im nächsten Block weiter</div>
        ${blocks}`;
};

window.ganttStundenzettel = function() {
    const { data, grid } = window._lastGanttData || {};
    const html = window._buildStundenzettelHtml(data, grid);
    if (!html) {
        window.showToast && window.showToast('Keine Timeline-Daten für den Stundenzettel gefunden.', 'error');
        return;
    }
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        window.showToast && window.showToast('Popup-Fenster blockiert — bitte erlauben.', 'error');
        return;
    }
    printWindow.document.write(`<!DOCTYPE html><html><head><title>Stundenzettel</title>
        <style>
            body { font-family: -apple-system, 'Segoe UI', Roboto, sans-serif; color:#111; background:#fff; margin:24px; }
            ul { list-style:none; }
            @media print { @page { size: portrait; margin: 1.2cm; } .sz-block { break-inside: avoid; } }
        </style></head>
        <body>${html}<script>window.onload=()=>{setTimeout(()=>{window.print();},400);};<\/script></body></html>`);
    printWindow.document.close();
};

window.showGanttView = showGanttView;
