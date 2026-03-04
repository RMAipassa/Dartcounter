export type GameStatus = 'LOBBY' | 'LIVE' | 'FINISHED'

export type GameType = 'X01' | 'AROUND' | 'PRACTICE'

export type PlayerId = string

export type DartMultiplier = 0 | 1 | 2 | 3

export type DartSegment = number

export type Dart = {
  segment: DartSegment
  multiplier: DartMultiplier
}

export type X01Settings = {
  gameType: 'X01'
  startScore: number
  legsToWin: number
  setsEnabled: boolean
  setsToWin: number
  doubleIn: boolean
  doubleOut: boolean
  masterOut: boolean
}

export type AroundSettings = {
  gameType: 'AROUND'
  legsToWin: number
  setsEnabled: boolean
  setsToWin: number
  advanceByMultiplier: boolean
}

export type PracticeMode = 'RANDOM_CHECKOUT' | 'DOUBLES' | 'TRIPLES' | 'X01'

export type PracticeSettings = {
  gameType: 'PRACTICE'
  practiceMode: PracticeMode
  startScore: number
  legsToWin: number
  setsEnabled: boolean
  setsToWin: number
}

export type GameSettings = X01Settings | AroundSettings | PracticeSettings

export type TurnInput =
  | { mode: 'TOTAL'; total: number; darts?: Dart[] }
  | { mode: 'PER_DART'; darts: Dart[] }

export type TurnRecord = {
  id: string
  playerId: PlayerId
  createdAt: number
  input: TurnInput
}

export type Player = {
  id: PlayerId
  name: string
  orderIndex: number
}

export type X01LegState = {
  setNumber: number
  legNumber: number
  startingPlayerIndex: number
  turns: TurnRecord[]
  winnerPlayerId: PlayerId | null
}

export type X01MatchState = {
  status: GameStatus
  settings: GameSettings
  lockedAt: number | null
  players: Player[]
  currentLegIndex: number
  legs: X01LegState[]
  legsWonByPlayerId: Record<PlayerId, number>
  legsWonInCurrentSetByPlayerId: Record<PlayerId, number>
  setsWonByPlayerId: Record<PlayerId, number>
  currentSetNumber: number
}

export type PlayerStats = {
  playerId: PlayerId
  legsWon: number
  setsWon: number
  dartsThrown: number
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

export type X01PlayerLegSnapshot = {
  playerId: PlayerId
  remaining: number
  isIn: boolean
  turnsTaken: number
}

export type X01LegSnapshot = {
  setNumber: number
  legNumber: number
  startingPlayerIndex: number
  currentPlayerIndex: number
  winnerPlayerId: PlayerId | null
  players: X01PlayerLegSnapshot[]
  turns: Array<
    TurnRecord & {
      scoreTotal: number
      isBust: boolean
      remainingBefore: number
      remainingAfter: number
      didCheckout: boolean
      checkoutDartIndex: number | null
      isInBefore: boolean
      isInAfter: boolean
    }
  >
}

export type X01MatchSnapshot = {
  status: GameStatus
  settings: GameSettings
  lockedAt: number | null
  players: Player[]
  currentLegIndex: number
  legsWonByPlayerId: Record<PlayerId, number>
  legsWonInCurrentSetByPlayerId: Record<PlayerId, number>
  setsWonByPlayerId: Record<PlayerId, number>
  currentSetNumber: number
  currentLeg: {
    setNumber: number
    legNumber: number
    startingPlayerIndex: number
    currentPlayerIndex: number
    winnerPlayerId: PlayerId | null
  }
  leg: X01LegSnapshot
  statsByPlayerId: Record<PlayerId, PlayerStats>
}
