# EDUBAN Sicherheitsupdate

## Zusammenfassung der Änderungen

### 1. Separates Admin-Tool (`admin.html`)
- **Neue Datei**: `/workspace/admin.html`
- Erstellt verschlüsselte INI-Konfigurationsdateien für Tutoren
- Enthält RSA-OAEP 2048-Bit Schlüsselpaar-Generierung
- Privater Schlüssel wird mit AES-GCM (PBKDF2-abgeleitet) verschlüsselt
- Passwort-Mindestlänge: 8 Zeichen
- Nur für Tutor-Personal zugänglich

### 2. Entfernte Funktionen aus Haupt-App (`app.html`)
- ❌ Modal zur INI-Erstellung entfernt
- ❌ "INI-Datei erstellen" Button im Sidebar-Menü entfernt
- ✅ Nur noch "INI laden" Funktion verfügbar

### 3. Aktualisierte Hinweise (`app.html`, `js/auth.js`)
- Warnung für Tutoren ohne INI-Datei verbessert
- Verweis auf `admin.html` als einzigen Weg zur INI-Erstellung
- Error-Messages aktualisiert

### 4. Code-Bereinigung (`js/tools.js`)
- `showCreateIniModal()` entfernt
- `createTeacherIniFile()` entfernt
- Hinweis-Kommentar eingefügt

## Sicherheitsvorteile

### Vorher (unsicher):
```
Schüler → app.html → "INI erstellen" → Eigene INI → Admin-Zugriff möglich
```

### Nachher (sicher):
```
Schüler → app.html → KEINE INI-Erstellung möglich
Tutor   → admin.html (separat) → INI erstellen → app.html → INI laden → Admin-Zugriff
```

## Verwendung

### Für neue Tutoren:
1. `admin.html` im Browser öffnen (lokal oder auf sicherem Server)
2. Namen und Master-Passwort eingeben
3. "INI-Datei erstellen" klicken → `.ini`-Datei wird heruntergeladen
4. `app.html` öffnen
5. Beim Begrüßungsbildschirm "INI laden" klicken
6. Die erstellte `.ini`-Datei auswählen
7. Normal anmelden

### Für Schüler:
- Keine Änderung im Workflow
- Können keine INI-Dateien erstellen
- Benötigen Tutor-INI für verschlüsselten Export

## Kompatibilität

- ✅ Bestehende INI-Dateien funktionieren weiterhin
- ✅ Crypto-Funktionen in `js/crypto.js` bleiben erhalten
- ✅ Rückwärtskompatibel mit bestehenden Backups

## Dateien geändert

| Datei | Änderung |
|-------|----------|
| `admin.html` | NEU - Admin-Tool |
| `app.html` | INI-Modal entfernt, Hinweise aktualisiert |
| `js/tools.js` | INI-Erstellungsfunktionen entfernt |
| `js/auth.js` | Error-Messages aktualisiert |
| `js/crypto.js` | Kommentar hinzugefügt |

## Nächste Schritte (optional)

Für zusätzliche Sicherheit könnte man:
- `admin.html` mit einem globalen Sicherheitscode schützen (z.B. "jephtha1")
- Admin-Tool nur lokal betreiben (nicht auf öffentlichem Server)
- Regelmäßige Passwortwechsel für Tutoren empfehlen
