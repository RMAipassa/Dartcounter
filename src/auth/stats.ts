import fs from 'fs'
import path from 'path'
import type { PlayerId, X01MatchState } from '../game/types'
import type { PlayerStats } from '../game/types'

type GameResult = 'WIN' | 'LOSS'

type GameSummary = {
  roomCode: string
  finishedAt: number
  result: GameResult
  legsWon: number
  legsLost: number
  setsWon: number
  setsLost: number
  dartsThrown: number
  pointsScored: number
  threeDartAvg: number | null
  checkouts: number
  checkoutAttempts: number
  highestCheckout: number | null
  highestScore: number
}

type UserAggregateStats = {
  userId: string
  totalGames: number
  wins: number
  losses: number
  legsWon: number
  legsLost: number
  setsWon: number
  setsLost: number
  dartsThrown: number
  pointsScored: number
  checkouts: number
  checkoutAttempts: number
  highestCheckout: number
  highestScore: number
  updatedAt: number
  lastTenGames: GameSummary[]
}

type GlobalRecords = {
  mostWins: { userId: string; value: number } | null
  highestCheckout: { userId: string; value: number } | null
  highestScore: { userId: string; value: number } | null
  bestThreeDartAverage: { userId: string; value: number } | null
  updatedAt: number
}

type StatsStoreData = {
  users: Record<string, UserAggregateStats>
  global: GlobalRecords
}

export type UserStatsView = {
  allTime: {
    totalGames: number
    wins: number
    losses: number
    winRate: number | null
    legsWon: number
    legsLost: number
    setsWon: number
    setsLost: number
    threeDartAvg: number | null
    checkouts: number
    checkoutAttempts: number
    checkoutRate: number | null
    highestCheckout: number | null
    highestScore: number
  }
  lastTen: {
    games: number
    wins: number
    losses: number
    winRate: number | null
    threeDartAvg: number | null
    checkouts: number
    checkoutAttempts: number
    checkoutRate: number | null
    highestCheckout: number | null
    highestScore: number
  }
  history: GameSummary[]
}

const statsFile = path.join(process.cwd(), 'data', 'user-stats.json')
let db: StatsStoreData = loadDb()

export function recordFinishedMatch(args: {
  roomCode: string
  match: X01MatchState
  statsByPlayerId: Record<PlayerId, PlayerStats>
  playerUserIdByPlayerId: Record<PlayerId, string>
}): void {
  const finishedAt = Date.now()
  const totalLegs = args.match.legs.length
  const setsEnabled = args.match.settings.setsEnabled

  const bestLegs = Math.max(...Object.values(args.match.legsWonByPlayerId), 0)
  const bestSets = Math.max(...Object.values(args.match.setsWonByPlayerId), 0)

  for (const player of args.match.players) {
    const userId = args.playerUserIdByPlayerId[player.id]
    if (!userId) continue
    const ps = args.statsByPlayerId[player.id]
    if (!ps) continue

    const pointsScored = sumPointsForPlayer(args.match, player.id)
    const dartsThrown = sumDartsForPlayer(args.match, player.id)
    const legsWon = ps.legsWon
    const legsLost = Math.max(0, totalLegs - legsWon)
    const setsWon = setsEnabled ? ps.setsWon : 0
    const setsLost = setsEnabled ? Math.max(0, bestSets - setsWon) : 0
    const won = setsEnabled ? setsWon === bestSets && setsWon > 0 : legsWon === bestLegs && legsWon > 0

    const game: GameSummary = {
      roomCode: args.roomCode,
      finishedAt,
      result: won ? 'WIN' : 'LOSS',
      legsWon,
      legsLost,
      setsWon,
      setsLost,
      dartsThrown,
      pointsScored,
      threeDartAvg: ps.threeDartAvg,
      checkouts: ps.checkouts,
      checkoutAttempts: ps.checkoutAttempts,
      highestCheckout: ps.highestFinish,
      highestScore: ps.highestScore,
    }

    const current = db.users[userId] ?? emptyAggregate(userId)
    current.totalGames += 1
    if (won) current.wins += 1
    else current.losses += 1
    current.legsWon += legsWon
    current.legsLost += legsLost
    current.setsWon += setsWon
    current.setsLost += setsLost
    current.dartsThrown += dartsThrown
    current.pointsScored += pointsScored
    current.checkouts += ps.checkouts
    current.checkoutAttempts += ps.checkoutAttempts
    current.highestCheckout = Math.max(current.highestCheckout, ps.highestFinish ?? 0)
    current.highestScore = Math.max(current.highestScore, ps.highestScore)
    current.updatedAt = finishedAt
    current.lastTenGames = [game, ...current.lastTenGames].slice(0, 10)
    db.users[userId] = current
  }

  rebuildGlobalRecords()
  persistDb()
}

export function getUserStats(userId: string): UserStatsView {
  const current = db.users[userId] ?? emptyAggregate(userId)
  const allGames = current.lastTenGames

  return {
    allTime: {
      totalGames: current.totalGames,
      wins: current.wins,
      losses: current.losses,
      winRate: ratioPercent(current.wins, current.totalGames),
      legsWon: current.legsWon,
      legsLost: current.legsLost,
      setsWon: current.setsWon,
      setsLost: current.setsLost,
      threeDartAvg: avgFromPointsAndDarts(current.pointsScored, current.dartsThrown),
      checkouts: current.checkouts,
      checkoutAttempts: current.checkoutAttempts,
      checkoutRate: ratioPercent(current.checkouts, current.checkoutAttempts),
      highestCheckout: current.highestCheckout > 0 ? current.highestCheckout : null,
      highestScore: current.highestScore,
    },
    lastTen: summarizeLastTen(allGames),
    history: [...allGames],
  }
}

export function getGlobalRecords(): GlobalRecords {
  return db.global
}

function summarizeLastTen(games: GameSummary[]): UserStatsView['lastTen'] {
  const total = games.length
  let wins = 0
  let losses = 0
  let points = 0
  let darts = 0
  let checkouts = 0
  let checkoutAttempts = 0
  let highestCheckout = 0
  let highestScore = 0

  for (const g of games) {
    if (g.result === 'WIN') wins += 1
    else losses += 1
    points += g.pointsScored
    darts += g.dartsThrown
    checkouts += g.checkouts
    checkoutAttempts += g.checkoutAttempts
    highestCheckout = Math.max(highestCheckout, g.highestCheckout ?? 0)
    highestScore = Math.max(highestScore, g.highestScore)
  }

  return {
    games: total,
    wins,
    losses,
    winRate: ratioPercent(wins, total),
    threeDartAvg: avgFromPointsAndDarts(points, darts),
    checkouts,
    checkoutAttempts,
    checkoutRate: ratioPercent(checkouts, checkoutAttempts),
    highestCheckout: highestCheckout > 0 ? highestCheckout : null,
    highestScore,
  }
}

function rebuildGlobalRecords(): void {
  let mostWins: GlobalRecords['mostWins'] = null
  let highestCheckout: GlobalRecords['highestCheckout'] = null
  let highestScore: GlobalRecords['highestScore'] = null
  let bestAverage: GlobalRecords['bestThreeDartAverage'] = null

  for (const stat of Object.values(db.users)) {
    if (!mostWins || stat.wins > mostWins.value) mostWins = { userId: stat.userId, value: stat.wins }
    if (!highestCheckout || stat.highestCheckout > highestCheckout.value) {
      highestCheckout = { userId: stat.userId, value: stat.highestCheckout }
    }
    if (!highestScore || stat.highestScore > highestScore.value) {
      highestScore = { userId: stat.userId, value: stat.highestScore }
    }
    const avg = avgFromPointsAndDarts(stat.pointsScored, stat.dartsThrown)
    if (avg != null && (!bestAverage || avg > bestAverage.value)) {
      bestAverage = { userId: stat.userId, value: avg }
    }
  }

  db.global = {
    mostWins,
    highestCheckout,
    highestScore,
    bestThreeDartAverage: bestAverage,
    updatedAt: Date.now(),
  }
}

function emptyAggregate(userId: string): UserAggregateStats {
  return {
    userId,
    totalGames: 0,
    wins: 0,
    losses: 0,
    legsWon: 0,
    legsLost: 0,
    setsWon: 0,
    setsLost: 0,
    dartsThrown: 0,
    pointsScored: 0,
    checkouts: 0,
    checkoutAttempts: 0,
    highestCheckout: 0,
    highestScore: 0,
    updatedAt: 0,
    lastTenGames: [],
  }
}

function sumPointsForPlayer(match: X01MatchState, playerId: string): number {
  let sum = 0
  for (const leg of match.legs) {
    for (const t of leg.turns) {
      if (t.playerId !== playerId) continue
      if (t.input.mode === 'TOTAL') sum += t.input.total
      else sum += t.input.darts.reduce((acc, d) => acc + d.segment * d.multiplier, 0)
    }
  }
  return sum
}

function sumDartsForPlayer(match: X01MatchState, playerId: string): number {
  let sum = 0
  for (const leg of match.legs) {
    for (const t of leg.turns) {
      if (t.playerId !== playerId) continue
      if (t.input.mode === 'PER_DART') sum += t.input.darts.length
      else if (Array.isArray(t.input.darts)) sum += t.input.darts.length
      else sum += 3
    }
  }
  return sum
}

function avgFromPointsAndDarts(points: number, darts: number): number | null {
  if (darts < 1) return null
  return round2((points / darts) * 3)
}

function ratioPercent(a: number, b: number): number | null {
  if (b < 1) return null
  return round2((a / b) * 100)
}

function round2(n: number): number {
  return Math.round(n * 100) / 100
}

function loadDb(): StatsStoreData {
  try {
    const dir = path.dirname(statsFile)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (!fs.existsSync(statsFile)) {
      const initial: StatsStoreData = {
        users: {},
        global: {
          mostWins: null,
          highestCheckout: null,
          highestScore: null,
          bestThreeDartAverage: null,
          updatedAt: Date.now(),
        },
      }
      fs.writeFileSync(statsFile, JSON.stringify(initial, null, 2), 'utf8')
      return initial
    }

    const raw = fs.readFileSync(statsFile, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      users: typeof parsed?.users === 'object' && parsed.users ? parsed.users : {},
      global:
        typeof parsed?.global === 'object' && parsed.global
          ? parsed.global
          : {
              mostWins: null,
              highestCheckout: null,
              highestScore: null,
              bestThreeDartAverage: null,
              updatedAt: Date.now(),
            },
    }
  } catch {
    return {
      users: {},
      global: {
        mostWins: null,
        highestCheckout: null,
        highestScore: null,
        bestThreeDartAverage: null,
        updatedAt: Date.now(),
      },
    }
  }
}

function persistDb(): void {
  const dir = path.dirname(statsFile)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(statsFile, JSON.stringify(db, null, 2), 'utf8')
}
