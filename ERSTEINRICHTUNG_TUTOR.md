# EDUBAN Sicherheitserweiterung: Ersteinrichtung für Tutoren

## Problem
Ein neuer Tutor konnte bisher nicht einfach die App starten und seine INI-Datei erstellen. Es gab keinen geführten Einrichtungsprozess. Gleichzeitig bestand eine Sicherheitslücke, bei der Schüler durch URL-Manipulation auf das Notenmodul zugreifen konnten.

## Lösung

### 1. Ersteinrichtungs-Assistent für neue Tutoren

**Neue Funktionen:**
- Beim ersten Start ohne INI-Datei wird automatisch ein Einrichtungsdialog angezeigt
- Der Tutor kann direkt im Willkommensbildschirm eine INI-Datei erstellen
- Alternative: Bestehende INI-Datei laden

**Geänderte Dateien:**
- `app.html`: Neues UI-Element `#first-run-setup` im Auth-Screen
- `js/auth.js`: 
  - `showFirstRunSetupIfNeeded()` - Zeigt Einrichtung bei Bedarf
  - `saveProfile()` - Prüft jetzt ob INI vorhanden ist
  - `initApp()` - Ruft Einrichtungs-Assistent auf
- `js/tools.js`: `showCreateIniModal()` - Öffnet INI-Erstellungsmodal

**Ablauf für neuen Tutor:**
1. App öffnen → Willkommensbildschirm erscheint
2. Name eingeben → "Los geht's" klicken
3. ⚠️ Hinweis: "Als Tutor bitte zuerst INI-Datei erstellen oder laden!"
4. Einrichtungsbox erscheint mit:
   - Button "INI-Datei erstellen" → öffnet Modal für Name + Passwort
   - Link "INI laden" → bestehende Datei importieren
5. Nach erfolgreicher INI-Erstellung kann der Tutor die App nutzen

### 2. Verbesserter Passwortschutz für Admin-Funktionen

**Bereits implementiert (vorhandene Änderungen):**
- `js/admin.js`: `currentUserIsAdmin()` prüft 15-Minuten-Session
- `js/helpers.js`: `showTutorPasswordPrompt()` verlangt INI + Master-Passwort
- 15-Minuten-Timeout für Admin-Sitzung
- Session wird bei Logout komplett gelöscht

## Sicherheitsgewinn

### Vorher:
- Schüler konnte durch Ändern von `sessionStorage.kf_role` Admin-Rechte erlangen
- Admin-UI war nur ausgeblendet, nicht geschützt
- Keine echte Authentifizierung für Notenmodul

### Nachher:
- Admin-Zugriff erfordert kryptografische Verifikation mit RSA-OAEP
- INI-Datei mit privatem Schlüssel notwendig
- Master-Passwort muss korrekt eingegeben werden
- Session läuft nach 15 Minuten automatisch ab
- Bei jedem Logout komplette Session-Löschung

## Verwendung

### Für neue Tutoren:
```
1. App öffnen
2. Namen eingeben
3. Auf "INI-Datei erstellen" klicken
4. Master-Passwort wählen (min. 6 Zeichen)
5. INI-Datei speichern (Backup empfohlen!)
6. Ab jetzt kann das Notenmodul genutzt werden
```

### Für Schüler:
- Kein Zugriff auf Admin-Funktionen möglich
- Selbst bei Manipulation von sessionStorage blockiert das System
- Passwortabfrage erscheint bei Admin-Zugriffsversuch

## Technische Details

### INI-Datei Struktur:
```json
{
  "kanbanfluss_ini": true,
  "teacherName": "Max Mustermann",
  "publicKey": { ... },
  "encryptedPrivateKey": { ... },
  "createdAt": "2025-01-15T10:30:00.000Z"
}
```

### Session-Management:
- `_adminAuthTimestamp`: Zeitstempel der letzten Authentifizierung
- `ADMIN_AUTH_TIMEOUT`: 15 Minuten (900.000 ms)
- `_tutorSession`: Enthält entschlüsselten privaten Schlüssel nach erfolgreicher Auth

### Kryptografie:
- RSA-OAEP mit 2048-Bit-Schlüsseln
- Passwort schützt privaten Schlüssel via AES-GCM
- Token-basierte Verifikation für Schüler-Login

## Dateien geändert

1. **app.html** (Zeile 122-137)
   - Neues `#first-run-setup` Element
   
2. **js/auth.js** (mehrere Stellen)
   - `showFirstRunSetupIfNeeded()` neu
   - `saveProfile()` erweitert
   - `initApp()` ruft Einrichtung auf
   
3. **js/tools.js** (Zeile 6-12)
   - `showCreateIniModal()` neu

4. **js/admin.js** (bereits vorhanden)
   - Passwortschutz implementiert
   
5. **js/helpers.js** (bereits vorhanden)
   - `showTutorPasswordPrompt()` implementiert

## Testing

### Testszenario 1: Neuer Tutor
1. localStorage leeren
2. App öffnen
3. Namen eingeben → Einrichtungsassistent erscheint ✓
4. INI erstellen → Passwortabfrage ✓
5. INI speichern → App nutzbar ✓

### Testszenario 2: Admin-Zugriffsschutz
1. Als Schüler anmelden
2. Konsole öffnen → `openAdminArea()` aufrufen
3. Passwortabfrage erscheint ✓
4. Ohne INI/Passwort kein Zugriff ✓

### Testszenario 3: Session-Timeout
1. Als Tutor authentifizieren
2. 15 Minuten warten
3. Admin-Funktion aufrufen → erneute Passwortabfrage ✓

## Empfehlungen

1. **INI-Datei sichern**: Tutor sollte INI-Datei auf USB-Stick oder Cloud speichern
2. **Passwort merken**: Ohne Passwort ist INI-Datei wertlos
3. **Regelmäßig logout**: Session-Timeout erhöht Sicherheit
4. **Keine INI an Schüler geben**: Nur öffentliche `.ini`-Datei für Schüler-Registration

## Ausblick

Mögliche zukünftige Erweiterungen:
- Biometrische Authentifizierung (Fingerprint/FaceID)
- Hardware-Security-Key Unterstützung (WebAuthn)
- Multi-Tutor Support mit separaten INI-Dateien
- Automatische Session-Verlängerung bei Aktivität
