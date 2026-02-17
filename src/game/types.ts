export type GameStatus = 'LOBBY' | 'LIVE' | 'FINISHED'

export type GameType = 'X01'

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
  legNumber: number
  startingPlayerIndex: number
  turns: TurnRecord[]
  winnerPlayerId: PlayerId | null
}

export type X01MatchState = {
  status: GameStatus
  settings: X01Settings
  lockedAt: number | null
  players: Player[]
  currentLegIndex: number
  legs: X01LegState[]
  legsWonByPlayerId: Record<PlayerId, number>
}

export type X01PlayerLegSnapshot = {
  playerId: PlayerId
  remaining: number
  isIn: boolean
  turnsTaken: number
}

export type X01LegSnapshot = {
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
