// js/settings.js — Theme, Hintergrund, Overlay (lokal, kein Firebase)
import { S, getSetting, setSetting, BG_KEY, OVERLAY_KEY, THEME_KEY, IMG_COUNT_KEY } from './state.js';

const DEFAULT_BG = 'H1.png';

const BG_PRESETS = [
  { label:'Standard',    value:DEFAULT_BG,   style:"url('images/H1.png') center / cover" },
  { label:'Ozean',       value:'__ocean',    style:'linear-gradient(135deg,#0f2027,#203a43,#2c5364)' },
  { label:'Aurora',      value:'__aurora',   style:'linear-gradient(135deg,#0d0d2b,#1a4a3a,#0d1b4a)' },
  { label:'Dämmerung',   value:'__dusk',     style:'linear-gradient(135deg,#1a0533,#2d1b69,#11998e)' },
  { label:'Mitternacht', value:'__midnight', style:'linear-gradient(135deg,#0a0a0a,#1a1a2e,#16213e)' },
  { label:'Saphir',      value:'__sapphire', style:'linear-gradient(135deg,#0f0c29,#302b63,#24243e)' },
];

const BG_GRADIENTS = {
  '__ocean':    'linear-gradient(135deg,#0f2027,#203a43,#2c5364)',
  '__aurora':   'linear-gradient(135deg,#0d0d2b,#1a4a3a,#0d1b4a)',
  '__dusk':     'linear-gradient(135deg,#1a0533,#2d1b69,#11998e)',
  '__midnight': 'linear-gradient(135deg,#0a0a0a,#1a1a2e,#16213e)',
  '__sapphire': 'linear-gradient(135deg,#0f0c29,#302b63,#24243e)',
};

// ── THEME ────────────────────────────────────────────
window.applyTheme = function(theme) {
  if (theme === 'light') document.body.classList.add('theme-light');
  else document.body.classList.remove('theme-light');
};

window.setTheme = (theme) => {
  applyTheme(theme);
  setSetting('theme', theme);
  renderSettingsPanel();
};

window.loadSavedTheme = function() {
  applyTheme(getSetting('theme') || 'dark');
};

// ── OVERLAY ──────────────────────────────────────────
window.setOverlay = (value) => {
  document.documentElement.style.setProperty('--panel-opacity', (value / 100).toFixed(2));
  setSetting('overlayOpacity', value);
  const slider = document.getElementById('overlay-slider');
  if (slider) slider.value = value;
};

window.loadSavedOverlay = function() {
  setOverlay(getSetting('overlayOpacity') ?? '72');
};

// ── HINTERGRUND ───────────────────────────────────────
window.applyBg = function(value) {
  const layer = document.getElementById('bg-layer');
  const bgValue = value || DEFAULT_BG;
  if (bgValue.startsWith('__')) layer.style.backgroundImage = BG_GRADIENTS[bgValue] || 'none';
  else layer.style.backgroundImage = `url('images/${bgValue}')`;
  document.querySelectorAll('.bg-preset').forEach(el => { el.classList.toggle('active', el.dataset.bg === bgValue); });
};

window.setBg = (value) => {
  applyBg(value);
  setSetting('bg', value);
};

window.loadSavedBg = function() {
  applyBg(getSetting('bg') || DEFAULT_BG);
};

// Hintergrund nach Board-Wechsel neu laden (lokale Version braucht keinen uid-Sync)
window.syncBackgroundToUser = function() {
  applyBg(getSetting('bg') || DEFAULT_BG);
  const opacity = getSetting('overlayOpacity') ?? '72';
  document.documentElement.style.setProperty('--panel-opacity', (opacity / 100).toFixed(2));
};

// ── SETTINGS PANEL ───────────────────────────────────
window.toggleSettingsPanel = () => {
  const panel = document.getElementById('settings-panel');
  const isVisible = panel.style.display !== 'none';
  panel.style.display = isVisible ? 'none' : 'block';
  if (!isVisible) renderSettingsPanel();
};

window.renderSettingsPanel = function() {
  const presetsEl    = document.getElementById('bg-presets');
  const currentBg    = getSetting('bg') || DEFAULT_BG;
  const savedOverlay = getSetting('overlayOpacity') ?? '72';
  const slider       = document.getElementById('overlay-slider');
  if (slider) slider.value = savedOverlay;
  const currentTheme = getSetting('theme') || 'dark';
  const btnDark  = document.getElementById('btn-theme-dark');
  const btnLight = document.getElementById('btn-theme-light');
  if (btnDark && btnLight) {
    btnDark.className  = currentTheme === 'dark'  ? 'btn-sm btn-sm-primary' : 'btn-sm btn-sm-ghost';
    btnLight.className = currentTheme === 'light' ? 'btn-sm btn-sm-primary' : 'btn-sm btn-sm-ghost';
  }
  presetsEl.innerHTML = BG_PRESETS.map(p => `<div class="bg-preset ${currentBg===p.value?'active':''}" data-bg="${p.value}" style="background: ${p.style};" onclick="setBg('${p.value}')"><span>${p.label}</span></div>`).join('');
  renderCustomImages();
};

window.renderCustomImages = function() {
  const count = getImageCount();
  const currentBg = getSetting('bg') || DEFAULT_BG;
  const label = document.getElementById('img-thumbnails-label');
  if (label) label.textContent = `Hintergrundbilder (H1–H${count})`;
  const el = document.getElementById('custom-images-list');
  if (!el) return;
  el.innerHTML = Array.from({length: count}, (_, i) => i + 1).map(i => `<div class="bg-preset ${currentBg===('H'+i+'.png')?'active':''}" data-bg="H${i}.png" style="background-image:url('images/H${i}.png'); background-size:cover; background-position:center;" onclick="setBg('H${i}.png')"><span>H${i}</span></div>`).join('');
};

// ── BILDANZAHL ───────────────────────────────────────
window.loadImageCount = function() { /* feste Anzahl, kein Firebase */ };
window.getImageCount  = function() { return 60; };
window.loadAgingUnit  = function() { /* lokale Version braucht kein Firebase */ };
