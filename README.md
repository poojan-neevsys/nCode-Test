# NeevSys HR Onboarding Portal

npm workspaces monorepo (Tech Lead decision DEC-001):

- `client/`: React 18, TypeScript and Vite
- `server/`: Node 22, Express and TypeScript, with SQLite through the built-in `node:sqlite` module and plain SQL migrations in `server/migrations/`

No authentication yet (comes with EP-04).

## Prerequisites

- Node.js 22.13 or later (`node:sqlite` is available without a flag from 22.13)
- npm 10 or later (ships with Node 22)

## Install

From the repository root:

```bash
npm install
```

## Build

From the repository root, this type-checks both workspaces with TypeScript strict mode and creates the client production bundle in `client/dist`:

```bash
npm run build
```

## Start (production-style)

Build first, then start the server. It applies pending migrations, serves the built client and the API on the same port:

```bash
npm run build
npm start
```

Open http://localhost:3000 to see the portal heading and the health status. The API health check is at http://localhost:3000/api/health.

## Development mode

Run the server and the Vite dev client in two terminals:

```bash
# Terminal 1: API on port 3000 (restarts on change)
npm run dev:server

# Terminal 2: client on Vite's dev server, proxying /api to port 3000
npm run dev:client
```

Open the URL that Vite prints (usually http://localhost:5173). Keep the server on port 3000 in development, because the Vite proxy targets it.

## Configuration

The server reads these environment variables. Defaults are listed in `.env.example`:

| Variable        | Default                     | Purpose                              |
| --------------- | --------------------------- | ------------------------------------ |
| `PORT`          | `3000`                      | Port the server listens on           |
| `DATABASE_PATH` | `./data/hr-onboarding.db`   | SQLite database file                 |

Copy `.env.example` to `.env` if you want to keep your own values, and export them in your shell before starting the server. Do not commit `.env`.

The database file and its folder are created on first start. Migrations in `server/migrations/` are applied in name order and recorded in the `schema_migrations` table; starting the server again applies only new files.
