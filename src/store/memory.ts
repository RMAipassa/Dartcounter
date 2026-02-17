import { randomBytes } from 'crypto'
import { GameRuleError } from '../game/errors'
import type { Player, PlayerId, X01MatchState, X01Settings } from '../game/types'

export type RoomCode = string

export type ClientInfo = {
  socketId: string
  name: string
  isHost: boolean
  role: 'PLAYER' | 'SPECTATOR'
}

export type RoomState = {
  code: RoomCode
  title: string
  isPublic: boolean
  createdAt: number
  clients: Map<string, ClientInfo>
  hostSecret: string
  match: X01MatchState
}

const rooms = new Map<RoomCode, RoomState>()

function randomId(bytes: number): string {
  // URL-safe, no padding
  return randomBytes(bytes).toString('base64url')
}

function randomRoomCode(): RoomCode {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let out = ''
  for (let i = 0; i < 6; i++) out += alphabet[Math.floor(Math.random() * alphabet.length)]
  return out
}

export function createRoom(args: { hostName: string; settings: X01Settings }): RoomState {
  const now = Date.now()
  let code = randomRoomCode()
  while (rooms.has(code)) code = randomRoomCode()

  const hostSecret = randomId(18)

  const match: X01MatchState = {
    status: 'LOBBY',
    settings: args.settings,
    lockedAt: null,
    players: [],
    currentLegIndex: 0,
    legs: [
      {
        legNumber: 1,
        startingPlayerIndex: 0,
        turns: [],
        winnerPlayerId: null,
      },
    ],
    legsWonByPlayerId: {},
  }

  const room: RoomState = {
    code,
    title: '',
    isPublic: false,
    createdAt: now,
    clients: new Map(),
    hostSecret,
    match,
  }
  rooms.set(code, room)
  return room
}

export function listPublicRooms() {
  const out: Array<{
    code: RoomCode
    title: string
    createdAt: number
    isPublic: boolean
    status: X01MatchState['status']
    playersCount: number
    clientsCount: number
  }> = []

  for (const room of rooms.values()) {
    if (!room.isPublic) continue
    out.push({
      code: room.code,
      title: room.title,
      createdAt: room.createdAt,
      isPublic: room.isPublic,
      status: room.match.status,
      playersCount: room.match.players.length,
      clientsCount: room.clients.size,
    })
  }

  out.sort((a, b) => b.createdAt - a.createdAt)
  return out
}

export function getRoom(code: RoomCode): RoomState {
  const room = rooms.get(code)
  if (!room) throw new GameRuleError('ROOM_NOT_FOUND', 'Room not found', { code })
  return room
}

export function deleteRoom(code: RoomCode): void {
  rooms.delete(code)
}

export function addClient(room: RoomState, client: ClientInfo): void {
  room.clients.set(client.socketId, client)
}

export function getClient(room: RoomState, socketId: string): ClientInfo | null {
  return room.clients.get(socketId) ?? null
}

export function removeClient(room: RoomState, socketId: string): void {
  room.clients.delete(socketId)
}

export function isRoomEmpty(room: RoomState): boolean {
  return room.clients.size === 0
}

export function assertHost(room: RoomState, hostSecret?: string): void {
  if (!hostSecret || hostSecret !== room.hostSecret) {
    throw new GameRuleError('NOT_HOST', 'Host privileges required')
  }
}

export function addPlayer(room: RoomState, name: string): Player {
  const trimmed = name.trim()
  if (!trimmed) throw new GameRuleError('INVALID_PLAYER', 'Player name is required')
  if (trimmed.length > 32) throw new GameRuleError('INVALID_PLAYER', 'Player name is too long')

  const existingNames = new Set(room.match.players.map((p) => p.name.toLowerCase()))
  if (existingNames.has(trimmed.toLowerCase())) {
    throw new GameRuleError('INVALID_PLAYER', 'Player name already exists')
  }

  const id: PlayerId = randomId(8)
  const player: Player = {
    id,
    name: trimmed,
    orderIndex: room.match.players.length,
  }

  room.match.players.push(player)
  room.match.legsWonByPlayerId[player.id] = 0
  return player
}

export function reorderPlayers(room: RoomState, playerIdsInOrder: PlayerId[]): void {
  const existing = new Map(room.match.players.map((p) => [p.id, p] as const))
  if (playerIdsInOrder.length !== room.match.players.length) {
    throw new GameRuleError('INVALID_PLAYER_ORDER', 'Order list length mismatch')
  }
  for (const id of playerIdsInOrder) {
    if (!existing.has(id)) throw new GameRuleError('INVALID_PLAYER_ORDER', 'Unknown player in order', { id })
  }
  const seen = new Set<PlayerId>()
  for (const id of playerIdsInOrder) {
    if (seen.has(id)) throw new GameRuleError('INVALID_PLAYER_ORDER', 'Duplicate player in order', { id })
    seen.add(id)
  }

  room.match.players = playerIdsInOrder.map((id, idx) => ({ ...existing.get(id)!, orderIndex: idx }))
}
