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

If you run the app on a Windows PC and want it to auto-update from GitHub:

1) Install pm2 once:

```bat
npm i -g pm2
```

2) Start the app under pm2:

```bat
scripts\windows\run-prod-pm2.cmd
```

3) Auto-pull/build/restart every 30s (polling):

```bat
scripts\windows\watch-updates.cmd
```

Notes:

- This expects your repo has a remote configured and an upstream branch.
- The update script uses `git pull --ff-only` and will fail if local changes exist.

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
