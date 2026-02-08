# Didaktischer Mail-Simulator (Node/Express + SQLite)

Ziel: geschlossene Mail-Simulation für Unterricht (To/CC/BCC, Betreff, Posteingang/Gesendet/Entwürfe/Papierkorb), ohne Versand nach außen.

## Features
- Rollen: **Admin**, **Schuladmin**, **Lehrkraft**, **Schüler**.
- Mailboxen mit **INBOX / SENT / DRAFTS / TRASH** inkl. Threading, Reply/Reply-All/Forward.
- BCC-Sichtbarkeit steuerbar (Lehrkraft optional, Admin/Schuladmin immer).
- Versandfenster pro Kurs inkl. optionaler **Anhang-Freigabe** für Schüler.
- Anhänge mit Typ-Whitelist (PDF, PNG/JPEG, GIF, WebP, HEIC/HEIF) und Größen-/Anzahl-Limits.
- Kurs-/Schulverwaltung, CSV-Import, Nutzer-Generator, Exporte (CSV/XLSX/PDF).
- Protokollierung: Mail-Logs ohne Inhaltstext für Admin/Schuladmin.
- I18n: Locale-Dateien unter `src/locales/` (Standard: `de`).

## Voraussetzungen
- Node.js 18+ (empfohlen 20+)
- npm

## Schnellstart
```bash
npm install
npm run initdb
npm run dev
```
Danach im Browser: http://localhost:3000

## Ersteinrichtung (Setup-Flow)
Wenn Pflicht-Env-Keys fehlen **oder** die DB/der Admin fehlt, leitet die App auf `/setup` um.
Dort werden Session-Secret und Admin-Zugang gesetzt sowie Basis-Defaults (BCC-Sichtbarkeit, Lehrkraft-Create, Versandfenster-Minuten, Auto-Create-Limit, Name-API) gepflegt und die `.env` aktualisiert.

## Standard-Zugang (nach initdb)
- Admin: `admin` / `admin123!` (bitte direkt ändern oder in `.env` anpassen)

## Rollen & Rechte (Kurzfassung)
- **Admin**: globale Sicht, Schulen/Kurse/Schuladmins verwalten, Logs einsehen.
- **Schuladmin**: eigene Schule verwalten, Kurse/Lehrkräfte pflegen, Logs der Schule.
- **Lehrkraft**: Kursverwaltung, Versandfenster, Schülerkonten, Kursweite Einsicht (nur Schüler-Mails im eigenen Kurs).
- **Schüler**: kursinternes Mailen; Senden nur bei geöffnetem Versandfenster.

## Login-Format
- **Admin**: `username` (z. B. `admin`)
- **Schuladmin**: `username@schule-domain` (z. B. `sa@alpha.edu`)
- **Lehrkraft**: `username@schule-domain` (z. B. `t_a1@alpha.edu`)
- **Schüler**: `username@kurs.schule-domain` (z. B. `s_a1_1@A1.alpha.edu`)
Hinweis: **Admin** und **Schuladmin** können sich auch nur mit `username` (ohne @-Teil) anmelden.

## Konfiguration (.env)
Wichtige Keys (siehe `.env.example`, weitere optional möglich):
- `PORT`, `SESSION_SECRET`, `REDIS_URL` (optional, sonst MemoryStore)
- `DB_PATH` (Default: `./data/app.db`)
- `SOCKET_PATH`, `SOCKET_MODE` (optional für Unix-Socket)
- `DEFAULT_ADMIN_USER`, `DEFAULT_ADMIN_PASS` (nur für `initdb`)
- `TEACHER_CAN_SEE_BCC` (0/1), `TEACHER_CAN_CREATE` (0/1)
- `SEND_WINDOW_MINUTES` (Default-Dauer)
- `TEACHER_AUTO_CREATE_MAX` (Limit pro Auto-Create-Lauf)
- `ATTACHMENTS_DIR`, `ATTACHMENTS_MAX_MB`, `ATTACHMENTS_MAX_FILES`
- `MAIL_DOMAIN_TEMPLATE`, `MAIL_DOMAIN` (Anzeige von Login/Adresse)
- `DEFAULT_LOCALE` (z. B. `de`)
- `ASSET_VERSION` (Cache-Busting)
- `FORCE_SETUP=1` (erzwingt Setup-Flow)
- `TEACHER_NAME_API_*` (Namens-Generator via randomuser.me)

### Domain-Format (@-Teil)
`MAIL_DOMAIN_TEMPLATE={course}.{domain}`
- `{course}` Kurs/Gruppe (Fallback: `default`)
- `{domain}` Basisdomain (via `MAIL_DOMAIN` oder Schul-Domain)

## Datenmodell & Migrationen
- Schema: `src/db/schema.sql` (idempotent).
- Beim App-Start werden Schema-Erweiterungen geprüft und ggf. migriert (siehe `src/app.js`).
- Anhänge liegen im Dateisystem (`data/attachments`), Metadaten in SQLite.

## Scripts
- `npm run dev` – Start mit Entwicklungs-Env
- `npm run start` – Production-Start
- `npm run initdb` – DB initialisieren, Admin anlegen
- `npm run seed` – Demo-Daten (mit `SEED_FORCE=1` auch bei vorhandenen Daten)
- `npm run build` – Build-Verzeichnis erzeugen
- `npm run start:build` – Build starten (erzwingt Setup)

## Build & Deploy
`npm run build` kopiert Quellcode, Assets und `data/` (ohne `.db` und `.env`) nach `./build`.
Mit `INCLUDE_NODE_MODULES=1` werden `node_modules` mitkopiert.

## Build-Routinen (Details)
- `npm run build` erstellt einen frischen `./build`-Ordner, kopiert `src/`, Root-Dateien (README, LICENSE, package.json) und `data/` ohne `.db`.
- `npm run start:build` startet den Build aus `./build`, setzt `FORCE_SETUP=1` und verwendet `./build/.env`.
- Für produktive Deployments: `.env` manuell in `./build` anlegen oder mit `ENV_FILE` auf einen externen Pfad zeigen.
- Optional: `INCLUDE_NODE_MODULES=1 npm run build` für vollständig autarke Builds.

## Sicherheitshinweise (Kurz)
- Inhalte werden serverseitig mit `sanitize-html` bereinigt (XSS-Schutz).
- Es gibt keine SMTP/IMAP-Funktionen – alles bleibt lokal in der SQLite-DB.

## Lizenz
MIT
