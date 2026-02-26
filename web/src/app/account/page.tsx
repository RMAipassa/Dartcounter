'use client'

import { useEffect, useMemo, useState } from 'react'
import { getServerUrl } from '@/lib/config'
import { getSocket } from '@/lib/socket'

type MeUser = {
  id: string
  email: string
  displayName: string
  autodartsDeviceId: string | null
  hasAutodartsCredentials: boolean
  autodartsApiBase: string | null
  autodartsWsBase: string | null
  createdAt: number
}

type MeStats = {
  allTime: {
    totalGames: number
    wins: number
    losses: number
    winRate: number | null
    threeDartAvg: number | null
    checkoutRate: number | null
    highestCheckout: number | null
    highestScore: number
  }
  lastTen: {
    games: number
    wins: number
    losses: number
    winRate: number | null
    threeDartAvg: number | null
    checkoutRate: number | null
    highestCheckout: number | null
    highestScore: number
  }
  history: Array<{
    roomCode: string
    finishedAt: number
    result: 'WIN' | 'LOSS'
    threeDartAvg: number | null
    highestCheckout: number | null
    highestScore: number
  }>
}

type GlobalRecords = {
  allTime: {
    mostWins: { userId: string; value: number; displayName?: string | null } | null
    highestCheckout: { userId: string; value: number; displayName?: string | null } | null
    highestScore: { userId: string; value: number; displayName?: string | null } | null
    bestThreeDartAverage: { userId: string; value: number; displayName?: string | null } | null
  }
  lastTen: {
    mostWins: { userId: string; value: number; displayName?: string | null } | null
    highestCheckout: { userId: string; value: number; displayName?: string | null } | null
    highestScore: { userId: string; value: number; displayName?: string | null } | null
    bestThreeDartAverage: { userId: string; value: number; displayName?: string | null } | null
  }
}

type FriendLeaderboardRow = {
  userId: string
  displayName: string
  isYou: boolean
  allTime: {
    totalGames: number
    wins: number
    losses: number
    winRate: number | null
    threeDartAvg: number | null
    checkoutRate: number | null
    highestCheckout: number | null
    highestScore: number
  }
  lastTen: {
    games: number
    wins: number
    losses: number
    winRate: number | null
    threeDartAvg: number | null
    checkoutRate: number | null
    highestCheckout: number | null
    highestScore: number
  }
}

type BridgeHealth = {
  reachable: boolean
  latencyMs: number
  status?: number
  error?: string
  health?: { mode?: string; sessions?: number }
}

type FriendUser = {
  userId: string
  email: string
  displayName: string
}

type FriendsState = {
  friends: Array<{ user: FriendUser; since: number; online: boolean }>
  incoming: Array<{ user: FriendUser; requestedAt: number; online: boolean }>
  outgoing: Array<{ user: FriendUser; requestedAt: number; online: boolean }>
  blocked: Array<{ user: FriendUser; blockedAt: number }>
}

export default function AccountPage() {
  const serverUrl = useMemo(() => getServerUrl(), [])
  const [mode, setMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [me, setMe] = useState<MeUser | null>(null)
  const [stats, setStats] = useState<MeStats | null>(null)
  const [records, setRecords] = useState<GlobalRecords | null>(null)
  const [autodartsDeviceIdInput, setAutodartsDeviceIdInput] = useState('')
  const [autodartsTokenInput, setAutodartsTokenInput] = useState('')
  const [autodartsEmailInput, setAutodartsEmailInput] = useState('')
  const [autodartsPasswordInput, setAutodartsPasswordInput] = useState('')
  const [autodartsApiBaseInput, setAutodartsApiBaseInput] = useState('')
  const [autodartsWsBaseInput, setAutodartsWsBaseInput] = useState('')
  const [bridgeHealth, setBridgeHealth] = useState<BridgeHealth | null>(null)
  const [friends, setFriends] = useState<FriendsState | null>(null)
  const [friendIdentityInput, setFriendIdentityInput] = useState('')
  const [friendsLeaderboard, setFriendsLeaderboard] = useState<FriendLeaderboardRow[]>([])

  useEffect(() => {
    void refreshMe(serverUrl, setMe, setStats)
    void refreshGlobalRecords(serverUrl, setRecords)
    void refreshBridgeHealth(serverUrl, setBridgeHealth)
  }, [serverUrl])

  useEffect(() => {
    if (!me) return
    setAutodartsDeviceIdInput(me.autodartsDeviceId ?? '')
    setAutodartsApiBaseInput(me.autodartsApiBase ?? '')
    setAutodartsWsBaseInput(me.autodartsWsBase ?? '')
  }, [me])

  useEffect(() => {
    if (!me) {
      setFriends(null)
      setFriendsLeaderboard([])
      return
    }
    const token = localStorage.getItem('dc_authToken')
    if (!token) return
    const socket = getSocket(serverUrl)
    void socket.emitWithAck('social:identify', { authToken: token, token })
    void refreshFriends(serverUrl, setFriends)
    void refreshFriendsLeaderboard(serverUrl, setFriendsLeaderboard)
  }, [me, serverUrl])

  useEffect(() => {
    if (!me) return
    const refresh = () => {
      void refreshFriends(serverUrl, setFriends)
    }
    const t = window.setInterval(refresh, 12000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [me, serverUrl])

  async function submit() {
    setError(null)
    setBusy(true)
    try {
      const endpoint = mode === 'LOGIN' ? '/api/auth/login' : '/api/auth/register'
      const payload: Record<string, unknown> = { email, password }
      if (mode === 'REGISTER') payload.displayName = displayName.trim()

      const res = await fetch(`${serverUrl}${endpoint}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok || !data?.token) {
        throw new Error(data?.message ?? 'Authentication failed')
      }

      localStorage.setItem('dc_authToken', data.token)
      localStorage.setItem('dc_authEmail', data.user?.email ?? '')
      localStorage.setItem('dc_authDisplayName', data.user?.displayName ?? '')
      if (data.user?.displayName) {
        localStorage.setItem('dc_name', data.user.displayName)
      }

      await refreshMe(serverUrl, setMe, setStats)
      if (data.user?.autodartsDeviceId) setAutodartsDeviceIdInput(data.user.autodartsDeviceId)
      setPassword('')
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  async function logout() {
    setError(null)
    setBusy(true)
    try {
      const token = localStorage.getItem('dc_authToken')
      if (token) {
        await fetch(`${serverUrl}/api/auth/logout`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ token }),
        })
      }
    } finally {
      localStorage.removeItem('dc_authToken')
      localStorage.removeItem('dc_authEmail')
      localStorage.removeItem('dc_authDisplayName')
      setMe(null)
      setStats(null)
      setAutodartsDeviceIdInput('')
      setAutodartsTokenInput('')
      setAutodartsEmailInput('')
      setAutodartsPasswordInput('')
      setAutodartsApiBaseInput('')
      setAutodartsWsBaseInput('')
      setFriends(null)
      setFriendsLeaderboard([])
      setBusy(false)
    }
  }

  async function sendFriendRequest() {
    setError(null)
    setBusy(true)
    try {
      const token = localStorage.getItem('dc_authToken')
      if (!token) throw new Error('Not signed in')
      const res = await fetch(`${serverUrl}/api/friends/request`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ identity: friendIdentityInput.trim() }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) throw new Error(data?.message ?? 'Could not send friend request')
      setFriendIdentityInput('')
      await refreshFriends(serverUrl, setFriends)
      await refreshFriendsLeaderboard(serverUrl, setFriendsLeaderboard)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  async function respondFriend(friendUserId: string, accept: boolean) {
    setError(null)
    setBusy(true)
    try {
      const token = localStorage.getItem('dc_authToken')
      if (!token) throw new Error('Not signed in')
      const res = await fetch(`${serverUrl}/api/friends/respond`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ friendUserId, accept }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) throw new Error(data?.message ?? 'Could not respond to friend request')
      await refreshFriends(serverUrl, setFriends)
      await refreshFriendsLeaderboard(serverUrl, setFriendsLeaderboard)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  async function removeFriendship(friendUserId: string) {
    setError(null)
    setBusy(true)
    try {
      const token = localStorage.getItem('dc_authToken')
      if (!token) throw new Error('Not signed in')
      const res = await fetch(`${serverUrl}/api/friends/remove`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({ friendUserId }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) throw new Error(data?.message ?? 'Could not remove friend')
      await refreshFriends(serverUrl, setFriends)
      await refreshFriendsLeaderboard(serverUrl, setFriendsLeaderboard)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  async function challengeFriend(friendUserId: string) {
    setError(null)
    setBusy(true)
    try {
      const token = localStorage.getItem('dc_authToken')
      if (!token) throw new Error('Not signed in')
      const socket = getSocket(serverUrl)
      const res = await socket.emitWithAck('friends:challenge', { friendUserId, authToken: token })
      if (!res?.ok) throw new Error(res?.message ?? 'Could not send challenge')
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveAutodartsDevice() {
    setError(null)
    setBusy(true)
    try {
      const token = localStorage.getItem('dc_authToken')
      if (!token) throw new Error('Not signed in')

      const payload = { deviceId: autodartsDeviceIdInput.trim() || null }
      const res = await fetch(`${serverUrl}/api/auth/autodarts`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok || !data?.user) {
        throw new Error(data?.message ?? 'Failed to update autodarts device')
      }
      localStorage.setItem('dc_authDisplayName', data.user.displayName ?? '')
      setMe(data.user)
      setAutodartsDeviceIdInput(data.user.autodartsDeviceId ?? '')
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  async function saveAutodartsCredentials(clear = false) {
    setError(null)
    setBusy(true)
    try {
      const token = localStorage.getItem('dc_authToken')
      if (!token) throw new Error('Not signed in')

      const payload = clear
        ? { clear: true }
        : {
            token: autodartsTokenInput.trim() || null,
            email: autodartsEmailInput.trim() || null,
            password: autodartsPasswordInput.trim() || null,
            apiBase: autodartsApiBaseInput.trim() || null,
            wsBase: autodartsWsBaseInput.trim() || null,
          }

      const res = await fetch(`${serverUrl}/api/auth/autodarts-credentials`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify(payload),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok || !data?.user) {
        throw new Error(data?.message ?? 'Failed to update autodarts credentials')
      }
      setMe(data.user)
      setAutodartsPasswordInput('')
      if (clear) {
        setAutodartsTokenInput('')
        setAutodartsEmailInput('')
        setAutodartsApiBaseInput('')
        setAutodartsWsBaseInput('')
      }
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="col" style={{ gap: 16 }}>
      <div className="card" style={{ padding: 16 }}>
        <h1 className="title">Account</h1>
        <p className="subtitle">Sign in to link personal autodarts devices in upcoming updates.</p>
      </div>

      {me ? (
        <div className="card" style={{ padding: 16 }}>
          <div className="col">
            <span className="pill">Signed in</span>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <span className="pill">Name: {me.displayName}</span>
              <span className="pill">Email: {me.email}</span>
            </div>
            <div className="col">
              <label className="help">Personal autodarts device id</label>
              <input
                className="input"
                value={autodartsDeviceIdInput}
                onChange={(e) => setAutodartsDeviceIdInput(e.target.value)}
                placeholder="e.g. board-home-ruben"
              />
              <div className="help">This board will auto-bind when it is your turn in live games.</div>
              <div className="row">
                <button className="btn" disabled={busy} onClick={saveAutodartsDevice}>
                  Save autodarts device
                </button>
                {me.autodartsDeviceId ? <span className="pill">Current: {me.autodartsDeviceId}</span> : <span className="pill">Current: none</span>}
              </div>
            </div>
            <div className="col">
              <label className="help">Personal autodarts credentials (optional override)</label>
              <input
                className="input"
                value={autodartsTokenInput}
                onChange={(e) => setAutodartsTokenInput(e.target.value)}
                placeholder="Token (or use email/password below)"
              />
              <input
                className="input"
                value={autodartsEmailInput}
                onChange={(e) => setAutodartsEmailInput(e.target.value)}
                placeholder="Autodarts email"
              />
              <input
                className="input"
                type="password"
                value={autodartsPasswordInput}
                onChange={(e) => setAutodartsPasswordInput(e.target.value)}
                placeholder="Autodarts password"
              />
              <input
                className="input"
                value={autodartsApiBaseInput}
                onChange={(e) => setAutodartsApiBaseInput(e.target.value)}
                placeholder="Optional API base override"
              />
              <input
                className="input"
                value={autodartsWsBaseInput}
                onChange={(e) => setAutodartsWsBaseInput(e.target.value)}
                placeholder="Optional WS base override"
              />
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn" disabled={busy} onClick={() => void saveAutodartsCredentials(false)}>
                  Save credentials
                </button>
                <button className="btn" disabled={busy} onClick={() => void saveAutodartsCredentials(true)}>
                  Clear credentials
                </button>
                <span className="pill">Saved: {me.hasAutodartsCredentials ? 'yes' : 'no'}</span>
              </div>
              <div className="help">Credentials are stored on this server and used for your personal board binding.</div>
            </div>
            <button className="btn" disabled={busy} onClick={logout}>
              Sign out
            </button>
          </div>
        </div>
      ) : (
        <div className="card" style={{ padding: 16 }}>
          <div className="row">
            <button className="btn" disabled={mode === 'LOGIN'} onClick={() => setMode('LOGIN')}>
              Login
            </button>
            <button className="btn" disabled={mode === 'REGISTER'} onClick={() => setMode('REGISTER')}>
              Register
            </button>
          </div>

          <div className="col" style={{ marginTop: 12 }}>
            <label className="help">Email</label>
            <input className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" />

            {mode === 'REGISTER' ? (
              <>
                <label className="help">Display name</label>
                <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder="Ruben" />
              </>
            ) : null}

            <label className="help">Password</label>
            <input
              className="input"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="At least 8 characters"
            />

            <button className="btn btnPrimary" disabled={busy || !email.trim() || !password} onClick={submit}>
              {busy ? 'Working...' : mode === 'LOGIN' ? 'Sign in' : 'Create account'}
            </button>
          </div>
        </div>
      )}

      {me ? (
        <div className="card" style={{ padding: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 16 }}>Friends</div>
            <button className="btn" disabled={busy} onClick={() => void refreshFriends(serverUrl, setFriends)}>
              Refresh friends
            </button>
          </div>

          <div className="col" style={{ marginTop: 10 }}>
            <label className="help">Add friend by email or display name</label>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <input
                className="input"
                value={friendIdentityInput}
                onChange={(e) => setFriendIdentityInput(e.target.value)}
                placeholder="friend@example.com or Ruben"
              />
              <button className="btn" disabled={busy || !friendIdentityInput.trim()} onClick={sendFriendRequest}>
                Send request
              </button>
            </div>
          </div>

          <div className="col" style={{ marginTop: 12 }}>
            <div className="help">Friends</div>
            {(friends?.friends ?? []).length === 0 ? <span className="pill">No friends yet</span> : null}
            {(friends?.friends ?? []).map((f) => (
              <div key={f.user.userId} className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span className="pill">{f.user.displayName}</span>
                <span className="pill">{f.user.email}</span>
                <span className="pill" style={{ color: f.online ? 'var(--good)' : 'var(--muted)' }}>{f.online ? 'online' : 'offline'}</span>
                <button className="btn" disabled={busy} onClick={() => void challengeFriend(f.user.userId)}>
                  {f.online ? 'Challenge' : 'Challenge (offline)'}
                </button>
                <button className="btn" disabled={busy} onClick={() => void removeFriendship(f.user.userId)}>
                  Remove
                </button>
              </div>
            ))}
          </div>

          <div className="col" style={{ marginTop: 12 }}>
            <div className="help">Incoming requests</div>
            {(friends?.incoming ?? []).length === 0 ? <span className="pill">None</span> : null}
            {(friends?.incoming ?? []).map((f) => (
              <div key={f.user.userId} className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span className="pill">{f.user.displayName}</span>
                <span className="pill">{f.user.email}</span>
                <button className="btn" disabled={busy} onClick={() => void respondFriend(f.user.userId, true)}>
                  Accept
                </button>
                <button className="btn" disabled={busy} onClick={() => void respondFriend(f.user.userId, false)}>
                  Decline
                </button>
              </div>
            ))}
          </div>

          <div className="col" style={{ marginTop: 12 }}>
            <div className="help">Outgoing requests</div>
            {(friends?.outgoing ?? []).length === 0 ? <span className="pill">None</span> : null}
            {(friends?.outgoing ?? []).map((f) => (
              <div key={f.user.userId} className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span className="pill">{f.user.displayName}</span>
                <span className="pill">{f.user.email}</span>
                <button className="btn" disabled={busy} onClick={() => void removeFriendship(f.user.userId)}>
                  Cancel request
                </button>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {stats ? (
        <div className="grid2">
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 16, marginBottom: 8 }}>All-time stats</div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <span className="pill">Games: {stats.allTime.totalGames}</span>
              <span className="pill">W/L: {stats.allTime.wins}/{stats.allTime.losses}</span>
              <span className="pill">Win%: {stats.allTime.winRate ?? '-'}</span>
              <span className="pill">Avg: {stats.allTime.threeDartAvg ?? '-'}</span>
              <span className="pill">CO%: {stats.allTime.checkoutRate ?? '-'}</span>
              <span className="pill">Hi finish: {stats.allTime.highestCheckout ?? '-'}</span>
              <span className="pill">Hi score: {stats.allTime.highestScore}</span>
            </div>
          </div>

          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 16, marginBottom: 8 }}>Last 10 games</div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <span className="pill">Games: {stats.lastTen.games}</span>
              <span className="pill">W/L: {stats.lastTen.wins}/{stats.lastTen.losses}</span>
              <span className="pill">Win%: {stats.lastTen.winRate ?? '-'}</span>
              <span className="pill">Avg: {stats.lastTen.threeDartAvg ?? '-'}</span>
              <span className="pill">CO%: {stats.lastTen.checkoutRate ?? '-'}</span>
              <span className="pill">Hi finish: {stats.lastTen.highestCheckout ?? '-'}</span>
              <span className="pill">Hi score: {stats.lastTen.highestScore}</span>
            </div>
          </div>
        </div>
      ) : null}

      {stats && stats.history.length > 0 ? (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 16, marginBottom: 8 }}>Recent games history</div>
          <div className="col">
            {stats.history.map((g, idx) => (
              <div key={`${g.roomCode}-${g.finishedAt}-${idx}`} className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span className="pill">{g.result}</span>
                <span className="pill">Room: {g.roomCode}</span>
                <span className="pill">Avg: {g.threeDartAvg ?? '-'}</span>
                <span className="pill">Hi finish: {g.highestCheckout ?? '-'}</span>
                <span className="pill">Hi score: {g.highestScore}</span>
                <span className="help">{new Date(g.finishedAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      <div className="card" style={{ padding: 16 }}>
        <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ fontSize: 16 }}>Autodarts bridge status</div>
          <button className="btn" disabled={busy} onClick={() => void refreshBridgeHealth(serverUrl, setBridgeHealth)}>
            Refresh bridge
          </button>
        </div>
        {bridgeHealth ? (
          <div className="row" style={{ flexWrap: 'wrap', marginTop: 8 }}>
            <span className="pill">Reachable: {bridgeHealth.reachable ? 'yes' : 'no'}</span>
            <span className="pill">Latency: {bridgeHealth.latencyMs}ms</span>
            <span className="pill">HTTP: {bridgeHealth.status ?? '-'}</span>
            <span className="pill">Mode: {bridgeHealth.health?.mode ?? '-'}</span>
            <span className="pill">Sessions: {bridgeHealth.health?.sessions ?? '-'}</span>
            {bridgeHealth.error ? <span className="pill" style={{ color: 'var(--bad)' }}>Err: {bridgeHealth.error}</span> : null}
          </div>
        ) : (
          <div className="help" style={{ marginTop: 8 }}>No bridge status loaded yet.</div>
        )}
      </div>

      {records ? (
        <div className="card" style={{ padding: 16 }}>
          <div style={{ fontSize: 16, marginBottom: 8 }}>Global records</div>
          <div className="help">All time</div>
          <div className="row" style={{ flexWrap: 'wrap', marginTop: 6 }}>
            <span className="pill">Most wins: {recordLabel(records.allTime.mostWins)}</span>
            <span className="pill">Highest checkout: {recordLabel(records.allTime.highestCheckout)}</span>
            <span className="pill">Highest score: {recordLabel(records.allTime.highestScore)}</span>
            <span className="pill">Best avg: {recordLabel(records.allTime.bestThreeDartAverage)}</span>
          </div>
          <div className="help" style={{ marginTop: 10 }}>Last 10 games</div>
          <div className="row" style={{ flexWrap: 'wrap', marginTop: 6 }}>
            <span className="pill">Most wins: {recordLabel(records.lastTen.mostWins)}</span>
            <span className="pill">Highest checkout: {recordLabel(records.lastTen.highestCheckout)}</span>
            <span className="pill">Highest score: {recordLabel(records.lastTen.highestScore)}</span>
            <span className="pill">Best avg: {recordLabel(records.lastTen.bestThreeDartAverage)}</span>
          </div>
        </div>
      ) : null}

      {me ? (
        <div className="card" style={{ padding: 16 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 16 }}>Friends leaderboard</div>
            <button className="btn" disabled={busy} onClick={() => void refreshFriendsLeaderboard(serverUrl, setFriendsLeaderboard)}>
              Refresh leaderboard
            </button>
          </div>
          <div className="col" style={{ marginTop: 8 }}>
            {friendsLeaderboard.length < 1 ? <span className="pill">No friend stats yet</span> : null}
            {friendsLeaderboard.map((row) => (
              <div key={row.userId} className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span className="pill" style={{ color: row.isYou ? 'var(--accent)' : 'var(--text)' }}>{row.isYou ? `${row.displayName} (You)` : row.displayName}</span>
                <span className="pill">All-time W/L: {row.allTime.wins}/{row.allTime.losses}</span>
                <span className="pill">All-time Avg: {row.allTime.threeDartAvg ?? '-'}</span>
                <span className="pill">Last10 W/L: {row.lastTen.wins}/{row.lastTen.losses}</span>
                <span className="pill">Last10 Avg: {row.lastTen.threeDartAvg ?? '-'}</span>
                <span className="pill">Hi CO: {row.allTime.highestCheckout ?? '-'}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {error ? <div className="toast">{error}</div> : null}
    </div>
  )
}

async function refreshMe(
  serverUrl: string,
  setMe: (u: MeUser | null) => void,
  setStats: (s: MeStats | null) => void,
): Promise<void> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('dc_authToken') : null
  if (!token) {
    setMe(null)
    setStats(null)
    return
  }

  const res = await fetch(`${serverUrl}/api/auth/me`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok || !data?.user) {
    setMe(null)
    setStats(null)
    return
  }
  setMe(data.user)

  const statsRes = await fetch(`${serverUrl}/api/stats/me`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  })
  const statsData = await statsRes.json().catch(() => null)
  if (!statsRes.ok || !statsData?.ok || !statsData?.stats) {
    setStats(null)
    return
  }
  setStats(statsData.stats)
}

async function refreshGlobalRecords(serverUrl: string, setRecords: (r: GlobalRecords | null) => void): Promise<void> {
  const res = await fetch(`${serverUrl}/api/stats/global`)
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok || !data?.records) {
    setRecords(null)
    return
  }
  setRecords(data.records)
}

async function refreshBridgeHealth(serverUrl: string, setBridge: (b: BridgeHealth | null) => void): Promise<void> {
  const res = await fetch(`${serverUrl}/api/autodarts/bridge-health`)
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) {
    setBridge(null)
    return
  }
  setBridge({
    reachable: Boolean(data.reachable),
    latencyMs: Number(data.latencyMs ?? 0),
    status: typeof data.status === 'number' ? data.status : undefined,
    error: typeof data.error === 'string' ? data.error : undefined,
    health: typeof data.health === 'object' && data.health ? data.health : undefined,
  })
}

async function refreshFriends(serverUrl: string, setFriends: (f: FriendsState | null) => void): Promise<void> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('dc_authToken') : null
  if (!token) {
    setFriends(null)
    return
  }

  const res = await fetch(`${serverUrl}/api/friends/me`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok) {
    setFriends(null)
    return
  }

  setFriends({
    friends: Array.isArray(data.friends) ? data.friends : [],
    incoming: Array.isArray(data.incoming) ? data.incoming : [],
    outgoing: Array.isArray(data.outgoing) ? data.outgoing : [],
    blocked: Array.isArray(data.blocked) ? data.blocked : [],
  })
}

async function refreshFriendsLeaderboard(
  serverUrl: string,
  setRows: (rows: FriendLeaderboardRow[]) => void,
): Promise<void> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('dc_authToken') : null
  if (!token) {
    setRows([])
    return
  }

  const res = await fetch(`${serverUrl}/api/stats/friends`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok || !Array.isArray(data.rows)) {
    setRows([])
    return
  }
  setRows(data.rows as FriendLeaderboardRow[])
}

function recordLabel(record: { userId: string; value: number; displayName?: string | null } | null): string {
  if (!record) return '-'
  return `${record.value} (${record.displayName ?? record.userId.slice(0, 8)})`
}
