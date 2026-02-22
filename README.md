# Dartcounter (Web + Realtime Server)

This repo has:

- Socket.io + Node authoritative scoring server (x01)
- Next.js web client (lobby + game UI)

## Run locally

Server (port 3001):

```bash
npm install
npm run dev
```

Web (port 3000):

```bash
npm --prefix web install
npm --prefix web run dev
```

Run both at once:

```bash
npm run dev:all
```

Windows shortcuts:

- Dev: `run-dev.cmd`
- Prod (build + start): `run-prod.cmd` (uses `PORT` env var, default `7777`)

## Auto-update (Windows)

If you run the app on a Windows PC and want it to auto-update from GitHub (polling every 30 seconds):

Run production:

```bat
scripts\windows\run-prod-with-tunnel.cmd
```

Auto-pull/build/restart loop:

```bat
scripts\windows\run-prod-auto-update.cmd
```

Notes:

- Requires `git` in PATH and an upstream branch configured.
- Uses `git pull --ff-only` and will skip updates if the working tree is dirty.

Web uses `NEXT_PUBLIC_SERVER_URL` (defaults to `http://localhost:3001`). See `web/.env.example`.

## Single-process (one port) hosting

The server can also serve the Next.js UI from `web/` on the same port (Socket.io + UI together).

Build everything:

```bash
npm run build:all
```

Start (one port):

```bash
npm start
```

In production, if `NEXT_PUBLIC_SERVER_URL` is not set, the web UI will connect to the same origin automatically.
