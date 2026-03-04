import cors from 'cors'
import express from 'express'
import http from 'http'
import next from 'next'
import path from 'path'
import { randomBytes } from 'crypto'
import { Server, type Socket } from 'socket.io'
import { z } from 'zod'
import { ZodError } from 'zod'
import {
  areFriends,
  authenticateUser,
  blockUser,
  createSession,
  getUserById,
  getUserAutodartsCredentials,
  getUserBySessionToken,
  listFriendState,
  removeFriend,
  registerUser,
  respondToFriendRequest,
  revokeSession,
  sendFriendRequest,
  setUserAutodartsCredentials,
  setUserAutodartsDevice,
} from './auth/store'
import { getGlobalRecords, getUserStats, recordFinishedMatch } from './auth/stats'
import {
  getDailyCheckoutTarget,
  getDailyCheckoutView,
  getDailyCheckoutStartKey,
  getMinimumCheckoutDarts,
  listDailyCheckoutArchive,
  submitDailyCheckout,
} from './daily-checkout/store'
import {
  addLocalTournamentPlayer,
  attachRoomToMatchByParticipant,
  autoReportWinnerByRoom,
  assignMatchRoom,
  closeTournament,
  createTournament,
  getTournament,
  getTournamentMatchForRoomCode,
  getTournamentMatchParticipants,
  joinTournament,
  listDueTournamentNoShowChecks,
  leaveTournament,
  listPendingTournamentInvitesForUser,
  listTournaments,
  reportMatchWinner,
  respondTournamentInvite,
  resolveTournamentNoShow,
  sendTournamentInvite,
  setMatchReady,
  setTournamentSeeding,
  startTournament,
} from './tournaments/store'
import { GameRuleError } from './game/errors'
import type { AroundSettings, Dart, GameSettings, PracticeSettings, TurnInput, TurnRecord, X01Settings } from './game/types'
import { computeAroundLegSnapshot, validateAroundSettings } from './game/around'
import { applyPracticeTurn, computePracticeLegSnapshot, validatePracticeSettings } from './game/practice'
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

function parseEnvSet(value?: string): Set<string> {
  if (!value) return new Set()
  return new Set(
    value
      .split(',')
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => x.toLowerCase()),
  )
}

const adminUserIds = parseEnvSet(process.env.ADMIN_USER_IDS)
const adminEmails = parseEnvSet(process.env.ADMIN_EMAILS)

function isAdminUser(user: { id: string; email?: string | null } | null | undefined): boolean {
  if (!user) return false
  if (adminUserIds.has(user.id.toLowerCase())) return true
  const email = (user.email ?? '').toLowerCase()
  if (email && adminEmails.has(email)) return true
  return false
}

function withNamesForGlobalMode(mode: {
  allTime: {
    mostWins: { userId: string; value: number } | null
    highestCheckout: { userId: string; value: number } | null
    highestScore: { userId: string; value: number } | null
    bestThreeDartAverage: { userId: string; value: number } | null
  }
  lastTen: {
    mostWins: { userId: string; value: number } | null
    highestCheckout: { userId: string; value: number } | null
    highestScore: { userId: string; value: number } | null
    bestThreeDartAverage: { userId: string; value: number } | null
  }
}) {
  const withName = (record: { userId: string; value: number } | null) =>
    record
      ? {
          ...record,
          displayName: getUserById(record.userId)?.displayName ?? null,
        }
      : null

  return {
    allTime: {
      mostWins: withName(mode.allTime.mostWins),
      highestCheckout: withName(mode.allTime.highestCheckout),
      highestScore: withName(mode.allTime.highestScore),
      bestThreeDartAverage: withName(mode.allTime.bestThreeDartAverage),
    },
    lastTen: {
      mostWins: withName(mode.lastTen.mostWins),
      highestCheckout: withName(mode.lastTen.highestCheckout),
      highestScore: withName(mode.lastTen.highestScore),
      bestThreeDartAverage: withName(mode.lastTen.bestThreeDartAverage),
    },
  }
}

function requireAuthedUser(req: express.Request): ReturnType<typeof getUserBySessionToken> {
  const token = bearerTokenFromReq(req)
  const user = getUserBySessionToken(token)
  if (user) lastSeenByUserId.set(user.id, Date.now())
  return user
}

const app = express()
app.use(cors())
app.use(express.json())

const onlineSocketsByUserId = new Map<string, Set<string>>()
const lastSeenByUserId = new Map<string, number>()
const dailyCheckoutSubmitThrottle = new Map<string, number>()

function isUserOnline(userId: string): boolean {
  const sockets = onlineSocketsByUserId.get(userId)
  if (sockets && sockets.size > 0) return true
  const lastSeen = lastSeenByUserId.get(userId) ?? 0
  return Date.now() - lastSeen <= 45_000
}

function addOnlineSocket(userId: string, socketId: string): void {
  const next = onlineSocketsByUserId.get(userId) ?? new Set<string>()
  next.add(socketId)
  onlineSocketsByUserId.set(userId, next)
  lastSeenByUserId.set(userId, Date.now())
}

function removeOnlineSocket(userId: string, socketId: string): void {
  const next = onlineSocketsByUserId.get(userId)
  if (!next) return
  next.delete(socketId)
  if (next.size === 0) onlineSocketsByUserId.delete(userId)
}

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

const friendRequestSchema = z.object({
  identity: z.string().trim().min(1).max(160),
})

const friendRespondSchema = z.object({
  friendUserId: z.string().trim().min(1).max(128),
  accept: z.boolean(),
})

const friendRemoveSchema = z.object({
  friendUserId: z.string().trim().min(1).max(128),
})

const friendBlockSchema = z.object({
  friendUserId: z.string().trim().min(1).max(128),
})

const tournamentCreateSchema = z.object({
  name: z.string().trim().min(1).max(64),
  maxPlayers: z.number().int().min(2).max(128).optional(),
  participationMode: z.union([z.literal('ONLINE'), z.literal('LOCAL')]).optional(),
  settings: z.any(),
})

const tournamentIdSchema = z.object({
  tournamentId: z.string().trim().min(1).max(128),
})

const tournamentAssignRoomSchema = z.object({
  tournamentId: z.string().trim().min(1).max(128),
  matchId: z.string().trim().min(1).max(128),
  roomCode: z.string().trim().min(1).max(16),
})

const tournamentReportWinnerSchema = z.object({
  tournamentId: z.string().trim().min(1).max(128),
  matchId: z.string().trim().min(1).max(128),
  winnerUserId: z.string().trim().min(1).max(128),
})

const tournamentMatchReadySchema = z.object({
  tournamentId: z.string().trim().min(1).max(128),
  matchId: z.string().trim().min(1).max(128),
  ready: z.boolean().optional(),
})

const tournamentSeedingSchema = z.object({
  tournamentId: z.string().trim().min(1).max(128),
  mode: z.union([z.literal('JOIN_ORDER'), z.literal('RANDOM'), z.literal('MANUAL')]),
  manualSeedUserIds: z.array(z.string().trim().min(1).max(128)).optional(),
})

const tournamentInviteSendSchema = z.object({
  tournamentId: z.string().trim().min(1).max(128),
  toUserId: z.string().trim().min(1).max(128),
})

const tournamentInviteRespondSchema = z.object({
  inviteId: z.string().trim().min(1).max(128),
  accept: z.boolean(),
})

const tournamentAddPlayerSchema = z.object({
  tournamentId: z.string().trim().min(1).max(128),
  displayName: z.string().trim().min(1).max(32),
})

const dailyCheckoutSubmitSchema = z.object({
  dartsUsed: z.number().int().min(1).max(501),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
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
  res.status(200).json({ ok: true, user, isAdmin: isAdminUser(user) })
})

app.get('/api/friends/me', (req, res) => {
  const user = requireAuthedUser(req)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }

  const state = listFriendState(user.id)
  res.status(200).json({
    ok: true,
    friends: state.friends.map((f) => ({ ...f, online: isUserOnline(f.user.userId) })),
    incoming: state.incoming.map((f) => ({ ...f, online: isUserOnline(f.user.userId) })),
    outgoing: state.outgoing.map((f) => ({ ...f, online: isUserOnline(f.user.userId) })),
    blocked: state.blocked,
  })
})

app.post('/api/friends/request', (req, res) => {
  const user = requireAuthedUser(req)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }

  try {
    enforceRateLimit(requestRateByUserId, user.id, 8, 60_000)
    const body = friendRequestSchema.parse(req.body)
    const result = sendFriendRequest({ fromUserId: user.id, toIdentity: body.identity })
    if (result.status === 'PENDING') {
      const from = getUserById(user.id)
      const targetSockets = [...(onlineSocketsByUserId.get(result.targetUserId) ?? new Set<string>())]
      for (const sid of targetSockets) {
        io.to(sid).emit('friends:requestReceived', {
          from: from ? { userId: from.id, displayName: from.displayName } : { userId: user.id, displayName: 'Friend' },
        })
      }
    }
    res.status(200).json({ ok: true, status: result.status, targetUserId: result.targetUserId })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'FRIEND_REQUEST_FAILED'
    if (message === 'TARGET_USER_NOT_FOUND') {
      res.status(404).json({ ok: false, message: 'No account found for that email or display name' })
      return
    }
    if (message === 'DISPLAY_NAME_AMBIGUOUS') {
      res.status(409).json({ ok: false, message: 'Display name is not unique. Add by email instead.' })
      return
    }
    if (message === 'CANNOT_FRIEND_SELF') {
      res.status(400).json({ ok: false, message: 'You cannot friend yourself' })
      return
    }
    if (message === 'ALREADY_FRIENDS') {
      res.status(409).json({ ok: false, message: 'You are already friends' })
      return
    }
    if (message === 'REQUEST_ALREADY_SENT') {
      res.status(409).json({ ok: false, message: 'Friend request already sent' })
      return
    }
    if (message === 'FRIENDSHIP_BLOCKED') {
      res.status(403).json({ ok: false, message: 'Friend request blocked' })
      return
    }
    if (message === 'RATE_LIMITED') {
      res.status(429).json({ ok: false, message: 'Too many friend requests, try again shortly' })
      return
    }
    res.status(400).json({ ok: false, message: 'Invalid friend request' })
  }
})

app.post('/api/friends/respond', (req, res) => {
  const user = requireAuthedUser(req)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }

  try {
    const body = friendRespondSchema.parse(req.body)
    const result = respondToFriendRequest({ userId: user.id, friendUserId: body.friendUserId, accept: body.accept })
    res.status(200).json({ ok: true, status: result.status })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'FRIEND_REQUEST_FAILED'
    if (message === 'REQUEST_NOT_FOUND') {
      res.status(404).json({ ok: false, message: 'Friend request not found' })
      return
    }
    if (message === 'NOT_INCOMING_REQUEST') {
      res.status(403).json({ ok: false, message: 'You can only respond to incoming requests' })
      return
    }
    res.status(400).json({ ok: false, message: 'Invalid friend response' })
  }
})

app.post('/api/friends/remove', (req, res) => {
  const user = requireAuthedUser(req)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }

  try {
    const body = friendRemoveSchema.parse(req.body)
    removeFriend({ userId: user.id, friendUserId: body.friendUserId })
    res.status(200).json({ ok: true })
  } catch {
    res.status(400).json({ ok: false, message: 'Invalid remove request' })
  }
})

app.post('/api/friends/block', (req, res) => {
  const user = requireAuthedUser(req)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }

  try {
    const body = friendBlockSchema.parse(req.body)
    blockUser({ userId: user.id, friendUserId: body.friendUserId })
    res.status(200).json({ ok: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : 'BLOCK_FAILED'
    if (message === 'CANNOT_BLOCK_SELF') {
      res.status(400).json({ ok: false, message: 'You cannot block yourself' })
      return
    }
    res.status(400).json({ ok: false, message: 'Invalid block request' })
  }
})

app.get('/api/friends/challenges/me', (req, res) => {
  const user = requireAuthedUser(req)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }

  const pending = pendingChallengesForUser(user.id).map((invite) => {
    const from = getUserById(invite.fromUserId)
    return {
      challengeId: invite.id,
      from: from
        ? { userId: from.id, displayName: from.displayName, email: from.email }
        : { userId: invite.fromUserId, displayName: 'Friend', email: '' },
      createdAt: invite.createdAt,
      expiresAt: invite.createdAt + CHALLENGE_EXPIRE_MS,
    }
  })

  res.status(200).json({ ok: true, incoming: pending })
})

app.get('/api/friends/invites/me', (req, res) => {
  const user = requireAuthedUser(req)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }

  const pending = pendingRoomInvitesForUser(user.id).map((invite) => {
    const from = getUserById(invite.fromUserId)
    return {
      inviteId: invite.id,
      roomCode: invite.roomCode,
      roomTitle: invite.roomTitle,
      from: from
        ? { userId: from.id, displayName: from.displayName, email: from.email }
        : { userId: invite.fromUserId, displayName: 'Friend', email: '' },
      createdAt: invite.createdAt,
      expiresAt: invite.createdAt + ROOM_INVITE_EXPIRE_MS,
    }
  })

  res.status(200).json({ ok: true, incoming: pending })
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
    byMode: {
      X01: withNamesForGlobalMode(records.byMode.X01),
      AROUND: withNamesForGlobalMode(records.byMode.AROUND),
    },
    updatedAt: records.updatedAt,
  }
  res.status(200).json({ ok: true, records: withNames })
})

app.get('/api/stats/friends', (req, res) => {
  const token = bearerTokenFromReq(req)
  const user = getUserBySessionToken(token)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }

  const modeRaw = String(req.query.gameType ?? 'X01').toUpperCase()
  const mode = modeRaw === 'AROUND' ? 'AROUND' : 'X01'

  const friendState = listFriendState(user.id)
  const ids = [user.id, ...friendState.friends.map((f) => f.user.userId)]
  const rows = ids
    .map((uid) => {
      const profile = getUserById(uid)
      if (!profile) return null
      const stats = getUserStats(uid)
      return {
        userId: uid,
        displayName: profile.displayName,
        isYou: uid === user.id,
        allTime: stats.allTime,
        lastTen: stats.lastTen,
        byMode: stats.byMode,
      }
    })
    .filter(Boolean)
    .sort((a: any, b: any) => {
      const aMode = a.byMode?.[mode]?.allTime ?? a.allTime
      const bMode = b.byMode?.[mode]?.allTime ?? b.allTime
      if (a.isYou && !b.isYou) return -1
      if (!a.isYou && b.isYou) return 1
      if ((bMode.wins ?? 0) !== (aMode.wins ?? 0)) return (bMode.wins ?? 0) - (aMode.wins ?? 0)
      return (bMode.threeDartAvg ?? 0) - (aMode.threeDartAvg ?? 0)
    })

  res.status(200).json({ ok: true, rows })
})

app.get('/api/daily-checkout', (req, res) => {
  const token = bearerTokenFromReq(req)
  const user = getUserBySessionToken(token)
  const dateKeyRaw = typeof req.query.dateKey === 'string' ? req.query.dateKey : undefined
  try {
    const view = getDailyCheckoutView({ dateKey: dateKeyRaw, userId: user?.id ?? null })
    res.status(200).json({ ok: true, ...view })
  } catch (err: any) {
    const msg = String(err?.message ?? '')
    if (msg === 'DAILY_CHECKOUT_NOT_STARTED') {
      res.status(400).json({ ok: false, message: `Daily checkout starts on ${getDailyCheckoutStartKey()}.` })
      return
    }
    if (msg === 'DAILY_CHECKOUT_FUTURE_DATE_NOT_ALLOWED') {
      res.status(400).json({ ok: false, message: 'Future daily checkouts are not available yet.' })
      return
    }
    res.status(400).json({ ok: false, message: 'Invalid daily checkout request' })
  }
})

app.post('/api/daily-checkout/submit', (req, res) => {
  const user = requireAuthedUser(req)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }
  try {
    const body = dailyCheckoutSubmitSchema.parse(req.body)
    const dateTarget = getDailyCheckoutTarget(body.dateKey)
    const minDarts = getMinimumCheckoutDarts(dateTarget.target)
    if (body.dartsUsed < minDarts) {
      res.status(400).json({ ok: false, message: `That target cannot be checked out in fewer than ${minDarts} darts.` })
      return
    }

    const throttleKey = `${user.id}:${dateTarget.dateKey}:${req.ip ?? 'ip-unknown'}`
    const now = Date.now()
    const lastSubmitAt = dailyCheckoutSubmitThrottle.get(throttleKey) ?? 0
    if (now - lastSubmitAt < 20_000) {
      res.status(429).json({ ok: false, message: 'Please wait before submitting again.' })
      return
    }
    dailyCheckoutSubmitThrottle.set(throttleKey, now)

    const result = submitDailyCheckout({
      userId: user.id,
      displayName: user.displayName,
      dartsUsed: body.dartsUsed,
      dateKey: dateTarget.dateKey,
    })
    const view = getDailyCheckoutView({ dateKey: result.dateKey, userId: user.id })
    res.status(200).json({ ok: true, improved: result.improved, ...view })
  } catch (err: any) {
    const msg = String(err?.message ?? '')
    if (msg === 'DAILY_CHECKOUT_NOT_STARTED') {
      res.status(400).json({ ok: false, message: `Daily checkout starts on ${getDailyCheckoutStartKey()}.` })
      return
    }
    if (msg === 'DAILY_CHECKOUT_FUTURE_DATE_NOT_ALLOWED') {
      res.status(400).json({ ok: false, message: 'Future daily checkouts are not available yet.' })
      return
    }
    res.status(400).json({ ok: false, message: 'Invalid daily checkout submit request' })
  }
})

app.get('/api/daily-checkout/archive', (req, res) => {
  const token = bearerTokenFromReq(req)
  const user = getUserBySessionToken(token)
  const days = listDailyCheckoutArchive({ userId: user?.id ?? null })
  res.status(200).json({ ok: true, days })
})

app.get('/api/tournaments', (req, res) => {
  const token = bearerTokenFromReq(req)
  const me = getUserBySessionToken(token)
  const rows = listTournaments()
    .filter((t) => t.status !== 'FINISHED')
    .map((t) => ({
    id: t.id,
    name: t.name,
    createdAt: t.createdAt,
    createdByDisplayName: t.createdByDisplayName,
    status: t.status,
    format: t.format,
    participationMode: t.participationMode,
    playersCount: t.players.length,
    maxPlayers: t.maxPlayers,
    isHost: me ? t.createdByUserId === me.id : false,
    isParticipant: me ? t.players.some((p) => p.userId === me.id) : false,
    winnerUserId: t.winnerUserId,
  }))
  res.status(200).json({ ok: true, tournaments: rows })
})

app.get('/api/tournaments/:id', (req, res) => {
  try {
    const token = bearerTokenFromReq(req)
    const me = getUserBySessionToken(token)
    const t = getTournament(String(req.params.id ?? ''))
    res.status(200).json({
      ok: true,
      tournament: {
        ...t,
        isHost: me ? t.createdByUserId === me.id : false,
        isParticipant: me ? t.players.some((p) => p.userId === me.id) : false,
      },
    })
  } catch {
    res.status(404).json({ ok: false, message: 'Tournament not found' })
  }
})

app.post('/api/tournaments/create', (req, res) => {
  const user = requireAuthedUser(req)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }
  try {
    const body = tournamentCreateSchema.parse(req.body)
    validateGameSettings(body.settings)
    if (body.settings?.gameType === 'PRACTICE') {
      res.status(400).json({ ok: false, message: 'Practice mode is not available for tournaments' })
      return
    }
    const t = createTournament({
      name: body.name,
      createdByUserId: user.id,
      createdByDisplayName: user.displayName,
      settings: body.settings,
      maxPlayers: body.maxPlayers ?? 16,
      participationMode: body.participationMode ?? 'ONLINE',
    })
    res.status(200).json({ ok: true, tournament: t })
  } catch {
    res.status(400).json({ ok: false, message: 'Invalid tournament create request' })
  }
})

app.post('/api/tournaments/join', (req, res) => {
  const user = requireAuthedUser(req)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }
  try {
    const body = tournamentIdSchema.parse(req.body)
    const t = joinTournament({ tournamentId: body.tournamentId, userId: user.id, displayName: user.displayName })
    res.status(200).json({ ok: true, tournament: t })
  } catch (e: any) {
    const code = String(e?.message ?? '')
    const msg =
      code === 'TOURNAMENT_ALREADY_STARTED'
        ? 'Tournament already started'
        : code === 'TOURNAMENT_ONLINE_ONLY'
          ? 'This tournament is local-only'
        : code === 'TOURNAMENT_FULL'
          ? 'Tournament is full'
          : 'Could not join tournament'
    res.status(400).json({ ok: false, message: msg })
  }
})

app.post('/api/tournaments/player/add', (req, res) => {
  const user = requireAuthedUser(req)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }
  try {
    const body = tournamentAddPlayerSchema.parse(req.body)
    const t = addLocalTournamentPlayer({
      tournamentId: body.tournamentId,
      requestedByUserId: user.id,
      displayName: body.displayName,
    })
    res.status(200).json({ ok: true, tournament: t })
  } catch (e: any) {
    const code = String(e?.message ?? '')
    const msg =
      code === 'TOURNAMENT_HOST_REQUIRED'
        ? 'Only the tournament host can add local players'
        : code === 'TOURNAMENT_LOCAL_ONLY'
          ? 'This tournament is online-only'
        : code === 'TOURNAMENT_PLAYER_NAME_TAKEN'
          ? 'Player name already exists in tournament'
          : code === 'TOURNAMENT_FULL'
            ? 'Tournament is full'
            : 'Could not add player'
    res.status(400).json({ ok: false, message: msg })
  }
})

app.post('/api/tournaments/leave', (req, res) => {
  const user = requireAuthedUser(req)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }
  try {
    const body = tournamentIdSchema.parse(req.body)
    const t = leaveTournament({ tournamentId: body.tournamentId, userId: user.id })
    res.status(200).json({ ok: true, tournament: t })
  } catch (e: any) {
    if (String(e?.message ?? '') === 'TOURNAMENT_DELETED_EMPTY') {
      res.status(200).json({ ok: true, deleted: true })
      return
    }
    res.status(400).json({ ok: false, message: 'Could not leave tournament' })
  }
})

app.post('/api/tournaments/start', (req, res) => {
  const user = requireAuthedUser(req)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }
  try {
    const body = tournamentIdSchema.parse(req.body)
    const t = startTournament({ tournamentId: body.tournamentId, requestedByUserId: user.id })
    res.status(200).json({ ok: true, tournament: t })
  } catch (e: any) {
    const code = String(e?.message ?? '')
    const msg =
      code === 'TOURNAMENT_HOST_REQUIRED'
        ? 'Only the tournament host can start it'
        : code === 'TOURNAMENT_NEEDS_PLAYERS'
          ? 'Need at least 2 players'
          : 'Could not start tournament'
    res.status(400).json({ ok: false, message: msg })
  }
})

app.post('/api/tournaments/close', (req, res) => {
  const user = requireAuthedUser(req)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }
  if (!isAdminUser(user)) {
    res.status(403).json({ ok: false, message: 'Admin privileges required' })
    return
  }
  try {
    const body = tournamentIdSchema.parse(req.body)
    const t = getTournament(body.tournamentId)
    if (t.participationMode !== 'LOCAL') {
      res.status(400).json({ ok: false, message: 'Only local tournaments can be force-closed' })
      return
    }
    const closed = closeTournament({ tournamentId: body.tournamentId })
    res.status(200).json({ ok: true, tournament: closed })
  } catch {
    res.status(400).json({ ok: false, message: 'Could not close tournament' })
  }
})

app.post('/api/tournaments/seeding', (req, res) => {
  const user = requireAuthedUser(req)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }
  try {
    const body = tournamentSeedingSchema.parse(req.body)
    const t = setTournamentSeeding({
      tournamentId: body.tournamentId,
      requestedByUserId: user.id,
      mode: body.mode,
      manualSeedUserIds: body.manualSeedUserIds,
    })
    res.status(200).json({ ok: true, tournament: t })
  } catch {
    res.status(400).json({ ok: false, message: 'Could not update seeding' })
  }
})

app.post('/api/tournaments/match/room', (req, res) => {
  const user = requireAuthedUser(req)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }
  try {
    const body = tournamentAssignRoomSchema.parse(req.body)
    const t = assignMatchRoom({
      tournamentId: body.tournamentId,
      requestedByUserId: user.id,
      matchId: body.matchId,
      roomCode: body.roomCode,
    })
    res.status(200).json({ ok: true, tournament: t })
  } catch {
    res.status(400).json({ ok: false, message: 'Could not assign room code to match' })
  }
})

app.post('/api/tournaments/match/report', (req, res) => {
  const user = requireAuthedUser(req)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }
  try {
    const body = tournamentReportWinnerSchema.parse(req.body)
    const t = reportMatchWinner({
      tournamentId: body.tournamentId,
      requestedByUserId: user.id,
      matchId: body.matchId,
      winnerUserId: body.winnerUserId,
    })
    res.status(200).json({ ok: true, tournament: t })
  } catch {
    res.status(400).json({ ok: false, message: 'Could not report match winner' })
  }
})

app.post('/api/tournaments/match/ready', (req, res) => {
  const user = requireAuthedUser(req)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }
  try {
    const body = tournamentMatchReadySchema.parse(req.body)
    const t = setMatchReady({
      tournamentId: body.tournamentId,
      matchId: body.matchId,
      userId: user.id,
      ready: body.ready ?? true,
    })
    const roomCode = autoCreateTournamentRoomIfReady(body.tournamentId, body.matchId)
    const updated = getTournament(t.id)
    res.status(200).json({ ok: true, tournament: updated, roomCode })
  } catch {
    res.status(400).json({ ok: false, message: 'Could not update ready state' })
  }
})

app.get('/api/tournaments/invites/me', (req, res) => {
  const user = requireAuthedUser(req)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }
  const invites = listPendingTournamentInvitesForUser(user.id)
    .map((i) => {
      try {
        const tournament = getTournament(i.tournamentId)
        const from = getUserById(i.fromUserId)
        return {
          id: i.id,
          tournamentId: i.tournamentId,
          tournamentName: tournament.name,
          fromUserId: i.fromUserId,
          fromDisplayName: from?.displayName ?? i.fromUserId,
          createdAt: i.createdAt,
        }
      } catch {
        return null
      }
    })
    .filter(Boolean)
  res.status(200).json({ ok: true, invites })
})

app.post('/api/tournaments/invite', (req, res) => {
  const user = requireAuthedUser(req)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }
  try {
    const body = tournamentInviteSendSchema.parse(req.body)
    if (!areFriends(user.id, body.toUserId)) {
      res.status(400).json({ ok: false, message: 'You can only invite friends' })
      return
    }
    const invite = sendTournamentInvite({ tournamentId: body.tournamentId, fromUserId: user.id, toUserId: body.toUserId })
    res.status(200).json({ ok: true, invite })
  } catch {
    res.status(400).json({ ok: false, message: 'Could not send tournament invite (online tournaments only)' })
  }
})

app.post('/api/tournaments/invite/respond', (req, res) => {
  const user = requireAuthedUser(req)
  if (!user) {
    res.status(401).json({ ok: false, message: 'Not authenticated' })
    return
  }
  try {
    const body = tournamentInviteRespondSchema.parse(req.body)
    const t = respondTournamentInvite({
      inviteId: body.inviteId,
      toUserId: user.id,
      accept: body.accept,
      displayName: user.displayName,
    })
    res.status(200).json({ ok: true, tournament: t })
  } catch {
    res.status(400).json({ ok: false, message: 'Could not respond to tournament invite' })
  }
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

const aroundSettingsSchema = z.object({
  gameType: z.literal('AROUND'),
  legsToWin: z.number().int().min(1).max(99),
  setsEnabled: z.boolean(),
  setsToWin: z.number().int().min(0).max(99),
  advanceByMultiplier: z.boolean(),
})

const practiceSettingsSchema = z.object({
  gameType: z.literal('PRACTICE'),
  practiceMode: z.union([z.literal('RANDOM_CHECKOUT'), z.literal('DOUBLES'), z.literal('TRIPLES'), z.literal('X01')]),
  startScore: z.number().int().min(2).max(10001),
  legsToWin: z.literal(1),
  setsEnabled: z.literal(false),
  setsToWin: z.literal(0),
})

const gameSettingsSchema = z.union([x01SettingsSchema, aroundSettingsSchema, practiceSettingsSchema])

const challengeMatchSettings: X01Settings = {
  gameType: 'X01',
  startScore: 501,
  legsToWin: 3,
  setsEnabled: false,
  setsToWin: 0,
  doubleIn: false,
  doubleOut: true,
  masterOut: false,
}

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
  settings: gameSettingsSchema,
  tournamentId: z.string().trim().min(1).max(128).optional(),
  tournamentMatchId: z.string().trim().min(1).max(128).optional(),
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
  settings: gameSettingsSchema,
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

const socialIdentifySchema = z.any()
const challengeFriendSchema = z.any()
const challengeRespondSchema = z.any()
const roomInviteSchema = z.any()

type PendingAutodartsTurn = {
  playerId: string
  legIndex: number
  turnsInLeg: number
  darts: Dart[]
  ready: boolean
  reason: 'THREE_DARTS' | 'BUST' | 'CHECKOUT' | null
}

type ChallengeInvite = {
  id: string
  fromUserId: string
  toUserId: string
  createdAt: number
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED'
}

type RoomInvite = {
  id: string
  fromUserId: string
  toUserId: string
  roomCode: string
  roomTitle: string | null
  createdAt: number
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED'
}

const CHALLENGE_EXPIRE_MS = 5 * 60_000
const ROOM_INVITE_EXPIRE_MS = 30 * 60_000

const autodartsPendingTurnByRoomCode = new Map<string, PendingAutodartsTurn>()
const challengeById = new Map<string, ChallengeInvite>()
const roomInviteById = new Map<string, RoomInvite>()
const requestRateByUserId = new Map<string, number[]>()
const challengeRateByUserId = new Map<string, number[]>()

function enforceRateLimit(map: Map<string, number[]>, userId: string, maxCount: number, windowMs: number): void {
  const now = Date.now()
  const recent = (map.get(userId) ?? []).filter((ts) => now - ts <= windowMs)
  if (recent.length >= maxCount) {
    throw new GameRuleError('RATE_LIMITED', 'Too many requests, try again shortly')
  }
  recent.push(now)
  map.set(userId, recent)
}

function pruneExpiredChallenges() {
  const now = Date.now()
  for (const invite of challengeById.values()) {
    if (invite.status !== 'PENDING') continue
    if (now - invite.createdAt > CHALLENGE_EXPIRE_MS) invite.status = 'EXPIRED'
  }
}

function pendingChallengesForUser(userId: string): ChallengeInvite[] {
  pruneExpiredChallenges()
  const now = Date.now()
  return [...challengeById.values()].filter(
    (c) => c.status === 'PENDING' && c.toUserId === userId && now - c.createdAt <= CHALLENGE_EXPIRE_MS,
  )
}

function pruneExpiredRoomInvites() {
  const now = Date.now()
  for (const invite of roomInviteById.values()) {
    if (invite.status !== 'PENDING') continue
    if (now - invite.createdAt > ROOM_INVITE_EXPIRE_MS) invite.status = 'EXPIRED'
  }
}

function pendingRoomInvitesForUser(userId: string): RoomInvite[] {
  pruneExpiredRoomInvites()
  const now = Date.now()
  return [...roomInviteById.values()].filter(
    (i) => i.status === 'PENDING' && i.toUserId === userId && now - i.createdAt <= ROOM_INVITE_EXPIRE_MS,
  )
}

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

function processTournamentNoShowForfeits(): void {
  const due = listDueTournamentNoShowChecks(Date.now())
  for (const item of due) {
    try {
      const room = getRoom(item.roomCode)
      const presentUserIds = new Set<string>()
      for (const c of room.clients.values()) {
        if (c.userId) presentUserIds.add(c.userId)
      }

      const present = [item.playerAUserId, item.playerBUserId].filter(
        (id): id is string => Boolean(id) && presentUserIds.has(id as string),
      )
      const changed = resolveTournamentNoShow({
        tournamentId: item.tournamentId,
        matchId: item.matchId,
        presentUserIds: present,
      })
      if (changed) {
        io.to(roomChannel(item.roomCode)).emit('room:tournamentForfeitResolved', {
          tournamentId: item.tournamentId,
          matchId: item.matchId,
          presentUserIds: present,
        })
      }
    } catch {
      // ignore stale room/tournament records
    }
  }
}

function autoCreateTournamentRoomIfReady(tournamentId: string, matchId: string): string | null {
  const t = getTournament(tournamentId)
  const match = t.rounds.flatMap((r) => r.matches).find((m) => m.id === matchId)
  if (!match) return null
  if (match.roomCode || match.winnerUserId || match.resolved) return match.roomCode ?? null
  if (!match.playerAUserId || !match.playerBUserId) return null
  const ready = new Set(match.readyUserIds ?? [])
  if (!ready.has(match.playerAUserId) || !ready.has(match.playerBUserId)) return null

  const participants = getTournamentMatchParticipants({ tournamentId, matchId })
  if (participants.length < 2) return null

  const room = createRoom({ hostName: `${t.name} host`, settings: t.settings })
  room.title = `${t.name} • Match`
  room.isPublic = false
  room.match.players = []
  room.match.legsWonByPlayerId = {}
  room.match.legsWonInCurrentSetByPlayerId = {}
  room.match.setsWonByPlayerId = {}
  room.controllerSocketIdByPlayerId = {}
  room.playerUserIdByPlayerId = {}

  for (const p of participants) {
    const player = addPlayer(room, p.displayName)
    if (p.source === 'USER') room.playerUserIdByPlayerId[player.id] = p.userId
  }
  room.match.currentLegIndex = 0
  room.match.legs[0].startingPlayerIndex = 0
  room.match.status = 'LIVE'

  assignMatchRoom({
    tournamentId,
    requestedByUserId: t.createdByUserId,
    matchId,
    roomCode: room.code,
  })

  return room.code
}

function validateGameSettings(settings: GameSettings): void {
  if (settings.gameType === 'AROUND') {
    validateAroundSettings(settings as AroundSettings)
    return
  }
  if (settings.gameType === 'PRACTICE') {
    validatePracticeSettings(settings as PracticeSettings)
    return
  }
  validateX01Settings(settings as X01Settings)
}

function validateLobbyStartScorePreset(settings: GameSettings): void {
  const allowed = new Set([121, 170, 301, 501])
  if (settings.gameType === 'X01' && !allowed.has(settings.startScore)) {
    throw new GameRuleError('INVALID_SETTINGS', 'X01 start score must be one of 121, 170, 301, 501')
  }
  if (settings.gameType === 'PRACTICE' && settings.practiceMode === 'X01' && !allowed.has(settings.startScore)) {
    throw new GameRuleError('INVALID_SETTINGS', 'Practice X01 start score must be one of 121, 170, 301, 501')
  }
}

function computeMatchSnapshotForRoom(match: any) {
  if (match.settings.gameType === 'PRACTICE') {
    const leg = match.legs[match.currentLegIndex]
    if (!leg) throw new GameRuleError('INVALID_STATE', 'Current leg does not exist')
    const legSnap = computePracticeLegSnapshot({
      settings: match.settings as PracticeSettings,
      players: match.players,
      startingPlayerIndex: leg.startingPlayerIndex,
      turns: leg.turns,
      legNumber: leg.legNumber,
      setNumber: leg.setNumber,
    })
    return {
      status: match.status,
      settings: match.settings,
      lockedAt: match.lockedAt,
      players: [...match.players].sort((a, b) => a.orderIndex - b.orderIndex),
      currentLegIndex: match.currentLegIndex,
      legsWonByPlayerId: match.legsWonByPlayerId,
      legsWonInCurrentSetByPlayerId: match.legsWonInCurrentSetByPlayerId,
      setsWonByPlayerId: match.setsWonByPlayerId,
      currentSetNumber: match.currentSetNumber,
      currentLeg: {
        legNumber: legSnap.legNumber,
        setNumber: legSnap.setNumber,
        startingPlayerIndex: legSnap.startingPlayerIndex,
        currentPlayerIndex: legSnap.currentPlayerIndex,
        winnerPlayerId: legSnap.winnerPlayerId,
      },
      leg: legSnap,
    }
  }

  if (match.settings.gameType === 'AROUND') {
    const leg = match.legs[match.currentLegIndex]
    if (!leg) throw new GameRuleError('INVALID_STATE', 'Current leg does not exist')
    const legSnap = computeAroundLegSnapshot({
      settings: match.settings as AroundSettings,
      players: match.players,
      startingPlayerIndex: leg.startingPlayerIndex,
      turns: leg.turns,
      legNumber: leg.legNumber,
      setNumber: leg.setNumber,
    })
    return {
      status: match.status,
      settings: match.settings,
      lockedAt: match.lockedAt,
      players: [...match.players].sort((a, b) => a.orderIndex - b.orderIndex),
      currentLegIndex: match.currentLegIndex,
      legsWonByPlayerId: match.legsWonByPlayerId,
      legsWonInCurrentSetByPlayerId: match.legsWonInCurrentSetByPlayerId,
      setsWonByPlayerId: match.setsWonByPlayerId,
      currentSetNumber: match.currentSetNumber,
      currentLeg: {
        legNumber: legSnap.legNumber,
        setNumber: legSnap.setNumber,
        startingPlayerIndex: legSnap.startingPlayerIndex,
        currentPlayerIndex: legSnap.currentPlayerIndex,
        winnerPlayerId: legSnap.winnerPlayerId,
      },
      leg: legSnap,
    }
  }

  return computeMatchSnapshot(match)
}

function applyTurnForCurrentMode(args: {
  settings: GameSettings
  remainingBefore: number
  isInBefore: boolean
  input: TurnInput
  legMeta?: { setNumber: number; legNumber: number }
}) {
  if (args.settings.gameType === 'PRACTICE') {
    if (!args.legMeta) throw new GameRuleError('INVALID_STATE', 'Practice mode needs leg context')
    return applyPracticeTurn({
      settings: args.settings as PracticeSettings,
      stateBefore: { remaining: args.remainingBefore, isIn: args.isInBefore },
      input: args.input,
      legMeta: args.legMeta,
    })
  }
  if (args.settings.gameType === 'AROUND') {
    return applyAroundTurnForServer({ settings: args.settings, targetBefore: args.remainingBefore, input: args.input })
  }
  return applyX01Turn({
    remainingBefore: args.remainingBefore,
    isInBefore: args.isInBefore,
    input: args.input,
    settings: args.settings as X01Settings,
  })
}

function applyAroundTurnForServer(args: { settings: AroundSettings; targetBefore: number; input: TurnInput }) {
  const targetBefore = args.targetBefore
  const advanceByMultiplier = Boolean(args.settings.advanceByMultiplier)
  const nextTarget = (current: number) => {
    const targets = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 25]
    const idx = targets.findIndex((t) => t === current)
    if (idx < 0) return 1
    if (idx >= targets.length - 1) return 0
    return targets[idx + 1]
  }

  const advanceTarget = (current: number, steps: number) => {
    let next = current
    const count = Number.isInteger(steps) && steps > 0 ? steps : 1
    for (let i = 0; i < count; i++) {
      next = nextTarget(next)
      if (next === 0) break
    }
    return next
  }

  const isHit = (dart: Dart, target: number) => {
    if (target === 25) return dart.segment === 25 && (dart.multiplier === 1 || dart.multiplier === 2)
    return dart.segment === target && dart.multiplier > 0
  }

  if (targetBefore === 0) {
    return {
      scoreTotal: 0,
      isBust: false,
      didCheckout: true,
      checkoutDartIndex: null,
      remainingBefore: 0,
      remainingAfter: 0,
      isInBefore: true,
      isInAfter: true,
    }
  }

  const perDartInput = args.input.mode === 'PER_DART' ? args.input.darts : args.input.darts
  if (perDartInput) {
    let target = targetBefore
    let scoreTotal = 0
    let checkoutDartIndex: number | null = null

    for (let i = 0; i < perDartInput.length; i++) {
      if (target === 0) break
      const d = perDartInput[i]
      if (!isHit(d, target)) continue
      scoreTotal += d.segment === 25 ? (d.multiplier === 2 ? 50 : 25) : d.segment * d.multiplier
      const steps = advanceByMultiplier ? Math.max(1, d.multiplier) : 1
      target = advanceTarget(target, steps)
      if (target === 0) {
        checkoutDartIndex = i
        break
      }
    }

    if (args.input.mode === 'TOTAL') {
      const derivedTotal = perDartInput.reduce(
        (sum, d) => sum + (d.segment === 25 ? (d.multiplier === 2 ? 50 : 25) : d.segment * d.multiplier),
        0,
      )
      if (derivedTotal !== args.input.total) {
        throw new GameRuleError('TURN_TOTAL_MISMATCH', 'Provided total does not match darts sum', {
          total: args.input.total,
          derived: derivedTotal,
        })
      }
    }

    return {
      scoreTotal,
      isBust: false,
      didCheckout: target === 0,
      checkoutDartIndex,
      remainingBefore: targetBefore,
      remainingAfter: target,
      isInBefore: true,
      isInAfter: true,
    }
  }

  if (args.input.mode !== 'TOTAL') {
    throw new GameRuleError('INVALID_TURN', 'Invalid around turn input mode', { mode: args.input.mode })
  }

  const t = args.input.total
  const hit = targetBefore === 25 ? t === 25 || t === 50 : t === targetBefore || t === targetBefore * 2 || t === targetBefore * 3
  const after = hit ? nextTarget(targetBefore) : targetBefore
  return {
    scoreTotal: hit ? t : 0,
    isBust: false,
    didCheckout: after === 0,
    checkoutDartIndex: null,
    remainingBefore: targetBefore,
    remainingAfter: after,
    isInBefore: true,
    isInAfter: true,
  }
}

function emitSnapshot(code: string) {
  const room = getRoom(code)
  const tournamentMatch = getTournamentMatchForRoomCode(code)
  const matchSnapshot = computeMatchSnapshotForRoom(room.match)
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
      tournamentMatch: tournamentMatch
        ? {
            tournamentId: tournamentMatch.tournamentId,
            matchId: tournamentMatch.match.id,
            participationMode: tournamentMatch.participationMode,
          }
        : null,
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

  if (room.match.settings.gameType !== 'X01') {
    room.autodartsBoundUserId = null
    autodarts.unbindRoom(roomCode)
    return
  }

  const snap = computeMatchSnapshotForRoom(room.match)
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

  const snap = computeMatchSnapshotForRoom(room.match)
  const currentIdx = snap.leg.currentPlayerIndex
  if (currentIdx < 0) throw new GameRuleError('LEG_FINISHED', 'Leg is finished')
  const currentPlayerId = snap.players[currentIdx].id

  const currentPlayerState = snap.leg.players.find((p) => p.playerId === currentPlayerId)
  if (!currentPlayerState) {
    throw new GameRuleError('INVALID_STATE', 'Current player state not found', { currentPlayerId })
  }

  // Validate against current player state before mutating server state
  const applied = applyTurnForCurrentMode({
    settings: room.match.settings,
    remainingBefore: currentPlayerState.remaining,
    isInBefore: currentPlayerState.isIn,
    input: args.input,
    legMeta: { setNumber: snap.leg.setNumber, legNumber: snap.leg.legNumber },
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
  const nextSnap = computeMatchSnapshotForRoom(room.match)
  const winnerId = nextSnap.leg.winnerPlayerId
  if (winnerId) {
    const practiceTraining = room.match.settings.gameType === 'PRACTICE'
    if (!practiceTraining) {
      finishedLegNumber = leg.legNumber
      finishedSetNumber = leg.setNumber
    }
    leg.winnerPlayerId = winnerId
    if (practiceTraining) {
      room.match.status = 'FINISHED'
    } else {
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
    if (room.match.settings.gameType !== 'PRACTICE') {
      const statsByPlayerId = computePlayerStats(room.match)
      recordFinishedMatch({
        roomCode: args.roomCode,
        match: room.match,
        statsByPlayerId,
        playerUserIdByPlayerId: room.playerUserIdByPlayerId,
      })
    }
    room.statsRecorded = true

    const tournamentWinnerUserId = winnerId ? room.playerUserIdByPlayerId[winnerId] ?? null : null
    const tournamentWinnerName = winnerId ? room.match.players.find((p) => p.id === winnerId)?.name ?? null : null
    try {
      autoReportWinnerByRoom({
        roomCode: args.roomCode,
        winnerUserId: tournamentWinnerUserId,
        winnerDisplayName: tournamentWinnerName,
      })
    } catch {
      // no-op
    }
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
  if (room.match.settings.gameType !== 'X01') return { accepted: false, bufferedDarts: [], playerId: null, ready: false, reason: null }

  const snap = computeMatchSnapshotForRoom(room.match)
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
    applied = applyTurnForCurrentMode({
      settings: room.match.settings,
      remainingBefore: currentPlayerState.remaining,
      isInBefore: currentPlayerState.isIn,
      input,
      legMeta: { setNumber: snap.leg.setNumber, legNumber: snap.leg.legNumber },
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

function reassignControllersForSocket(roomCode: string, socketId: string, replacementSocketId?: string) {
  const room = getRoom(roomCode)
  for (const [playerId, controller] of Object.entries(room.controllerSocketIdByPlayerId)) {
    if (controller !== socketId) continue
    if (replacementSocketId) room.controllerSocketIdByPlayerId[playerId] = replacementSocketId
    else delete room.controllerSocketIdByPlayerId[playerId]
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

function toTurnInput(args: { settings: GameSettings; total?: number; darts?: Dart[] }): TurnInput {
  const practiceNeedsDarts = args.settings.gameType === 'PRACTICE' && args.settings.practiceMode !== 'X01'
  if ((args.settings.gameType === 'AROUND' || practiceNeedsDarts) && typeof args.total === 'number' && !args.darts) {
    throw new GameRuleError('NEED_DARTS', `${args.settings.gameType} mode needs per-dart input (or include darts details)`)
  }
  if (typeof args.total === 'number') {
    return args.darts ? { mode: 'TOTAL', total: args.total, darts: args.darts } : { mode: 'TOTAL', total: args.total }
  }
  if (args.darts) {
    return { mode: 'PER_DART', darts: args.darts }
  }
  throw new GameRuleError('NEED_TOTAL_OR_DARTS', 'Provide either total or darts')
}

io.on('connection', (socket) => {
  function setSocketUser(userId?: string) {
    const prev = (socket.data as any).userId as string | undefined
    if (prev && prev !== userId) removeOnlineSocket(prev, socket.id)
    if (userId) {
      ;(socket.data as any).userId = userId
      addOnlineSocket(userId, socket.id)
    } else {
      delete (socket.data as any).userId
    }
  }

  function emitPendingChallengeInvites(toUserId: string) {
    const invites = pendingChallengesForUser(toUserId)
    for (const invite of invites) {
      const from = getUserById(invite.fromUserId)
      socket.emit('friends:challengeInvite', {
        challengeId: invite.id,
        from: from ? { userId: from.id, displayName: from.displayName } : { userId: invite.fromUserId, displayName: 'Friend' },
        createdAt: invite.createdAt,
      })
    }
  }

  function emitPendingRoomInvites(toUserId: string) {
    const invites = pendingRoomInvitesForUser(toUserId)
    for (const invite of invites) {
      const from = getUserById(invite.fromUserId)
      socket.emit('friends:roomInvite', {
        inviteId: invite.id,
        roomCode: invite.roomCode,
        roomTitle: invite.roomTitle,
        from: from ? { userId: from.id, displayName: from.displayName } : { userId: invite.fromUserId, displayName: 'Friend' },
        createdAt: invite.createdAt,
      })
    }
  }

  function detachFromRoom(code: string) {
    try {
      const room = getRoom(code)
      const leavingClient = getClient(room, socket.id)
      removeClient(room, socket.id)

      if (leavingClient?.isHost && room.clients.size > 0) {
        const remaining = [...room.clients.values()]
        const secondPlayerName = room.match.players[1]?.name?.toLowerCase()
        let nextHost =
          (secondPlayerName
            ? remaining.find((c) => c.role === 'PLAYER' && c.name.toLowerCase() === secondPlayerName)
            : undefined) ??
          remaining.find((c) => c.role === 'PLAYER') ??
          remaining[0]

        for (const c of remaining) c.isHost = false
        nextHost.isHost = true
        room.hostSecret = randomId(18)

        io.to(nextHost.socketId).emit('room:hostGranted', {
          code: room.code,
          hostSecret: room.hostSecret,
          reason: 'HOST_LEFT',
        })
        io.to(roomChannel(code)).emit('room:toast', {
          message: `${nextHost.name} is now host.`,
        })
      }

      const hostSocketId = [...room.clients.values()].find((c) => c.isHost)?.socketId
      reassignControllersForSocket(code, socket.id, hostSocketId)

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

  socket.on('social:identify', (raw, cb) => {
    try {
      socialIdentifySchema.parse(raw)
      const authToken = String((raw as any)?.authToken ?? (raw as any)?.token ?? '').trim()
      const auth = resolveAuthIdentity(authToken || undefined)
      if (!auth) throw new GameRuleError('AUTH_INVALID', 'Authentication token is invalid or expired')
      setSocketUser(auth.userId)
      lastSeenByUserId.set(auth.userId, Date.now())
      emitPendingChallengeInvites(auth.userId)
      emitPendingRoomInvites(auth.userId)
      cb?.({ ok: true, user: { id: auth.userId, displayName: auth.displayName } })
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid identify request')
      cb?.({ ok: false, code: e.code, message: e.message })
    }
  })

  socket.on('friends:challenge', (raw, cb) => {
    try {
      challengeFriendSchema.parse(raw)
      const friendUserId = String((raw as any)?.friendUserId ?? (raw as any)?.targetUserId ?? '').trim()
      const authToken = String((raw as any)?.authToken ?? (raw as any)?.token ?? '').trim() || undefined
      if (!friendUserId) throw new GameRuleError('BAD_REQUEST', 'friendUserId is required')
      let fromUserId = (socket.data as any).userId as string | undefined
      if (!fromUserId && authToken) {
        const auth = resolveAuthIdentity(authToken)
        if (auth) {
          setSocketUser(auth.userId)
          lastSeenByUserId.set(auth.userId, Date.now())
          fromUserId = auth.userId
        }
      }
      if (!fromUserId) throw new GameRuleError('AUTH_REQUIRED', 'Sign in first')
      if (!areFriends(fromUserId, friendUserId)) throw new GameRuleError('NOT_FRIENDS', 'You can only challenge accepted friends')

      enforceRateLimit(challengeRateByUserId, fromUserId, 10, 60_000)
      pruneExpiredChallenges()

      const fromUser = getUserById(fromUserId)
      if (!fromUser) throw new GameRuleError('AUTH_REQUIRED', 'Sign in first')

      const invite: ChallengeInvite = {
        id: randomId(10),
        fromUserId,
        toUserId: friendUserId,
        createdAt: Date.now(),
        status: 'PENDING',
      }
      challengeById.set(invite.id, invite)

      const targetSocketIds = [...(onlineSocketsByUserId.get(friendUserId) ?? new Set<string>())]
      for (const targetSocketId of targetSocketIds) {
        io.to(targetSocketId).emit('friends:challengeInvite', {
          challengeId: invite.id,
          from: { userId: fromUser.id, displayName: fromUser.displayName },
          createdAt: invite.createdAt,
        })
      }

      cb?.({ ok: true, challengeId: invite.id })
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid challenge request')
      cb?.({ ok: false, code: e.code, message: e.message })
    }
  })

  socket.on('friends:challengeRespond', (raw, cb) => {
    try {
      challengeRespondSchema.parse(raw)
      const challengeId = String((raw as any)?.challengeId ?? '').trim()
      const accept = Boolean((raw as any)?.accept)
      const authToken = String((raw as any)?.authToken ?? (raw as any)?.token ?? '').trim() || undefined
      if (!challengeId) throw new GameRuleError('BAD_REQUEST', 'challengeId is required')
      let toUserId = (socket.data as any).userId as string | undefined
      if (!toUserId && authToken) {
        const auth = resolveAuthIdentity(authToken)
        if (auth) {
          setSocketUser(auth.userId)
          lastSeenByUserId.set(auth.userId, Date.now())
          toUserId = auth.userId
        }
      }
      if (!toUserId) throw new GameRuleError('AUTH_REQUIRED', 'Sign in first')

      const invite = challengeById.get(challengeId)
      if (!invite || invite.status !== 'PENDING') throw new GameRuleError('CHALLENGE_NOT_FOUND', 'Challenge not found')
      if (invite.toUserId !== toUserId) throw new GameRuleError('NOT_ALLOWED', 'Not your challenge')
      if (Date.now() - invite.createdAt > CHALLENGE_EXPIRE_MS) {
        invite.status = 'EXPIRED'
        throw new GameRuleError('CHALLENGE_EXPIRED', 'Challenge expired')
      }

      if (!accept) {
        invite.status = 'DECLINED'
        const fromSockets = [...(onlineSocketsByUserId.get(invite.fromUserId) ?? new Set<string>())]
        for (const sid of fromSockets) {
          io.to(sid).emit('friends:challengeResolved', { challengeId, accepted: false })
        }
        cb?.({ ok: true, accepted: false })
        return
      }

      const fromUser = getUserById(invite.fromUserId)
      const toUser = getUserById(invite.toUserId)
      if (!fromUser || !toUser) throw new GameRuleError('CHALLENGE_NOT_FOUND', 'Challenge users not found')

      const room = createRoom({ hostName: fromUser.displayName, settings: challengeMatchSettings })
      room.title = `${fromUser.displayName} vs ${toUser.displayName}`
      room.isPublic = false

      invite.status = 'ACCEPTED'

      const fromSockets = [...(onlineSocketsByUserId.get(invite.fromUserId) ?? new Set<string>())]
      const toSockets = [...(onlineSocketsByUserId.get(invite.toUserId) ?? new Set<string>())]
      for (const sid of fromSockets) {
        io.to(sid).emit('friends:challengeMatchReady', {
          challengeId,
          roomCode: room.code,
          hostSecret: room.hostSecret,
          by: { userId: toUser.id, displayName: toUser.displayName },
        })
      }
      for (const sid of toSockets) {
        io.to(sid).emit('friends:challengeMatchReady', {
          challengeId,
          roomCode: room.code,
          by: { userId: fromUser.id, displayName: fromUser.displayName },
        })
      }

      cb?.({ ok: true, accepted: true, roomCode: room.code })
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid challenge response')
      cb?.({ ok: false, code: e.code, message: e.message })
    }
  })

  socket.on('room:inviteFriend', (raw, cb) => {
    try {
      roomInviteSchema.parse(raw)
      const friendUserId = String((raw as any)?.friendUserId ?? '').trim()
      const authToken = String((raw as any)?.authToken ?? (raw as any)?.token ?? '').trim() || undefined
      if (!friendUserId) throw new GameRuleError('BAD_REQUEST', 'friendUserId is required')

      let fromUserId = (socket.data as any).userId as string | undefined
      if (!fromUserId && authToken) {
        const auth = resolveAuthIdentity(authToken)
        if (auth) {
          setSocketUser(auth.userId)
          lastSeenByUserId.set(auth.userId, Date.now())
          fromUserId = auth.userId
        }
      }
      if (!fromUserId) throw new GameRuleError('AUTH_REQUIRED', 'Sign in first')
      if (!areFriends(fromUserId, friendUserId)) throw new GameRuleError('NOT_FRIENDS', 'You can only invite accepted friends')

      const code = currentRoomCode()
      const room = getRoom(code)
      const fromUser = getUserById(fromUserId)
      if (!fromUser) throw new GameRuleError('AUTH_REQUIRED', 'Sign in first')

      const alreadyInLobby = [...room.clients.values()].some((c) => c.userId === friendUserId)
      if (alreadyInLobby) {
        throw new GameRuleError('ALREADY_IN_LOBBY', 'Friend is already in this lobby')
      }

      pruneExpiredRoomInvites()
      const duplicatePending = [...roomInviteById.values()].some(
        (i) => i.status === 'PENDING' && i.roomCode === room.code && i.toUserId === friendUserId,
      )
      if (duplicatePending) {
        throw new GameRuleError('INVITE_ALREADY_PENDING', 'Invite already pending for this friend')
      }

      const invite: RoomInvite = {
        id: randomId(10),
        fromUserId,
        toUserId: friendUserId,
        roomCode: room.code,
        roomTitle: room.title || null,
        createdAt: Date.now(),
        status: 'PENDING',
      }
      roomInviteById.set(invite.id, invite)

      const targetSocketIds = [...(onlineSocketsByUserId.get(friendUserId) ?? new Set<string>())]
      for (const targetSocketId of targetSocketIds) {
        io.to(targetSocketId).emit('friends:roomInvite', {
          inviteId: invite.id,
          roomCode: room.code,
          roomTitle: room.title || null,
          from: { userId: fromUser.id, displayName: fromUser.displayName },
          createdAt: invite.createdAt,
        })
      }

      cb?.({ ok: true, delivered: targetSocketIds.length })
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid room invite request')
      cb?.({ ok: false, code: e.code, message: e.message })
    }
  })

  socket.on('room:inviteRespond', (raw, cb) => {
    try {
      const inviteId = String((raw as any)?.inviteId ?? '').trim()
      const accept = Boolean((raw as any)?.accept)
      const authToken = String((raw as any)?.authToken ?? (raw as any)?.token ?? '').trim() || undefined
      if (!inviteId) throw new GameRuleError('BAD_REQUEST', 'inviteId is required')

      let toUserId = (socket.data as any).userId as string | undefined
      if (!toUserId && authToken) {
        const auth = resolveAuthIdentity(authToken)
        if (auth) {
          setSocketUser(auth.userId)
          lastSeenByUserId.set(auth.userId, Date.now())
          toUserId = auth.userId
        }
      }
      if (!toUserId) throw new GameRuleError('AUTH_REQUIRED', 'Sign in first')

      const invite = roomInviteById.get(inviteId)
      if (!invite || invite.status !== 'PENDING') throw new GameRuleError('INVITE_NOT_FOUND', 'Invite not found')
      if (invite.toUserId !== toUserId) throw new GameRuleError('NOT_ALLOWED', 'Not your invite')
      if (Date.now() - invite.createdAt > ROOM_INVITE_EXPIRE_MS) {
        invite.status = 'EXPIRED'
        throw new GameRuleError('INVITE_EXPIRED', 'Invite expired')
      }

      if (!accept) {
        invite.status = 'DECLINED'
        cb?.({ ok: true, accepted: false })
        return
      }

      getRoom(invite.roomCode)
      invite.status = 'ACCEPTED'
      cb?.({ ok: true, accepted: true, roomCode: invite.roomCode })
    } catch (err) {
      const e = err instanceof GameRuleError ? err : new GameRuleError('BAD_REQUEST', 'Invalid invite response')
      cb?.({ ok: false, code: e.code, message: e.message })
    }
  })

  socket.on('room:create', (raw, cb) => {
    try {
      const { name, authToken, settings, title, isPublic, tournamentId, tournamentMatchId } = createSchema.parse(raw)
      validateGameSettings(settings)
      validateLobbyStartScorePreset(settings)
      const auth = resolveAuthIdentity(authToken)
      const userId = auth?.userId
      const effectiveName = auth?.displayName ?? name

      leaveCurrentRoomIfAny()

      const room = createRoom({ hostName: effectiveName, settings })
      room.title = settings.gameType === 'PRACTICE' ? '' : (title ?? '').trim()
      room.isPublic = settings.gameType === 'PRACTICE' ? false : Boolean(isPublic)
      addClient(room, { socketId: socket.id, name: effectiveName, userId, isHost: true, role: 'PLAYER' })
      setSocketUser(userId)

      // By default, the host is also a player in the lobby.
      const hostPlayer = ensurePlayer(room.code, effectiveName, socket.id, userId)
      let responseRole: 'PLAYER' | 'SPECTATOR' = 'PLAYER'
      let responsePlayerId: string | undefined = hostPlayer?.id

      if (settings.gameType === 'PRACTICE') {
        room.match.status = 'LIVE'
        room.match.currentLegIndex = 0
        room.match.legs[0].startingPlayerIndex = 0
      }

      socket.join(roomChannel(room.code))
      ;(socket.data as any).roomCode = room.code

      if (userId && tournamentId && tournamentMatchId) {
        try {
          attachRoomToMatchByParticipant({
            tournamentId,
            matchId: tournamentMatchId,
            userId,
            roomCode: room.code,
          })

          const participants = getTournamentMatchParticipants({ tournamentId, matchId: tournamentMatchId })
          if (participants.length > 0) {
            room.match.players = []
            room.match.legsWonByPlayerId = {}
            room.match.legsWonInCurrentSetByPlayerId = {}
            room.match.setsWonByPlayerId = {}
            room.controllerSocketIdByPlayerId = {}
            room.playerUserIdByPlayerId = {}

            for (const p of participants) {
              const player = addPlayer(room, p.displayName)
              if (p.source === 'USER') room.playerUserIdByPlayerId[player.id] = p.userId
              if (p.source === 'USER' && p.userId === userId) {
                room.controllerSocketIdByPlayerId[player.id] = socket.id
              }
            }

            room.match.legs[0].startingPlayerIndex = 0
            room.match.currentLegIndex = 0

            const controlledPlayerId = Object.entries(room.controllerSocketIdByPlayerId).find(([, sid]) => sid === socket.id)?.[0]
            if (controlledPlayerId) {
              responseRole = 'PLAYER'
              responsePlayerId = controlledPlayerId
            } else {
              responseRole = 'SPECTATOR'
              responsePlayerId = undefined
              const c = room.clients.get(socket.id)
              if (c) c.role = 'SPECTATOR'
            }
          }
        } catch (err) {
          // eslint-disable-next-line no-console
          console.warn('tournament room attach failed', err)
        }
      }

      cb?.({ ok: true, code: room.code, hostSecret: room.hostSecret, role: responseRole, playerId: responsePlayerId })
      emitSnapshot(room.code)
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn('room:create failed', {
        error: err instanceof Error ? err.message : String(err),
        raw: {
          ...(typeof raw === 'object' && raw ? (raw as Record<string, unknown>) : {}),
          authToken: typeof (raw as any)?.authToken === 'string' ? '[present]' : undefined,
        },
      })
      if (err instanceof ZodError) {
        const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
        cb?.({ ok: false, code: 'BAD_REQUEST', message: 'Invalid room create payload', details: issues })
        return
      }
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
      const tournamentMatch = getTournamentMatchForRoomCode(code)
      const practiceSolo = room.match.settings.gameType === 'PRACTICE'

      const normalized = effectiveName.trim().toLowerCase()
      const isExistingPlayerName = room.match.players.some((p) => p.name.toLowerCase() === normalized)
      const gameStarted = room.match.status !== 'LOBBY'

      let role: 'PLAYER' | 'SPECTATOR' =
        isExistingPlayerName ? 'PLAYER' : gameStarted ? 'SPECTATOR' : asSpectator ? 'SPECTATOR' : 'PLAYER'

      if (practiceSolo && gameStarted) {
        role = hostSecret === room.hostSecret ? 'PLAYER' : 'SPECTATOR'
      }

      if (tournamentMatch) {
        if (tournamentMatch.participationMode === 'ONLINE') {
          const allowedUserIds = new Set(tournamentMatch.participants.map((p) => p.userId))
          role = userId && allowedUserIds.has(userId) ? 'PLAYER' : 'SPECTATOR'
        } else {
          const allowedNames = new Set(tournamentMatch.participants.map((p) => p.displayName.trim().toLowerCase()))
          role = allowedNames.has(normalized) ? 'PLAYER' : 'SPECTATOR'
        }
      }

      addClient(room, {
        socketId: socket.id,
        name: effectiveName,
        userId,
        isHost: hostSecret === room.hostSecret,
        role,
      })
      setSocketUser(userId)

      let playerId: string | undefined
      if (role === 'PLAYER') {
        if (tournamentMatch) {
          if (tournamentMatch.participationMode === 'ONLINE') {
            const mapped = Object.entries(room.playerUserIdByPlayerId).find(([, uid]) => uid === userId)?.[0]
            if (mapped) {
              room.controllerSocketIdByPlayerId[mapped] = socket.id
              playerId = mapped
            } else {
              role = 'SPECTATOR'
              const c = room.clients.get(socket.id)
              if (c) c.role = 'SPECTATOR'
            }
          } else {
            const p = getPlayerByName(code, effectiveName)
            if (p) {
              room.controllerSocketIdByPlayerId[p.id] = socket.id
              playerId = p.id
            } else {
              role = 'SPECTATOR'
              const c = room.clients.get(socket.id)
              if (c) c.role = 'SPECTATOR'
            }
          }
        } else if (room.match.status === 'LOBBY') {
          const p = ensurePlayer(code, effectiveName, socket.id, userId)
          playerId = p?.id
        } else {
          const p =
            practiceSolo && hostSecret === room.hostSecret
              ? room.match.players[0] ?? null
              : getPlayerByName(code, effectiveName)
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
      // eslint-disable-next-line no-console
      console.warn('room:join failed', {
        error: err instanceof Error ? err.message : String(err),
        raw: {
          ...(typeof raw === 'object' && raw ? (raw as Record<string, unknown>) : {}),
          authToken: typeof (raw as any)?.authToken === 'string' ? '[present]' : undefined,
        },
      })
      if (err instanceof ZodError) {
        const issues = err.issues.map((i) => ({ path: i.path.join('.'), message: i.message }))
        cb?.({ ok: false, code: 'BAD_REQUEST', message: 'Invalid room join payload', details: issues })
        return
      }
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

      const tournamentMatch = getTournamentMatchForRoomCode(code)
      if (tournamentMatch) {
        if (tournamentMatch.participationMode === 'ONLINE') {
          const allowed = new Set(tournamentMatch.participants.map((p) => p.userId))
          if (!client.userId || !allowed.has(client.userId)) {
            throw new GameRuleError('NOT_ALLOWED', 'Only assigned tournament players can become player')
          }
        } else {
          const allowedNames = new Set(tournamentMatch.participants.map((p) => p.displayName.trim().toLowerCase()))
          if (!allowedNames.has(client.name.trim().toLowerCase())) {
            throw new GameRuleError('NOT_ALLOWED', 'Only assigned tournament players can become player')
          }
        }
      }

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
      if (getTournamentMatchForRoomCode(code)) {
        throw new GameRuleError('NOT_ALLOWED', 'Tournament match players are fixed')
      }
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
      if (getTournamentMatchForRoomCode(code)) {
        throw new GameRuleError('NOT_ALLOWED', 'Tournament match players are fixed')
      }
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
      validateGameSettings(settings)
      validateLobbyStartScorePreset(settings)
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
      const snap = computeMatchSnapshotForRoom(room.match)
      const currentIdx = snap.leg.currentPlayerIndex
      if (currentIdx < 0) throw new GameRuleError('LEG_FINISHED', 'Leg is finished')
      const currentPlayerId = snap.players[currentIdx].id

      const controller = room.controllerSocketIdByPlayerId[currentPlayerId]
      const tournamentMatch = getTournamentMatchForRoomCode(code)
      const client = getClient(room, socket.id)
      const localHostOverride = Boolean(client?.isHost && tournamentMatch?.participationMode === 'LOCAL')
      if (controller !== socket.id && !localHostOverride) {
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
    const userId = (socket.data as any).userId as string | undefined
    if (userId) removeOnlineSocket(userId, socket.id)
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
  setInterval(processTournamentNoShowForfeits, 15_000)
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
