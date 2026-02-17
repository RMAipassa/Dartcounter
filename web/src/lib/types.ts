export type InputMode = 'TOTAL' | 'PER_DART'

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

export type Player = {
  id: string
  name: string
  orderIndex: number
}

export type Dart = {
  segment: number
  multiplier: 0 | 1 | 2 | 3
}

export type LegPlayerSnapshot = {
  playerId: string
  remaining: number
  isIn: boolean
  turnsTaken: number
}

export type TurnSnapshot = {
  id: string
  playerId: string
  createdAt: number
  input: any
  scoreTotal: number
  isBust: boolean
  remainingBefore: number
  remainingAfter: number
  didCheckout: boolean
  checkoutDartIndex: number | null
  isInBefore: boolean
  isInAfter: boolean
}

export type LegSnapshot = {
  legNumber: number
  startingPlayerIndex: number
  currentPlayerIndex: number
  winnerPlayerId: string | null
  players: LegPlayerSnapshot[]
  turns: TurnSnapshot[]
}

export type MatchSnapshot = {
  status: 'LOBBY' | 'LIVE' | 'FINISHED'
  settings: X01Settings
  lockedAt: number | null
  players: Player[]
  currentLegIndex: number
  legsWonByPlayerId: Record<string, number>
  currentLeg: {
    legNumber: number
    startingPlayerIndex: number
    currentPlayerIndex: number
    winnerPlayerId: string | null
  }
  leg: LegSnapshot
}

export type RoomSnapshot = {
  code: string
  room?: {
    title: string
    isPublic: boolean
    createdAt: number
  }
  clients: Array<{ socketId: string; name: string; isHost: boolean; role: 'PLAYER' | 'SPECTATOR' }>
  match: MatchSnapshot
}

export type PublicRoom = {
  code: string
  title: string
  createdAt: number
  isPublic: boolean
  status: 'LOBBY' | 'LIVE' | 'FINISHED'
  playersCount: number
  clientsCount: number
}
