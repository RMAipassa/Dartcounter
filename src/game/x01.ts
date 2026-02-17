import { GameRuleError } from './errors'
import type {
  Dart,
  Player,
  PlayerId,
  TurnInput,
  TurnRecord,
  X01LegSnapshot,
  X01MatchState,
  X01Settings,
} from './types'

function assertIntegerInRange(
  value: number,
  name: string,
  min: number,
  max: number,
): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new GameRuleError('INVALID_VALUE', `${name} must be an integer in [${min}, ${max}]`, {
      name,
      value,
      min,
      max,
    })
  }
}

export function validateX01Settings(settings: X01Settings): void {
  if (settings.gameType !== 'X01') {
    throw new GameRuleError('INVALID_SETTINGS', 'Only X01 is supported', { gameType: settings.gameType })
  }

  assertIntegerInRange(settings.startScore, 'startScore', 2, 10001)
  assertIntegerInRange(settings.legsToWin, 'legsToWin', 1, 99)

  if (settings.setsEnabled) {
    assertIntegerInRange(settings.setsToWin, 'setsToWin', 1, 99)
  }

  if (settings.doubleOut && settings.masterOut) {
    throw new GameRuleError('INVALID_SETTINGS', 'doubleOut and masterOut cannot both be enabled')
  }
}

export function dartValue(dart: Dart): number {
  const { segment, multiplier } = dart

  if (multiplier === 0) return 0

  if (segment === 25) {
    if (multiplier !== 1 && multiplier !== 2) {
      throw new GameRuleError('INVALID_DART', 'Bull can only be single or double', { dart })
    }
    return multiplier === 1 ? 25 : 50
  }

  if (!Number.isInteger(segment) || segment < 0 || segment > 20) {
    throw new GameRuleError('INVALID_DART', 'Segment must be 0, 1-20, or 25', { dart })
  }

  if (segment === 0) {
    // multiplier is non-zero here (multiplier===0 returns above)
    throw new GameRuleError('INVALID_DART', 'Miss must have multiplier 0', { dart })
  }

  if (multiplier !== 1 && multiplier !== 2 && multiplier !== 3) {
    throw new GameRuleError('INVALID_DART', 'Multiplier must be 1, 2, or 3 (or 0 for miss)', { dart })
  }

  return segment * multiplier
}

function isFinishingDart(dart: Dart, settings: X01Settings): boolean {
  if (settings.doubleOut) return dart.multiplier === 2
  if (settings.masterOut) return dart.multiplier === 2 || dart.multiplier === 3
  return true
}

function isDoubleDart(dart: Dart): boolean {
  return dart.multiplier === 2
}

type AppliedTurn = {
  scoreTotal: number
  isBust: boolean
  didCheckout: boolean
  checkoutDartIndex: number | null
  remainingBefore: number
  remainingAfter: number
  isInBefore: boolean
  isInAfter: boolean
}

function applyPerDartTurn(args: {
  remainingBefore: number
  isInBefore: boolean
  darts: Dart[]
  settings: X01Settings
}): AppliedTurn {
  const { remainingBefore, isInBefore, darts, settings } = args

  if (!Array.isArray(darts) || darts.length < 1 || darts.length > 3) {
    throw new GameRuleError('INVALID_TURN', 'darts must contain 1-3 darts', { count: darts?.length })
  }

  let remaining = remainingBefore
  let totalScored = 0
  let isIn = isInBefore
  let checkoutDartIndex: number | null = null
  let didCheckout = false

  for (let i = 0; i < darts.length; i++) {
    const dart = darts[i]
    const val = dartValue(dart)
    const isScoring = val > 0

    if (settings.doubleIn && !isIn) {
      if (!isScoring) {
        continue
      }

      if (!isDoubleDart(dart)) {
        continue
      }

      isIn = true
    }

    if (!isIn) {
      continue
    }

    const nextRemaining = remaining - val

    const isPotentialFinish = nextRemaining === 0
    const isBust =
      nextRemaining < 0 ||
      (settings.doubleOut || settings.masterOut ? nextRemaining === 1 : false) ||
      (isPotentialFinish && !isFinishingDart(dart, settings))

    if (isBust) {
      return {
        scoreTotal: 0,
        isBust: true,
        didCheckout: false,
        checkoutDartIndex: null,
        remainingBefore,
        remainingAfter: remainingBefore,
        isInBefore,
        isInAfter: isInBefore,
      }
    }

    totalScored += val
    remaining = nextRemaining

    if (isPotentialFinish) {
      checkoutDartIndex = i
      didCheckout = true
      break
    }
  }

  return {
    scoreTotal: totalScored,
    isBust: false,
    didCheckout,
    checkoutDartIndex,
    remainingBefore,
    remainingAfter: remaining,
    isInBefore,
    isInAfter: isIn,
  }
}

function applyTotalTurn(args: {
  remainingBefore: number
  isInBefore: boolean
  total: number
  darts: Dart[] | null
  settings: X01Settings
}): AppliedTurn {
  const { remainingBefore, isInBefore, total, darts, settings } = args
  assertIntegerInRange(total, 'total', 0, 180)

  if (settings.doubleIn && !isInBefore) {
    if (!darts) {
      throw new GameRuleError(
        'NEED_DARTS_FOR_DOUBLE_IN',
        'Double-in is enabled; provide per-dart detail until the player is in',
      )
    }

    const applied = applyPerDartTurn({ remainingBefore, isInBefore, darts, settings })
    if (applied.isBust) return applied
    if (applied.scoreTotal !== total) {
      throw new GameRuleError('TURN_TOTAL_MISMATCH', 'Provided total does not match darts sum', {
        total,
        derived: applied.scoreTotal,
      })
    }
    return applied
  }

  const remainingAfterCandidate = remainingBefore - total

  const needsCheckoutDarts =
    remainingAfterCandidate === 0 && (settings.doubleOut || settings.masterOut)
  if (needsCheckoutDarts && !darts) {
    throw new GameRuleError(
      'NEED_DARTS_FOR_CHECKOUT',
      'Double-out/master-out is enabled; provide per-dart detail for checkout turns',
    )
  }

  if (darts) {
    const applied = applyPerDartTurn({ remainingBefore, isInBefore, darts, settings })
    if (applied.scoreTotal !== total) {
      throw new GameRuleError('TURN_TOTAL_MISMATCH', 'Provided total does not match darts sum', {
        total,
        derived: applied.scoreTotal,
      })
    }
    return applied
  }

  const isBust =
    remainingAfterCandidate < 0 ||
    (settings.doubleOut || settings.masterOut ? remainingAfterCandidate === 1 : false) ||
    false

  if (isBust) {
    return {
      scoreTotal: 0,
      isBust: true,
      didCheckout: false,
      checkoutDartIndex: null,
      remainingBefore,
      remainingAfter: remainingBefore,
      isInBefore,
      isInAfter: isInBefore,
    }
  }

  return {
    scoreTotal: total,
    isBust: false,
    didCheckout: remainingAfterCandidate === 0,
    checkoutDartIndex: remainingAfterCandidate === 0 ? 2 : null,
    remainingBefore,
    remainingAfter: remainingAfterCandidate,
    isInBefore,
    isInAfter: isInBefore,
  }
}

export function applyX01Turn(args: {
  remainingBefore: number
  isInBefore: boolean
  input: TurnInput
  settings: X01Settings
}): AppliedTurn {
  const { remainingBefore, isInBefore, input, settings } = args

  if (input.mode === 'PER_DART') {
    return applyPerDartTurn({ remainingBefore, isInBefore, darts: input.darts, settings })
  }

  const darts = input.darts ?? null
  return applyTotalTurn({ remainingBefore, isInBefore, total: input.total, darts, settings })
}

function sortedPlayers(players: Player[]): Player[] {
  return [...players].sort((a, b) => a.orderIndex - b.orderIndex)
}

export function computeX01LegSnapshot(args: {
  settings: X01Settings
  players: Player[]
  startingPlayerIndex: number
  turns: TurnRecord[]
  legNumber: number
}): X01LegSnapshot {
  const { settings, startingPlayerIndex, turns, legNumber } = args
  validateX01Settings(settings)

  const players = sortedPlayers(args.players)
  if (players.length < 1) {
    throw new GameRuleError('INVALID_STATE', 'At least one player is required')
  }

  assertIntegerInRange(startingPlayerIndex, 'startingPlayerIndex', 0, players.length - 1)

  const perPlayer = new Map<PlayerId, { remaining: number; isIn: boolean; turnsTaken: number }>()
  for (const p of players) {
    perPlayer.set(p.id, {
      remaining: settings.startScore,
      isIn: settings.doubleIn ? false : true,
      turnsTaken: 0,
    })
  }

  const enrichedTurns: X01LegSnapshot['turns'] = []
  let winnerPlayerId: PlayerId | null = null

  for (let idx = 0; idx < turns.length; idx++) {
    const turn = turns[idx]
    if (winnerPlayerId) {
      throw new GameRuleError('INVALID_STATE', 'Turns exist after leg is already finished')
    }

    const expectedPlayerIndex = (startingPlayerIndex + idx) % players.length
    const expectedPlayerId = players[expectedPlayerIndex].id
    if (turn.playerId !== expectedPlayerId) {
      throw new GameRuleError('OUT_OF_TURN', 'Turn player does not match expected order', {
        expectedPlayerId,
        gotPlayerId: turn.playerId,
      })
    }

    const state = perPlayer.get(turn.playerId)
    if (!state) {
      throw new GameRuleError('INVALID_STATE', 'Turn references unknown player', { playerId: turn.playerId })
    }

    const applied = applyX01Turn({
      remainingBefore: state.remaining,
      isInBefore: state.isIn,
      input: turn.input,
      settings,
    })

    state.remaining = applied.remainingAfter
    state.isIn = applied.isInAfter
    state.turnsTaken += 1

    enrichedTurns.push({
      ...turn,
      ...applied,
    })

    if (applied.didCheckout) {
      winnerPlayerId = turn.playerId
    }
  }

  const currentPlayerIndex = winnerPlayerId ? -1 : (startingPlayerIndex + turns.length) % players.length

  return {
    legNumber,
    startingPlayerIndex,
    currentPlayerIndex,
    winnerPlayerId,
    players: players.map((p) => {
      const state = perPlayer.get(p.id)!
      return {
        playerId: p.id,
        remaining: state.remaining,
        isIn: state.isIn,
        turnsTaken: state.turnsTaken,
      }
    }),
    turns: enrichedTurns,
  }
}

export function totalTurnsInMatch(match: X01MatchState): number {
  return match.legs.reduce((sum, leg) => sum + leg.turns.length, 0)
}

export function getCurrentLeg(match: X01MatchState) {
  const leg = match.legs[match.currentLegIndex]
  if (!leg) throw new GameRuleError('INVALID_STATE', 'Current leg does not exist')
  return leg
}

export function computeMatchSnapshot(match: X01MatchState) {
  const leg = getCurrentLeg(match)
  const legSnap = computeX01LegSnapshot({
    settings: match.settings,
    players: match.players,
    startingPlayerIndex: leg.startingPlayerIndex,
    turns: leg.turns,
    legNumber: leg.legNumber,
  })

  return {
    status: match.status,
    settings: match.settings,
    lockedAt: match.lockedAt,
    players: sortedPlayers(match.players),
    currentLegIndex: match.currentLegIndex,
    legsWonByPlayerId: match.legsWonByPlayerId,
    currentLeg: {
      legNumber: legSnap.legNumber,
      startingPlayerIndex: legSnap.startingPlayerIndex,
      currentPlayerIndex: legSnap.currentPlayerIndex,
      winnerPlayerId: legSnap.winnerPlayerId,
    },
    leg: legSnap,
  }
}
