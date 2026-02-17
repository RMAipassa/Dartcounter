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
