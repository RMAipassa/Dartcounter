import fs from 'fs'
import path from 'path'
import type { GameType, PlayerId, X01MatchState } from '../game/types'
import type { PlayerStats } from '../game/types'

type GameResult = 'WIN' | 'LOSS'

type GameSummary = {
  gameType: GameType
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
  byMode: Record<GameType, ModeAggregateStats>
  updatedAt: number
}

type ModeAggregateStats = {
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
  lastTenGames: GameSummary[]
}

type StatRecord = { userId: string; value: number } | null

type GlobalModeRecords = {
  allTime: {
    mostWins: StatRecord
    highestCheckout: StatRecord
    highestScore: StatRecord
    bestThreeDartAverage: StatRecord
  }
  lastTen: {
    mostWins: StatRecord
    highestCheckout: StatRecord
    highestScore: StatRecord
    bestThreeDartAverage: StatRecord
  }
}

type GlobalRecords = {
  byMode: Record<GameType, GlobalModeRecords>
  updatedAt: number
}

type StatsStoreData = {
  users: Record<string, UserAggregateStats>
  global: GlobalRecords
}

function isX01(gameType: GameType): boolean {
  return gameType === 'X01'
}

export type UserStatsView = {
  allTime: {
    totalGames: number
    wins: number
    losses: number
    winRate: number | null
    dartsThrown: number
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
    dartsThrown: number
    threeDartAvg: number | null
    checkouts: number
    checkoutAttempts: number
    checkoutRate: number | null
    highestCheckout: number | null
    highestScore: number
  }
  history: GameSummary[]
  byMode: Record<
    GameType,
    {
      allTime: UserStatsView['allTime']
      lastTen: UserStatsView['lastTen']
      history: GameSummary[]
    }
  >
}

const statsFile = path.join(process.cwd(), 'data', 'user-stats.json')
let db: StatsStoreData = loadDb()
rebuildGlobalRecords()

export function recordFinishedMatch(args: {
  roomCode: string
  match: X01MatchState
  statsByPlayerId: Record<PlayerId, PlayerStats>
  playerUserIdByPlayerId: Record<PlayerId, string>
}): void {
  const finishedAt = Date.now()
  const gameType: GameType = args.match.settings.gameType
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
      gameType,
      roomCode: args.roomCode,
      finishedAt,
      result: won ? 'WIN' : 'LOSS',
      legsWon,
      legsLost,
      setsWon,
      setsLost,
      dartsThrown,
      pointsScored,
      threeDartAvg: isX01(gameType) ? ps.threeDartAvg : null,
      checkouts: isX01(gameType) ? ps.checkouts : 0,
      checkoutAttempts: isX01(gameType) ? ps.checkoutAttempts : 0,
      highestCheckout: isX01(gameType) ? ps.highestFinish : null,
      highestScore: isX01(gameType) ? ps.highestScore : 0,
    }

    const current = db.users[userId] ?? emptyAggregate(userId)
    const mode = current.byMode[gameType]
    mode.totalGames += 1
    if (won) mode.wins += 1
    else mode.losses += 1
    mode.legsWon += legsWon
    mode.legsLost += legsLost
    mode.setsWon += setsWon
    mode.setsLost += setsLost
    mode.dartsThrown += dartsThrown
    mode.pointsScored += pointsScored
    if (isX01(gameType)) {
      mode.checkouts += ps.checkouts
      mode.checkoutAttempts += ps.checkoutAttempts
      mode.highestCheckout = Math.max(mode.highestCheckout, ps.highestFinish ?? 0)
      mode.highestScore = Math.max(mode.highestScore, ps.highestScore)
    }
    current.updatedAt = finishedAt
    mode.lastTenGames = [game, ...mode.lastTenGames].slice(0, 10)
    db.users[userId] = current
  }

  rebuildGlobalRecords()
  persistDb()
}

export function getUserStats(userId: string): UserStatsView {
  const current = db.users[userId] ?? emptyAggregate(userId)
  const x01 = current.byMode.X01
  const around = current.byMode.AROUND
  const practice = current.byMode.PRACTICE
  const x01AllTime = summarizeModeAllTime(x01, 'X01')
  const x01LastTen = summarizeLastTen(x01.lastTenGames, 'X01')
  const aroundAllTime = summarizeModeAllTime(around, 'AROUND')
  const aroundLastTen = summarizeLastTen(around.lastTenGames, 'AROUND')
  const practiceAllTime = summarizeModeAllTime(practice, 'PRACTICE')
  const practiceLastTen = summarizeLastTen(practice.lastTenGames, 'PRACTICE')

  return {
    allTime: x01AllTime,
    lastTen: x01LastTen,
    history: [...x01.lastTenGames],
    byMode: {
      X01: {
        allTime: x01AllTime,
        lastTen: x01LastTen,
        history: [...x01.lastTenGames],
      },
      AROUND: {
        allTime: aroundAllTime,
        lastTen: aroundLastTen,
        history: [...around.lastTenGames],
      },
      PRACTICE: {
        allTime: practiceAllTime,
        lastTen: practiceLastTen,
        history: [...practice.lastTenGames],
      },
    },
  }
}

export function getGlobalRecords(): GlobalRecords {
  return db.global
}

function summarizeModeAllTime(mode: ModeAggregateStats, gameType: GameType): UserStatsView['allTime'] {
  return {
    totalGames: mode.totalGames,
    wins: mode.wins,
    losses: mode.losses,
    winRate: ratioPercent(mode.wins, mode.totalGames),
    dartsThrown: mode.dartsThrown,
    legsWon: mode.legsWon,
    legsLost: mode.legsLost,
    setsWon: mode.setsWon,
    setsLost: mode.setsLost,
    threeDartAvg: isX01(gameType) ? avgFromPointsAndDarts(mode.pointsScored, mode.dartsThrown) : null,
    checkouts: isX01(gameType) ? mode.checkouts : 0,
    checkoutAttempts: isX01(gameType) ? mode.checkoutAttempts : 0,
    checkoutRate: isX01(gameType) ? ratioPercent(mode.checkouts, mode.checkoutAttempts) : null,
    highestCheckout: isX01(gameType) ? (mode.highestCheckout > 0 ? mode.highestCheckout : null) : null,
    highestScore: isX01(gameType) ? mode.highestScore : 0,
  }
}

function summarizeLastTen(games: GameSummary[], gameType: GameType): UserStatsView['lastTen'] {
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
    dartsThrown: darts,
    threeDartAvg: isX01(gameType) ? avgFromPointsAndDarts(points, darts) : null,
    checkouts: isX01(gameType) ? checkouts : 0,
    checkoutAttempts: isX01(gameType) ? checkoutAttempts : 0,
    checkoutRate: isX01(gameType) ? ratioPercent(checkouts, checkoutAttempts) : null,
    highestCheckout: isX01(gameType) ? (highestCheckout > 0 ? highestCheckout : null) : null,
    highestScore: isX01(gameType) ? highestScore : 0,
  }
}

function rebuildGlobalRecords(): void {
  db.global = {
    byMode: {
      X01: rebuildGlobalModeRecords('X01'),
      AROUND: rebuildGlobalModeRecords('AROUND'),
      PRACTICE: rebuildGlobalModeRecords('PRACTICE'),
    },
    updatedAt: Date.now(),
  }
}

function rebuildGlobalModeRecords(gameType: GameType): GlobalModeRecords {
  let allTimeMostWins: StatRecord = null
  let allTimeHighestCheckout: StatRecord = null
  let allTimeHighestScore: StatRecord = null
  let allTimeBestAverage: StatRecord = null

  let lastTenMostWins: StatRecord = null
  let lastTenHighestCheckout: StatRecord = null
  let lastTenHighestScore: StatRecord = null
  let lastTenBestAverage: StatRecord = null

  for (const stat of Object.values(db.users)) {
    const mode = stat.byMode[gameType]
    if (!allTimeMostWins || mode.wins > allTimeMostWins.value) allTimeMostWins = { userId: stat.userId, value: mode.wins }
    if (!allTimeHighestCheckout || mode.highestCheckout > allTimeHighestCheckout.value) {
      allTimeHighestCheckout = { userId: stat.userId, value: mode.highestCheckout }
    }
    if (!allTimeHighestScore || mode.highestScore > allTimeHighestScore.value) {
      allTimeHighestScore = { userId: stat.userId, value: mode.highestScore }
    }
    if (isX01(gameType)) {
      const allTimeAvg = avgFromPointsAndDarts(mode.pointsScored, mode.dartsThrown)
      if (allTimeAvg != null && (!allTimeBestAverage || allTimeAvg > allTimeBestAverage.value)) {
        allTimeBestAverage = { userId: stat.userId, value: allTimeAvg }
      }
    }

    const lt = summarizeLastTen(mode.lastTenGames, gameType)
    if (!lastTenMostWins || lt.wins > lastTenMostWins.value) lastTenMostWins = { userId: stat.userId, value: lt.wins }
    const ltCheckout = lt.highestCheckout ?? 0
    if (!lastTenHighestCheckout || ltCheckout > lastTenHighestCheckout.value) {
      lastTenHighestCheckout = { userId: stat.userId, value: ltCheckout }
    }
    if (!lastTenHighestScore || lt.highestScore > lastTenHighestScore.value) {
      lastTenHighestScore = { userId: stat.userId, value: lt.highestScore }
    }
    if (isX01(gameType)) {
      const ltAvg = lt.threeDartAvg
      if (ltAvg != null && (!lastTenBestAverage || ltAvg > lastTenBestAverage.value)) {
        lastTenBestAverage = { userId: stat.userId, value: ltAvg }
      }
    }
  }

  return {
    allTime: {
      mostWins: allTimeMostWins,
      highestCheckout: isX01(gameType) ? allTimeHighestCheckout : null,
      highestScore: isX01(gameType) ? allTimeHighestScore : null,
      bestThreeDartAverage: isX01(gameType) ? allTimeBestAverage : null,
    },
    lastTen: {
      mostWins: lastTenMostWins,
      highestCheckout: isX01(gameType) ? lastTenHighestCheckout : null,
      highestScore: isX01(gameType) ? lastTenHighestScore : null,
      bestThreeDartAverage: isX01(gameType) ? lastTenBestAverage : null,
    },
  }
}

function emptyAggregate(userId: string): UserAggregateStats {
  return {
    userId,
    byMode: {
      X01: emptyModeAggregate(),
      AROUND: emptyModeAggregate(),
      PRACTICE: emptyModeAggregate(),
    },
    updatedAt: 0,
  }
}

function emptyModeAggregate(): ModeAggregateStats {
  return {
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
          byMode: {
            X01: emptyGlobalModeRecords(),
            AROUND: emptyGlobalModeRecords(),
            PRACTICE: emptyGlobalModeRecords(),
          },
          updatedAt: Date.now(),
        },
      }
      fs.writeFileSync(statsFile, JSON.stringify(initial, null, 2), 'utf8')
      return initial
    }

    const raw = fs.readFileSync(statsFile, 'utf8')
    const parsed = JSON.parse(raw)
    const usersRaw = typeof parsed?.users === 'object' && parsed.users ? parsed.users : {}
    const users: Record<string, UserAggregateStats> = {}
    for (const [userId, raw] of Object.entries(usersRaw as Record<string, any>)) {
      users[userId] = normalizeUserAggregate(userId, raw)
    }

    return {
      users,
      global: normalizeGlobalRecords(parsed?.global),
    }
  } catch {
    return {
      users: {},
      global: {
        byMode: {
          X01: emptyGlobalModeRecords(),
          AROUND: emptyGlobalModeRecords(),
          PRACTICE: emptyGlobalModeRecords(),
        },
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

function normalizeUserAggregate(userId: string, raw: any): UserAggregateStats {
  if (raw && typeof raw === 'object' && raw.byMode && typeof raw.byMode === 'object') {
    const x01 = normalizeModeAggregate(raw.byMode.X01, 'X01')
    const around = normalizeModeAggregate(raw.byMode.AROUND, 'AROUND')
    const practice = normalizeModeAggregate(raw.byMode.PRACTICE, 'PRACTICE')
    return {
      userId,
      byMode: { X01: x01, AROUND: around, PRACTICE: practice },
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : 0,
    }
  }

  const legacyGames = Array.isArray(raw?.lastTenGames) ? raw.lastTenGames : []
  const x01: ModeAggregateStats = {
    totalGames: asInt(raw?.totalGames),
    wins: asInt(raw?.wins),
    losses: asInt(raw?.losses),
    legsWon: asInt(raw?.legsWon),
    legsLost: asInt(raw?.legsLost),
    setsWon: asInt(raw?.setsWon),
    setsLost: asInt(raw?.setsLost),
    dartsThrown: asInt(raw?.dartsThrown),
    pointsScored: asInt(raw?.pointsScored),
    checkouts: asInt(raw?.checkouts),
    checkoutAttempts: asInt(raw?.checkoutAttempts),
    highestCheckout: asInt(raw?.highestCheckout),
    highestScore: asInt(raw?.highestScore),
    lastTenGames: legacyGames.map((g: any) => normalizeGameSummary(g, 'X01')),
  }
  return {
    userId,
    byMode: {
      X01: x01,
      AROUND: emptyModeAggregate(),
      PRACTICE: emptyModeAggregate(),
    },
    updatedAt: typeof raw?.updatedAt === 'number' ? raw.updatedAt : 0,
  }
}

function normalizeModeAggregate(raw: any, fallbackType: GameType): ModeAggregateStats {
  return {
    totalGames: asInt(raw?.totalGames),
    wins: asInt(raw?.wins),
    losses: asInt(raw?.losses),
    legsWon: asInt(raw?.legsWon),
    legsLost: asInt(raw?.legsLost),
    setsWon: asInt(raw?.setsWon),
    setsLost: asInt(raw?.setsLost),
    dartsThrown: asInt(raw?.dartsThrown),
    pointsScored: asInt(raw?.pointsScored),
    checkouts: asInt(raw?.checkouts),
    checkoutAttempts: asInt(raw?.checkoutAttempts),
    highestCheckout: asInt(raw?.highestCheckout),
    highestScore: asInt(raw?.highestScore),
    lastTenGames: Array.isArray(raw?.lastTenGames)
      ? raw.lastTenGames.map((g: any) => normalizeGameSummary(g, fallbackType))
      : [],
  }
}

function normalizeGameSummary(raw: any, fallbackType: GameType): GameSummary {
  const gameType: GameType = raw?.gameType === 'AROUND' || raw?.gameType === 'X01' || raw?.gameType === 'PRACTICE' ? raw.gameType : fallbackType
  return {
    gameType,
    roomCode: typeof raw?.roomCode === 'string' ? raw.roomCode : '',
    finishedAt: asInt(raw?.finishedAt),
    result: raw?.result === 'WIN' ? 'WIN' : 'LOSS',
    legsWon: asInt(raw?.legsWon),
    legsLost: asInt(raw?.legsLost),
    setsWon: asInt(raw?.setsWon),
    setsLost: asInt(raw?.setsLost),
    dartsThrown: asInt(raw?.dartsThrown),
    pointsScored: asInt(raw?.pointsScored),
    threeDartAvg: typeof raw?.threeDartAvg === 'number' ? raw.threeDartAvg : null,
    checkouts: asInt(raw?.checkouts),
    checkoutAttempts: asInt(raw?.checkoutAttempts),
    highestCheckout: typeof raw?.highestCheckout === 'number' ? raw.highestCheckout : null,
    highestScore: asInt(raw?.highestScore),
  }
}

function asInt(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0
}

function emptyGlobalModeRecords(): GlobalModeRecords {
  return {
    allTime: {
      mostWins: null,
      highestCheckout: null,
      highestScore: null,
      bestThreeDartAverage: null,
    },
    lastTen: {
      mostWins: null,
      highestCheckout: null,
      highestScore: null,
      bestThreeDartAverage: null,
    },
  }
}

function normalizeStatRecord(raw: any): StatRecord {
  if (!raw || typeof raw !== 'object') return null
  if (typeof raw.userId !== 'string' || typeof raw.value !== 'number' || !Number.isFinite(raw.value)) return null
  return { userId: raw.userId, value: raw.value }
}

function normalizeGlobalModeRecords(raw: any): GlobalModeRecords {
  return {
    allTime: {
      mostWins: normalizeStatRecord(raw?.allTime?.mostWins),
      highestCheckout: normalizeStatRecord(raw?.allTime?.highestCheckout),
      highestScore: normalizeStatRecord(raw?.allTime?.highestScore),
      bestThreeDartAverage: normalizeStatRecord(raw?.allTime?.bestThreeDartAverage),
    },
    lastTen: {
      mostWins: normalizeStatRecord(raw?.lastTen?.mostWins),
      highestCheckout: normalizeStatRecord(raw?.lastTen?.highestCheckout),
      highestScore: normalizeStatRecord(raw?.lastTen?.highestScore),
      bestThreeDartAverage: normalizeStatRecord(raw?.lastTen?.bestThreeDartAverage),
    },
  }
}

function normalizeGlobalRecords(raw: any): GlobalRecords {
  if (raw && typeof raw === 'object' && raw.byMode && typeof raw.byMode === 'object') {
    return {
      byMode: {
        X01: normalizeGlobalModeRecords(raw.byMode.X01),
        AROUND: normalizeGlobalModeRecords(raw.byMode.AROUND),
        PRACTICE: normalizeGlobalModeRecords(raw.byMode.PRACTICE),
      },
      updatedAt: typeof raw.updatedAt === 'number' ? raw.updatedAt : Date.now(),
    }
  }

  return {
    byMode: {
      X01: normalizeGlobalModeRecords(raw),
      AROUND: emptyGlobalModeRecords(),
      PRACTICE: emptyGlobalModeRecords(),
    },
    updatedAt: typeof raw?.updatedAt === 'number' ? raw.updatedAt : Date.now(),
  }
}
