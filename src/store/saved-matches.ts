import { randomUUID } from 'node:crypto'
import { mkdirSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { z } from 'zod'
import type { GameSettings, X01MatchState } from '../game/types'

export type SavedMatch = {
  code: string
  title: string
  isPublic: boolean
  createdAt: number
  hostSecret: string
  hostUserId: string | null
  playerUserIdByPlayerId: Record<string, string>
  guestDevicesByPlayerId: Record<string, string>
  localOwnerByPlayerId: Record<string, string>
  statsRecorded: boolean
  match: X01MatchState
}

const directory = path.join(process.cwd(), 'data', 'matches')
const roomCode = z.string().regex(/^[A-Z0-9]{6}$/)
const index = z.number().int().nonnegative()
const dart = z.object({ segment: z.number().int(), multiplier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]) })
const input = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('TOTAL'), total: index.max(180), darts: z.array(dart).min(1).max(3).optional() }),
  z.object({ mode: z.literal('PER_DART'), darts: z.array(dart).min(1).max(3) }),
])

export function readSavedMatches(settings: z.ZodType<GameSettings>): SavedMatch[] {
  const fileSchema = z.object({
    version: z.literal(1),
    room: z.object({
      code: roomCode,
      title: z.string(),
      isPublic: z.boolean(),
      createdAt: index,
      hostSecret: z.string().min(1),
      hostUserId: z.string().nullable().default(null),
      playerUserIdByPlayerId: z.record(z.string(), z.string()),
      guestDevicesByPlayerId: z.record(z.string(), z.string()).default({}),
      localOwnerByPlayerId: z.record(z.string(), z.string()),
      statsRecorded: z.boolean(),
      match: z.object({
        status: z.enum(['LOBBY', 'LIVE', 'FINISHED']),
        settings,
        lockedAt: index.nullable(),
        players: z.array(z.object({ id: z.string().min(1), name: z.string().min(1), orderIndex: index })),
        currentLegIndex: index,
        legs: z.array(z.object({
          setNumber: index,
          legNumber: index,
          startingPlayerIndex: index,
          winnerPlayerId: z.string().nullable(),
          turns: z.array(z.object({ id: z.string(), playerId: z.string(), createdAt: index, input })),
        })).min(1),
        legsWonByPlayerId: z.record(z.string(), index),
        legsWonInCurrentSetByPlayerId: z.record(z.string(), index),
        setsWonByPlayerId: z.record(z.string(), index),
        currentSetNumber: index,
      }),
    }),
  })

  mkdirSync(directory, { recursive: true })
  const restored: SavedMatch[] = []
  for (const file of readdirSync(directory, { withFileTypes: true })) {
    if (!file.isFile() || !/^[A-Z0-9]{6}\.json$/.test(file.name)) continue
    try {
      const { room } = fileSchema.parse(JSON.parse(readFileSync(path.join(directory, file.name), 'utf8')))
      if (file.name !== `${room.code}.json` || !room.match.legs[room.match.currentLegIndex]) throw new Error('Invalid saved room')
      if (room.match.settings.gameType !== 'PRACTICE') restored.push(room)
    } catch {
      // Leave unreadable saves on disk for recovery, and never log their contents.
      console.warn(`[matches] Could not restore ${file.name}`)
    }
  }
  return restored
}

export function writeSavedMatch(room: SavedMatch): void {
  const file = path.join(directory, `${roomCode.parse(room.code)}.json`)
  mkdirSync(directory, { recursive: true })
  const temporary = `${file}.${randomUUID()}.tmp`
  try {
    writeFileSync(temporary, JSON.stringify({ version: 1, room }), { mode: 0o600, flag: 'wx', flush: true })
    renameSync(temporary, file)
  } catch (error) {
    try { rmSync(temporary, { force: true }) } catch { /* keep the original error */ }
    throw error
  }
}

export function removeSavedMatch(code: string): void {
  rmSync(path.join(directory, `${roomCode.parse(code)}.json`), { force: true })
}
