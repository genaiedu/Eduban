# EDUBAN – Kanban für Bildung

Kanban-App für den Schulunterricht. Läuft komplett lokal (PWA, Browser-Speicher),
optional mit Firebase-Datenbank für den Austausch zwischen Tutor und Lerngruppe.

## Starten (Doppelklick)

- `Start EDUBAN Tutor mit Datenbank.command`
- `Start EDUBAN Schueler mit Datenbank.command`
- `Start EDUBAN Tutor ohne Datenbank.command`
- `Start EDUBAN Schueler ohne Datenbank.command`

Die datenbankfreie Version speichert und lädt Boards ausschließlich als
verschlüsselte Dateien (kein Firebase).

## Anmeldung (passwortfrei, Datei = Schlüssel)

- **Tutor:** erstellt beim ersten Start zwei Schlüsseldateien –
  den privaten Tutor-Schlüssel (bleibt beim Tutor) und die Verteil-INI
  (geht an die Schülerinnen und Schüler).
- **SchülerIn:** registriert sich einmalig mit der Verteil-INI und erhält
  eine persönliche Schüler-INI. Anmelden = Schüler-INI laden.

## Wichtig

Alle Daten liegen im Browser-Speicher des Geräts. Regelmäßig
„Alles exportieren & sichern" ausführen – die App erinnert nach 7 Tagen daran.

Alte, nicht mehr eingebundene Dateien liegen in `_archiv-alte-versionen/`.
