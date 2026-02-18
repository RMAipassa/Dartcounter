import type { PlayerId, TurnRecord, X01LegSnapshot, X01MatchState } from './types'
import { computeX01LegSnapshot, dartValue } from './x01'

export type PlayerStats = {
  playerId: PlayerId
  legsWon: number
  setsWon: number
  threeDartAvg: number | null
  first9Avg: number | null
  checkoutRate: number | null
  checkoutAttempts: number
  checkouts: number
  highestFinish: number | null
  highestScore: number
  bestLegDarts: number | null
  worstLegDarts: number | null
}

function dartsInTurn(turn: TurnRecord): number {
  if (turn.input.mode === 'PER_DART') return turn.input.darts.length
  if (turn.input.darts) return turn.input.darts.length
  return 3
}

function pointsInTurn(turn: TurnRecord, scoreTotal: number): number {
  // bust is already represented by scoreTotal=0 in enriched snapshots
  return scoreTotal
}

function* iterateDartPoints(turn: TurnRecord, scoreTotal: number): Generator<number, void, void> {
  if (turn.input.mode === 'PER_DART') {
    for (const d of turn.input.darts) yield dartValue(d)
    return
  }

  if (turn.input.darts) {
    for (const d of turn.input.darts) yield dartValue(d)
    return
  }

  // No per-dart detail; treat as a 3-dart block.
  // For first-9 average we only need total points for the first 3 turns anyway.
  // Yield it as a single chunk to avoid faking distribution.
  yield scoreTotal
}

function computeAllLegSnapshots(match: X01MatchState): X01LegSnapshot[] {
  return match.legs.map((leg) =>
    computeX01LegSnapshot({
      settings: match.settings,
      players: match.players,
      startingPlayerIndex: leg.startingPlayerIndex,
      turns: leg.turns,
      legNumber: leg.legNumber,
      setNumber: leg.setNumber,
    }),
  )
}

export function computePlayerStats(match: X01MatchState): Record<PlayerId, PlayerStats> {
  const out: Record<PlayerId, PlayerStats> = {}
  const legSnaps = computeAllLegSnapshots(match)

  for (const p of match.players) {
    out[p.id] = {
      playerId: p.id,
      legsWon: match.legsWonByPlayerId[p.id] ?? 0,
      setsWon: match.setsWonByPlayerId[p.id] ?? 0,
      threeDartAvg: null,
      first9Avg: null,
      checkoutRate: null,
      checkoutAttempts: 0,
      checkouts: 0,
      highestFinish: null,
      highestScore: 0,
      bestLegDarts: null,
      worstLegDarts: null,
    }
  }

  const totalPointsByPlayer: Record<PlayerId, number> = {}
  const totalDartsByPlayer: Record<PlayerId, number> = {}

  const first9PointsByPlayer: Record<PlayerId, number> = {}
  const first9DartsByPlayer: Record<PlayerId, number> = {}

  // init
  for (const p of match.players) {
    totalPointsByPlayer[p.id] = 0
    totalDartsByPlayer[p.id] = 0
    first9PointsByPlayer[p.id] = 0
    first9DartsByPlayer[p.id] = 0
  }

  for (const leg of legSnaps) {
    // per leg first 9 tracking
    const legFirst9Darts: Record<PlayerId, number> = {}
    const legFirst9Points: Record<PlayerId, number> = {}
    for (const p of match.players) {
      legFirst9Darts[p.id] = 0
      legFirst9Points[p.id] = 0
    }

    // best/worst leg darts (winner only)
    if (leg.winnerPlayerId) {
      const winner = leg.winnerPlayerId
      let winnerDarts = 0
      for (const t of leg.turns) {
        if (t.playerId !== winner) continue
        winnerDarts += dartsInTurn(t)
        if (t.didCheckout) break
      }
      const stats = out[winner]
      if (stats) {
        stats.bestLegDarts = stats.bestLegDarts == null ? winnerDarts : Math.min(stats.bestLegDarts, winnerDarts)
        stats.worstLegDarts = stats.worstLegDarts == null ? winnerDarts : Math.max(stats.worstLegDarts, winnerDarts)
      }
    }

    for (const t of leg.turns) {
      const stats = out[t.playerId]
      if (!stats) continue

      const darts = dartsInTurn(t)
      const pts = pointsInTurn(t, t.scoreTotal)

      totalPointsByPlayer[t.playerId] += pts
      totalDartsByPlayer[t.playerId] += darts

      stats.highestScore = Math.max(stats.highestScore, t.scoreTotal)

      // Checkout rate
      if (t.isInBefore && t.remainingBefore <= 170) {
        stats.checkoutAttempts += 1
        if (t.didCheckout) stats.checkouts += 1
      }
      if (t.didCheckout) {
        const finish = t.remainingBefore
        stats.highestFinish = stats.highestFinish == null ? finish : Math.max(stats.highestFinish, finish)
      }

      // First 9 avg: track first 9 darts per leg.
      if (legFirst9Darts[t.playerId] < 9) {
        if (t.input.mode === 'PER_DART' || (t.input.mode === 'TOTAL' && t.input.darts)) {
          for (const dp of iterateDartPoints(t, t.scoreTotal)) {
            if (legFirst9Darts[t.playerId] >= 9) break
            legFirst9Darts[t.playerId] += 1
            legFirst9Points[t.playerId] += dp
          }
        } else {
          // total-only: count as 3 darts at once
          const take = Math.min(3, 9 - legFirst9Darts[t.playerId])
          legFirst9Darts[t.playerId] += take
          // If we take less than 3 (because already close to 9), we still can't split;
          // treat whole turn points as within first 9 to keep it simple.
          legFirst9Points[t.playerId] += t.scoreTotal
        }
      }
    }

    for (const p of match.players) {
      if (legFirst9Darts[p.id] >= 9) {
        first9DartsByPlayer[p.id] += 9
        first9PointsByPlayer[p.id] += legFirst9Points[p.id]
      }
    }
  }

  for (const p of match.players) {
    const stats = out[p.id]
    const darts = totalDartsByPlayer[p.id]
    const pts = totalPointsByPlayer[p.id]
    if (darts > 0) {
      stats.threeDartAvg = Number((pts / (darts / 3)).toFixed(2))
    }

    if (first9DartsByPlayer[p.id] > 0) {
      // First 9 darts => 3 "visits" of 3 darts
      stats.first9Avg = Number((first9PointsByPlayer[p.id] / 3).toFixed(2))
    }

    if (stats.checkoutAttempts > 0) {
      stats.checkoutRate = Number(((stats.checkouts / stats.checkoutAttempts) * 100).toFixed(1))
    }
  }

  return out
}
