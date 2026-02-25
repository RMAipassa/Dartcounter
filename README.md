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

For in-app voice callouts, use local audio files in `web/public/audio/callouts/en/` (or browser TTS fallback).


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

## Autodarts groundwork

The server now includes an autodarts integration scaffold with room-to-device bindings, adapter mode switching, and mock dart events.

- Toggle support with `AUTODARTS_ENABLED` (defaults to enabled unless set to `false`).
- Choose adapter mode with `AUTODARTS_MODE` (`MOCK` default, `REAL` scaffold).
- Mock controls policy:
  - `AUTODARTS_ALLOW_MOCK_BINDING` (`true`/`false`)
  - `AUTODARTS_ALLOW_MOCK_DARTS` (`true`/`false`)
- Real adapter credential inputs:
  - `AUTODARTS_TOKEN` **or** `AUTODARTS_EMAIL` + `AUTODARTS_PASSWORD`
  - optional `AUTODARTS_API_BASE`, `AUTODARTS_WS_BASE`
- Real adapter bridge inputs:
  - optional `AUTODARTS_BRIDGE_BASE` (default: `http://127.0.0.1:6876`)
  - optional `AUTODARTS_BRIDGE_TOKEN`
  - optional `AUTODARTS_BRIDGE_POLL_MS` (default: `900`)
- Included reference bridge scripts:
  - `npm run dev:bridge`
  - `npm run start:bridge`
- Health endpoint: `GET /api/autodarts/status`.
- Socket events:
  - `lobby:autodartsBindDevice` (`hostSecret`, `deviceId`, optional `mockMode` = `MANUAL` | `AUTO`) (MOCK mode only)
  - `lobby:autodartsUnbindDevice` (`hostSecret`) (MOCK mode only)
  - `game:autodartsMockDart` (`segment`, `multiplier`) (host only)
  - `game:autodartsClearPending` (host or controlling player)
- Room snapshots now include `room.autodarts` state and rooms receive `room:autodartsDart` events.
- Incoming autodarts darts are buffered per active player and marked `ready` when:
  - 3 darts are collected, or
  - bust/checkout is reached early.
- Players must review and manually submit the captured turn (to account for board misreads).
- While autodarts is connected, total-mode submissions are blocked; turns must be submitted as per-dart (autodarts + corrections).
- After a turn is `ready`, additional autodarts darts are ignored until the player submits or clears the pending turn.
- `REAL` mode expects a local/remote bridge with this contract:
  - `POST /api/session/connect` -> `{ ok: true, sessionId }`
  - `POST /api/session/events` -> `{ ok: true, events: [{ id, segment, multiplier }] }`
  - `POST /api/session/disconnect` -> `{ ok: true }`
- Reference bridge helper endpoint (for manual tests):
  - `POST /api/session/inject` -> injects a dart for a session
- In `REAL` mode, binding is per-user (account-scoped):
  - each authenticated user saves `autodartsDeviceId` via `POST /api/auth/autodarts`
  - during live play, the server auto-binds the current player's saved board

Default script behavior:
- `run-dev.cmd`: REAL mode enabled, mock binding/darts allowed (dev testing + real support).
- Production scripts (`run-prod.cmd`, `scripts/windows/run-prod-with-tunnel.cmd`, `scripts/windows/run-prod-auto-update.ps1`): REAL mode with mock binding/darts disabled.

Real-connection hardening currently included:
- reconnect with backoff on bridge failure
- duplicate event-id filtering
- game-screen warning when current player has no personal autodarts device configured

## Announcer-quality callouts

The game page first tries local callout audio files, then falls back to browser TTS.

- Place files in `web/public/audio/callouts/en/`
- Supported keys are listed in `web/public/audio/callouts/README.txt`
- Generate a high-quality pack with ElevenLabs:

```bash
# required
set ELEVENLABS_API_KEY=your_api_key
set ELEVENLABS_VOICE_ID=your_voice_id

# optional
set CALLOUT_LANGS=en
set ELEVENLABS_MODEL_ID=eleven_multilingual_v2
set ELEVENLABS_OUTPUT_FORMAT=mp3_44100_128

npm run generate:callouts:elevenlabs
```

## Accounts (foundation)

Basic account auth is now available with persistent local storage in `data/auth-store.json`.

- API endpoints:
  - `POST /api/auth/register` (`email`, `password`, optional `displayName`)
  - `POST /api/auth/login` (`email`, `password`)
  - `POST /api/auth/logout` (`token`)
  - `GET /api/auth/me` (`Authorization: Bearer <token>`)
  - `POST /api/auth/autodarts` (`Authorization: Bearer <token>`, body: `{ deviceId: string | null }`)
  - `POST /api/auth/autodarts-credentials` (`Authorization: Bearer <token>`, body supports `{ token }` or `{ email, password }`, optional `{ apiBase, wsBase }`, or `{ clear: true }`)
- Web account page: `/account`
- Auth token is stored client-side (`dc_authToken`) and attached to room create/join.
- This is the identity foundation for upcoming per-user autodarts bindings.

## User stats

Match results are now persisted for authenticated users.

- Stored in `data/user-stats.json`
- Captures:
  - all-time cumulative stats
  - last 10 games history
  - global records (most wins, highest checkout, highest score, best avg)
- API endpoints:
  - `GET /api/stats/me` (requires `Authorization: Bearer <token>`)
  - `GET /api/stats/global`
- Web view: `/account`
