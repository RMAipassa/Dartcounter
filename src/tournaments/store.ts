import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import type { GameSettings } from '../game/types'

export type TournamentStatus = 'LOBBY' | 'LIVE' | 'FINISHED'
export type TournamentMatchStatus = 'PENDING' | 'READY' | 'LIVE' | 'FINISHED' | 'BYE' | 'NO_SHOW'
export type TournamentSeedingMode = 'JOIN_ORDER' | 'RANDOM' | 'MANUAL'
export type TournamentParticipationMode = 'ONLINE' | 'LOCAL'

export type TournamentPlayer = {
  userId: string
  displayName: string
  joinedAt: number
  source?: 'USER' | 'LOCAL'
}

export type TournamentMatch = {
  id: string
  roundIndex: number
  matchIndex: number
  playerAUserId: string | null
  playerBUserId: string | null
  winnerUserId: string | null
  roomCode: string | null
  status: TournamentMatchStatus
  resolved: boolean
  joinDeadlineAt: number | null
  readyUserIds: string[]
}

export type TournamentRound = {
  roundIndex: number
  matches: TournamentMatch[]
}

export type Tournament = {
  id: string
  name: string
  createdAt: number
  createdByUserId: string
  createdByDisplayName: string
  status: TournamentStatus
  format: 'SINGLE_ELIM'
  maxPlayers: number
  participationMode: TournamentParticipationMode
  settings: GameSettings
  players: TournamentPlayer[]
  seedingMode: TournamentSeedingMode
  manualSeedUserIds: string[]
  rounds: TournamentRound[]
  winnerUserId: string | null
}

export type TournamentInvite = {
  id: string
  tournamentId: string
  fromUserId: string
  toUserId: string
  createdAt: number
  status: 'PENDING' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED'
}

type TournamentsDb = {
  tournaments: Record<string, Tournament>
  invites: Record<string, TournamentInvite>
}

const dbFile = path.join(process.cwd(), 'data', 'tournaments.json')
let db = loadDb()

export function createTournament(args: {
  name: string
  createdByUserId: string
  createdByDisplayName: string
  settings: GameSettings
  maxPlayers: number
  participationMode: TournamentParticipationMode
}): Tournament {
  if (args.settings.gameType === 'PRACTICE') throw new Error('TOURNAMENT_PRACTICE_NOT_ALLOWED')
  const now = Date.now()
  const t: Tournament = {
    id: randomId(10),
    name: args.name.trim().slice(0, 64),
    createdAt: now,
    createdByUserId: args.createdByUserId,
    createdByDisplayName: sanitizeName(args.createdByDisplayName),
    status: 'LOBBY',
    format: 'SINGLE_ELIM',
    maxPlayers: clampInt(args.maxPlayers, 2, 128, 16),
    participationMode: args.participationMode,
    settings: args.settings,
    players: [
      {
        userId: args.createdByUserId,
        displayName: sanitizeName(args.createdByDisplayName),
        joinedAt: now,
        source: 'USER',
      },
    ],
    seedingMode: 'JOIN_ORDER',
    manualSeedUserIds: [args.createdByUserId],
    rounds: [],
    winnerUserId: null,
  }
  db.tournaments[t.id] = t
  persistDb()
  return t
}

export function listTournaments(): Tournament[] {
  return Object.values(db.tournaments).sort((a, b) => b.createdAt - a.createdAt)
}

export function getTournament(id: string): Tournament {
  const t = db.tournaments[id]
  if (!t) throw new Error('TOURNAMENT_NOT_FOUND')
  return t
}

export function joinTournament(args: { tournamentId: string; userId: string; displayName: string }): Tournament {
  const t = getTournament(args.tournamentId)
  if (t.participationMode !== 'ONLINE') throw new Error('TOURNAMENT_ONLINE_ONLY')
  if (t.status !== 'LOBBY') throw new Error('TOURNAMENT_ALREADY_STARTED')
  if (t.players.find((p) => p.userId === args.userId)) return t
  if (t.players.length >= t.maxPlayers) throw new Error('TOURNAMENT_FULL')
  t.players.push({
    userId: args.userId,
    displayName: sanitizeName(args.displayName),
    joinedAt: Date.now(),
    source: 'USER',
  })
  if (!t.manualSeedUserIds.includes(args.userId)) t.manualSeedUserIds.push(args.userId)
  persistDb()
  return t
}

export function leaveTournament(args: { tournamentId: string; userId: string }): Tournament {
  const t = getTournament(args.tournamentId)
  if (t.status !== 'LOBBY') throw new Error('TOURNAMENT_ALREADY_STARTED')
  t.players = t.players.filter((p) => p.userId !== args.userId)
  t.manualSeedUserIds = t.manualSeedUserIds.filter((id) => id !== args.userId)
  if (t.players.length < 1) {
    delete db.tournaments[t.id]
    persistDb()
    throw new Error('TOURNAMENT_DELETED_EMPTY')
  }
  if (!t.players.find((p) => p.userId === t.createdByUserId)) {
    const nextHost = t.players[0]
    t.createdByUserId = nextHost.userId
    t.createdByDisplayName = nextHost.displayName
  }
  persistDb()
  return t
}

export function setTournamentSeeding(args: {
  tournamentId: string
  requestedByUserId: string
  mode: TournamentSeedingMode
  manualSeedUserIds?: string[]
}): Tournament {
  const t = getTournament(args.tournamentId)
  if (t.createdByUserId !== args.requestedByUserId) throw new Error('TOURNAMENT_HOST_REQUIRED')
  if (t.status !== 'LOBBY') throw new Error('TOURNAMENT_ALREADY_STARTED')

  t.seedingMode = args.mode
  if (args.mode === 'MANUAL') {
    const incoming = Array.isArray(args.manualSeedUserIds) ? args.manualSeedUserIds : t.players.map((p) => p.userId)
    const filtered = incoming.filter((id, idx) => typeof id === 'string' && incoming.indexOf(id) === idx)
    const existing = new Set(t.players.map((p) => p.userId))
    const ordered = filtered.filter((id) => existing.has(id))
    for (const p of t.players) {
      if (!ordered.includes(p.userId)) ordered.push(p.userId)
    }
    t.manualSeedUserIds = ordered
  }
  persistDb()
  return t
}

export function addLocalTournamentPlayer(args: {
  tournamentId: string
  requestedByUserId: string
  displayName: string
}): Tournament {
  const t = getTournament(args.tournamentId)
  if (t.participationMode !== 'LOCAL') throw new Error('TOURNAMENT_LOCAL_ONLY')
  if (t.createdByUserId !== args.requestedByUserId) throw new Error('TOURNAMENT_HOST_REQUIRED')
  if (t.status !== 'LOBBY') throw new Error('TOURNAMENT_ALREADY_STARTED')
  if (t.players.length >= t.maxPlayers) throw new Error('TOURNAMENT_FULL')

  const name = sanitizeName(args.displayName)
  if (!name) throw new Error('TOURNAMENT_INVALID_PLAYER')
  if (t.players.some((p) => p.displayName.toLowerCase() === name.toLowerCase())) {
    throw new Error('TOURNAMENT_PLAYER_NAME_TAKEN')
  }

  const localUserId = `local_${randomId(6)}`
  t.players.push({
    userId: localUserId,
    displayName: name,
    joinedAt: Date.now(),
    source: 'LOCAL',
  })
  if (!t.manualSeedUserIds.includes(localUserId)) t.manualSeedUserIds.push(localUserId)
  persistDb()
  return t
}

export function startTournament(args: { tournamentId: string; requestedByUserId: string }): Tournament {
  const t = getTournament(args.tournamentId)
  if (t.createdByUserId !== args.requestedByUserId) throw new Error('TOURNAMENT_HOST_REQUIRED')
  if (t.status !== 'LOBBY') throw new Error('TOURNAMENT_ALREADY_STARTED')
  if (t.players.length < 2) throw new Error('TOURNAMENT_NEEDS_PLAYERS')

  const seeded = getSeededPlayers(t)
  const bracketSize = nextPowerOfTwo(seeded.length)
  const roundsCount = Math.log2(bracketSize)
  const rounds: TournamentRound[] = []

  const firstMatches: TournamentMatch[] = []
  for (let i = 0; i < bracketSize / 2; i++) {
    const a = seeded[i * 2]?.userId ?? null
    const b = seeded[i * 2 + 1]?.userId ?? null
    firstMatches.push({
      id: randomId(8),
      roundIndex: 0,
      matchIndex: i,
      playerAUserId: a,
      playerBUserId: b,
      winnerUserId: null,
      roomCode: null,
      status: 'PENDING',
      resolved: false,
      joinDeadlineAt: null,
      readyUserIds: [],
    })
  }
  rounds.push({ roundIndex: 0, matches: firstMatches })

  for (let r = 1; r < roundsCount; r++) {
    const matchCount = bracketSize / 2 ** (r + 1)
    const matches: TournamentMatch[] = []
    for (let i = 0; i < matchCount; i++) {
      matches.push({
        id: randomId(8),
        roundIndex: r,
        matchIndex: i,
        playerAUserId: null,
        playerBUserId: null,
        winnerUserId: null,
        roomCode: null,
        status: 'PENDING',
        resolved: false,
        joinDeadlineAt: null,
        readyUserIds: [],
      })
    }
    rounds.push({ roundIndex: r, matches })
  }

  t.rounds = rounds
  t.status = 'LIVE'
  t.winnerUserId = null
  normalizeBracket(t)
  persistDb()
  return t
}

export function getTournamentMatchParticipants(args: {
  tournamentId: string
  matchId: string
}): Array<{ userId: string; displayName: string; source: 'USER' | 'LOCAL' }> {
  const t = getTournament(args.tournamentId)
  const match = findMatch(t, args.matchId)
  const ids = [match.playerAUserId, match.playerBUserId].filter((x): x is string => Boolean(x))
  return ids
    .map((id) => {
      const p = t.players.find((x) => x.userId === id)
      if (!p) return null
      return {
        userId: p.userId,
        displayName: p.displayName,
        source: p.source === 'LOCAL' ? 'LOCAL' : 'USER',
      }
    })
    .filter(Boolean) as Array<{ userId: string; displayName: string; source: 'USER' | 'LOCAL' }>
}

export function getTournamentMatchForRoomCode(roomCode: string): {
  tournamentId: string
  participationMode: TournamentParticipationMode
  match: TournamentMatch
  participants: TournamentPlayer[]
} | null {
  const code = roomCode.toUpperCase()
  for (const t of Object.values(db.tournaments)) {
    for (const r of t.rounds) {
      const m = r.matches.find((x) => x.roomCode?.toUpperCase() === code)
      if (!m) continue
      const ids = [m.playerAUserId, m.playerBUserId].filter((x): x is string => Boolean(x))
      const participants = t.players.filter((p) => ids.includes(p.userId))
      return { tournamentId: t.id, participationMode: t.participationMode, match: m, participants }
    }
  }
  return null
}

export function listDueTournamentNoShowChecks(nowMs: number): Array<{
  tournamentId: string
  matchId: string
  playerAUserId: string | null
  playerBUserId: string | null
  roomCode: string
}> {
  const out: Array<{
    tournamentId: string
    matchId: string
    playerAUserId: string | null
    playerBUserId: string | null
    roomCode: string
  }> = []
  for (const t of Object.values(db.tournaments)) {
    if (t.status !== 'LIVE' || t.participationMode !== 'ONLINE') continue
    for (const r of t.rounds) {
      for (const m of r.matches) {
        if (!m.roomCode || !m.joinDeadlineAt) continue
        if (m.resolved || m.winnerUserId) continue
        if (nowMs < m.joinDeadlineAt) continue
        out.push({
          tournamentId: t.id,
          matchId: m.id,
          playerAUserId: m.playerAUserId,
          playerBUserId: m.playerBUserId,
          roomCode: m.roomCode,
        })
      }
    }
  }
  return out
}

export function resolveTournamentNoShow(args: {
  tournamentId: string
  matchId: string
  presentUserIds: string[]
}): Tournament | null {
  const t = getTournament(args.tournamentId)
  const m = findMatch(t, args.matchId)
  if (m.resolved || m.winnerUserId) return null
  const present = new Set(args.presentUserIds)
  const aIn = Boolean(m.playerAUserId && present.has(m.playerAUserId))
  const bIn = Boolean(m.playerBUserId && present.has(m.playerBUserId))

  if (aIn && bIn) return null

  if (aIn && !bIn) {
    m.winnerUserId = m.playerAUserId
    m.status = 'FINISHED'
    m.resolved = true
    m.readyUserIds = []
    m.joinDeadlineAt = null
  } else if (!aIn && bIn) {
    m.winnerUserId = m.playerBUserId
    m.status = 'FINISHED'
    m.resolved = true
    m.readyUserIds = []
    m.joinDeadlineAt = null
  } else {
    m.winnerUserId = null
    m.status = 'NO_SHOW'
    m.resolved = true
    m.readyUserIds = []
    m.joinDeadlineAt = null
  }

  normalizeBracket(t)
  persistDb()
  return t
}

export function closeTournament(args: { tournamentId: string }): Tournament {
  const t = getTournament(args.tournamentId)
  if (t.status === 'FINISHED') return t
  t.status = 'FINISHED'
  t.winnerUserId = null
  for (const r of t.rounds) {
    for (const m of r.matches) {
      if (m.winnerUserId) {
        m.status = 'FINISHED'
        m.resolved = true
        m.joinDeadlineAt = null
        continue
      }
      if (m.playerAUserId || m.playerBUserId) {
        m.status = 'NO_SHOW'
      } else {
        m.status = 'PENDING'
      }
      m.resolved = true
      m.joinDeadlineAt = null
      m.roomCode = m.roomCode ?? null
    }
  }
  persistDb()
  return t
}

export function assignMatchRoom(args: {
  tournamentId: string
  requestedByUserId: string
  matchId: string
  roomCode: string
}): Tournament {
  const t = getTournament(args.tournamentId)
  if (t.createdByUserId !== args.requestedByUserId) throw new Error('TOURNAMENT_HOST_REQUIRED')
  if (t.status !== 'LIVE') throw new Error('TOURNAMENT_NOT_LIVE')

  const match = findMatch(t, args.matchId)
  if (!match.playerAUserId || !match.playerBUserId) throw new Error('TOURNAMENT_MATCH_NOT_READY')
  if (match.winnerUserId) throw new Error('TOURNAMENT_MATCH_DONE')
  match.roomCode = args.roomCode.toUpperCase()
  match.status = 'LIVE'
  match.joinDeadlineAt = t.participationMode === 'ONLINE' ? Date.now() + 3 * 60_000 : null
  match.resolved = false
  match.readyUserIds = []
  persistDb()
  return t
}

export function attachRoomToMatchByParticipant(args: {
  tournamentId: string
  matchId: string
  userId: string
  roomCode: string
}): Tournament {
  const t = getTournament(args.tournamentId)
  if (t.status !== 'LIVE') throw new Error('TOURNAMENT_NOT_LIVE')
  const match = findMatch(t, args.matchId)
  if (match.winnerUserId) throw new Error('TOURNAMENT_MATCH_DONE')
  if (match.roomCode) throw new Error('TOURNAMENT_MATCH_ROOM_EXISTS')
  if (match.playerAUserId !== args.userId && match.playerBUserId !== args.userId && t.createdByUserId !== args.userId) {
    throw new Error('TOURNAMENT_MATCH_NOT_YOURS')
  }
  match.roomCode = args.roomCode.toUpperCase()
  match.status = 'LIVE'
  match.joinDeadlineAt = t.participationMode === 'ONLINE' ? Date.now() + 3 * 60_000 : null
  match.resolved = false
  match.readyUserIds = []
  persistDb()
  return t
}

export function setMatchReady(args: {
  tournamentId: string
  matchId: string
  userId: string
  ready: boolean
}): Tournament {
  const t = getTournament(args.tournamentId)
  if (t.participationMode !== 'ONLINE') throw new Error('TOURNAMENT_ONLINE_ONLY')
  const match = findMatch(t, args.matchId)
  if (t.status !== 'LIVE') throw new Error('TOURNAMENT_NOT_LIVE')
  if (match.winnerUserId || match.resolved) throw new Error('TOURNAMENT_MATCH_DONE')
  if (match.playerAUserId !== args.userId && match.playerBUserId !== args.userId) throw new Error('TOURNAMENT_MATCH_NOT_YOURS')

  const current = new Set(match.readyUserIds)
  if (args.ready) current.add(args.userId)
  else current.delete(args.userId)
  match.readyUserIds = [...current]
  persistDb()
  return t
}

export function reportMatchWinner(args: {
  tournamentId: string
  requestedByUserId: string
  matchId: string
  winnerUserId: string
}): Tournament {
  const t = getTournament(args.tournamentId)
  if (t.createdByUserId !== args.requestedByUserId) throw new Error('TOURNAMENT_HOST_REQUIRED')
  if (t.status !== 'LIVE') throw new Error('TOURNAMENT_NOT_LIVE')

  const match = findMatch(t, args.matchId)
  if (match.playerAUserId !== args.winnerUserId && match.playerBUserId !== args.winnerUserId) {
    throw new Error('TOURNAMENT_INVALID_WINNER')
  }
  match.winnerUserId = args.winnerUserId
  match.status = 'FINISHED'
  match.resolved = true
  match.joinDeadlineAt = null
  match.readyUserIds = []
  normalizeBracket(t)
  persistDb()
  return t
}

export function autoReportWinnerByRoom(args: { roomCode: string; winnerUserId?: string | null; winnerDisplayName?: string | null }): Tournament | null {
  const roomCode = args.roomCode.toUpperCase()
  for (const t of Object.values(db.tournaments)) {
    if (t.status !== 'LIVE') continue
    for (const r of t.rounds) {
      const m = r.matches.find((x) => x.roomCode?.toUpperCase() === roomCode && !x.winnerUserId)
      if (!m) continue

      let winnerUserId: string | null = null
      if (args.winnerUserId && (m.playerAUserId === args.winnerUserId || m.playerBUserId === args.winnerUserId)) {
        winnerUserId = args.winnerUserId
      } else if (args.winnerDisplayName) {
        const name = args.winnerDisplayName.trim().toLowerCase()
        const aName = t.players.find((p) => p.userId === m.playerAUserId)?.displayName?.trim().toLowerCase()
        const bName = t.players.find((p) => p.userId === m.playerBUserId)?.displayName?.trim().toLowerCase()
        if (aName && aName === name) winnerUserId = m.playerAUserId
        else if (bName && bName === name) winnerUserId = m.playerBUserId
      }

      if (!winnerUserId) return null
      m.winnerUserId = winnerUserId
      m.status = 'FINISHED'
      m.resolved = true
      m.joinDeadlineAt = null
      m.readyUserIds = []
      normalizeBracket(t)
      persistDb()
      return t
    }
  }
  return null
}

export function listPendingTournamentInvitesForUser(userId: string): TournamentInvite[] {
  pruneExpiredInvites()
  return Object.values(db.invites)
    .filter((i) => i.toUserId === userId && i.status === 'PENDING')
    .sort((a, b) => b.createdAt - a.createdAt)
}

export function sendTournamentInvite(args: {
  tournamentId: string
  fromUserId: string
  toUserId: string
}): TournamentInvite {
  if (args.fromUserId === args.toUserId) throw new Error('TOURNAMENT_INVITE_SELF')
  const t = getTournament(args.tournamentId)
  if (t.participationMode !== 'ONLINE') throw new Error('TOURNAMENT_ONLINE_ONLY')
  if (t.status !== 'LOBBY') throw new Error('TOURNAMENT_ALREADY_STARTED')
  if (!t.players.find((p) => p.userId === args.fromUserId)) throw new Error('TOURNAMENT_NOT_PARTICIPANT')
  if (t.players.find((p) => p.userId === args.toUserId)) throw new Error('TOURNAMENT_ALREADY_JOINED')

  pruneExpiredInvites()
  const duplicate = Object.values(db.invites).find(
    (i) => i.tournamentId === args.tournamentId && i.toUserId === args.toUserId && i.status === 'PENDING',
  )
  if (duplicate) return duplicate

  const invite: TournamentInvite = {
    id: randomId(10),
    tournamentId: args.tournamentId,
    fromUserId: args.fromUserId,
    toUserId: args.toUserId,
    createdAt: Date.now(),
    status: 'PENDING',
  }
  db.invites[invite.id] = invite
  persistDb()
  return invite
}

export function respondTournamentInvite(args: {
  inviteId: string
  toUserId: string
  accept: boolean
  displayName: string
}): Tournament {
  const invite = db.invites[args.inviteId]
  if (!invite || invite.status !== 'PENDING') throw new Error('TOURNAMENT_INVITE_NOT_FOUND')
  if (invite.toUserId !== args.toUserId) throw new Error('TOURNAMENT_INVITE_NOT_YOURS')
  pruneExpiredInvites()
  if (invite.status !== 'PENDING') throw new Error('TOURNAMENT_INVITE_EXPIRED')

  if (!args.accept) {
    invite.status = 'DECLINED'
    persistDb()
    return getTournament(invite.tournamentId)
  }

  invite.status = 'ACCEPTED'
  const t = joinTournament({ tournamentId: invite.tournamentId, userId: args.toUserId, displayName: args.displayName })
  persistDb()
  return t
}

function normalizeBracket(t: Tournament): void {
  if (t.rounds.length < 1) return

  for (let r = 0; r < t.rounds.length; r++) {
    for (const m of t.rounds[r].matches) {
      const prev = r > 0 ? t.rounds[r - 1].matches : null
      const srcA = prev ? prev[m.matchIndex * 2] ?? null : null
      const srcB = prev ? prev[m.matchIndex * 2 + 1] ?? null : null
      const srcAResolved = !srcA || Boolean(srcA.resolved)
      const srcBResolved = !srcB || Boolean(srcB.resolved)

      if (r > 0) {
        m.playerAUserId = srcA?.winnerUserId ?? null
        m.playerBUserId = srcB?.winnerUserId ?? null
      }

      if (m.winnerUserId && m.winnerUserId !== m.playerAUserId && m.winnerUserId !== m.playerBUserId) {
        m.winnerUserId = null
        m.resolved = false
      }

      if (r > 0 && (!srcAResolved || !srcBResolved)) {
        m.winnerUserId = null
        m.roomCode = null
        m.joinDeadlineAt = null
        m.resolved = false
        m.readyUserIds = []
        m.status = 'PENDING'
        continue
      }

      if (m.playerAUserId && !m.playerBUserId) {
        m.winnerUserId = m.playerAUserId
        m.roomCode = null
        m.joinDeadlineAt = null
        m.resolved = true
        m.readyUserIds = []
        m.status = 'BYE'
        continue
      }
      if (!m.playerAUserId && m.playerBUserId) {
        m.winnerUserId = m.playerBUserId
        m.roomCode = null
        m.joinDeadlineAt = null
        m.resolved = true
        m.readyUserIds = []
        m.status = 'BYE'
        continue
      }
      if (!m.playerAUserId && !m.playerBUserId) {
        m.winnerUserId = null
        m.roomCode = null
        m.joinDeadlineAt = null
        m.resolved = true
        m.readyUserIds = []
        m.status = 'NO_SHOW'
        continue
      }

      if (m.winnerUserId) {
        m.resolved = true
        m.joinDeadlineAt = null
        m.readyUserIds = []
        m.status = 'FINISHED'
      } else {
        m.resolved = false
        if (m.roomCode) m.readyUserIds = []
        m.status = m.roomCode ? 'LIVE' : 'READY'
      }
    }
  }

  const finalRound = t.rounds[t.rounds.length - 1]
  const finalMatch = finalRound?.matches?.[0] ?? null
  if (finalMatch?.winnerUserId) {
    t.winnerUserId = finalMatch.winnerUserId
    t.status = 'FINISHED'
  } else if (finalMatch?.resolved) {
    t.winnerUserId = null
    t.status = 'FINISHED'
  } else {
    t.winnerUserId = null
    t.status = 'LIVE'
  }
}

function getSeededPlayers(t: Tournament): TournamentPlayer[] {
  const players = [...t.players]
  if (t.seedingMode === 'RANDOM') {
    shuffle(players)
    return players
  }
  if (t.seedingMode === 'MANUAL') {
    const byId = new Map(players.map((p) => [p.userId, p] as const))
    const out: TournamentPlayer[] = []
    for (const id of t.manualSeedUserIds) {
      const p = byId.get(id)
      if (p) {
        out.push(p)
        byId.delete(id)
      }
    }
    for (const p of players) {
      if (byId.has(p.userId)) out.push(p)
    }
    return out
  }
  return players
}

function shuffle<T>(arr: T[]): void {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1))
    const tmp = arr[i]
    arr[i] = arr[j]
    arr[j] = tmp
  }
}

function pruneExpiredInvites(): void {
  const now = Date.now()
  for (const invite of Object.values(db.invites)) {
    if (invite.status !== 'PENDING') continue
    if (now - invite.createdAt > 7 * 24 * 60 * 60_000) invite.status = 'EXPIRED'
  }
}

function findMatch(t: Tournament, matchId: string): TournamentMatch {
  for (const r of t.rounds) {
    const m = r.matches.find((x) => x.id === matchId)
    if (m) return m
  }
  throw new Error('TOURNAMENT_MATCH_NOT_FOUND')
}

function nextPowerOfTwo(n: number): number {
  let p = 1
  while (p < n) p <<= 1
  return p
}

function sanitizeName(value: string): string {
  const v = value.trim()
  if (!v) return 'Player'
  return v.slice(0, 32)
}

function clampInt(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback
  const n = Math.trunc(value)
  if (n < min) return min
  if (n > max) return max
  return n
}

function randomId(bytes: number): string {
  return randomBytes(bytes).toString('base64url')
}

function loadDb(): TournamentsDb {
  try {
    const dir = path.dirname(dbFile)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (!fs.existsSync(dbFile)) {
      const initial: TournamentsDb = { tournaments: {}, invites: {} }
      fs.writeFileSync(dbFile, JSON.stringify(initial, null, 2), 'utf8')
      return initial
    }
    const parsed = JSON.parse(fs.readFileSync(dbFile, 'utf8'))
    const tournamentsRaw = typeof parsed?.tournaments === 'object' && parsed.tournaments ? parsed.tournaments : {}
    const invites = typeof parsed?.invites === 'object' && parsed.invites ? parsed.invites : {}
    const tournaments: Record<string, Tournament> = {}
    for (const [id, raw] of Object.entries(tournamentsRaw as Record<string, any>)) {
      const players = Array.isArray(raw?.players)
        ? raw.players.map((p: any) => ({
            ...p,
            source: p?.source === 'LOCAL' ? 'LOCAL' : 'USER',
          }))
        : []
      const participationMode =
        raw?.participationMode === 'LOCAL' || raw?.participationMode === 'ONLINE'
          ? raw.participationMode
          : players.some((p: any) => p.source === 'LOCAL')
            ? 'LOCAL'
            : 'ONLINE'
      tournaments[id] = {
        ...raw,
        players,
        participationMode,
        seedingMode: raw?.seedingMode === 'RANDOM' || raw?.seedingMode === 'MANUAL' ? raw.seedingMode : 'JOIN_ORDER',
        manualSeedUserIds: Array.isArray(raw?.manualSeedUserIds) ? raw.manualSeedUserIds.filter((x: any) => typeof x === 'string') : [],
        rounds: Array.isArray(raw?.rounds)
          ? raw.rounds.map((rr: any) => ({
              ...rr,
              matches: Array.isArray(rr?.matches)
                ? rr.matches.map((m: any) => ({
                    ...m,
                    status:
                      m?.status === 'PENDING' ||
                      m?.status === 'READY' ||
                      m?.status === 'LIVE' ||
                      m?.status === 'FINISHED' ||
                      m?.status === 'BYE' ||
                      m?.status === 'NO_SHOW'
                        ? m.status
                        : 'PENDING',
                    resolved: typeof m?.resolved === 'boolean' ? m.resolved : Boolean(m?.winnerUserId || m?.status === 'BYE'),
                    joinDeadlineAt: typeof m?.joinDeadlineAt === 'number' ? m.joinDeadlineAt : null,
                    readyUserIds: Array.isArray(m?.readyUserIds) ? m.readyUserIds.filter((x: any) => typeof x === 'string') : [],
                  }))
                : [],
            }))
          : [],
      }
    }
    return { tournaments, invites }
  } catch {
    return { tournaments: {}, invites: {} }
  }
}

function persistDb(): void {
  const dir = path.dirname(dbFile)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2), 'utf8')
}
