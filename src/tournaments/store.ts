import fs from 'fs'
import path from 'path'
import { randomBytes } from 'crypto'
import type { GameSettings } from '../game/types'

export type TournamentStatus = 'LOBBY' | 'LIVE' | 'FINISHED'
export type TournamentMatchStatus = 'PENDING' | 'READY' | 'LIVE' | 'FINISHED' | 'BYE'

export type TournamentPlayer = {
  userId: string
  displayName: string
  joinedAt: number
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
  settings: GameSettings
  players: TournamentPlayer[]
  rounds: TournamentRound[]
  winnerUserId: string | null
}

type TournamentsDb = {
  tournaments: Record<string, Tournament>
}

const dbFile = path.join(process.cwd(), 'data', 'tournaments.json')
let db = loadDb()

export function createTournament(args: {
  name: string
  createdByUserId: string
  createdByDisplayName: string
  settings: GameSettings
  maxPlayers: number
}): Tournament {
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
    settings: args.settings,
    players: [
      {
        userId: args.createdByUserId,
        displayName: sanitizeName(args.createdByDisplayName),
        joinedAt: now,
      },
    ],
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
  if (t.status !== 'LOBBY') throw new Error('TOURNAMENT_ALREADY_STARTED')
  if (t.players.find((p) => p.userId === args.userId)) return t
  if (t.players.length >= t.maxPlayers) throw new Error('TOURNAMENT_FULL')
  t.players.push({
    userId: args.userId,
    displayName: sanitizeName(args.displayName),
    joinedAt: Date.now(),
  })
  persistDb()
  return t
}

export function leaveTournament(args: { tournamentId: string; userId: string }): Tournament {
  const t = getTournament(args.tournamentId)
  if (t.status !== 'LOBBY') throw new Error('TOURNAMENT_ALREADY_STARTED')
  t.players = t.players.filter((p) => p.userId !== args.userId)
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

export function startTournament(args: { tournamentId: string; requestedByUserId: string }): Tournament {
  const t = getTournament(args.tournamentId)
  if (t.createdByUserId !== args.requestedByUserId) throw new Error('TOURNAMENT_HOST_REQUIRED')
  if (t.status !== 'LOBBY') throw new Error('TOURNAMENT_ALREADY_STARTED')
  if (t.players.length < 2) throw new Error('TOURNAMENT_NEEDS_PLAYERS')

  const bracketSize = nextPowerOfTwo(t.players.length)
  const roundsCount = Math.log2(bracketSize)
  const rounds: TournamentRound[] = []

  const firstMatches: TournamentMatch[] = []
  for (let i = 0; i < bracketSize / 2; i++) {
    const a = t.players[i * 2]?.userId ?? null
    const b = t.players[i * 2 + 1]?.userId ?? null
    firstMatches.push({
      id: randomId(8),
      roundIndex: 0,
      matchIndex: i,
      playerAUserId: a,
      playerBUserId: b,
      winnerUserId: null,
      roomCode: null,
      status: 'PENDING',
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
  normalizeBracket(t)
  persistDb()
  return t
}

function normalizeBracket(t: Tournament): void {
  if (t.rounds.length < 1) return

  for (let r = 0; r < t.rounds.length; r++) {
    if (r > 0) {
      const prev = t.rounds[r - 1].matches
      for (const m of t.rounds[r].matches) {
        const srcA = prev[m.matchIndex * 2] ?? null
        const srcB = prev[m.matchIndex * 2 + 1] ?? null
        m.playerAUserId = srcA?.winnerUserId ?? null
        m.playerBUserId = srcB?.winnerUserId ?? null
      }
    }

    for (const m of t.rounds[r].matches) {
      if (m.winnerUserId && m.winnerUserId !== m.playerAUserId && m.winnerUserId !== m.playerBUserId) {
        m.winnerUserId = null
      }

      if (m.playerAUserId && !m.playerBUserId) {
        m.winnerUserId = m.playerAUserId
        m.roomCode = null
        m.status = 'BYE'
        continue
      }
      if (!m.playerAUserId && m.playerBUserId) {
        m.winnerUserId = m.playerBUserId
        m.roomCode = null
        m.status = 'BYE'
        continue
      }
      if (!m.playerAUserId && !m.playerBUserId) {
        m.winnerUserId = null
        m.roomCode = null
        m.status = 'PENDING'
        continue
      }

      if (m.winnerUserId) {
        m.status = 'FINISHED'
      } else {
        m.status = m.roomCode ? 'LIVE' : 'READY'
      }
    }
  }

  const finalRound = t.rounds[t.rounds.length - 1]
  const finalMatch = finalRound?.matches?.[0] ?? null
  if (finalMatch?.winnerUserId) {
    t.winnerUserId = finalMatch.winnerUserId
    t.status = 'FINISHED'
  } else {
    t.winnerUserId = null
    t.status = 'LIVE'
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
      const initial: TournamentsDb = { tournaments: {} }
      fs.writeFileSync(dbFile, JSON.stringify(initial, null, 2), 'utf8')
      return initial
    }
    const parsed = JSON.parse(fs.readFileSync(dbFile, 'utf8'))
    const tournaments = typeof parsed?.tournaments === 'object' && parsed.tournaments ? parsed.tournaments : {}
    return { tournaments }
  } catch {
    return { tournaments: {} }
  }
}

function persistDb(): void {
  const dir = path.dirname(dbFile)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(dbFile, JSON.stringify(db, null, 2), 'utf8')
}
