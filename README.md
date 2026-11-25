# NeevSys HR Onboarding Portal

Project foundation for the HR Onboarding Portal. It is an npm workspaces monorepo:

- `client/`: React 18, TypeScript and Vite
- `server/`: Node 22, Express and TypeScript, with SQLite through the built-in `node:sqlite` module and plain SQL migrations in `server/migrations/`

## Prerequisites

- Node.js 22.13 or later (`node:sqlite` is available without a flag from this version)
- npm 10 or later (ships with Node 22)

## Install

From the repository root:

```bash
npm install
```

## Build

From the repository root, this type-checks both workspaces (TypeScript strict mode) and creates the client production bundle in `client/dist/`:

```bash
npm run build
```

## Start

After a build, start the server:

```bash
npm start
```

Open http://localhost:3000. The server serves the built client on the same port and exposes `GET /api/health`, which returns `{"status":"ok","database":"ok"}` with HTTP 200, or HTTP 503 with `"database":"error"` when the database check fails.

On startup the server applies pending migrations from `server/migrations/` in file name order and records each one in the `schema_migrations` table. Restarting applies nothing new.

## Development mode

Use three terminals from the repository root:

1. Compile the server on change:
   ```bash
   npm run dev:compile
   ```
2. Run the server. It restarts automatically when step 1 rebuilds `server/dist/`:
   ```bash
   npm run dev:server
   ```
3. Run the client with hot reload at http://localhost:5173. Requests to `/api` are proxied to the server:
   ```bash
   npm run dev:client
   ```

Run `npm run build` once first so that `server/dist/` exists before `npm run dev:server`.

## Configuration

Settings come from environment variables. Defaults are listed in `.env.example`. To override them, copy the file to `.env` in the repository root. `.env` is git-ignored.

| Variable        | Default                    | Meaning                                              |
| --------------- | -------------------------- | ---------------------------------------------------- |
| `PORT`          | `3000`                     | HTTP port for the server                             |
| `DATABASE_FILE` | `./data/hr-onboarding.db`  | SQLite file. Relative paths resolve from `server/`   |

Do not commit `.env` or any secrets.

## Repository layout

```
client/            React + Vite client (src/, index.html, vite.config.ts)
server/            Express API (src/), SQL migrations (migrations/)
.env.example       Default configuration values
package.json       npm workspaces root and shared scripts
```
