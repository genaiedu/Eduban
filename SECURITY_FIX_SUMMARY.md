# Sicherheitsfix: Schutz des Notenmoduls vor unbefugtem Zugriff

## Problem
Ein Schüler konnte durch Manipulation der URL oder Aufruf von `openAdminArea()` in der Browser-Konsole auf das Tutor-Notenmodul zugreifen, ohne das Tutor-Passwort zu kennen.

### Ursachen:
1. `currentUserIsAdmin()` gab immer `true` zurück
2. Keine echte Passwortprüfung für Admin-Funktionen
3. Admin-UI war nur per CSS versteckt, nicht geschützt
4. Gemeinsamer localStorage für alle Nutzer ohne Zugriffskontrolle

## Lösung

### 1. Neue Authentifizierungslogik (`js/admin.js`)
- `_adminAuthTimestamp`: Speichert Zeitpunkt der letzten erfolgreichen Tutor-Authentifizierung
- `ADMIN_AUTH_TIMEOUT`: 15 Minuten Session-Dauer
- `currentUserIsAdmin()`: Prüft ob Session noch gültig ist
- `openAdminArea()`: Fordert Passwort an wenn nicht authentifiziert

### 2. Tutor-Passwortabfrage (`js/helpers.js`)
Neue Funktion `showTutorPasswordPrompt()`:
- Prüft ob INI-Datei geladen ist
- Zeigt Passwort-Dialog mit kryptografischer Prüfung
- Entschlüsselt privaten Schlüssel aus INI-Datei
- Speichert erfolgreiche Auth in `_tutorSession`

### 3. Geschützte Funktionen
- `loadAdminBoardTools()` in `js/grading.js`: Prüft Admin-Rechte vor Laden
- Alle sensiblen Operationen erfordern nun gültige Session

### 4. Session-Management
- `resetAdminSession()`: Setzt Admin-Session zurück
- `setAdminAuthenticated()`: Markiert erfolgreiche Auth
- Beim Logout werden alle Sessions gelöscht (`_tutorSession`, `_adminAuthTimestamp`)

## Ablauf für Tutor

1. **Erster Zugriff auf Admin-Panel:**
   - INI-Datei laden (falls noch nicht geschehen)
   - Master-Passwort eingeben
   - Kryptografische Verifikation via Web Crypto API
   - Session wird für 15 Minuten gespeichert

2. **Während der Session:**
   - Kein erneutes Passwort nötig (innerhalb 15 Min)
   - Vollzugriff auf Notenmodul und Board-Tools

3. **Nach Session-Ablauf:**
   - Erneute Passwortabfrage erforderlich

## Ablauf für Schüler

- Schüler sehen keinen Admin-Button mehr (weiterhin per CSS versteckt)
- Selbst bei manuellem Aufruf von `openAdminArea()`:
  - Wird nach INI-Datei + Passwort gefragt
  - Ohne Tutor-INI kein Zugriff möglich
  - Mit falschem Passwort kein Zugriff

## Kryptografie

Die Passwortprüfung nutzt:
- **RSA-OAEP** mit 2048-Bit Schlüsseln
- **AES-GCM** für verschlüsselte Daten
- **PBKDF2** mit 200.000 Iterationen für Token

Der private Schlüssel des Tutors bleibt verschlüsselt in der INI-Datei und wird nur bei erfolgreicher Passworteingabe entschlüsselt.

## Getroffene Änderungen

### Modifizierte Dateien:
1. `js/admin.js` - Admin-Authentifizierung hinzugefügt
2. `js/helpers.js` - `showTutorPasswordPrompt()` implementiert
3. `js/auth.js` - Session-Cleanup beim Logout erweitert
4. `js/tools.js` - `_tutorSession` Reset hinzugefügt
5. `js/grading.js` - Sicherheitsprüfung in `loadAdminBoardTools()`

### Neue globale Variablen:
- `window._tutorSession` - Speichert authentifizierte Tutor-Session
- `_adminAuthTimestamp` - Zeitpunkt der letzten Admin-Auth

### Neue Funktionen:
- `window.showTutorPasswordPrompt()` - Passwort-Dialog
- `window.currentUserIsAdmin()` - Prüft Admin-Rechte
- `window.setAdminAuthenticated()` - Setzt Auth-Flag
- `window.resetAdminSession()` - Löscht Admin-Session

## Testempfehlung

1. **Als Schüler testen:**
   - Anmelden als Schüler
   - URL zur Tutor-Ansicht wechseln
   - `openAdminArea()` in Konsole aufrufen
   - → Sollte Passwortabfrage zeigen, kein Zugriff ohne INI

2. **Als Tutor testen:**
   - INI-Datei laden
   - Auf Admin-Button klicken
   - Passwort eingeben
   - → Sollte Zugriff gewähren
   - Nach 15 Minuten → Erneute Abfrage

3. **Logout testen:**
   - Als Tutor anmelden
   - Admin-Bereich öffnen
   - Logout durchführen
   - Erneut als Schüler anmelden
   - → Kein Zugriff auf Admin-Funktionen

## Einschränkungen

- **Client-seitiger Schutz**: Da keine Server-Komponente existiert, basiert der Schutz auf Client-seitiger Validierung
- **Lokaler Speicher**: Alle Daten bleiben im localStorage – physischer Zugang zum Gerät ermöglicht weiterhin Datenextraktion
- **Kein Ersatz für Server-Auth**: Für produktiven Einsatz mit echten sensiblen Daten wäre eine Server-basierte Authentifizierung notwendig

## Empfehlung für Produktion

Für den Einsatz mit echten Notendaten:
1. HTTPS obligatorisch machen
2. Server-basierte Authentifizierung hinzufügen
3. Regelmäßige Session-Invalidation
4. Audit-Logging für Zugriffe auf Notendaten
