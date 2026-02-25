import cors from 'cors'
import express from 'express'
import http from 'http'
import next from 'next'
import path from 'path'
import { randomBytes } from 'crypto'
import { Server } from 'socket.io'
import { z } from 'zod'
import {
  authenticateUser,
  createSession,
  getUserById,
  getUserAutodartsCredentials,
  getUserBySessionToken,
  registerUser,
  revokeSession,
  setUserAutodartsCredentials,
  setUserAutodartsDevice,
} from './auth/store'
import { getGlobalRecords, getUserStats, recordFinishedMatch } from './auth/stats'
import { GameRuleError } from './game/errors'
import type { Dart, TurnInput, TurnRecord, X01Settings } from './game/types'
import { AutodartsService } from './integrations/autodarts'
import type { AutodartsDartEvent } from './integrations/autodarts'
import type { AutodartsRuntimeMode } from './integrations/autodarts'
import { applyX01Turn, computeMatchSnapshot, totalTurnsInMatch, validateX01Settings } from './game/x01'
import { computePlayerStats } from './game/stats'
import {
  addClient,
  addPlayer,
  assertHost,
  createRoom,
  deleteRoom,
  getClient,
  getRoom,
  isRoomEmpty,
  listPublicRooms,
  removeClient,
  reorderPlayers,
} from './store/memory'

function randomId(bytes: number): string {
  return randomBytes(bytes).toString('base64url')
}

function bearerTokenFromReq(req: express.Request): string | null {
  const auth = req.header('authorization') ?? ''
  return auth.toLowerCase().startsWith('bearer ') ? auth.slice(7).trim() : null
}

const app = express()
app.use(cors())
app.use(express.json())

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true })
})

app.get('/api/status', (_req, res) => {
  res.status(200).json({ ok: true, service: 'dartcounter' })
})

const registerSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(8).max(200),
  displayName: z.string().trim().min(1).max(32).optional(),
})

const loginSchema = z.object({
  email: z.string().email().max(160),
  password: z.string().min(1).max(200),
})

const logoutSchema = z.object({
  token: z.string().trim().min(1).max(256),
})

const updateAutodartsDeviceSchema = z.object({
  deviceId: z.string().trim().min(1).max(96).nullable().optional(),
})

const updateAutodartsCredentialsSchema = z.object({
  token: z.string().trim().min(1).max(512).optional().nullable(),
  email: z.string().email().optional().nullable(),
  password: z.string().trim().min(1).max(512).optional().nullable(),
  apiBase: z.string().url().optional().nullable(),
  wsBase: z.string().url().optional().nullable(),
  clear: z.boolean().optional(),
})

app.post('/api/auth/register', (req, res) => {
  try {
    const body = registerSchema.parse(req.body)
    const user = registerUser(body)
    const session = createSession(user.id)
    res.status(200).json({ ok: true, token: session.token, user })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'REGISTER_FAILED'
    if (message === 'EMAIL_ALREADY_USED') {
      res.status(409).json({ ok: false, message: 'Email is already in use' })
      return
    }
    res.status(400).json({ ok: false, message: 'Invalid registration request' })
  }
})

app.post('/api/auth/login', (req, res) => {
  try {
    const body = loginSchema.parse(req.body)
    const user = authenticateUser(body)
    if (!user) {
      res.status(401).json({ ok: false, message: 'Invalid email or password' })
      return
    }
    const session = createSession(user.id)
    res.status(200).json({ ok: true, token: session.token, user })
  } catch {
    res.status(400).json({ ok: false, message: 'Invalid login request' })
  }
})

app.post('/api/auth/logout', (req, res) => {
  try {
    const { token } = logoutSchema.parse(req.body)
    revokeSession(token)
    res.status(200).json({ ok: true })
  } catch {
    res.status(400).json({ ok: false, message: 'Invalid logout request' })
  }
})

app.get('/api/auth/me', (req, res) => {
  const token = bearerTokenFromReq(req)
  const user = getUserBySessionToken(token)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }
  res.status(200).json({ ok: true, user })
})

app.post('/api/auth/autodarts', (req, res) => {
  const token = bearerTokenFromReq(req)
  const user = getUserBySessionToken(token)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }

  try {
    const { deviceId } = updateAutodartsDeviceSchema.parse(req.body)
    const updated = setUserAutodartsDevice({ userId: user.id, deviceId: deviceId ?? null })
    if (!updated) {
      res.status(404).json({ ok: false, message: 'User not found' })
      return
    }
    res.status(200).json({ ok: true, user: updated })
  } catch {
    res.status(400).json({ ok: false, message: 'Invalid autodarts update request' })
  }
})

app.post('/api/auth/autodarts-credentials', (req, res) => {
  const token = bearerTokenFromReq(req)
  const user = getUserBySessionToken(token)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }

  try {
    const body = updateAutodartsCredentialsSchema.parse(req.body)
    const updated = setUserAutodartsCredentials({
      userId: user.id,
      token: body.token,
      email: body.email,
      password: body.password,
      apiBase: body.apiBase,
      wsBase: body.wsBase,
      clear: body.clear,
    })
    if (!updated) {
      res.status(404).json({ ok: false, message: 'User not found' })
      return
    }
    res.status(200).json({ ok: true, user: updated })
  } catch {
    res.status(400).json({ ok: false, message: 'Invalid autodarts credentials request' })
  }
})

app.get('/api/stats/me', (req, res) => {
  const token = bearerTokenFromReq(req)
  const user = getUserBySessionToken(token)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }
  res.status(200).json({ ok: true, stats: getUserStats(user.id) })
})

app.get('/api/stats/global', (_req, res) => {
  const records = getGlobalRecords()
  const withNames = {
    ...records,
    mostWins: records.mostWins
      ? {
          ...records.mostWins,
          displayName: getUserById(records.mostWins.userId)?.displayName ?? null,
        }
      : null,
    highestCheckout: records.highestCheckout
      ? {
          ...records.highestCheckout,
          displayName: getUserById(records.highestCheckout.userId)?.displayName ?? null,
        }
      : null,
    highestScore: records.highestScore
      ? {
          ...records.highestScore,
          displayName: getUserById(records.highestScore.userId)?.displayName ?? null,
        }
      : null,
    bestThreeDartAverage: records.bestThreeDartAverage
      ? {
          ...records.bestThreeDartAverage,
          displayName: getUserById(records.bestThreeDartAverage.userId)?.displayName ?? null,
        }
      : null,
  }
  res.status(200).json({ ok: true, records: withNames })
})

app.get('/api/autodarts/status', (_req, res) => {
  const hasCredentials =
    Boolean(process.env.AUTODARTS_TOKEN) ||
    (Boolean(process.env.AUTODARTS_EMAIL) && Boolean(process.env.AUTODARTS_PASSWORD))

  res.status(200).json({
    ok: true,
    enabled: autodarts.isEnabled(),
    mode: autodarts.getMode(),
    hasCredentials,
    allowMockBinding,
    allowMockDartInput,
    bridgeBase: autodartsBridgeBase,
  })
})

app.get('/api/autodarts/bridge-health', async (_req, res) => {
  const startedAt = Date.now()
  const bridgeBase = autodartsBridgeBase.replace(/\/+$/, '')
  try {
    const response = await fetch(`${bridgeBase}/healthz`, { method: 'GET' })
    const latencyMs = Date.now() - startedAt
    if (!response.ok) {
      res.status(200).json({ ok: true, reachable: false, status: response.status, latencyMs })
      return
    }
    const health = await response.json().catch(() => null)
    res.status(200).json({ ok: true, reachable: true, status: response.status, latencyMs, health })
  } catch (err) {
    const latencyMs = Date.now() - startedAt
    res.status(200).json({
      ok: true,
      reachable: false,
      latencyMs,
      error: err instanceof Error ? err.message : 'BRIDGE_HEALTH_FAILED',
    })
  }
})

const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
  },
})

const autodartsMode: AutodartsRuntimeMode =
  String(process.env.AUTODARTS_MODE ?? 'MOCK').toUpperCase() === 'REAL' ? 'REAL' : 'MOCK'
const allowMockBinding = String(process.env.AUTODARTS_ALLOW_MOCK_BINDING ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true'
const allowMockDartInput = String(process.env.AUTODARTS_ALLOW_MOCK_DARTS ?? (process.env.NODE_ENV === 'production' ? 'false' : 'true')) === 'true'
const autodartsBridgeBase = process.env.AUTODARTS_BRIDGE_BASE ?? 'http://127.0.0.1:6876'

const autodarts = new AutodartsService({
  enabled: process.env.AUTODARTS_ENABLED !== 'false',
  mode: autodartsMode,
  real: {
    bridgeBase: autodartsBridgeBase,
    bridgeToken: process.env.AUTODARTS_BRIDGE_TOKEN,
    pollIntervalMs: process.env.AUTODARTS_BRIDGE_POLL_MS ? Number(process.env.AUTODARTS_BRIDGE_POLL_MS) : undefined,
    token: process.env.AUTODARTS_TOKEN,
    email: process.env.AUTODARTS_EMAIL,
    password: process.env.AUTODARTS_PASSWORD,
    apiBase: process.env.AUTODARTS_API_BASE,
    wsBase: process.env.AUTODARTS_WS_BASE,
  },
})

const port = Number(process.env.PORT ?? 3001)

const isProd = process.env.NODE_ENV === 'production'
const enableNext = process.env.ENABLE_NEXT !== 'false'

const x01SettingsSchema = z.object({
  gameType: z.literal('X01'),
  startScore: z.number().int().min(2).max(10001),
  legsToWin: z.number().int().min(1).max(99),
  setsEnabled: z.boolean(),
  setsToWin: z.number().int().min(0).max(99),
  doubleIn: z.boolean(),
  doubleOut: z.boolean(),
  masterOut: z.boolean(),
})

const dartSchema: z.ZodType<Dart> = z.object({
  segment: z.number().int(),
  multiplier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
})

const joinSchema = z.object({
  code: z.string().trim().min(1).max(16).optional(),
  name: z.string().trim().min(1).max(32),
  hostSecret: z.string().trim().min(1).max(128).optional(),
  authToken: z.string().trim().min(1).max(256).optional(),
  asSpectator: z.boolean().optional(),
})

const createSchema = z.object({
  name: z.string().trim().min(1).max(32),
  authToken: z.string().trim().min(1).max(256).optional(),
  settings: x01SettingsSchema,
  title: z.string().trim().min(0).max(48).optional(),
  isPublic: z.boolean().optional(),
})

const addPlayerSchema = z.object({
  hostSecret: z.string().trim().min(1).max(128),
  name: z.string().trim().min(1).max(32),
})

const reorderSchema = z.object({
  hostSecret: z.string().trim().min(1).max(128),
  playerIdsInOrder: z.array(z.string().min(1)).min(1),
})

const updateSettingsSchema = z.object({
  hostSecret: z.string().trim().min(1).max(128),
  settings: x01SettingsSchema,
})

const startSchema = z.object({
  hostSecret: z.string().trim().min(1).max(128),
  startingPlayerIndex: z.number().int().min(0),
})

const submitTurnSchema = z.object({
  total: z.number().int().min(0).max(180).optional(),
  darts: z.array(dartSchema).min(1).max(3).optional(),
})

const undoSchema = z.object({
  hostSecret: z.string().trim().min(1).max(128),
})

const updateRoomMetaSchema = z.object({
  hostSecret: z.string().trim().min(1).max(128),
  title: z.string().trim().min(0).max(48).optional(),
  isPublic: z.boolean().optional(),
})

const autodartsBindSchema = z.object({
  hostSecret: z.string().trim().min(1).max(128),
  deviceId: z.string().trim().min(1).max(96),
  mockMode: z.enum(['MANUAL', 'AUTO']).optional(),
})

const autodartsUnbindSchema = z.object({
  hostSecret: z.string().trim().min(1).max(128),
})

const autodartsMockDartSchema = z.object({
  segment: z.number().int().min(0).max(25),
  multiplier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]),
})

type PendingAutodartsTurn = {
  playerId: string
  legIndex: number
  turnsInLeg: number
  darts: Dart[]
  ready: boolean
  reason: 'THREE_DARTS' | 'BUST' | 'CHECKOUT' | null
}

const autodartsPendingTurnByRoomCode = new Map<string, PendingAutodartsTurn>()

function getAutodartsPendingTurn(roomCode: string) {
  const pending = autodartsPendingTurnByRoomCode.get(roomCode)
  if (!pending) return null
  return {
    playerId: pending.playerId,
    darts: pending.darts,
    ready: pending.ready,
    reason: pending.reason,
  }
}

function roomChannel(code: string): string {
  return `room:${code}`
}

function emitSnapshot(code: string) {
  const room = getRoom(code)
  const matchSnapshot = computeMatchSnapshot(room.match)
  const autodartsState = autodarts.getRoomState(code)
  const currentPlayerId =
    matchSnapshot.leg.currentPlayerIndex >= 0 ? matchSnapshot.players[matchSnapshot.leg.currentPlayerIndex]?.id ?? null : null
  const currentPlayerName = currentPlayerId ? matchSnapshot.players.find((p) => p.id === currentPlayerId)?.name ?? null : null
  const currentPlayerUserId = currentPlayerId ? room.playerUserIdByPlayerId[currentPlayerId] ?? null : null
  const currentPlayerDeviceId = currentPlayerUserId ? getUserById(currentPlayerUserId)?.autodartsDeviceId?.trim() ?? null : null

  io.to(roomChannel(code)).emit('room:snapshot', {
    code: room.code,
    room: {
      title: room.title,
      isPublic: room.isPublic,
      createdAt: room.createdAt,
      autodartsActiveUserId: room.autodartsBoundUserId,
      autodarts: autodartsState,
      autodartsPending: getAutodartsPendingTurn(code),
      autodartsRoutingDebug: {
        enabled: autodarts.isEnabled(),
        allowMockBinding,
        allowMockDartInput,
        currentPlayerId,
        currentPlayerName,
        currentPlayerUserId,
        missingPersonalDevice: Boolean(currentPlayerUserId) && !currentPlayerDeviceId,
        boundUserId: room.autodartsBoundUserId,
        boundDeviceId: autodartsState.deviceId,
        runtimeMode: autodartsState.runtimeMode,
        connectionStatus: autodartsState.status,
      },
    },
    clients: [...room.clients.values()].map((c) => ({
      socketId: c.socketId,
      name: c.name,
      userId: c.userId,
      isHost: c.isHost,
      role: c.role,
    })),
    match: {
      ...matchSnapshot,
      statsByPlayerId: computePlayerStats(room.match),
    },
  })
}

function syncRoomAutodartsBinding(roomCode: string): void {
  const room = getRoom(roomCode)
  const state = autodarts.getRoomState(roomCode)

  if (allowMockBinding && state.runtimeMode === 'MOCK' && state.status !== 'DISCONNECTED') {
    return
  }

  if (room.match.status !== 'LIVE') {
    room.autodartsBoundUserId = null
    autodarts.unbindRoom(roomCode)
    return
  }

  const snap = computeMatchSnapshot(room.match)
  const currentIdx = snap.leg.currentPlayerIndex
  if (currentIdx < 0) {
    room.autodartsBoundUserId = null
    autodarts.unbindRoom(roomCode)
    return
  }

  const currentPlayerId = snap.players[currentIdx]?.id
  if (!currentPlayerId) {
    room.autodartsBoundUserId = null
    autodarts.unbindRoom(roomCode)
    return
  }

  const userId = room.playerUserIdByPlayerId[currentPlayerId]
  const user = userId ? getUserById(userId) : null
  const creds = userId ? getUserAutodartsCredentials(userId) : null
  const deviceId = user?.autodartsDeviceId?.trim()

  if (!userId || !deviceId) {
    room.autodartsBoundUserId = null
    autodarts.unbindRoom(roomCode)
    return
  }

  if (room.autodartsBoundUserId === userId && state.deviceId === deviceId && state.status !== 'DISCONNECTED') {
    return
  }

  room.autodartsBoundUserId = userId
  autodarts.bindRoom({
    roomCode,
    deviceId,
    runtimeMode: 'REAL',
    mockMode: 'MANUAL',
    realAuth: {
      token: creds?.token,
      email: creds?.email,
      password: creds?.password,
      apiBase: creds?.apiBase,
      wsBase: creds?.wsBase,
    },
  })
}

function submitTurnForCurrentPlayer(args: {
  roomCode: string
  input: TurnInput
}): {
  currentPlayerId: string
  turnScore: number
  isBust: boolean
  didCheckout: boolean
  finishedLegNumber: number | null
  finishedSetNumber: number | null
  matchFinished: boolean
} {
  const room = getRoom(args.roomCode)
  if (room.match.status !== 'LIVE') throw new GameRuleError('NOT_LIVE', 'Game is not live')
  if (room.match.players.length < 1) throw new GameRuleError('NO_PLAYERS', 'No players')

  const snap = computeMatchSnapshot(room.match)
  const currentIdx = snap.leg.currentPlayerIndex
  if (currentIdx < 0) throw new GameRuleError('LEG_FINISHED', 'Leg is finished')
  const currentPlayerId = snap.players[currentIdx].id

  const currentPlayerState = snap.leg.players.find((p) => p.playerId === currentPlayerId)
  if (!currentPlayerState) {
    throw new GameRuleError('INVALID_STATE', 'Current player state not found', { currentPlayerId })
  }

  // Validate against current player state before mutating server state
  const applied = applyX01Turn({
    remainingBefore: currentPlayerState.remaining,
    isInBefore: currentPlayerState.isIn,
    input: args.input,
    settings: room.match.settings,
  })

  // Lock settings on first accepted turn
  if (!room.match.lockedAt) room.match.lockedAt = Date.now()

  const turn: TurnRecord = {
    id: randomId(9),
    playerId: currentPlayerId,
    createdAt: Date.now(),
    input: args.input,
  }

  const leg = room.match.legs[room.match.currentLegIndex]
  leg.turns.push(turn)

  let finishedLegNumber: number | null = null
  let finishedSetNumber: number | null = null

  // Recompute to see if leg finished and advance
  const nextSnap = computeMatchSnapshot(room.match)
  const winnerId = nextSnap.leg.winnerPlayerId
  if (winnerId) {
    finishedLegNumber = leg.legNumber
    finishedSetNumber = leg.setNumber
    leg.winnerPlayerId = winnerId
    room.match.legsWonByPlayerId[winnerId] = (room.match.legsWonByPlayerId[winnerId] ?? 0) + 1

    if (!room.match.settings.setsEnabled) {
      room.match.legsWonInCurrentSetByPlayerId[winnerId] = (room.match.legsWonInCurrentSetByPlayerId[winnerId] ?? 0) + 1

      if (room.match.legsWonInCurrentSetByPlayerId[winnerId] >= room.match.settings.legsToWin) {
        room.match.status = 'FINISHED'
      }
    } else {
      room.match.legsWonInCurrentSetByPlayerId[winnerId] = (room.match.legsWonInCurrentSetByPlayerId[winnerId] ?? 0) + 1

      if (room.match.legsWonInCurrentSetByPlayerId[winnerId] >= room.match.settings.legsToWin) {
        room.match.setsWonByPlayerId[winnerId] = (room.match.setsWonByPlayerId[winnerId] ?? 0) + 1

        if (room.match.setsWonByPlayerId[winnerId] >= room.match.settings.setsToWin) {
          room.match.status = 'FINISHED'
        } else {
          room.match.currentSetNumber += 1
          for (const p of room.match.players) {
            room.match.legsWonInCurrentSetByPlayerId[p.id] = 0
          }
        }
      }
    }

    if (room.match.status !== 'FINISHED') {
      const nextLegNumber = leg.legNumber + 1
      const nextStartingPlayerIndex = (leg.startingPlayerIndex + 1) % room.match.players.length
      room.match.legs.push({
        setNumber: room.match.currentSetNumber,
        legNumber: nextLegNumber,
        startingPlayerIndex: nextStartingPlayerIndex,
        turns: [],
        winnerPlayerId: null,
      })
      room.match.currentLegIndex = room.match.legs.length - 1
    }
  }

  if (room.match.status === 'FINISHED' && !room.statsRecorded) {
    const statsByPlayerId = computePlayerStats(room.match)
    recordFinishedMatch({
      roomCode: args.roomCode,
      match: room.match,
      statsByPlayerId,
      playerUserIdByPlayerId: room.playerUserIdByPlayerId,
    })
    room.statsRecorded = true
  }

  syncRoomAutodartsBinding(args.roomCode)

  return {
    currentPlayerId,
    turnScore: applied.scoreTotal,
    isBust: applied.isBust,
    didCheckout: applied.didCheckout,
    finishedLegNumber,
    finishedSetNumber,
    matchFinished: room.match.status === 'FINISHED',
  }
}

function applyAutodartsDart(event: AutodartsDartEvent): {
  accepted: boolean
  bufferedDarts: Dart[]
  playerId: string | null
  ready: boolean
  reason: 'THREE_DARTS' | 'BUST' | 'CHECKOUT' | null
} {
  const room = getRoom(event.roomCode)
  if (room.match.status !== 'LIVE') return { accepted: false, bufferedDarts: [], playerId: null, ready: false, reason: null }
  if (room.match.players.length < 1) return { accepted: false, bufferedDarts: [], playerId: null, ready: false, reason: null }

  const snap = computeMatchSnapshot(room.match)
  const currentIdx = snap.leg.currentPlayerIndex
  if (currentIdx < 0) return { accepted: false, bufferedDarts: [], playerId: null, ready: false, reason: null }

  const currentPlayerId = snap.players[currentIdx].id
  const currentPlayerState = snap.leg.players.find((p) => p.playerId === currentPlayerId)
  if (!currentPlayerState) return { accepted: false, bufferedDarts: [], playerId: null, ready: false, reason: null }

  const pending = autodartsPendingTurnByRoomCode.get(event.roomCode)
  const shouldResetPending =
    !pending ||
    pending.playerId !== currentPlayerId ||
    pending.legIndex !== room.match.currentLegIndex ||
    pending.turnsInLeg !== snap.leg.turns.length

  const nextPending: PendingAutodartsTurn = shouldResetPending
    ? {
        playerId: currentPlayerId,
        legIndex: room.match.currentLegIndex,
        turnsInLeg: snap.leg.turns.length,
        darts: [],
        ready: false,
        reason: null,
      }
    : pending

  if (nextPending.ready) {
    autodartsPendingTurnByRoomCode.set(event.roomCode, nextPending)
    return {
      accepted: false,
      bufferedDarts: nextPending.darts,
      playerId: currentPlayerId,
      ready: true,
      reason: nextPending.reason,
    }
  }

  nextPending.darts.push(event.dart)

  const input: TurnInput = {
    mode: 'PER_DART',
    darts: nextPending.darts,
  }

  let applied
  try {
    applied = applyX01Turn({
      remainingBefore: currentPlayerState.remaining,
      isInBefore: currentPlayerState.isIn,
      input,
      settings: room.match.settings,
    })
  } catch {
    autodartsPendingTurnByRoomCode.delete(event.roomCode)
    return { accepted: false, bufferedDarts: [], playerId: currentPlayerId, ready: false, reason: null }
  }

  if (applied.isBust) {
    nextPending.ready = true
    nextPending.reason = 'BUST'
  } else if (applied.didCheckout) {
    nextPending.ready = true
    nextPending.reason = 'CHECKOUT'
  } else if (nextPending.darts.length >= 3) {
    nextPending.ready = true
    nextPending.reason = 'THREE_DARTS'
  }

  autodartsPendingTurnByRoomCode.set(event.roomCode, nextPending)
  return {
    accepted: true,
    bufferedDarts: nextPending.darts,
    playerId: currentPlayerId,
    ready: nextPending.ready,
    reason: nextPending.reason,
  }
}

autodarts.on('state', ({ roomCode }: { roomCode: string }) => {
  try {
    getRoom(roomCode)
    const state = autodarts.getRoomState(roomCode)
    if (state.status !== 'CONNECTED') {
      autodartsPendingTurnByRoomCode.delete(roomCode)
    }
    emitSnapshot(roomCode)
  } catch {
    autodartsPendingTurnByRoomCode.delete(roomCode)
    autodarts.unbindRoom(roomCode)
  }
})

autodarts.on('dart', (event: AutodartsDartEvent) => {
  try {
    getRoom(event.roomCode)

    const turnResult = applyAutodartsDart(event)
    if (turnResult.accepted) {
      io.to(roomChannel(event.roomCode)).emit('room:autodartsDart', event)
    } else if (turnResult.ready && turnResult.bufferedDarts.length > 0) {
      io.to(roomChannel(event.roomCode)).emit('room:autodartsDartIgnored', {
        roomCode: event.roomCode,
        playerId: turnResult.playerId,
        reason: 'WAITING_FOR_SUBMIT',
      })
    }

    if (turnResult.bufferedDarts.length > 0) {
      io.to(roomChannel(event.roomCode)).emit('room:autodartsTurnBuffer', {
        playerId: turnResult.playerId,
        darts: turnResult.bufferedDarts,
        ready: turnResult.ready,
        reason: turnResult.reason,
      })
    }

    emitSnapshot(event.roomCode)
  } catch {
    autodartsPendingTurnByRoomCode.delete(event.roomCode)
    autodarts.unbindRoom(event.roomCode)
  }
})

function ensurePlayer(roomCode: string, displayName: string, controllerSocketId?: string, userId?: string) {
  const room = getRoom(roomCode)
  if (room.match.status !== 'LOBBY') return
  if (room.match.lockedAt || totalTurnsInMatch(room.match) > 0) return

  const name = displayName.trim()
  if (!name) return

  const exists = room.match.players.some((p) => p.name.toLowerCase() === name.toLowerCase())

  if (!exists) {
    const p = addPlayer(room, name)
    if (controllerSocketId) room.controllerSocketIdByPlayerId[p.id] = controllerSocketId
    if (userId) room.playerUserIdByPlayerId[p.id] = userId
    return p
  }

  const existing = room.match.players.find((p) => p.name.toLowerCase() === name.toLowerCase())
  if (existing && controllerSocketId) room.controllerSocketIdByPlayerId[existing.id] = controllerSocketId
  if (existing && userId && !room.playerUserIdByPlayerId[existing.id]) room.playerUserIdByPlayerId[existing.id] = userId
  return existing
}

function getPlayerByName(roomCode: string, displayName: string) {
  const room = getRoom(roomCode)
  const name = displayName.trim().toLowerCase()
  return room.match.players.find((p) => p.name.toLowerCase() === name) ?? null
}

function clearControllersForSocket(roomCode: string, socketId: string) {
  const room = getRoom(roomCode)
  for (const [playerId, controller] of Object.entries(room.controllerSocketIdByPlayerId)) {
    if (controller === socketId) delete room.controllerSocketIdByPlayerId[playerId]
  }
}

function removePlayerByName(roomCode: string, displayName: string): void {
  const room = getRoom(roomCode)
  if (room.match.status !== 'LOBBY') throw new GameRuleError('ROLE_LOCKED', 'Cannot change role after game start')
  if (room.match.lockedAt || totalTurnsInMatch(room.match) > 0) {
    throw new GameRuleError('ROLE_LOCKED', 'Cannot change role after the first recorded turn')
  }

  const name = displayName.trim()
  if (!name) return

  const idx = room.match.players.findIndex((p) => p.name.toLowerCase() === name.toLowerCase())
  if (idx < 0) return
  const removed = room.match.players.splice(idx, 1)[0]
  delete room.match.legsWonByPlayerId[removed.id]
  delete room.match.legsWonInCurrentSetByPlayerId[removed.id]
  delete room.match.setsWonByPlayerId[removed.id]
  delete room.playerUserIdByPlayerId[removed.id]

  // Re-index order
  room.match.players = room.match.players.map((p, i) => ({ ...p, orderIndex: i }))

  // Keep starting player index in range
  const leg = room.match.legs[room.match.currentLegIndex]
  if (leg) {
    if (room.match.players.length === 0) leg.startingPlayerIndex = 0
    else if (leg.startingPlayerIndex >= room.match.players.length) leg.startingPlayerIndex = 0
  }
}

function toTurnInput(args: { settings: X01Settings; total?: number; darts?: Dart[] }): TurnInput {
  if (typeof args.total === 'number') {
    return args.darts ? { mode: 'TOTAL', total: args.total, darts: args.darts } : { mode: 'TOTAL', total: args.total }
  }
  if (args.darts) {
    return { mode: 'PER_DART', darts: args.darts }
  }
  throw new GameRuleError('NEED_TOTAL_OR_DARTS', 'Provide either total or darts')
}

io.on('connection', (socket) => {
  function detachFromRoom(code: string) {
    try {
      const room = getRoom(code)
      clearControllersForSocket(code, socket.id)
      removeClient(room, socket.id)
      socket.leave(roomChannel(code))
      // Room deletion is delayed (to allow refresh/rejoin)
      if (!isRoomEmpty(room)) emitSnapshot(code)
      else {
        autodartsPendingTurnByRoomCode.delete(code)
        room.autodartsBoundUserId = null
        autodarts.unbindRoom(code)
      }
    } catch {
      // ignore
    }
  }

  function leaveCurrentRoomIfAny(nextCode?: string) {
    const existing = (socket.data as any).roomCode as string | undefined
    if (!existing) return
    if (nextCode && existing === nextCode) return
    detachFromRoom(existing)
    delete (socket.data as any).roomCode
  }

  function currentRoomCode(): string {
    const code = (socket.data as any).roomCode as string | undefined
    if (code) return code
    const fromRooms = [...socket.rooms].find((r) => r.startsWith('room:'))?.slice(5)
    if (fromRooms) return fromRooms
    throw new GameRuleError('NOT_IN_ROOM', 'Join a room first')
  }

  function resolveAuthIdentity(token?: string): { userId: string; displayName: string } | undefined {
    if (!token) return undefined
    const user = getUserBySessionToken(token)
    if (!user) throw new GameRuleError('AUTH_INVALID', 'Authentication token is invalid or expired')
    return { userId: user.id, displayName: user.displayName }
  }

  socket.on('room:create', (raw, cb) => {
    try {
      const { name, authToken, settings, title, isPublic } = createSchema.parse(raw)
      validateX01Settings(settings)
      const auth = resolveAuthIdentity(authToken)
      const userId = auth?.userId
      const effectiveName = auth?.displayName ?? name

      leaveCurrentRoomIfAny()

      const room = createRoom({ hostName: effectiveName, settings })
      room.title = (title ?? '').trim()
      room.isPublic = Boolean(isPublic)
      addClient(room, { socketId: socket.id, name: effectiveName, userId, isHost: true, role: 'PLAYER' })
      ;(socket.data as any).userId = userId

      // By default, the host is also a player in the lobby.
      const hostPlayer = ensurePlayer(room.code, effectiveName, socket.id, userId)

      socket.join(roomChannel(room.code))
      ;(socket.data as any).roomCode = room.code
      cb?.({ ok: true, code: room.code, hostSecret: room.hostSecret, role: 'PLAYER', playerId: hostPlayer?.id })
      emitSnapshot(room.code)
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid request')
      cb?.({ ok: false, code: e.code, message: e.message, details: (e as any).details })
    }
  })

  socket.on('rooms:listPublic', async (_raw, cb) => {
    try {
      cb?.({ ok: true, rooms: listPublicRooms() })
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid request')
      cb?.({ ok: false, code: e.code, message: e.message })
    }
  })

  socket.on('room:leave', async (_raw, cb) => {
    try {
      const code = (socket.data as any).roomCode as string | undefined
      if (!code) throw new GameRuleError('NOT_IN_ROOM', 'Not in a room')
      detachFromRoom(code)
      delete (socket.data as any).roomCode
      cb?.({ ok: true })
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid request')
      cb?.({ ok: false, code: e.code, message: e.message })
    }
  })

  socket.on('lobby:updateRoomMeta', (raw, cb) => {
    try {
      const { hostSecret, title, isPublic } = updateRoomMetaSchema.parse(raw)
      const code = [...socket.rooms].find((r) => r.startsWith('room:'))?.slice(5)
      if (!code) throw new GameRuleError('NOT_IN_ROOM', 'Join a room first')
      const room = getRoom(code)
      assertHost(room, hostSecret)
      if (room.match.status !== 'LOBBY') throw new GameRuleError('NOT_IN_LOBBY', 'Game already started')
      if (room.match.lockedAt || totalTurnsInMatch(room.match) > 0) {
        throw new GameRuleError('ROOM_META_LOCKED', 'Room visibility is locked after the first recorded turn')
      }

      if (typeof title === 'string') room.title = title.trim()
      if (typeof isPublic === 'boolean') room.isPublic = isPublic

      cb?.({ ok: true })
      emitSnapshot(code)
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid request')
      cb?.({ ok: false, code: e.code, message: e.message, details: (e as any).details })
    }
  })

  socket.on('lobby:autodartsBindDevice', (raw, cb) => {
    try {
      if (!allowMockBinding) throw new GameRuleError('AUTODARTS_MOCK_DISABLED', 'Mock autodarts binding is disabled')
      const { hostSecret, deviceId, mockMode } = autodartsBindSchema.parse(raw)
      const code = currentRoomCode()
      const room = getRoom(code)
      assertHost(room, hostSecret)

      room.autodartsBoundUserId = null
      const state = autodarts.bindRoom({ roomCode: code, deviceId, runtimeMode: 'MOCK', mockMode })
      cb?.({ ok: true, state })
      emitSnapshot(code)
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid request')
      cb?.({ ok: false, code: e.code, message: e.message, details: (e as any).details })
    }
  })

  socket.on('lobby:autodartsUnbindDevice', (raw, cb) => {
    try {
      if (!allowMockBinding) throw new GameRuleError('AUTODARTS_MOCK_DISABLED', 'Mock autodarts binding is disabled')
      const { hostSecret } = autodartsUnbindSchema.parse(raw)
      const code = currentRoomCode()
      const room = getRoom(code)
      assertHost(room, hostSecret)

      room.autodartsBoundUserId = null
      autodarts.unbindRoom(code)
      cb?.({ ok: true, state: autodarts.getRoomState(code) })
      emitSnapshot(code)
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid request')
      cb?.({ ok: false, code: e.code, message: e.message, details: (e as any).details })
    }
  })

  socket.on('room:join', (raw, cb) => {
    try {
      const { code, name, hostSecret, authToken, asSpectator } = joinSchema.parse(raw)
      if (!code) throw new GameRuleError('NEED_CODE', 'Room code is required')
      const auth = resolveAuthIdentity(authToken)
      const userId = auth?.userId
      const effectiveName = auth?.displayName ?? name

      leaveCurrentRoomIfAny(code)

      const room = getRoom(code)

      const normalized = effectiveName.trim().toLowerCase()
      const isExistingPlayerName = room.match.players.some((p) => p.name.toLowerCase() === normalized)
      const gameStarted = room.match.status !== 'LOBBY'

      const role: 'PLAYER' | 'SPECTATOR' =
        isExistingPlayerName ? 'PLAYER' : gameStarted ? 'SPECTATOR' : asSpectator ? 'SPECTATOR' : 'PLAYER'

      addClient(room, {
        socketId: socket.id,
        name: effectiveName,
        userId,
        isHost: hostSecret === room.hostSecret,
        role,
      })
      ;(socket.data as any).userId = userId

      let playerId: string | undefined
      if (role === 'PLAYER') {
        if (room.match.status === 'LOBBY') {
          const p = ensurePlayer(code, effectiveName, socket.id, userId)
          playerId = p?.id
        } else {
          const p = getPlayerByName(code, effectiveName)
          if (p) {
            room.controllerSocketIdByPlayerId[p.id] = socket.id
            if (userId) room.playerUserIdByPlayerId[p.id] = userId
            playerId = p.id
          }
        }
      }

      socket.join(roomChannel(code))
      ;(socket.data as any).roomCode = code

      if (gameStarted && role === 'SPECTATOR' && !asSpectator) {
        socket.emit('room:toast', { message: 'Game already started: joined as spectator.' })
      }

      cb?.({ ok: true, role, playerId })
      if (gameStarted && role === 'PLAYER') {
        syncRoomAutodartsBinding(code)
      }
      emitSnapshot(code)
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid request')
      cb?.({ ok: false, code: e.code, message: e.message, details: (e as any).details })
    }
  })

  socket.on('lobby:becomePlayer', async (_raw, cb) => {
    try {
      const code = [...socket.rooms].find((r) => r.startsWith('room:'))?.slice(5)
      if (!code) throw new GameRuleError('NOT_IN_ROOM', 'Join a room first')
      const room = getRoom(code)
      const client = getClient(room, socket.id)
      if (!client) throw new GameRuleError('NOT_IN_ROOM', 'Join a room first')
      client.role = 'PLAYER'
      const p = ensurePlayer(code, client.name, socket.id, client.userId)
      cb?.({ ok: true })
      emitSnapshot(code)
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid request')
      cb?.({ ok: false, code: e.code, message: e.message, details: (e as any).details })
    }
  })

  socket.on('lobby:addLocalPlayer', async (raw, cb) => {
    try {
      const schema = z.object({ name: z.string().trim().min(1).max(32) })
      const { name } = schema.parse(raw)
      const code = currentRoomCode()
      const room = getRoom(code)
      if (room.match.status !== 'LOBBY') throw new GameRuleError('NOT_IN_LOBBY', 'Game already started')
      if (room.match.lockedAt || totalTurnsInMatch(room.match) > 0) {
        throw new GameRuleError('SETTINGS_LOCKED', 'Game is locked after the first recorded turn')
      }
      const player = addPlayer(room, name)
      room.controllerSocketIdByPlayerId[player.id] = socket.id
      cb?.({ ok: true, player })
      emitSnapshot(code)
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid request')
      cb?.({ ok: false, code: e.code, message: e.message, details: (e as any).details })
    }
  })

  socket.on('lobby:becomeSpectator', async (_raw, cb) => {
    try {
      const code = [...socket.rooms].find((r) => r.startsWith('room:'))?.slice(5)
      if (!code) throw new GameRuleError('NOT_IN_ROOM', 'Join a room first')
      const room = getRoom(code)
      const client = getClient(room, socket.id)
      if (!client) throw new GameRuleError('NOT_IN_ROOM', 'Join a room first')

      removePlayerByName(code, client.name)
      client.role = 'SPECTATOR'
      cb?.({ ok: true })
      emitSnapshot(code)
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid request')
      cb?.({ ok: false, code: e.code, message: e.message, details: (e as any).details })
    }
  })

  socket.on('lobby:addPlayer', (raw, cb) => {
    try {
      const { hostSecret, name } = addPlayerSchema.parse(raw)
      const code = currentRoomCode()

      const room = getRoom(code)
      assertHost(room, hostSecret)
      if (room.match.status !== 'LOBBY') throw new GameRuleError('NOT_IN_LOBBY', 'Game already started')

      const player = addPlayer(room, name)
      // Host that adds the player controls it until that player joins.
      room.controllerSocketIdByPlayerId[player.id] = socket.id
      cb?.({ ok: true, player })
      emitSnapshot(code)
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid request')
      cb?.({ ok: false, code: e.code, message: e.message, details: (e as any).details })
    }
  })

  socket.on('lobby:reorderPlayers', (raw, cb) => {
    try {
      const { hostSecret, playerIdsInOrder } = reorderSchema.parse(raw)
      const code = currentRoomCode()

      const room = getRoom(code)
      assertHost(room, hostSecret)
      if (room.match.status !== 'LOBBY') throw new GameRuleError('NOT_IN_LOBBY', 'Game already started')
      reorderPlayers(room, playerIdsInOrder)
      cb?.({ ok: true })
      emitSnapshot(code)
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid request')
      cb?.({ ok: false, code: e.code, message: e.message, details: (e as any).details })
    }
  })

  socket.on('lobby:updateSettings', (raw, cb) => {
    try {
      const { hostSecret, settings } = updateSettingsSchema.parse(raw)
      validateX01Settings(settings)
      const code = currentRoomCode()

      const room = getRoom(code)
      assertHost(room, hostSecret)
      if (totalTurnsInMatch(room.match) > 0 || room.match.lockedAt) {
        throw new GameRuleError('SETTINGS_LOCKED', 'Settings are locked after the first recorded turn')
      }
      room.match.settings = settings
      cb?.({ ok: true })
      emitSnapshot(code)
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid request')
      cb?.({ ok: false, code: e.code, message: e.message, details: (e as any).details })
    }
  })

  socket.on('lobby:startGame', (raw, cb) => {
    try {
      const { hostSecret, startingPlayerIndex } = startSchema.parse(raw)
      const code = currentRoomCode()

      const room = getRoom(code)
      assertHost(room, hostSecret)
      if (room.match.status !== 'LOBBY') throw new GameRuleError('ALREADY_STARTED', 'Game already started')
      if (room.match.players.length < 1) throw new GameRuleError('NO_PLAYERS', 'Add at least one player')

      const maxIndex = room.match.players.length - 1
      if (startingPlayerIndex > maxIndex) {
        throw new GameRuleError('INVALID_STARTER', 'Invalid starting player index', {
          startingPlayerIndex,
          maxIndex,
        })
      }

      room.match.status = 'LIVE'
      room.match.legs[0].startingPlayerIndex = startingPlayerIndex
      autodartsPendingTurnByRoomCode.delete(code)
      syncRoomAutodartsBinding(code)

      cb?.({ ok: true })
      emitSnapshot(code)
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid request')
      cb?.({ ok: false, code: e.code, message: e.message, details: (e as any).details })
    }
  })

  socket.on('game:submitTurn', (raw, cb) => {
    try {
      const { total, darts } = submitTurnSchema.parse(raw)
      const code = currentRoomCode()

      const room = getRoom(code)
      const snap = computeMatchSnapshot(room.match)
      const currentIdx = snap.leg.currentPlayerIndex
      if (currentIdx < 0) throw new GameRuleError('LEG_FINISHED', 'Leg is finished')
      const currentPlayerId = snap.players[currentIdx].id

      const controller = room.controllerSocketIdByPlayerId[currentPlayerId]
      if (controller !== socket.id) {
        throw new GameRuleError('NOT_YOUR_TURN', 'You can only submit scores for players you control', {
          currentPlayerId,
        })
      }

      const autodartsState = autodarts.getRoomState(code)
      if (autodartsState.status === 'CONNECTED' && typeof total === 'number') {
        throw new GameRuleError(
          'AUTODARTS_PER_DART_ONLY',
          'Autodarts is connected: submit per-dart turns only (review/correct then submit)',
        )
      }

      const input = toTurnInput({ settings: room.match.settings, total, darts })

      const turnResult = submitTurnForCurrentPlayer({ roomCode: code, input })
      autodartsPendingTurnByRoomCode.delete(code)
      syncRoomAutodartsBinding(code)

      const playerName = room.match.players.find((p) => p.id === turnResult.currentPlayerId)?.name ?? null
      io.to(roomChannel(code)).emit('room:turnAccepted', {
        playerId: turnResult.currentPlayerId,
        playerName,
        score: turnResult.turnScore,
        isBust: turnResult.isBust,
        didCheckout: turnResult.didCheckout,
        finishedLegNumber: turnResult.finishedLegNumber,
        finishedSetNumber: turnResult.finishedSetNumber,
        matchFinished: turnResult.matchFinished,
      })

      cb?.({ ok: true })
      emitSnapshot(code)
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid turn')
      cb?.({ ok: false, code: e.code, message: e.message, details: (e as any).details })
    }
  })

  socket.on('game:autodartsMockDart', (raw, cb) => {
    try {
      if (!allowMockDartInput) throw new GameRuleError('AUTODARTS_MOCK_DISABLED', 'Mock autodarts darts are disabled')
      const dart = autodartsMockDartSchema.parse(raw)
      const code = currentRoomCode()
      const room = getRoom(code)
      if (room.match.status !== 'LIVE') throw new GameRuleError('NOT_LIVE', 'Game is not live')
      const client = getClient(room, socket.id)
      if (!client?.isHost) throw new GameRuleError('NOT_HOST', 'Host privileges required')

      const state = autodarts.getRoomState(code)
      if (state.runtimeMode !== 'MOCK') {
        throw new GameRuleError('AUTODARTS_MOCK_DISABLED', 'Room is not currently bound in mock mode')
      }

      const event = autodarts.emitMockDart(code, dart, 'MOCK_MANUAL')
      cb?.({ ok: true, event })
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid request')
      cb?.({ ok: false, code: e.code, message: e.message, details: (e as any).details })
    }
  })

  socket.on('game:autodartsClearPending', (_raw, cb) => {
    try {
      const code = currentRoomCode()
      const room = getRoom(code)
      if (room.match.status !== 'LIVE') throw new GameRuleError('NOT_LIVE', 'Game is not live')

      const pending = autodartsPendingTurnByRoomCode.get(code)
      if (!pending) {
        cb?.({ ok: true })
        return
      }

      const client = getClient(room, socket.id)
      if (!client) throw new GameRuleError('NOT_IN_ROOM', 'Join a room first')

      const controller = room.controllerSocketIdByPlayerId[pending.playerId]
      if (!client.isHost && controller !== socket.id) {
        throw new GameRuleError('NOT_ALLOWED', 'Only host or controlling player can clear autodarts input')
      }

      autodartsPendingTurnByRoomCode.delete(code)
      io.to(roomChannel(code)).emit('room:autodartsTurnCleared', {
        playerId: pending.playerId,
        by: client.name,
      })

      cb?.({ ok: true })
      emitSnapshot(code)
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid request')
      cb?.({ ok: false, code: e.code, message: e.message, details: (e as any).details })
    }
  })

  socket.on('game:undoLastTurn', (raw, cb) => {
    try {
      const { hostSecret } = undoSchema.parse(raw)
      const code = currentRoomCode()

      const room = getRoom(code)
      assertHost(room, hostSecret)

      // Find last turn in current leg, or previous leg.
      let leg = room.match.legs[room.match.currentLegIndex]
      if (!leg) throw new GameRuleError('INVALID_STATE', 'No leg')

      if (leg.turns.length === 0 && room.match.currentLegIndex > 0) {
        // Move back a leg
        room.match.currentLegIndex -= 1
        leg = room.match.legs[room.match.currentLegIndex]
        leg.winnerPlayerId = null
      }

      const popped = leg.turns.pop()
      if (!popped) throw new GameRuleError('NOTHING_TO_UNDO', 'No turns to undo')

      // If we undid the first ever turn, unlock settings
      if (totalTurnsInMatch(room.match) === 0) {
        room.match.lockedAt = null
        if (room.match.status === 'LIVE') room.match.status = 'LOBBY'
      }

      autodartsPendingTurnByRoomCode.delete(code)

      cb?.({ ok: true })
      emitSnapshot(code)
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid request')
      cb?.({ ok: false, code: e.code, message: e.message, details: (e as any).details })
    }
  })

  socket.on('disconnect', () => {
    const code = (socket.data as any).roomCode as string | undefined
    if (!code) return
    detachFromRoom(code)
  })
})

async function startNext() {
  if (!enableNext) return
  const dir = path.join(process.cwd(), 'web')
  const nextApp = next({ dev: !isProd, dir })
  const handle = nextApp.getRequestHandler()

  await nextApp.prepare()

  // Let Next handle everything else (after our explicit routes and socket upgrade)
  // Express v5's path-to-regexp does not accept bare "*".
  app.use((req, res) => handle(req, res))
}

async function main() {
  await startNext()
  server.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`server listening on :${port}`)
  })
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('Server failed to start', err)
  process.exitCode = 1
})
