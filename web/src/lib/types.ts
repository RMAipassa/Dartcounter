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

export type AroundSettings = {
  gameType: 'AROUND'
  legsToWin: number
  setsEnabled: boolean
  setsToWin: number
  advanceByMultiplier: boolean
}

export type GameSettings = X01Settings | AroundSettings

export type Player = {
  id: string
  name: string
  orderIndex: number
}

export type Dart = {
  segment: number
  multiplier: 0 | 1 | 2 | 3
}

export type AutodartsRoomState = {
  roomCode: string
  deviceId: string | null
  runtimeMode: 'MOCK' | 'REAL'
  status: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR'
  mockMode: 'MANUAL' | 'AUTO' | null
  lastConnectedAt: number | null
  lastEventAt: number | null
  lastError: string | null
}

export type AutodartsPendingTurn = {
  playerId: string
  darts: Dart[]
  ready: boolean
  reason: 'THREE_DARTS' | 'BUST' | 'CHECKOUT' | null
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
  setNumber: number
  legNumber: number
  startingPlayerIndex: number
  currentPlayerIndex: number
  winnerPlayerId: string | null
  players: LegPlayerSnapshot[]
  turns: TurnSnapshot[]
}

export type MatchSnapshot = {
  status: 'LOBBY' | 'LIVE' | 'FINISHED'
  settings: GameSettings
  lockedAt: number | null
  players: Player[]
  currentLegIndex: number
  legsWonByPlayerId: Record<string, number>
  legsWonInCurrentSetByPlayerId: Record<string, number>
  setsWonByPlayerId: Record<string, number>
  currentSetNumber: number
  currentLeg: {
    setNumber: number
    legNumber: number
    startingPlayerIndex: number
    currentPlayerIndex: number
    winnerPlayerId: string | null
  }
  leg: LegSnapshot
  statsByPlayerId: Record<string, PlayerStats>
}

export type PlayerStats = {
  playerId: string
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

export type RoomSnapshot = {
  code: string
  room?: {
    title: string
    isPublic: boolean
    createdAt: number
    tournamentMatch?: {
      tournamentId: string
      matchId: string
      participationMode: 'ONLINE' | 'LOCAL'
    } | null
    autodartsActiveUserId?: string | null
    autodartsRoutingDebug?: {
      enabled: boolean
      allowMockBinding: boolean
      allowMockDartInput: boolean
      currentPlayerId: string | null
      currentPlayerName: string | null
      currentPlayerUserId: string | null
      missingPersonalDevice: boolean
      boundUserId: string | null
      boundDeviceId: string | null
      runtimeMode: 'MOCK' | 'REAL'
      connectionStatus: 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED' | 'ERROR'
    }
    autodarts?: AutodartsRoomState
    autodartsPending?: AutodartsPendingTurn | null
  }
  clients: Array<{ socketId: string; name: string; userId?: string; isHost: boolean; role: 'PLAYER' | 'SPECTATOR' }>
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

export type TournamentPlayer = {
  userId: string
  displayName: string
  joinedAt: number
  source?: 'USER' | 'LOCAL'
}

export type TournamentMatch = {
  id: string
  roundIndex: number
  matchIndex: number
  playerAUserId: string | null
  playerBUserId: string | null
  winnerUserId: string | null
  roomCode: string | null
  status: 'PENDING' | 'READY' | 'LIVE' | 'FINISHED' | 'BYE' | 'NO_SHOW'
  resolved?: boolean
  joinDeadlineAt?: number | null
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
  status: 'LOBBY' | 'LIVE' | 'FINISHED'
  format: 'SINGLE_ELIM'
  maxPlayers: number
  participationMode: 'ONLINE' | 'LOCAL'
  settings: GameSettings
  players: TournamentPlayer[]
  seedingMode: 'JOIN_ORDER' | 'RANDOM' | 'MANUAL'
  manualSeedUserIds: string[]
  rounds: TournamentRound[]
  winnerUserId: string | null
  isHost?: boolean
  isParticipant?: boolean
}

export type TournamentInvite = {
  id: string
  tournamentId: string
  tournamentName: string
  fromUserId: string
  fromDisplayName: string
  createdAt: number
}
