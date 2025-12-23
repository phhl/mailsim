# Didaktischer Mail‑Simulator (Node/Express + SQLite)

Ziel: geschlossene Mail‑Simulation für Unterricht (To/CC/BCC, Betreff, Posteingang/Gesendet/Entwürfe/Papierkorb), ohne Versand nach außen.

## Voraussetzungen
- Node.js 18+ (empfohlen 20+)
- npm

## Installation
```bash
npm install
npm run initdb
npm run dev
```

Dann im Browser:
- http://localhost:3000

## Standard-Zugang (nach initdb)
- Admin: `admin` / `admin123!` (bitte sofort ändern oder in `.env` anpassen)

## Code-Organisation (Codex-friendly)
Die Anwendung ist absichtlich in **Bootstrap**, **App-Wiring** und **Feature-Routen** getrennt:

- `src/server.js`:
  - Startet den HTTP-Server (`app.listen(...)`).
  - Enthält keine Geschäftslogik.
- `src/app.js`:
  - Erstellt und konfiguriert die Express-App (Middleware, Sessions, Views, Static, DB-Init).
  - Registriert die Router.
  - Exportiert `{ app, db }`.
- `src/routes/*`:
  - Feature-spezifische Routen.
  - `auth.js` (Login/Logout)
  - `mail.js` (Mailbox, Lesen, Compose, Reply/Forward, Addressbook)
  - `teacher.js` (Logs, Versandfenster, CSV/Benutzerverwaltung innerhalb des Kurses)
  - `admin.js` (Kurse/Nutzer/Import/Exports/Cleanup)
- `src/services/*`:
  - Geschäftslogik/Helper mit stabilen, testbaren Schnittstellen.
  - z. B. `sendWindow.js`, `visibility.js`.
- `src/utils/*`:
  - Kleine, pure Helper (`time.js`, `csv.js`).

## Architektur-Überblick

### Datenmodell (vereinfacht)
- `users` + `courses`: Benutzer, Rollen (student/teacher/admin) und Kurszuordnung.
- `messages`: Nachricht (Betreff, Body, Sender, Draft-Flag).
- `recipients`: Empfängerliste (TO/CC/BCC) pro Nachricht.
- `deliveries`: Zustellungen pro Benutzer und Ordner (INBOX/SENT/DRAFTS/TRASH). Ein `message` kann viele `deliveries` haben.
- `mail_logs` + `mail_log_recipients`: Protokollierung für Lehrer/Admin (ohne Nachrichtentexte).
- `course_send_windows`: Versandfenster pro Kurs (Zeitfenster, in dem Schüler senden dürfen).

### Request-Flows

**1) Login**
- `GET /login` zeigt Formular.
- `POST /login` prüft Passwort-Hash und setzt Session (`userId`, `role`).

**2) Mailbox anzeigen**
- `GET /mailbox/:folder` lädt die letzten Zustellungen des Ordners aus `deliveries` und zeigt sie in `views/mailbox.ejs`.

**3) Nachricht lesen**
- `GET /mail/:id` lädt `messages` + Senderdaten.
- Zugriff:
  - Admin: jede Nachricht.
  - Student: nur Nachrichten, für die es eine eigene `delivery` gibt.
  - Teacher: eigene `deliveries` plus kursweite Sicht auf von Schülern gesendete Mails des eigenen Kurses (Detailansicht).

**4) Schreiben/Senden/Entwurf**
- `GET /compose` lädt „sichtbare“ Empfänger (kursintern + teacher/admin).
- `POST /compose`:
  - action=`draft` → speichert Entwurf (DRAFTS).
  - action=`send` → erzeugt `messages`, `recipients` und `deliveries` (SENT beim Sender, INBOX bei Empfängern).
  - Für Schüler gilt: Senden nur bei geöffnetem Versandfenster (`course_send_windows`).

**5) Teacher: Versandfenster / Kursverwaltung**
- `POST /teacher/send-window/open` setzt `open_until` für den Kurs.
- `POST /teacher/send-window/close` schließt das Versandfenster.
- CSV-Import/Erzeugung löscht oder erstellt/aktualisiert Kurs-Schülerkonten.

**6) Admin: globale Verwaltung**
- `GET /admin` zeigt Nutzer, Kurse und letzte Nachrichten.
- `POST /admin/import-csv` erstellt Kurse bei Bedarf und importiert Nutzer (inkl. Rollen).
- `GET /admin/download-created.csv` exportiert die zuletzt erzeugten Zugangsdaten.

## CSV-Import (Admin)
Im Admin-Bereich können Nutzer per CSV importiert werden. Format:

```csv
username,display_name,course,expires_at,password,role
max.mustermann,Max Mustermann,FOS11,2026-01-31,max123!,student
```

- `expires_at` optional (YYYY-MM-DD). Leere Zelle = kein Ablauf.
- `password` optional. Leer = zufälliges Passwort wird generiert und angezeigt.
- `role` optional (default: `student`). Zulässig: `student`, `teacher`, `admin`.

## Domain-Konfiguration (@-Teil)
In `.env` können Sie konfigurieren, wie die angezeigte Mailadresse aufgebaut ist.

Beispiel:
`MAIL_DOMAIN_TEMPLATE={course}.meine-domain.de`

Dann wird für Nutzer aus Kurs `FOS11` z.B. `max.mustermann@FOS11.meine-domain.de` angezeigt.

Platzhalter:
- `{course}` Kurs/Gruppe (falls leer, wird `default` eingesetzt)
- `{domain}` Basisdomain (optional, wenn Sie stattdessen MAIL_DOMAIN setzen möchten)

## Admin-Einsicht in alle Nachrichten
Admins können über den Admin-Bereich **jede Nachricht** öffnen (inkl. aller Empfängerarten). Das ist für Unterrichtszwecke gedacht – bitte transparent kommunizieren.

## Sicherheitshinweise (Kurz)
- Inhalte werden serverseitig mit `sanitize-html` bereinigt (XSS-Schutz).
- Es gibt keine externen SMTP/IMAP-Funktionen. Nachrichten bleiben in der SQLite-Datenbank.

## Lizenz
MIT
