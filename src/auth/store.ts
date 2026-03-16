import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'crypto'
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

type PasswordResetRecord = {
  id: string
  userId: string
  tokenHash: string
  createdAt: number
  expiresAt: number
  usedAt: number | null
}

type FriendStatus = 'PENDING' | 'ACCEPTED' | 'BLOCKED'

type FriendshipRecord = {
  userAId: string
  userBId: string
  status: FriendStatus
  requestedByUserId: string
  createdAt: number
  updatedAt: number
}

type AuthStoreData = {
  users: UserRecord[]
  sessions: SessionRecord[]
  friendships: FriendshipRecord[]
  passwordResets: PasswordResetRecord[]
}

const dataFile = path.join(process.cwd(), 'data', 'auth-store.json')
const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14
const SESSION_TTL_REMEMBER_ME_MS = 1000 * 60 * 60 * 24 * 90
const PASSWORD_RESET_TTL_MS = 1000 * 60 * 30

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

export type FriendSummary = {
  userId: string
  email: string
  displayName: string
}

export type FriendState = {
  friends: Array<{ user: FriendSummary; since: number }>
  incoming: Array<{ user: FriendSummary; requestedAt: number }>
  outgoing: Array<{ user: FriendSummary; requestedAt: number }>
  blocked: Array<{ user: FriendSummary; blockedAt: number }>
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

export function createSession(userId: string, opts?: { rememberMe?: boolean }): SessionRecord {
  pruneSessions()
  const ttlMs = opts?.rememberMe ? SESSION_TTL_REMEMBER_ME_MS : SESSION_TTL_MS
  const session: SessionRecord = {
    token: randomId(24),
    userId,
    createdAt: Date.now(),
    expiresAt: Date.now() + ttlMs,
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

export function getUserByEmail(email: string): PublicUser | null {
  const normalized = email.trim().toLowerCase()
  const user = db.users.find((u) => u.email === normalized)
  return user ? toPublicUser(user) : null
}

export function listFriendState(userId: string): FriendState {
  const friends: FriendState['friends'] = []
  const incoming: FriendState['incoming'] = []
  const outgoing: FriendState['outgoing'] = []
  const blocked: FriendState['blocked'] = []

  for (const rel of db.friendships) {
    const otherUserId = otherSide(rel, userId)
    if (!otherUserId) continue
    const other = db.users.find((u) => u.id === otherUserId)
    if (!other) continue
    const item = { user: toFriendSummary(other) }

    if (rel.status === 'ACCEPTED') {
      friends.push({ ...item, since: rel.updatedAt })
      continue
    }

    if (rel.status === 'BLOCKED') {
      if (rel.requestedByUserId === userId) blocked.push({ ...item, blockedAt: rel.updatedAt })
      continue
    }

    if (rel.status === 'PENDING') {
      if (rel.requestedByUserId === userId) outgoing.push({ ...item, requestedAt: rel.createdAt })
      else incoming.push({ ...item, requestedAt: rel.createdAt })
    }
  }

  friends.sort((a, b) => a.user.displayName.localeCompare(b.user.displayName))
  incoming.sort((a, b) => b.requestedAt - a.requestedAt)
  outgoing.sort((a, b) => b.requestedAt - a.requestedAt)
  blocked.sort((a, b) => b.blockedAt - a.blockedAt)

  return { friends, incoming, outgoing, blocked }
}

export function areFriends(userIdA: string, userIdB: string): boolean {
  if (userIdA === userIdB) return false
  const pair = normalizedPair(userIdA, userIdB)
  const rel = db.friendships.find((f) => f.userAId === pair.userAId && f.userBId === pair.userBId)
  return rel?.status === 'ACCEPTED'
}

export function sendFriendRequest(args: { fromUserId: string; toIdentity: string }): { targetUserId: string; status: 'PENDING' | 'ACCEPTED' } {
  const fromUser = db.users.find((u) => u.id === args.fromUserId)
  if (!fromUser) throw new Error('FROM_USER_NOT_FOUND')

  const toUser = findUserByEmailOrDisplayName(args.toIdentity)
  if (!toUser) throw new Error('TARGET_USER_NOT_FOUND')
  if (toUser.id === fromUser.id) throw new Error('CANNOT_FRIEND_SELF')

  const pair = normalizedPair(fromUser.id, toUser.id)
  const rel = db.friendships.find((f) => f.userAId === pair.userAId && f.userBId === pair.userBId)

  if (!rel) {
    const now = Date.now()
    db.friendships.push({
      userAId: pair.userAId,
      userBId: pair.userBId,
      status: 'PENDING',
      requestedByUserId: fromUser.id,
      createdAt: now,
      updatedAt: now,
    })
    persistDb()
    return { targetUserId: toUser.id, status: 'PENDING' }
  }

  if (rel.status === 'BLOCKED') throw new Error('FRIENDSHIP_BLOCKED')
  if (rel.status === 'ACCEPTED') throw new Error('ALREADY_FRIENDS')

  if (rel.status === 'PENDING') {
    if (rel.requestedByUserId === fromUser.id) throw new Error('REQUEST_ALREADY_SENT')
    rel.status = 'ACCEPTED'
    rel.updatedAt = Date.now()
    persistDb()
    return { targetUserId: toUser.id, status: 'ACCEPTED' }
  }

  throw new Error('FRIEND_REQUEST_FAILED')
}

export function respondToFriendRequest(args: { userId: string; friendUserId: string; accept: boolean }): { status: 'ACCEPTED' | 'DECLINED' } {
  const pair = normalizedPair(args.userId, args.friendUserId)
  const rel = db.friendships.find((f) => f.userAId === pair.userAId && f.userBId === pair.userBId)
  if (!rel || rel.status !== 'PENDING') throw new Error('REQUEST_NOT_FOUND')
  if (rel.requestedByUserId === args.userId) throw new Error('NOT_INCOMING_REQUEST')

  if (args.accept) {
    rel.status = 'ACCEPTED'
    rel.updatedAt = Date.now()
    persistDb()
    return { status: 'ACCEPTED' }
  }

  db.friendships = db.friendships.filter((f) => f !== rel)
  persistDb()
  return { status: 'DECLINED' }
}

export function removeFriend(args: { userId: string; friendUserId: string }): void {
  const pair = normalizedPair(args.userId, args.friendUserId)
  const before = db.friendships.length
  db.friendships = db.friendships.filter((f) => !(f.userAId === pair.userAId && f.userBId === pair.userBId))
  if (db.friendships.length !== before) persistDb()
}

export function blockUser(args: { userId: string; friendUserId: string }): void {
  if (args.userId === args.friendUserId) throw new Error('CANNOT_BLOCK_SELF')
  const pair = normalizedPair(args.userId, args.friendUserId)
  const rel = db.friendships.find((f) => f.userAId === pair.userAId && f.userBId === pair.userBId)
  const now = Date.now()
  if (!rel) {
    db.friendships.push({
      userAId: pair.userAId,
      userBId: pair.userBId,
      status: 'BLOCKED',
      requestedByUserId: args.userId,
      createdAt: now,
      updatedAt: now,
    })
  } else {
    rel.status = 'BLOCKED'
    rel.requestedByUserId = args.userId
    rel.updatedAt = now
  }
  persistDb()
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

export function createPasswordResetRequest(email: string): { token: string; user: PublicUser } | null {
  const normalized = email.trim().toLowerCase()
  if (!normalized) return null
  const user = db.users.find((u) => u.email === normalized)
  if (!user) return null

  prunePasswordResets()
  const token = randomId(32)
  const reset: PasswordResetRecord = {
    id: randomId(10),
    userId: user.id,
    tokenHash: hashResetToken(token),
    createdAt: Date.now(),
    expiresAt: Date.now() + PASSWORD_RESET_TTL_MS,
    usedAt: null,
  }
  db.passwordResets.push(reset)
  persistDb()
  return { token, user: toPublicUser(user) }
}

export function consumePasswordReset(args: { token: string; newPassword: string }): PublicUser | null {
  prunePasswordResets()
  const tokenHash = hashResetToken(args.token)
  const now = Date.now()
  const reset = db.passwordResets.find((r) => r.tokenHash === tokenHash && r.usedAt == null && r.expiresAt > now)
  if (!reset) return null

  const user = db.users.find((u) => u.id === reset.userId)
  if (!user) return null

  const salt = randomId(16)
  user.passwordSalt = salt
  user.passwordHash = hashPassword(args.newPassword, salt)

  reset.usedAt = now
  db.sessions = db.sessions.filter((s) => s.userId !== user.id)
  db.passwordResets = db.passwordResets.filter((r) => r.userId !== user.id || r.id === reset.id)
  persistDb()
  return toPublicUser(user)
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

function prunePasswordResets(): void {
  const now = Date.now()
  const before = db.passwordResets.length
  db.passwordResets = db.passwordResets.filter((r) => r.expiresAt > now && r.usedAt == null)
  if (db.passwordResets.length !== before) persistDb()
}

function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex')
}

function randomId(bytes: number): string {
  return randomBytes(bytes).toString('base64url')
}

function loadDb(): AuthStoreData {
  try {
    const dir = path.dirname(dataFile)
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    if (!fs.existsSync(dataFile)) {
      const initial: AuthStoreData = { users: [], sessions: [], friendships: [], passwordResets: [] }
      fs.writeFileSync(dataFile, JSON.stringify(initial, null, 2), 'utf8')
      return initial
    }

    const raw = fs.readFileSync(dataFile, 'utf8')
    const parsed = JSON.parse(raw)
    return {
      users: Array.isArray(parsed?.users) ? parsed.users : [],
      sessions: Array.isArray(parsed?.sessions) ? parsed.sessions : [],
      friendships: Array.isArray(parsed?.friendships) ? parsed.friendships : [],
      passwordResets: Array.isArray(parsed?.passwordResets) ? parsed.passwordResets : [],
    }
  } catch {
    return { users: [], sessions: [], friendships: [], passwordResets: [] }
  }
}

function persistDb(): void {
  const dir = path.dirname(dataFile)
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(dataFile, JSON.stringify(db, null, 2), 'utf8')
}

function normalizedPair(userIdA: string, userIdB: string): { userAId: string; userBId: string } {
  return userIdA < userIdB ? { userAId: userIdA, userBId: userIdB } : { userAId: userIdB, userBId: userIdA }
}

function otherSide(rel: FriendshipRecord, userId: string): string | null {
  if (rel.userAId === userId) return rel.userBId
  if (rel.userBId === userId) return rel.userAId
  return null
}

function toFriendSummary(u: UserRecord): FriendSummary {
  return {
    userId: u.id,
    email: u.email,
    displayName: u.displayName,
  }
}

function findUserByEmailOrDisplayName(identity: string): UserRecord | null {
  const raw = identity.trim()
  if (!raw) return null

  const emailMatch = db.users.find((u) => u.email === raw.toLowerCase())
  if (emailMatch) return emailMatch

  const byDisplay = db.users.filter((u) => u.displayName.toLowerCase() === raw.toLowerCase())
  if (byDisplay.length === 1) return byDisplay[0]
  if (byDisplay.length > 1) throw new Error('DISPLAY_NAME_AMBIGUOUS')
  return null
}
