import { GameRuleError } from './errors'
import type { AroundSettings, Dart, Player, PlayerId, TurnInput, TurnRecord, X01LegSnapshot } from './types'
import { dartValue } from './x01'

const AROUND_TARGETS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 25] as const

function assertIntegerInRange(value: number, name: string, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new GameRuleError('INVALID_VALUE', `${name} must be an integer in [${min}, ${max}]`, { name, value, min, max })
  }
}

export function validateAroundSettings(settings: AroundSettings): void {
  if (settings.gameType !== 'AROUND') {
    throw new GameRuleError('INVALID_SETTINGS', 'Only AROUND settings are accepted', { gameType: settings.gameType })
  }
  assertIntegerInRange(settings.legsToWin, 'legsToWin', 1, 99)
  if (settings.setsEnabled) assertIntegerInRange(settings.setsToWin, 'setsToWin', 1, 99)
  if (typeof settings.advanceByMultiplier !== 'boolean') {
    throw new GameRuleError('INVALID_SETTINGS', 'advanceByMultiplier must be a boolean', {
      advanceByMultiplier: settings.advanceByMultiplier,
    })
  }
}

function nextAroundTarget(current: number): number {
  const idx = AROUND_TARGETS.findIndex((t) => t === current)
  if (idx < 0) return 1
  if (idx >= AROUND_TARGETS.length - 1) return 0
  return AROUND_TARGETS[idx + 1]
}

function advanceAroundTarget(current: number, steps: number): number {
  let next = current
  const count = Number.isInteger(steps) && steps > 0 ? steps : 1
  for (let i = 0; i < count; i++) {
    next = nextAroundTarget(next)
    if (next === 0) break
  }
  return next
}

function isHitTarget(d: Dart, target: number): boolean {
  if (target === 25) return d.segment === 25 && (d.multiplier === 1 || d.multiplier === 2)
  return d.segment === target && d.multiplier > 0
}

function applyAroundTurn(args: {
  settings: AroundSettings
  targetBefore: number
  input: TurnInput
}): {
  scoreTotal: number
  isBust: boolean
  didCheckout: boolean
  checkoutDartIndex: number | null
  remainingBefore: number
  remainingAfter: number
  isInBefore: boolean
  isInAfter: boolean
} {
  const targetBefore = args.targetBefore
  const advanceByMultiplier = Boolean(args.settings.advanceByMultiplier)
  if (!Number.isInteger(targetBefore) || targetBefore < 0) {
    throw new GameRuleError('INVALID_STATE', 'Invalid around target state', { targetBefore })
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
    const darts = perDartInput
    if (!Array.isArray(darts) || darts.length < 1 || darts.length > 3) {
      throw new GameRuleError('INVALID_TURN', 'darts must contain 1-3 darts', { count: darts?.length })
    }

    let target = targetBefore
    let scoreTotal = 0
    let checkoutDartIndex: number | null = null

    for (let i = 0; i < darts.length; i++) {
      if (target === 0) break
      const d = darts[i]
      if (!isHitTarget(d, target)) continue

      scoreTotal += dartValue(d)
      const steps = advanceByMultiplier ? Math.max(1, d.multiplier) : 1
      target = advanceAroundTarget(target, steps)
      if (target === 0) {
        checkoutDartIndex = i
        break
      }
    }

    if (args.input.mode === 'TOTAL') {
      const providedTotal = args.input.total
      const derivedTotal = darts.reduce((sum, d) => sum + dartValue(d), 0)
      if (derivedTotal !== providedTotal) {
        throw new GameRuleError('TURN_TOTAL_MISMATCH', 'Provided total does not match darts sum', {
          total: providedTotal,
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

  const total = args.input.total
  const hit = targetBefore === 25 ? total === 25 || total === 50 : total === targetBefore || total === targetBefore * 2 || total === targetBefore * 3
  const after = hit ? nextAroundTarget(targetBefore) : targetBefore

  return {
    scoreTotal: hit ? total : 0,
    isBust: false,
    didCheckout: after === 0,
    checkoutDartIndex: null,
    remainingBefore: targetBefore,
    remainingAfter: after,
    isInBefore: true,
    isInAfter: true,
  }
}

function sortedPlayers(players: Player[]): Player[] {
  return [...players].sort((a, b) => a.orderIndex - b.orderIndex)
}

export function computeAroundLegSnapshot(args: {
  settings: AroundSettings
  players: Player[]
  startingPlayerIndex: number
  turns: TurnRecord[]
  legNumber: number
  setNumber?: number
}): X01LegSnapshot {
  const { settings, turns, legNumber, startingPlayerIndex } = args
  const setNumber = args.setNumber ?? 1
  validateAroundSettings(settings)

  const players = sortedPlayers(args.players)
  if (players.length < 1) throw new GameRuleError('INVALID_STATE', 'At least one player is required')
  assertIntegerInRange(startingPlayerIndex, 'startingPlayerIndex', 0, players.length - 1)

  const perPlayer = new Map<PlayerId, { target: number; turnsTaken: number }>()
  for (const p of players) perPlayer.set(p.id, { target: 1, turnsTaken: 0 })

  const enrichedTurns: X01LegSnapshot['turns'] = []
  let winnerPlayerId: PlayerId | null = null

  for (let idx = 0; idx < turns.length; idx++) {
    const turn = turns[idx]
    if (winnerPlayerId) throw new GameRuleError('INVALID_STATE', 'Turns exist after leg is already finished')
    const expectedPlayerIndex = (startingPlayerIndex + idx) % players.length
    const expectedPlayerId = players[expectedPlayerIndex].id
    if (turn.playerId !== expectedPlayerId) {
      throw new GameRuleError('OUT_OF_TURN', 'Turn player does not match expected order', {
        expectedPlayerId,
        gotPlayerId: turn.playerId,
      })
    }

    const state = perPlayer.get(turn.playerId)
    if (!state) throw new GameRuleError('INVALID_STATE', 'Turn references unknown player', { playerId: turn.playerId })

    const applied = applyAroundTurn({ settings, targetBefore: state.target, input: turn.input })
    state.target = applied.remainingAfter
    state.turnsTaken += 1

    enrichedTurns.push({ ...turn, ...applied })
    if (applied.didCheckout) winnerPlayerId = turn.playerId
  }

  const currentPlayerIndex = winnerPlayerId ? -1 : (startingPlayerIndex + turns.length) % players.length

  return {
    setNumber,
    legNumber,
    startingPlayerIndex,
    currentPlayerIndex,
    winnerPlayerId,
    players: players.map((p) => {
      const state = perPlayer.get(p.id)!
      return {
        playerId: p.id,
        remaining: state.target,
        isIn: true,
        turnsTaken: state.turnsTaken,
      }
    }),
    turns: enrichedTurns,
  }
}
