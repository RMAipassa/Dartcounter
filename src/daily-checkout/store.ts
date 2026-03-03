import fs from 'fs'
import path from 'path'

type DailyEntry = {
  userId: string
  displayName: string
  dartsUsed: number
  completedAt: number
}

type DailyChallenge = {
  dateKey: string
  target: number
  createdAt: number
  dayEntries: DailyEntry[]
  bestEntries: DailyEntry[]
}

type DailyCheckoutDb = {
  challenges: Record<string, DailyChallenge>
}

export type DailyLeaderboardRow = {
  rank: number
  userId: string
  displayName: string
  dartsUsed: number
  completedAt: number
}

export type DailyStanding = DailyLeaderboardRow | null

const dataFile = path.join(process.cwd(), 'data', 'daily-checkout.json')
const finishableTargets = buildFinishableTargets()
const dailyCheckoutStartKey = '2026-03-03'

let db = loadDb()

export function getDailyCheckoutView(args?: {
  dateKey?: string
  userId?: string | null
}): {
  dateKey: string
  target: number
  dayLeaderboardTop10: DailyLeaderboardRow[]
  bestLeaderboardTop10: DailyLeaderboardRow[]
  yourDayStanding: DailyStanding
  yourBestStanding: DailyStanding
  dayEntriesCount: number
  bestEntriesCount: number
} {
  const dateKey = resolveAllowedDateKey(args?.dateKey)
  const challenge = ensureChallenge(dateKey)
  const dayRanked = rankEntries(challenge.dayEntries)
  const bestRanked = rankEntries(challenge.bestEntries)
  const yourDayStanding = args?.userId ? dayRanked.find((x) => x.userId === args.userId) ?? null : null
  const yourBestStanding = args?.userId ? bestRanked.find((x) => x.userId === args.userId) ?? null : null
  return {
    dateKey: challenge.dateKey,
    target: challenge.target,
    dayLeaderboardTop10: dayRanked.slice(0, 10),
    bestLeaderboardTop10: bestRanked.slice(0, 10),
    yourDayStanding,
    yourBestStanding,
    dayEntriesCount: dayRanked.length,
    bestEntriesCount: bestRanked.length,
  }
}

export function submitDailyCheckout(args: {
  userId: string
  displayName: string
  dartsUsed: number
  dateKey?: string
}): { improved: boolean; standing: DailyLeaderboardRow; target: number; dateKey: string } {
  const dateKey = resolveAllowedDateKey(args.dateKey)
  const dartsUsed = Math.max(1, Math.trunc(args.dartsUsed))
  const challenge = ensureChallenge(dateKey)
  const isToday = dateKey === todayKeyUtc()
  const now = Date.now()
  const displayName = sanitizeName(args.displayName)

  let improved = false

  if (isToday) {
    upsertBestByUser(challenge.dayEntries, {
      userId: args.userId,
      displayName,
      dartsUsed,
      completedAt: now,
    })
  }

  const beforeBest = challenge.bestEntries.find((e) => e.userId === args.userId)
  const bestImproved = upsertBestByUser(challenge.bestEntries, {
    userId: args.userId,
    displayName,
    dartsUsed,
    completedAt: now,
  })
  improved = bestImproved || !beforeBest

  if (!bestImproved && beforeBest) {
    beforeBest.displayName = displayName
  }

  persistDb()
  const ranked = rankEntries(challenge.bestEntries)
  const standing = ranked.find((x) => x.userId === args.userId)
  if (!standing) throw new Error('DAILY_STANDING_MISSING')

  return {
    improved,
    standing,
    target: challenge.target,
    dateKey: challenge.dateKey,
  }
}

export function listDailyCheckoutArchive(args?: { userId?: string | null }): Array<{
  dateKey: string
  target: number
  dayEntriesCount: number
  bestEntriesCount: number
  dayBest: DailyLeaderboardRow | null
  bestBest: DailyLeaderboardRow | null
  yourDayStanding: DailyStanding
  yourBestStanding: DailyStanding
}> {
  const days = Object.values(db.challenges)
    .filter((d) => d.dateKey >= dailyCheckoutStartKey)
    .sort((a, b) => b.dateKey.localeCompare(a.dateKey))
  return days.map((d) => {
    const dayRanked = rankEntries(d.dayEntries)
    const bestRanked = rankEntries(d.bestEntries)
    return {
      dateKey: d.dateKey,
      target: d.target,
      dayEntriesCount: dayRanked.length,
      bestEntriesCount: bestRanked.length,
      dayBest: dayRanked[0] ?? null,
      bestBest: bestRanked[0] ?? null,
      yourDayStanding: args?.userId ? dayRanked.find((x) => x.userId === args.userId) ?? null : null,
      yourBestStanding: args?.userId ? bestRanked.find((x) => x.userId === args.userId) ?? null : null,
    }
  })
}

export function getDailyCheckoutTarget(dateKey?: string | null): { dateKey: string; target: number } {
  const normalized = resolveAllowedDateKey(dateKey)
  const challenge = ensureChallenge(normalized)
  return { dateKey: challenge.dateKey, target: challenge.target }
}

export function getDailyCheckoutStartKey(): string {
  return dailyCheckoutStartKey
}

export function getMinimumCheckoutDarts(target: number): number {
  const t = Math.trunc(target)
  if (t < 2 || t > 170) return 1

  const doubles = new Set<number>()
  for (let n = 1; n <= 20; n++) doubles.add(n * 2)
  doubles.add(50)

  const visitScores = new Set<number>()
  visitScores.add(0)
  for (let n = 1; n <= 20; n++) {
    visitScores.add(n)
    visitScores.add(n * 2)
    visitScores.add(n * 3)
  }
  visitScores.add(25)
  visitScores.add(50)

  if (doubles.has(t)) return 1

  for (const a of visitScores) {
    if (doubles.has(t - a)) return 2
  }

  for (const a of visitScores) {
    for (const b of visitScores) {
      if (doubles.has(t - a - b)) return 3
    }
  }

  return 3
}

function ensureChallenge(dateKey: string): DailyChallenge {
  const existing = db.challenges[dateKey]
  if (existing) return existing

  const target = pickTargetForDate(dateKey)
  const next: DailyChallenge = {
    dateKey,
    target,
    createdAt: Date.now(),
    dayEntries: [],
    bestEntries: [],
  }
  db.challenges[dateKey] = next
  persistDb()
  return next
}

function pickTargetForDate(dateKey: string): number {
  const parts = dateKey.split('-').map((x) => Number(x))
  const year = Number.isFinite(parts[0]) ? Math.trunc(parts[0]) : 1970
  const month = Number.isFinite(parts[1]) ? Math.trunc(parts[1]) : 1
  const day = Number.isFinite(parts[2]) ? Math.trunc(parts[2]) : 1

  const monthSeed = `${year}-${String(month).padStart(2, '0')}`
  const shuffled = shuffledTargetsForMonth(monthSeed)
  const idx = Math.max(0, day - 1) % shuffled.length
  return shuffled[idx]
}

function shuffledTargetsForMonth(monthSeed: string): number[] {
  const out = [...finishableTargets]
  let seed = hashSeed(monthSeed)
  for (let i = out.length - 1; i > 0; i--) {
    seed = lcg(seed)
    const j = seed % (i + 1)
    const tmp = out[i]
    out[i] = out[j]
    out[j] = tmp
  }
  return out
}

function hashSeed(input: string): number {
  let seed = 2166136261 >>> 0
  for (let i = 0; i < input.length; i++) {
    seed ^= input.charCodeAt(i)
    seed = Math.imul(seed, 16777619) >>> 0
  }
  return seed >>> 0
}

function lcg(seed: number): number {
  return (Math.imul(seed, 1664525) + 1013904223) >>> 0
}

function rankEntries(entries: DailyEntry[]): DailyLeaderboardRow[] {
  return [...entries]
    .sort((a, b) => {
      if (a.dartsUsed !== b.dartsUsed) return a.dartsUsed - b.dartsUsed
      if (a.completedAt !== b.completedAt) return a.completedAt - b.completedAt
      return a.userId.localeCompare(b.userId)
    })
    .map((e, idx) => ({
      rank: idx + 1,
      userId: e.userId,
      displayName: e.displayName,
      dartsUsed: e.dartsUsed,
      completedAt: e.completedAt,
    }))
}

function upsertBestByUser(entries: DailyEntry[], candidate: DailyEntry): boolean {
  const existing = entries.find((e) => e.userId === candidate.userId)
  if (!existing) {
    entries.push(candidate)
    return true
  }
  existing.displayName = candidate.displayName
  if (candidate.dartsUsed < existing.dartsUsed || (candidate.dartsUsed === existing.dartsUsed && candidate.completedAt < existing.completedAt)) {
    existing.dartsUsed = candidate.dartsUsed
    existing.completedAt = candidate.completedAt
    return true
  }
  return false
}

function sanitizeName(value: string): string {
  const trimmed = value.trim()
  if (!trimmed) return 'Player'
  return trimmed.slice(0, 32)
}

function normalizeDateKey(value?: string | null): string | null {
  if (!value) return null
  const v = value.trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) return null
  return v
}

function todayKeyUtc(): string {
  return new Date().toISOString().slice(0, 10)
}

function resolveAllowedDateKey(value?: string | null): string {
  const normalized = normalizeDateKey(value) ?? todayKeyUtc()
  const today = todayKeyUtc()
  if (normalized < dailyCheckoutStartKey) {
    throw new Error('DAILY_CHECKOUT_NOT_STARTED')
  }
  if (normalized > today) {
    throw new Error('DAILY_CHECKOUT_FUTURE_DATE_NOT_ALLOWED')
  }
  return normalized
}

function buildFinishableTargets(): number[] {
  const impossible = new Set([159, 162, 163, 165, 166, 168, 169])
  const out: number[] = []
  for (let n = 2; n <= 170; n++) {
    if (impossible.has(n)) continue
    out.push(n)
  }
  return out
}

function loadDb(): DailyCheckoutDb {
  try {
    const dir = path.dirname(dataFile)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (!fs.existsSync(dataFile)) {
      const initial: DailyCheckoutDb = { challenges: {} }
      fs.writeFileSync(dataFile, JSON.stringify(initial, null, 2), 'utf8')
      return initial
    }
    const raw = fs.readFileSync(dataFile, 'utf8')
    const parsed = JSON.parse(raw)
    const challengesRaw = typeof parsed?.challenges === 'object' && parsed.challenges ? parsed.challenges : {}
    const challenges: Record<string, DailyChallenge> = {}
    for (const [dateKey, rec] of Object.entries(challengesRaw as Record<string, any>)) {
      const target = typeof rec?.target === 'number' ? Math.trunc(rec.target) : pickTargetForDate(dateKey)
      const legacyEntries = Array.isArray(rec?.entries)
        ? rec.entries
            .filter((e: any) => typeof e?.userId === 'string')
            .map((e: any) => ({
              userId: String(e.userId),
              displayName: sanitizeName(String(e.displayName ?? 'Player')),
              dartsUsed: Math.max(1, Math.trunc(Number(e.dartsUsed ?? 0) || 0)),
              completedAt: typeof e.completedAt === 'number' ? e.completedAt : 0,
            }))
        : []

      const dayEntries = Array.isArray(rec?.dayEntries)
        ? rec.dayEntries
            .filter((e: any) => typeof e?.userId === 'string')
            .map((e: any) => ({
              userId: String(e.userId),
              displayName: sanitizeName(String(e.displayName ?? 'Player')),
              dartsUsed: Math.max(1, Math.trunc(Number(e.dartsUsed ?? 0) || 0)),
              completedAt: typeof e.completedAt === 'number' ? e.completedAt : 0,
            }))
        : legacyEntries

      const bestEntries = Array.isArray(rec?.bestEntries)
        ? rec.bestEntries
            .filter((e: any) => typeof e?.userId === 'string')
            .map((e: any) => ({
              userId: String(e.userId),
              displayName: sanitizeName(String(e.displayName ?? 'Player')),
              dartsUsed: Math.max(1, Math.trunc(Number(e.dartsUsed ?? 0) || 0)),
              completedAt: typeof e.completedAt === 'number' ? e.completedAt : 0,
            }))
        : legacyEntries

      challenges[dateKey] = {
        dateKey,
        target,
        createdAt: typeof rec?.createdAt === 'number' ? rec.createdAt : Date.now(),
        dayEntries,
        bestEntries,
      }
    }
    return { challenges }
  } catch {
    return { challenges: {} }
  }
}

function persistDb(): void {
  const dir = path.dirname(dataFile)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(dataFile, JSON.stringify(db, null, 2), 'utf8')
}
