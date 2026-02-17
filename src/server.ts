import cors from 'cors'
import express from 'express'
import http from 'http'
import next from 'next'
import path from 'path'
import { randomBytes } from 'crypto'
import { Server } from 'socket.io'
import { z } from 'zod'
import { GameRuleError } from './game/errors'
import type { Dart, TurnInput, TurnRecord, X01Settings } from './game/types'
import { applyX01Turn, computeMatchSnapshot, totalTurnsInMatch, validateX01Settings } from './game/x01'
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

const app = express()
app.use(cors())

app.get('/healthz', (_req, res) => {
  res.status(200).json({ ok: true })
})

app.get('/api/status', (_req, res) => {
  res.status(200).json({ ok: true, service: 'dartcounter' })
})

const server = http.createServer(app)
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST'],
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
  asSpectator: z.boolean().optional(),
})

const createSchema = z.object({
  name: z.string().trim().min(1).max(32),
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

function roomChannel(code: string): string {
  return `room:${code}`
}

function emitSnapshot(code: string) {
  const room = getRoom(code)
  io.to(roomChannel(code)).emit('room:snapshot', {
    code: room.code,
    room: {
      title: room.title,
      isPublic: room.isPublic,
      createdAt: room.createdAt,
    },
    clients: [...room.clients.values()].map((c) => ({
      socketId: c.socketId,
      name: c.name,
      isHost: c.isHost,
      role: c.role,
    })),
    match: computeMatchSnapshot(room.match),
  })
}

function ensurePlayerExists(roomCode: string, displayName: string): void {
  const room = getRoom(roomCode)
  if (room.match.status !== 'LOBBY') return
  if (room.match.lockedAt || totalTurnsInMatch(room.match) > 0) return

  const name = displayName.trim()
  if (!name) return

  const exists = room.match.players.some((p) => p.name.toLowerCase() === name.toLowerCase())
  if (!exists) addPlayer(room, name)
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
  socket.on('room:create', (raw, cb) => {
    try {
      const { name, settings, title, isPublic } = createSchema.parse(raw)
      validateX01Settings(settings)

      const room = createRoom({ hostName: name, settings })
      room.title = (title ?? '').trim()
      room.isPublic = Boolean(isPublic)
      addClient(room, { socketId: socket.id, name, isHost: true, role: 'PLAYER' })

      // By default, the host is also a player in the lobby.
      ensurePlayerExists(room.code, name)

      socket.join(roomChannel(room.code))
      cb?.({ ok: true, code: room.code, hostSecret: room.hostSecret })
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

  socket.on('room:join', (raw, cb) => {
    try {
      const { code, name, hostSecret, asSpectator } = joinSchema.parse(raw)
      if (!code) throw new GameRuleError('NEED_CODE', 'Room code is required')

      const room = getRoom(code)
      addClient(room, {
        socketId: socket.id,
        name,
        isHost: hostSecret === room.hostSecret,
        role: asSpectator ? 'SPECTATOR' : 'PLAYER',
      })

      // By default, anyone joining in the lobby is added as a player.
      if (!asSpectator) ensurePlayerExists(code, name)

      socket.join(roomChannel(code))
      cb?.({ ok: true })
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
      ensurePlayerExists(code, client.name)
      cb?.({ ok: true })
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
      const code = [...socket.rooms].find((r) => r.startsWith('room:'))?.slice(5)
      if (!code) throw new GameRuleError('NOT_IN_ROOM', 'Join a room first')

      const room = getRoom(code)
      assertHost(room, hostSecret)
      if (room.match.status !== 'LOBBY') throw new GameRuleError('NOT_IN_LOBBY', 'Game already started')

      addPlayer(room, name)
      cb?.({ ok: true })
      emitSnapshot(code)
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid request')
      cb?.({ ok: false, code: e.code, message: e.message, details: (e as any).details })
    }
  })

  socket.on('lobby:reorderPlayers', (raw, cb) => {
    try {
      const { hostSecret, playerIdsInOrder } = reorderSchema.parse(raw)
      const code = [...socket.rooms].find((r) => r.startsWith('room:'))?.slice(5)
      if (!code) throw new GameRuleError('NOT_IN_ROOM', 'Join a room first')

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
      const code = [...socket.rooms].find((r) => r.startsWith('room:'))?.slice(5)
      if (!code) throw new GameRuleError('NOT_IN_ROOM', 'Join a room first')

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
      const code = [...socket.rooms].find((r) => r.startsWith('room:'))?.slice(5)
      if (!code) throw new GameRuleError('NOT_IN_ROOM', 'Join a room first')

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
      const code = [...socket.rooms].find((r) => r.startsWith('room:'))?.slice(5)
      if (!code) throw new GameRuleError('NOT_IN_ROOM', 'Join a room first')

      const room = getRoom(code)
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

      const input = toTurnInput({ settings: room.match.settings, total, darts })

      // Validate against current player state before mutating server state
      applyX01Turn({
        remainingBefore: currentPlayerState.remaining,
        isInBefore: currentPlayerState.isIn,
        input,
        settings: room.match.settings,
      })

      // Lock settings on first accepted turn
      if (!room.match.lockedAt) room.match.lockedAt = Date.now()

      const turn: TurnRecord = {
        id: randomId(9),
        playerId: currentPlayerId,
        createdAt: Date.now(),
        input,
      }

      const leg = room.match.legs[room.match.currentLegIndex]
      leg.turns.push(turn)

      // Recompute to see if leg finished and advance
      const nextSnap = computeMatchSnapshot(room.match)
      const winnerId = nextSnap.leg.winnerPlayerId
      if (winnerId) {
        leg.winnerPlayerId = winnerId
        room.match.legsWonByPlayerId[winnerId] = (room.match.legsWonByPlayerId[winnerId] ?? 0) + 1

        if (room.match.legsWonByPlayerId[winnerId] >= room.match.settings.legsToWin) {
          room.match.status = 'FINISHED'
        } else {
          const nextLegNumber = leg.legNumber + 1
          const nextStartingPlayerIndex = (leg.startingPlayerIndex + 1) % room.match.players.length
          room.match.legs.push({
            legNumber: nextLegNumber,
            startingPlayerIndex: nextStartingPlayerIndex,
            turns: [],
            winnerPlayerId: null,
          })
          room.match.currentLegIndex = room.match.legs.length - 1
        }
      }

      cb?.({ ok: true })
      emitSnapshot(code)
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid turn')
      cb?.({ ok: false, code: e.code, message: e.message, details: (e as any).details })
    }
  })

  socket.on('game:undoLastTurn', (raw, cb) => {
    try {
      const { hostSecret } = undoSchema.parse(raw)
      const code = [...socket.rooms].find((r) => r.startsWith('room:'))?.slice(5)
      if (!code) throw new GameRuleError('NOT_IN_ROOM', 'Join a room first')

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

      cb?.({ ok: true })
      emitSnapshot(code)
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid request')
      cb?.({ ok: false, code: e.code, message: e.message, details: (e as any).details })
    }
  })

  socket.on('disconnect', () => {
    for (const roomName of socket.rooms) {
      if (!roomName.startsWith('room:')) continue
      const code = roomName.slice(5)
      try {
        const room = getRoom(code)
        removeClient(room, socket.id)
        if (isRoomEmpty(room)) deleteRoom(code)
        else emitSnapshot(code)
      } catch {
        // ignore
      }
    }
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
