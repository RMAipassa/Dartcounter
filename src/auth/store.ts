import { randomBytes, scryptSync, timingSafeEqual } from 'crypto'
import fs from 'fs'
import path from 'path'

type UserRecord = {
  id: string
  email: string
  displayName: string
  passwordSalt: string
  passwordHash: string
  autodartsDeviceId?: string | null
  autodartsToken?: string | null
  autodartsEmail?: string | null
  autodartsPassword?: string | null
  autodartsApiBase?: string | null
  autodartsWsBase?: string | null
  createdAt: number
}

type SessionRecord = {
  token: string
  userId: string
  createdAt: number
  expiresAt: number
}

type AuthStoreData = {
  users: UserRecord[]
  sessions: SessionRecord[]
}

const dataFile = path.join(process.cwd(), 'data', 'auth-store.json')
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14

let db: AuthStoreData = loadDb()

export type PublicUser = {
  id: string
  email: string
  displayName: string
  autodartsDeviceId: string | null
  hasAutodartsCredentials: boolean
  autodartsApiBase: string | null
  autodartsWsBase: string | null
  createdAt: number
}

export function registerUser(args: { email: string; password: string; displayName?: string }): PublicUser {
  const email = args.email.trim().toLowerCase()
  if (db.users.some((u) => u.email === email)) {
    throw new Error('EMAIL_ALREADY_USED')
  }

  const displayName = (args.displayName ?? email.split('@')[0] ?? 'Player').trim() || 'Player'
  const passwordSalt = randomId(16)
  const passwordHash = hashPassword(args.password, passwordSalt)
  const user: UserRecord = {
    id: randomId(12),
    email,
    displayName: displayName.slice(0, 32),
    passwordSalt,
    passwordHash,
    createdAt: Date.now(),
  }

  db.users.push(user)
  persistDb()
  return toPublicUser(user)
}

export function authenticateUser(args: { email: string; password: string }): PublicUser | null {
  const email = args.email.trim().toLowerCase()
  const user = db.users.find((u) => u.email === email)
  if (!user) return null

  const actual = Buffer.from(user.passwordHash, 'hex')
  const expected = Buffer.from(hashPassword(args.password, user.passwordSalt), 'hex')
  if (actual.length !== expected.length) return null
  if (!timingSafeEqual(actual, expected)) return null
  return toPublicUser(user)
}

export function createSession(userId: string): SessionRecord {
  pruneSessions()
  const session: SessionRecord = {
    token: randomId(24),
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + SESSION_TTL_MS,
  }
  db.sessions.push(session)
  persistDb()
  return session
}

export function getUserBySessionToken(token?: string | null): PublicUser | null {
  if (!token) return null
  pruneSessions()
  const session = db.sessions.find((s) => s.token === token)
  if (!session) return null
  const user = db.users.find((u) => u.id === session.userId)
  return user ? toPublicUser(user) : null
}

export function getUserById(userId: string): PublicUser | null {
  const user = db.users.find((u) => u.id === userId)
  return user ? toPublicUser(user) : null
}

export function setUserAutodartsDevice(args: { userId: string; deviceId: string | null }): PublicUser | null {
  const user = db.users.find((u) => u.id === args.userId)
  if (!user) return null

  const next = args.deviceId?.trim() ?? null
  user.autodartsDeviceId = next && next.length > 0 ? next.slice(0, 96) : null
  persistDb()
  return toPublicUser(user)
}

export function setUserAutodartsCredentials(args: {
  userId: string
  token?: string | null
  email?: string | null
  password?: string | null
  apiBase?: string | null
  wsBase?: string | null
  clear?: boolean
}): PublicUser | null {
  const user = db.users.find((u) => u.id === args.userId)
  if (!user) return null

  if (args.clear) {
    user.autodartsToken = null
    user.autodartsEmail = null
    user.autodartsPassword = null
    user.autodartsApiBase = null
    user.autodartsWsBase = null
    persistDb()
    return toPublicUser(user)
  }

  const token = args.token?.trim() || null
  const email = args.email?.trim() || null
  const password = args.password?.trim() || null
  const apiBase = args.apiBase?.trim() || null
  const wsBase = args.wsBase?.trim() || null

  user.autodartsToken = token
  user.autodartsEmail = email
  user.autodartsPassword = password
  user.autodartsApiBase = apiBase
  user.autodartsWsBase = wsBase
  persistDb()
  return toPublicUser(user)
}

export function getUserAutodartsCredentials(userId: string): {
  token?: string
  email?: string
  password?: string
  apiBase?: string
  wsBase?: string
} | null {
  const user = db.users.find((u) => u.id === userId)
  if (!user) return null
  const token = user.autodartsToken?.trim() || undefined
  const email = user.autodartsEmail?.trim() || undefined
  const password = user.autodartsPassword?.trim() || undefined
  const apiBase = user.autodartsApiBase?.trim() || undefined
  const wsBase = user.autodartsWsBase?.trim() || undefined
  const hasAny = Boolean(token || email || password || apiBase || wsBase)
  if (!hasAny) return null
  return { token, email, password, apiBase, wsBase }
}

export function revokeSession(token?: string | null): void {
  if (!token) return
  const before = db.sessions.length
  db.sessions = db.sessions.filter((s) => s.token !== token)
  if (db.sessions.length !== before) persistDb()
}

function toPublicUser(u: UserRecord): PublicUser {
  return {
    id: u.id,
    email: u.email,
    displayName: u.displayName,
    autodartsDeviceId: u.autodartsDeviceId ?? null,
    hasAutodartsCredentials: Boolean(
      (u.autodartsToken && u.autodartsToken.trim()) ||
        (u.autodartsEmail && u.autodartsEmail.trim() && u.autodartsPassword && u.autodartsPassword.trim()),
    ),
    autodartsApiBase: u.autodartsApiBase ?? null,
    autodartsWsBase: u.autodartsWsBase ?? null,
    createdAt: u.createdAt,
  }
}

function hashPassword(password: string, salt: string): string {
  return scryptSync(password, salt, 64).toString('hex')
}

function pruneSessions(): void {
  const now = Date.now()
  const before = db.sessions.length
  db.sessions = db.sessions.filter((s) => s.expiresAt > now)
  if (db.sessions.length !== before) persistDb()
}

function randomId(bytes: number): string {
  return randomBytes(bytes).toString('base64url')
}

function loadDb(): AuthStoreData {
  try {
    const dir = path.dirname(dataFile)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (!fs.existsSync(dataFile)) {
      const initial: AuthStoreData = { users: [], sessions: [] }
      fs.writeFileSync(dataFile, JSON.stringify(initial, null, 2), 'utf8')
      return initial
    }

    const raw = fs.readFileSync(dataFile, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      users: Array.isArray(parsed?.users) ? parsed.users : [],
      sessions: Array.isArray(parsed?.sessions) ? parsed.sessions : [],
    }
  } catch {
    return { users: [], sessions: [] }
  }
}

function persistDb(): void {
  const dir = path.dirname(dataFile)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(dataFile, JSON.stringify(db, null, 2), 'utf8')
}
