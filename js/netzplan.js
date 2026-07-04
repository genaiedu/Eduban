// js/netzplan.js — Visueller Abhängigkeitsbaum aus der U-Bahn-Datenbasis

export function showNetzplanView(data, grid) {
  // CPM-Werte (FAZ/SAZ/Puffer/kritisch) aus der Zeitsimulation übernehmen
  const cpmByLabel = new Map();
  (grid?.placedCards || []).forEach(pc => {
    if (!pc?.label) return;
    cpmByLabel.set(String(pc.label).trim().toUpperCase(), {
      faz: pc.simStart || 0,
      fez: pc.simEnd || 0,
      saz: pc._saz,
      sez: pc._sez,
      puffer: pc._puffer,
      kritisch: !!pc._kritisch,
    });
  });

  const cards = (data?.allCardsFlat || grid?.placedCards || [])
    .filter(Boolean)
    .map(card => ({
      ...card,
      label: String(card.label || '').trim().toUpperCase(),
      deps: (Array.isArray(card.baseDeps) ? card.baseDeps : (Array.isArray(card.deps) ? card.deps : []))
        .map(dep => String(dep || '').trim().toUpperCase())
        .filter(Boolean),
    }))
    .map(card => ({ ...card, _cpm: cpmByLabel.get(card.label) || null }))
    .filter(card => card.label);

  // Stunden → Schulstunden-Anzeige (45 min), deutsch formatiert
  const fmtSchulStd = h => {
    const value = Math.round((h / 0.75) * 10) / 10;
    return String(value).replace('.', ',');
  };

  document.getElementById('netzplan-overlay')?.remove();

  const overlay = document.createElement('div');
  overlay.id = 'netzplan-overlay';
  overlay.style.cssText = `
    position:fixed;inset:0;background:rgba(0,0,0,0.76);
    backdrop-filter:blur(10px);-webkit-backdrop-filter:blur(10px);
    z-index:31000;display:flex;align-items:center;justify-content:center;padding:2vw;
  `;
  overlay.onclick = event => { if (event.target === overlay) overlay.remove(); };

  const esc = text => String(text ?? '').replace(/[&<>"']/g, m => ({
    '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#039;'
  }[m]));

  if (!cards.length) {
    overlay.innerHTML = `
      <div style="width:min(760px,96vw);background:var(--bg-app);color:var(--text);border:1px solid var(--border);box-shadow:0 30px 90px rgba(0,0,0,0.42);padding:28px;border-radius:18px;" onclick="event.stopPropagation()">
        <h2 style="margin:0 0 8px;font-size:20px;font-weight:900;letter-spacing:1px;text-transform:uppercase;">Netzplan</h2>
        <div style="font-size:13px;color:var(--text-muted);line-height:1.5;">Es gibt aktuell keine verknüpften Karten, aus denen ein Netzplan berechnet werden kann.</div>
        <div style="display:flex;justify-content:flex-end;margin-top:18px;">
          <button onclick="document.getElementById('netzplan-overlay')?.remove()" style="background:var(--surface);border:1px solid var(--border);color:var(--text);padding:10px 18px;border-radius:12px;cursor:pointer;font-weight:800;">Schließen</button>
        </div>
      </div>`;
    document.body.appendChild(overlay);
    return;
  }

  const byLabel = new Map(cards.map(card => [card.label, card]));
  const successors = new Map(cards.map(card => [card.label, []]));
  cards.forEach(card => {
    card.deps.forEach(dep => {
      if (!byLabel.has(dep)) return;
      successors.get(dep)?.push(card.label);
    });
  });

  const memo = new Map();
  const visiting = new Set();
  function levelOf(label) {
    if (memo.has(label)) return memo.get(label);
    if (visiting.has(label)) return 0;
    visiting.add(label);
    const card = byLabel.get(label);
    const depLevels = (card?.deps || [])
      .filter(dep => byLabel.has(dep))
      .map(dep => levelOf(dep));
    visiting.delete(label);
    const level = depLevels.length ? Math.max(...depLevels) + 1 : 0;
    memo.set(label, level);
    return level;
  }

  cards.forEach(card => levelOf(card.label));
  const maxLevel = Math.max(1, ...Array.from(memo.values()));
  const levels = new Map();
  cards.forEach(card => {
    const isProductLeaf = (successors.get(card.label) || []).length === 0;
    const level = isProductLeaf ? maxLevel : Math.min(levelOf(card.label), maxLevel - 1);
    card._netzLevel = level;
    card._isProductLeaf = isProductLeaf;
    if (!levels.has(level)) levels.set(level, []);
    levels.get(level).push(card);
  });

  const levelKeys = Array.from({ length: maxLevel + 1 }, (_, index) => index);
  levelKeys.forEach(level => {
    const items = levels.get(level) || [];
    items.sort((a, b) =>
      (a.milestoneIndex ?? 999) - (b.milestoneIndex ?? 999) ||
      String(a.wer || '').localeCompare(String(b.wer || '')) ||
      String(a.label || '').localeCompare(String(b.label || ''))
    );
  });

  const nodeW = 230;
  const nodeH = 110;
  const gapX = 56;
  const gapY = 150;
  const padX = 80;
  const padY = 80;
  const maxCols = Math.max(1, ...levelKeys.map(level => (levels.get(level) || []).length));
  const stageW = Math.max(980, padX * 2 + maxCols * nodeW + (maxCols - 1) * gapX);
  const stageH = padY * 2 + (maxLevel + 1) * nodeH + maxLevel * gapY;

  const positions = new Map();
  levelKeys.forEach(level => {
    const items = levels.get(level) || [];
    const rowW = items.length * nodeW + Math.max(0, items.length - 1) * gapX;
    const startX = (stageW - rowW) / 2;
    const y = padY + level * (nodeH + gapY);
    items.forEach((card, index) => {
      positions.set(card.label, {
        x: startX + index * (nodeW + gapX),
        y,
      });
    });
  });

  const edges = cards.flatMap(card =>
    card.deps
      .filter(dep => byLabel.has(dep) && positions.has(dep) && positions.has(card.label))
      .map(dep => ({ from: dep, to: card.label }))
  );

  const isCritical = label => !!byLabel.get(label)?._cpm?.kritisch;

  const motionPaths = [];
  const lines = edges.map((edge, index) => {
    const from = positions.get(edge.from);
    const to = positions.get(edge.to);
    const x1 = from.x + nodeW / 2;
    const y1 = from.y + nodeH;
    const x2 = to.x + nodeW / 2;
    const y2 = to.y;
    const midY = y1 + Math.max(30, (y2 - y1) / 2);
    const pathId = `netz-flow-${index}`;
    const d = `M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`;
    motionPaths.push({ id: pathId, delay: (index % 5) * 0.55 });
    // Kanten auf dem kritischen Pfad rot hervorheben
    const critical = isCritical(edge.from) && isCritical(edge.to);
    const stroke = critical ? 'rgba(239,68,68,0.85)' : 'rgba(148,163,184,0.46)';
    const width = critical ? 3.2 : 2.2;
    const markerRef = critical ? 'url(#netzArrowCrit)' : 'url(#netzArrow)';
    return `<path id="${pathId}" d="${d}" fill="none" stroke="${stroke}" stroke-width="${width}" marker-end="${markerRef}"/>`;
  }).join('');

  const flowDots = motionPaths.map(path => `
    <circle r="4.2" fill="#67e8f9" opacity="0.72" filter="url(#netzGlow)">
      <animateMotion dur="4.8s" begin="${path.delay}s" repeatCount="indefinite">
        <mpath href="#${path.id}"></mpath>
      </animateMotion>
    </circle>`).join('');

  const lineColors = data?.lineColors || {};
  const nodes = cards.map(card => {
    const pos = positions.get(card.label);
    const color = lineColors[card.wer] || '#6366f1';
    // Sicheres JS-Argument (Labels mit Apostroph o. Ä. zerbrechen sonst das Attribut)
    const labelArg = typeof window.safeJsArg === 'function'
      ? window.safeJsArg(card.label)
      : esc(JSON.stringify(String(card.label ?? '')));
    const productBadge = card._isProductLeaf
      ? `<span style="background:rgba(16,185,129,0.14);color:#10b981;border:1px solid rgba(16,185,129,0.35);border-radius:999px;padding:3px 7px;font-size:9px;font-weight:900;">Produkt</span>`
      : '';
    const cpm = card._cpm;
    const critical = !!cpm?.kritisch;
    const criticalBadge = critical
      ? `<span style="background:rgba(239,68,68,0.16);color:#ef4444;border:1px solid rgba(239,68,68,0.4);border-radius:999px;padding:3px 7px;font-size:9px;font-weight:900;">Kritisch</span>`
      : '';
    // Netzplantechnik-Zeile: FAZ/SAZ (früheste/späteste Anfangszeit) + Gesamtpuffer in Schulstunden
    const cpmLine = cpm
      ? `<div style="display:flex;gap:6px;font-size:9px;font-weight:800;color:${critical ? '#ef4444' : 'var(--text-muted)'};white-space:nowrap;overflow:hidden;" title="FAZ/SAZ = früheste/späteste Anfangszeit in Schulstunden · Puffer = erlaubte Verspätung, ohne das Projektende zu verschieben">
           <span>FAZ ${fmtSchulStd(cpm.faz)}</span><span>·</span><span>SAZ ${fmtSchulStd(cpm.saz ?? cpm.faz)}</span><span>·</span><span>Puffer ${fmtSchulStd(cpm.puffer ?? 0)} Schulstd.</span>
         </div>`
      : '';
    const depCount = card.deps.filter(dep => byLabel.has(dep)).length;
    const succCount = (successors.get(card.label) || []).length;
    return `
      <button onclick="event.stopPropagation();window.showUBahnCardDetail?.(${labelArg})"
              title="${esc(card.description || card.titel || '')}"
              style="position:absolute;left:${pos.x}px;top:${pos.y}px;width:${nodeW}px;height:${nodeH}px;
                     border:${critical ? '3px solid #ef4444' : `2px solid ${color}`};border-radius:14px;background:rgba(var(--panel-rgb),0.96);
                     color:var(--text);box-shadow:${critical ? '0 12px 28px rgba(239,68,68,0.28)' : '0 12px 28px rgba(0,0,0,0.24)'};padding:10px 12px;
                     text-align:left;cursor:pointer;display:flex;flex-direction:column;gap:5px;overflow:hidden;">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;">
          <span style="width:34px;height:24px;border-radius:999px;background:${color};color:#fff;display:inline-flex;align-items:center;justify-content:center;font-size:11px;font-weight:900;flex-shrink:0;">${esc(card.label)}</span>
          <span style="display:flex;gap:4px;">${criticalBadge}${productBadge}</span>
        </div>
        <div style="font-size:12px;font-weight:850;line-height:1.25;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;">${esc(card.titel || 'Ohne Titel')}</div>
        <div style="font-size:10px;color:var(--text-muted);white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">${esc(card.wer || 'Niemand')} · ${depCount} rein · ${succCount} raus</div>
        ${cpmLine}
      </button>`;
  }).join('');

  const levelLabels = levelKeys.map(level => {
    const y = padY + level * (nodeH + gapY) - 28;
    const title = level === maxLevel ? 'Produktnahe Karten' : (level === 0 ? 'Start / Voraussetzungen' : `Ebene ${level + 1}`);
    return `<div style="position:absolute;left:18px;top:${y}px;font-size:10px;font-weight:900;color:var(--text-muted);text-transform:uppercase;letter-spacing:1.4px;">${esc(title)}</div>`;
  }).join('');

  const initialZoom = 100;

  overlay.innerHTML = `
    <div style="width:100%;max-width:1400px;height:90vh;background:var(--bg-app);color:var(--text);
                border:1px solid var(--border);box-shadow:0 30px 90px rgba(0,0,0,0.42);
                display:flex;flex-direction:column;overflow:hidden;" onclick="event.stopPropagation()">
      <div style="padding:18px 22px;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;gap:16px;background:rgba(var(--panel-rgb),0.32);">
        <div>
          <h2 style="margin:0;font-size:20px;font-weight:900;letter-spacing:1px;text-transform:uppercase;">Netzplan</h2>
          <div style="font-size:12px;color:var(--text-muted);margin-top:3px;">Direkte Pfeile zwischen Karten · produktnahe Karten unten · Klick öffnet die Kartendetails · <span style="color:#ef4444;font-weight:800;">Rot = kritischer Pfad (Puffer 0)</span> · FAZ/SAZ + Puffer in Schulstunden</div>
        </div>
        <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;justify-content:flex-end;">
          <div style="display:flex;align-items:center;gap:10px;background:var(--surface);border:1px solid var(--border);border-radius:12px;padding:8px 12px;">
            <span style="font-size:10px;font-weight:900;color:var(--text-muted);text-transform:uppercase;letter-spacing:1px;">Zoom</span>
            <input id="netzplan-zoom-input" type="range" min="45" max="180" value="${initialZoom}"
                   oninput="window.updateNetzplanZoom?.(this.value)"
                   style="width:160px;cursor:pointer;accent-color:#10b981;background:transparent;">
            <span id="netzplan-zoom-value" style="width:42px;text-align:right;font-size:12px;font-weight:900;color:var(--text);">${initialZoom}%</span>
          </div>
          <button onclick="document.getElementById('netzplan-overlay')?.remove()"
                  style="background:var(--surface);border:1px solid var(--border);color:var(--text);padding:10px 22px;border-radius:12px;cursor:pointer;font-weight:800;">Schließen</button>
        </div>
      </div>
      <div style="flex:1;overflow:auto;padding:18px 22px;">
        <div id="netzplan-stage-shell" style="position:relative;width:${stageW}px;height:${stageH}px;transform-origin:top left;">
          <div id="netzplan-stage" style="position:absolute;left:0;top:0;width:${stageW}px;height:${stageH}px;background:
                      linear-gradient(180deg,rgba(0,0,0,0.58),rgba(0,0,0,0.66) 55%,rgba(0,0,0,0.58));
                      border:1px solid rgba(148,163,184,0.32);border-radius:18px;transform-origin:top left;box-shadow:inset 0 0 0 1px rgba(15,23,42,0.72);">
            ${levelLabels}
            <svg width="${stageW}" height="${stageH}" style="position:absolute;inset:0;overflow:visible;pointer-events:none;">
              <defs>
                <filter id="netzGlow" x="-200%" y="-200%" width="500%" height="500%">
                  <feGaussianBlur stdDeviation="2.5" result="blur"></feGaussianBlur>
                  <feMerge>
                    <feMergeNode in="blur"></feMergeNode>
                    <feMergeNode in="SourceGraphic"></feMergeNode>
                  </feMerge>
                </filter>
                <marker id="netzArrow" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,6 L8,3 z" fill="rgba(148,163,184,0.62)"></path>
                </marker>
                <marker id="netzArrowCrit" markerWidth="10" markerHeight="10" refX="8" refY="3" orient="auto" markerUnits="strokeWidth">
                  <path d="M0,0 L0,6 L8,3 z" fill="rgba(239,68,68,0.9)"></path>
                </marker>
              </defs>
              ${lines}
              ${flowDots}
            </svg>
            ${nodes}
          </div>
        </div>
      </div>
    </div>`;

  document.body.appendChild(overlay);

  window.updateNetzplanZoom = function(value) {
    const zoom = Math.max(45, Math.min(180, parseInt(value, 10) || initialZoom));
    const scale = zoom / 100;
    const shell = document.getElementById('netzplan-stage-shell');
    const stage = document.getElementById('netzplan-stage');
    const label = document.getElementById('netzplan-zoom-value');
    if (shell) {
      shell.style.width = `${stageW * scale}px`;
      shell.style.height = `${stageH * scale}px`;
    }
    if (stage) stage.style.transform = `scale(${scale})`;
    if (label) label.textContent = `${zoom}%`;
  };
  window.updateNetzplanZoom(initialZoom);
}

if (typeof window !== 'undefined') window.showNetzplanView = showNetzplanView;
