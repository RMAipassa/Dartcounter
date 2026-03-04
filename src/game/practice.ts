import { GameRuleError } from './errors'
import type {
  Dart,
  Player,
  PlayerId,
  PracticeMode,
  PracticeSettings,
  TurnInput,
  TurnRecord,
  X01LegSnapshot,
} from './types'
import { applyX01Turn, dartValue } from './x01'

const RANDOM_CHECKOUT_TARGETS = (() => {
  const impossible = new Set([159, 162, 163, 165, 166, 168, 169])
  const out: number[] = []
  for (let n = 2; n <= 170; n++) {
    if (!impossible.has(n)) out.push(n)
  }
  return out
})()

const DOUBLE_TARGETS: number[] = [...Array.from({ length: 20 }, (_, i) => i + 1), 25]
const TRIPLE_TARGETS: number[] = Array.from({ length: 20 }, (_, i) => i + 1)

function assertIntegerInRange(value: number, name: string, min: number, max: number): void {
  if (!Number.isInteger(value) || value < min || value > max) {
    throw new GameRuleError('INVALID_VALUE', `${name} must be an integer in [${min}, ${max}]`, { name, value, min, max })
  }
}

export function validatePracticeSettings(settings: PracticeSettings): void {
  if (settings.gameType !== 'PRACTICE') {
    throw new GameRuleError('INVALID_SETTINGS', 'Only PRACTICE settings are accepted', { gameType: settings.gameType })
  }
  if (!['RANDOM_CHECKOUT', 'DOUBLES', 'TRIPLES', 'X01'].includes(settings.practiceMode)) {
    throw new GameRuleError('INVALID_SETTINGS', 'Invalid practice mode', { practiceMode: settings.practiceMode })
  }
  assertIntegerInRange(settings.startScore, 'startScore', 2, 10001)
  if (settings.legsToWin !== 1 || settings.setsEnabled || settings.setsToWin !== 0) {
    throw new GameRuleError('INVALID_SETTINGS', 'Practice mode does not use legs or sets', {
      legsToWin: settings.legsToWin,
      setsEnabled: settings.setsEnabled,
      setsToWin: settings.setsToWin,
    })
  }
}

function sortedPlayers(players: Player[]): Player[] {
  return [...players].sort((a, b) => a.orderIndex - b.orderIndex)
}

function hashSeed(input: string): number {
  let seed = 2166136261 >>> 0
  for (let i = 0; i < input.length; i++) {
    seed ^= input.charCodeAt(i)
    seed = Math.imul(seed, 16777619) >>> 0
  }
  return seed >>> 0
}

function randomCheckoutTarget(setNumber: number, legNumber: number): number {
  const seed = hashSeed(`PRACTICE-RANDOM-CHECKOUT-${setNumber}-${legNumber}`)
  return RANDOM_CHECKOUT_TARGETS[seed % RANDOM_CHECKOUT_TARGETS.length]
}

function currentSequenceTarget(mode: PracticeMode, index: number): number {
  if (mode === 'DOUBLES') {
    if (index < 0 || index >= DOUBLE_TARGETS.length) return 0
    return DOUBLE_TARGETS[index]
  }
  if (mode === 'TRIPLES') {
    if (index < 0 || index >= TRIPLE_TARGETS.length) return 0
    return TRIPLE_TARGETS[index]
  }
  return 0
}

function isSequenceHit(mode: PracticeMode, target: number, dart: Dart): boolean {
  if (mode === 'DOUBLES') {
    if (target === 25) return dart.segment === 25 && dart.multiplier === 2
    return dart.segment === target && dart.multiplier === 2
  }
  if (mode === 'TRIPLES') {
    return dart.segment === target && dart.multiplier === 3
  }
  return false
}

export function applyPracticeTurn(args: {
  settings: PracticeSettings
  stateBefore: { remaining: number; isIn: boolean }
  input: TurnInput
  legMeta: { setNumber: number; legNumber: number }
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
  const { settings, stateBefore, input, legMeta } = args

  if (settings.practiceMode === 'RANDOM_CHECKOUT') {
    const target = randomCheckoutTarget(legMeta.setNumber, legMeta.legNumber)
    return applyX01Turn({
      remainingBefore: stateBefore.remaining || target,
      isInBefore: true,
      input,
      settings: {
        gameType: 'X01',
        startScore: target,
        legsToWin: 1,
        setsEnabled: false,
        setsToWin: 0,
        doubleIn: false,
        doubleOut: true,
        masterOut: false,
      },
    })
  }

  if (settings.practiceMode === 'X01') {
    return applyX01Turn({
      remainingBefore: stateBefore.remaining || settings.startScore,
      isInBefore: true,
      input,
      settings: {
        gameType: 'X01',
        startScore: settings.startScore,
        legsToWin: 1,
        setsEnabled: false,
        setsToWin: 0,
        doubleIn: false,
        doubleOut: true,
        masterOut: false,
      },
    })
  }

  const darts = input.mode === 'PER_DART' ? input.darts : input.darts
  if (!darts || darts.length < 1 || darts.length > 3) {
    throw new GameRuleError('NEED_DARTS', 'Practice mode needs per-dart input')
  }

  const maxTargets = settings.practiceMode === 'DOUBLES' ? DOUBLE_TARGETS.length : TRIPLE_TARGETS.length
  let idx = Math.max(0, stateBefore.remaining - 1)
  if (idx >= maxTargets) idx = maxTargets
  const remainingBefore = idx >= maxTargets ? 0 : currentSequenceTarget(settings.practiceMode, idx)

  let scoreTotal = 0
  let checkoutDartIndex: number | null = null

  for (let i = 0; i < darts.length; i++) {
    if (idx >= maxTargets) break
    const target = currentSequenceTarget(settings.practiceMode, idx)
    const d = darts[i]
    if (!isSequenceHit(settings.practiceMode, target, d)) continue
    scoreTotal += dartValue(d)
    idx += 1
    if (idx >= maxTargets) {
      checkoutDartIndex = i
      break
    }
  }

  if (input.mode === 'TOTAL') {
    const derived = darts.reduce((sum, d) => sum + dartValue(d), 0)
    if (derived !== input.total) {
      throw new GameRuleError('TURN_TOTAL_MISMATCH', 'Provided total does not match darts sum', {
        total: input.total,
        derived,
      })
    }
  }

  const done = idx >= maxTargets
  const remainingAfter = done ? 0 : currentSequenceTarget(settings.practiceMode, idx)

  return {
    scoreTotal,
    isBust: false,
    didCheckout: done,
    checkoutDartIndex,
    remainingBefore,
    remainingAfter,
    isInBefore: true,
    isInAfter: true,
  }
}

export function computePracticeLegSnapshot(args: {
  settings: PracticeSettings
  players: Player[]
  startingPlayerIndex: number
  turns: TurnRecord[]
  legNumber: number
  setNumber?: number
}): X01LegSnapshot {
  const { settings, turns, legNumber, startingPlayerIndex } = args
  const setNumber = args.setNumber ?? 1
  validatePracticeSettings(settings)

  const players = sortedPlayers(args.players)
  if (players.length < 1) throw new GameRuleError('INVALID_STATE', 'At least one player is required')
  assertIntegerInRange(startingPlayerIndex, 'startingPlayerIndex', 0, players.length - 1)

  const startRemaining =
    settings.practiceMode === 'RANDOM_CHECKOUT'
      ? randomCheckoutTarget(setNumber, legNumber)
      : settings.practiceMode === 'X01'
        ? settings.startScore
        : currentSequenceTarget(settings.practiceMode, 0)

  const perPlayer = new Map<PlayerId, { remaining: number; isIn: boolean; turnsTaken: number }>()
  for (const p of players) perPlayer.set(p.id, { remaining: startRemaining, isIn: true, turnsTaken: 0 })

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

    const applied = applyPracticeTurn({ settings, stateBefore: state, input: turn.input, legMeta: { setNumber, legNumber } })
    state.remaining = applied.remainingAfter
    state.isIn = applied.isInAfter
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
        remaining: state.remaining,
        isIn: state.isIn,
        turnsTaken: state.turnsTaken,
      }
    }),
    turns: enrichedTurns,
  }
}
