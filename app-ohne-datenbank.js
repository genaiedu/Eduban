// app-ohne-datenbank.js — Einstiegspunkt der DATENBANKFREIEN VERSION
// Wie app.js, aber OHNE cloud.js (Firebase). Statt tools.js und admin.js
// werden die datenbankfreien Kopien geladen.

import './js/state.js';
import './js/helpers.js?v=3';
import './js/crypto.js';
import './js/settings.js';
import './js/auth.js?v=7';
import './js/boards.js?v=5';
import './js/columns.js?v=2';
import './js/cards.js?v=6';
import './js/ideas.js?v=2';
import './js/milestones.js?v=3';
import './js/admin-ohne-datenbank.js?v=1';
import './js/grading.js?v=4';
import './js/tools-ohne-datenbank.js?v=1';
import './js/ubahn.js?v=23';
import './js/ui.js?v=9';

console.log('KanbanFluss (ohne Datenbank): Alle Module geladen ✓');
