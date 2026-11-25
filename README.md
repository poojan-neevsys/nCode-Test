# NeevSys HR Onboarding Portal

Monorepo (npm workspaces) with:

- `client/`: React 18, TypeScript and Vite
- `server/`: Node 22, Express and TypeScript, with SQLite through the built-in `node:sqlite` module and plain SQL migrations in `server/migrations/`

## Prerequisites

- Node.js 22.13 or later (includes `node:sqlite` without a flag)
- npm 10 or later (includes workspace support)

## Configuration

Defaults work without any configuration. The settings (`PORT`, `DATABASE_FILE`, `API_PROXY_TARGET`) and their defaults are listed in `.env.example`. Node does not read `.env` automatically, so set variables in your shell if you need different values.

## Install

Run from the repository root:

```sh
npm install
```

## Build

Compiles the server with TypeScript (strict mode) and creates the client production bundle in `client/dist/`:

```sh
npm run build
```

## Start

Serves the API and the built client on the same port (default `http://localhost:3000`). Run the build first:

```sh
npm start
```

Open `http://localhost:3000` to see the heading and the health status. You can also check the API directly:

```sh
curl http://localhost:3000/api/health
```

The server applies pending files in `server/migrations/` on start, in name order, and records them in the `schema_migrations` table.

## Development mode

Use three terminals from the repository root:

1. `npm run dev:server:build` compiles the server and recompiles on change.
2. `npm run dev:server` runs the server from `server/dist` and restarts it when the compiled output changes.
3. `npm run dev:client` starts the Vite dev server with hot reload at `http://localhost:5173`. It forwards `/api` requests to the server (`API_PROXY_TARGET`, default `http://localhost:3000`).

Run `npm run build` once before the first `npm run dev:server`, so that `server/dist` exists.
