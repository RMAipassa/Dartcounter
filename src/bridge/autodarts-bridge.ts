import express from 'express'
import { randomBytes } from 'crypto'
import { z } from 'zod'

type DartEvent = {
  id: string
  segment: number
  multiplier: 0 | 1 | 2 | 3
  createdAt: number
}

type Session = {
  id: string
  deviceId: string
  events: DartEvent[]
  nextEventSeq: number
  autoTimer: NodeJS.Timeout | null
}

const port = Number(process.env.BRIDGE_PORT ?? 6876)
const mode = String(process.env.BRIDGE_MODE ?? 'MOCK').toUpperCase()
const token = process.env.BRIDGE_TOKEN?.trim() || null
const mockIntervalMs = Number(process.env.BRIDGE_MOCK_INTERVAL_MS ?? 2500)

const sessions = new Map<string, Session>()

const app = express()
app.use(express.json())

const connectSchema = z.object({
  deviceId: z.string().trim().min(1).max(96),
  token: z.string().trim().min(1).max(512).optional(),
  email: z.string().email().optional(),
  password: z.string().min(1).max(512).optional(),
  apiBase: z.string().url().optional(),
  wsBase: z.string().url().optional(),
})

const disconnectSchema = z.object({
  sessionId: z.string().trim().min(1).max(128),
})

const eventsSchema = z.object({
  sessionId: z.string().trim().min(1).max(128),
  after: z.string().trim().max(64).optional().nullable(),
})

const injectSchema = z.object({
  sessionId: z.string().trim().min(1).max(128),
  segment: z.number().int().min(0).max(25),
  multiplier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
})

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true, service: 'autodarts-bridge', mode, sessions: sessions.size })
})

app.post('/api/session/connect', (req, res) => {
  try {
    assertToken(req)
    const body = connectSchema.parse(req.body)

    const hasCredentials = Boolean(body.token) || (Boolean(body.email) && Boolean(body.password))
    if (!hasCredentials) {
      res.status(400).json({ ok: false, message: 'BRIDGE_MISSING_PROVIDER_CREDENTIALS' })
      return
    }

    const sessionId = randomId(16)
    const session: Session = {
      id: sessionId,
      deviceId: body.deviceId,
      events: [],
      nextEventSeq: 1,
      autoTimer: null,
    }

    if (mode === 'MOCK') {
      session.autoTimer = setInterval(() => {
        appendEvent(session, randomDart())
      }, mockIntervalMs)
    }

    sessions.set(sessionId, session)
    res.status(200).json({ ok: true, sessionId })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'BRIDGE_CONNECT_FAILED'
    res.status(400).json({ ok: false, message: msg })
  }
})

app.post('/api/session/events', (req, res) => {
  try {
    assertToken(req)
    const body = eventsSchema.parse(req.body)
    const session = sessions.get(body.sessionId)
    if (!session) {
      res.status(404).json({ ok: false, message: 'BRIDGE_SESSION_NOT_FOUND' })
      return
    }

    const afterSeq = parseAfter(body.after)
    const events = afterSeq == null ? session.events : session.events.filter((e) => parseAfter(e.id) != null && Number(e.id) > afterSeq)
    res.status(200).json({ ok: true, events: events.map(({ id, segment, multiplier }) => ({ id, segment, multiplier })) })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'BRIDGE_EVENTS_FAILED'
    res.status(400).json({ ok: false, message: msg })
  }
})

app.post('/api/session/disconnect', (req, res) => {
  try {
    assertToken(req)
    const body = disconnectSchema.parse(req.body)
    const session = sessions.get(body.sessionId)
    if (session?.autoTimer) clearInterval(session.autoTimer)
    sessions.delete(body.sessionId)
    res.status(200).json({ ok: true })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'BRIDGE_DISCONNECT_FAILED'
    res.status(400).json({ ok: false, message: msg })
  }
})

app.post('/api/session/inject', (req, res) => {
  try {
    assertToken(req)
    const body = injectSchema.parse(req.body)
    const session = sessions.get(body.sessionId)
    if (!session) {
      res.status(404).json({ ok: false, message: 'BRIDGE_SESSION_NOT_FOUND' })
      return
    }
    const event = appendEvent(session, { segment: body.segment, multiplier: body.multiplier })
    res.status(200).json({ ok: true, event: { id: event.id, segment: event.segment, multiplier: event.multiplier } })
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'BRIDGE_INJECT_FAILED'
    res.status(400).json({ ok: false, message: msg })
  }
})

app.listen(port, () => {
  // eslint-disable-next-line no-console
  console.log(`[autodarts-bridge] listening on :${port} (${mode})`)
})

function appendEvent(session: Session, dart: { segment: number; multiplier: 0 | 1 | 2 | 3 }): DartEvent {
  const event: DartEvent = {
    id: String(session.nextEventSeq++),
    segment: dart.segment,
    multiplier: dart.multiplier,
    createdAt: Date.now(),
  }
  session.events.push(event)
  if (session.events.length > 200) session.events.splice(0, session.events.length - 200)
  return event
}

function parseAfter(after?: string | null): number | null {
  if (!after) return null
  const n = Number(after)
  if (!Number.isFinite(n)) return null
  return Math.floor(n)
}

function randomDart(): { segment: number; multiplier: 0 | 1 | 2 | 3 } {
  const roll = Math.random()
  if (roll < 0.12) return { segment: 25, multiplier: 2 }
  if (roll < 0.22) return { segment: 25, multiplier: 1 }
  if (roll < 0.34) return { segment: 0, multiplier: 0 }
  const segment = Math.floor(Math.random() * 20) + 1
  const mRoll = Math.random()
  const multiplier: 0 | 1 | 2 | 3 = mRoll < 0.56 ? 1 : mRoll < 0.84 ? 3 : 2
  return { segment, multiplier }
}

function assertToken(req: express.Request): void {
  if (!token) return
  const auth = req.header('authorization') ?? ''
  const provided = auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : ''
  if (provided !== token) throw new Error('BRIDGE_UNAUTHORIZED')
}

function randomId(bytes: number): string {
  return randomBytes(bytes).toString('base64url')
}
