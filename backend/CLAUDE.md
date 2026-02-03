# Backend conventions (Node/TS/Express + Postgres + Drizzle)

- npm + Node 20
- ESM (unless tooling pain), consistent imports
- Routes in src/routes, services in src/services, db in src/db
- Validate inputs with zod
- Always keep migrations reproducible from schema.ts
- Provide verification commands in README
- Keep deps minimal; prefer deterministic tools over LLM “formatting”
