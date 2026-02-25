export default function AutodartsGuidePage() {
  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card" style={{ padding: 16 }}>
        <h1 className="title">Autodarts Setup Guide</h1>
        <p className="subtitle">How to connect a real autodarts board to Dartcounter</p>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>1) Choose runtime mode</div>
        <div className="help">Set server env var `AUTODARTS_MODE=REAL` and restart the server.</div>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>2) Provide credentials</div>
        <div className="help">Use either a token or email/password on the server (never in browser).</div>
        <pre className="pill" style={{ whiteSpace: 'pre-wrap' }}>{`AUTODARTS_ENABLED=true
AUTODARTS_MODE=REAL

# Either token:
AUTODARTS_TOKEN=...

# Or email + password:
AUTODARTS_EMAIL=...
AUTODARTS_PASSWORD=...

# Optional provider overrides:
AUTODARTS_API_BASE=...
AUTODARTS_WS_BASE=...`}</pre>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>3) Run the bridge service</div>
        <div className="help">REAL mode uses an HTTP bridge. This repo now includes a reference bridge you can run directly.</div>
        <pre className="pill" style={{ whiteSpace: 'pre-wrap' }}>{`# Development
npm run dev:bridge

# Production (after build)
npm run start:bridge`}</pre>
        <div className="help">Default bridge base URL: `http://127.0.0.1:6876`</div>
        <div className="help">Optional auth token: `AUTODARTS_BRIDGE_TOKEN`</div>
        <pre className="pill" style={{ whiteSpace: 'pre-wrap' }}>{`Bridge endpoints expected by Dartcounter:
POST /api/session/connect
  body: { deviceId, token?, email?, password?, apiBase?, wsBase? }
  -> { ok: true, sessionId: string }

POST /api/session/events
  body: { sessionId, after?: string }
  -> { ok: true, events: [{ id: string, segment: number, multiplier: 0|1|2|3 }] }

POST /api/session/disconnect
  body: { sessionId }
  -> { ok: true }`}</pre>
      </div>

      <div className="card" style={{ padding: 16 }}>
        <div style={{ fontSize: 16, marginBottom: 8 }}>4) Set your personal device on account</div>
        <div className="help">Open `/account`, sign in, and save your personal autodarts device id.</div>
        <div className="help">During live games, Dartcounter auto-binds the current player's saved board.</div>
      </div>
    </div>
  )
}
