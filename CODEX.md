# Codex Working Agreement

## Ziel
Änderungen sollen sicher und nachvollziehbar bleiben: klare Modulgrenzen, explizite Abhängigkeiten, wenig Querverbindungen.

## Repo-Struktur (nicht wieder zum Monolithen machen)
- `src/server.js`: Entry-Point (nur `app.listen` bzw. Socket-Start).
- `src/app.js`: Express-Wiring, Session/Locales, Schema-Checks/Migrationen.
- `src/routes/*`: Feature-Router (Auth, Mail, Teacher, Admin, Schooladmin, Setup).
- `src/services/*`: Geschäftslogik und DB-Helfer (Mail, Logs, Send-Window, Attachments).
- `src/utils/*`: kleine, pure Helfer (Zeit, CSV, Parse, Name-Generator).
- `src/lib/*`: Domain-spezifische Helfer (Adresse, Sanitizing).
- `src/views/*`: EJS-Templates, Layout-Teile in `partials/`.
- `src/public/assets/*`: statische Assets.

## Editing-Regeln
1. Neue Endpunkte immer in einem Feature-Router unter `src/routes/`.
2. Wiederverwendete DB-Logik in `src/services/` kapseln.
3. Keine versteckte globale State-Logik; `db` wird explizit übergeben.
4. Kleine, testbare Funktionen bevorzugen; keine übergroßen Handler.
5. Schema-Änderungen immer in `src/db/schema.sql` **und** im Startup-Pfad (`src/app.js`) berücksichtigen.

## Datenbank & Migrationen
- Schema ist idempotent; Startup führt ergänzende Migrationen aus.
- Bei neuen Tabellen/Spalten: `schema.sql` anpassen **und** Migrationen in `app.js` ergänzen.
- Transaktionen (`db.transaction`) bei Multi-Step Writes verwenden.

## Auth & Rollen
- Auth-Guard: `middleware/auth.js` (`requireAuth`, `requireRole`).
- Rollenregeln nicht im Template verstecken; Zugriff im Router prüfen.

## Mail-Adressen/Logins
- Immer `lib/address.formatEmail()` bzw. `formatLogin()` verwenden.
- Kein eigenes String-Building für Mail-Adressen.

## Attachments
- Datei-Handling ausschließlich über `services/attachments.js`.
- Pfade/Namen nie direkt aus User-Input bauen.

## I18n
- Texte über `req.t()` oder `res.locals.t()` holen.
- Neue Keys in `src/locales/de.json` ergänzen.

## UI/Views
- Admin/Teacher/Schooladmin an `STYLE_GUIDE.md` orientieren.
- Admin-Detailansichten ohne Sidebar (`showSidebar: false` via Layout).

## Häufige Fehler vermeiden
- Kein `app.listen(...)` außerhalb von `src/server.js`.
- Keine Router-Imports innerhalb anderer Router (Zirkel vermeiden).
- BCC-Logik nicht in Templates duplizieren; BCC-Sichtbarkeit nur zentral regeln.
- Zeitstempel im UI via `utils/time.toBerlinLocal()` formatieren.
