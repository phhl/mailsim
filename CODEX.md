# Codex Working Agreement

## High-level goal
Keep the project easy to change safely: small modules, explicit dependencies, and minimal cross-cutting edits.

## Repo shape (do not collapse back to a monolith)
- `src/server.js`: process entrypoint (only `app.listen`).
- `src/app.js`: Express wiring (middleware + router registration + db init).
- `src/routes/*`: route handlers, grouped by feature.
- `src/services/*`: business logic and DB-facing helpers.
- `src/utils/*`: pure utilities.

## Editing rules
1. When adding new endpoints, add them in a feature router under `src/routes/`.
2. Keep DB queries local to a router or move them into `src/services/` if reused.
3. Avoid hidden global state; pass `{ db }` into routers.
4. Prefer small, testable functions over inlined multi-purpose blocks.
5. When changing the data model, update `src/db/schema.sql` and keep it idempotent.

## Naming conventions
- Routers: `createXRouter({ db })` returning an `express.Router()`.
- Services: functions that take `db` explicitly as first argument if they need it.

## Common pitfalls to avoid
- Do not call `app.listen(...)` anywhere except `src/server.js`.
- Do not import routers from inside routers (avoid circular deps).
- When formatting displayed email addresses, always use `lib/address.formatEmail(...)`.

