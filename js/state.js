// js/state.js — App-Zustand (ohne Firebase, rein lokal)

export * from './storage.js';

// ── KONSTANTEN ───────────────────────────────────────
export const BG_KEY      = 'kanban_bg';
export const OVERLAY_KEY = 'kanban_overlay';
export const THEME_KEY   = 'kanban_theme';
export const IMG_COUNT_KEY = 'kanban_img_count';

// ── GETEILTER ZUSTAND ────────────────────────────────
// Wird von allen Modulen über import { S } from './state.js' benutzt.
export const S = {
  currentUser:      null,   // { displayName, groupId }
  currentBoard:     null,
  boards:           [],
  columns:          [],
  cards:            {},     // { colId: [card, ...] }
  cardsBoardId:     null,
  ideas:            [],
  dragCard:         null,
  dragFromCol:      null,
  isAdminMode:      false,
  wizardMemberCount: 1,
  wizardNameMode:   'manual',
  wizardAutoNames:  null,
  importParsedData: null,
  tourStep:         0,
  agendaSelectedBoardId: '',
  kanbanPromptEvent: null,
  undoStack:        [],     // Max 6 Snapshots pro Sitzung
};
