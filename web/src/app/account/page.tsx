'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import NameRow, { NameMark } from '@/components/NameRow'
import { SectionPanel, SectionTabs } from '@/components/SectionTabs'
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
    dartsThrown: number
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
    dartsThrown: number
    threeDartAvg: number | null
    checkoutRate: number | null
    highestCheckout: number | null
    highestScore: number
  }
  history: Array<{
    gameType: 'X01' | 'AROUND'
    roomCode: string
    finishedAt: number
    result: 'WIN' | 'LOSS'
    threeDartAvg: number | null
    highestCheckout: number | null
    highestScore: number
  }>
  byMode: {
    X01: {
      allTime: {
        totalGames: number
        wins: number
        losses: number
        winRate: number | null
        dartsThrown: number
        threeDartAvg: number | null
      }
      lastTen: {
        games: number
        wins: number
        losses: number
        winRate: number | null
        dartsThrown: number
        threeDartAvg: number | null
      }
      history: Array<{ roomCode: string; finishedAt: number; result: 'WIN' | 'LOSS' }>
    }
    AROUND: {
      allTime: {
        totalGames: number
        wins: number
        losses: number
        winRate: number | null
        dartsThrown: number
        threeDartAvg: number | null
      }
      lastTen: {
        games: number
        wins: number
        losses: number
        winRate: number | null
        dartsThrown: number
        threeDartAvg: number | null
      }
      history: Array<{ roomCode: string; finishedAt: number; result: 'WIN' | 'LOSS'; dartsThrown: number }>
    }
  }
}

type GlobalRecords = {
  byMode: {
    X01: {
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
    AROUND: {
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
  byMode?: any
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

type IncomingChallenge = {
  challengeId: string
  from: FriendUser
  createdAt: number
  expiresAt: number
}

type IncomingRoomInvite = {
  inviteId: string
  roomCode: string
  roomTitle: string | null
  from: FriendUser
  createdAt: number
  expiresAt: number
}

type AccountSection = 'overview' | 'friends' | 'stats' | 'boards'

export default function AccountPage() {
  const serverUrl = useMemo(() => getServerUrl(), [])
  const [mode, setMode] = useState<'LOGIN' | 'REGISTER'>('LOGIN')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [rememberMe, setRememberMe] = useState(true)
  const [forgotMode, setForgotMode] = useState(false)
  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotMessage, setForgotMessage] = useState<string | null>(null)
  const [resetToken, setResetToken] = useState('')
  const [resetPassword, setResetPassword] = useState('')
  const [resetPasswordConfirm, setResetPasswordConfirm] = useState('')
  const [resetMessage, setResetMessage] = useState<string | null>(null)
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
  const [incomingChallenges, setIncomingChallenges] = useState<IncomingChallenge[]>([])
  const [incomingInvites, setIncomingInvites] = useState<IncomingRoomInvite[]>([])
  const [uiDensity, setUiDensity] = useState<'spacious' | 'compact'>('spacious')
  const [statsModeView, setStatsModeView] = useState<'X01' | 'AROUND'>('X01')
  const [section, setSection] = useState<AccountSection>('overview')

  useEffect(() => {
    function restoreSection() {
      const tab = window.location.hash.slice(1)
      setSection(tab === 'friends' || tab === 'stats' || tab === 'boards' ? tab : 'overview')
    }
    restoreSection()
    window.addEventListener('hashchange', restoreSection)
    return () => window.removeEventListener('hashchange', restoreSection)
  }, [])

  function selectSection(tab: AccountSection) {
    setSection(tab)
    const url = new URL(window.location.href)
    url.hash = tab === 'overview' ? '' : tab
    window.history.replaceState(null, '', url)
  }

  useEffect(() => {
    if (typeof window === 'undefined') return
    const token = new URLSearchParams(window.location.search).get('resetToken')?.trim() ?? ''
    setResetToken(token)
  }, [])

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
      setIncomingChallenges([])
      setIncomingInvites([])
      return
    }
    const token = localStorage.getItem('dc_authToken')
    if (!token) return
    const socket = getSocket(serverUrl)
    void socket.emitWithAck('social:identify', { authToken: token, token })
    void refreshFriends(serverUrl, setFriends)
    void refreshFriendsLeaderboard(serverUrl, setFriendsLeaderboard, statsModeView)
    void refreshIncomingChallenges(serverUrl, setIncomingChallenges)
    void refreshIncomingInvites(serverUrl, setIncomingInvites)
  }, [me, serverUrl, statsModeView])

  useEffect(() => {
    if (typeof window === 'undefined') return
    const current = localStorage.getItem('dc_uiDensity')
    setUiDensity(current === 'compact' ? 'compact' : 'spacious')
  }, [])

  useEffect(() => {
    if (!me) return
    const refresh = () => {
      void refreshFriends(serverUrl, setFriends)
      void refreshIncomingChallenges(serverUrl, setIncomingChallenges)
      void refreshIncomingInvites(serverUrl, setIncomingInvites)
    }
    const t = window.setInterval(refresh, 12000)
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('dc:challengeInvite', refresh as any)
    window.addEventListener('dc:roomInvite', refresh as any)
    return () => {
      window.clearInterval(t)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('dc:challengeInvite', refresh as any)
      window.removeEventListener('dc:roomInvite', refresh as any)
    }
  }, [me, serverUrl])

  async function submit() {
    setError(null)
    setForgotMessage(null)
    setResetMessage(null)
    setBusy(true)
    try {
      const endpoint = mode === 'LOGIN' ? '/api/auth/login' : '/api/auth/register'
      const payload: Record<string, unknown> = { email, password }
      if (mode === 'REGISTER') payload.displayName = displayName.trim()
      if (mode === 'LOGIN') payload.rememberMe = rememberMe

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

  async function submitForgotPassword() {
    setError(null)
    setForgotMessage(null)
    setBusy(true)
    try {
      const res = await fetch(`${serverUrl}/api/auth/forgot-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: forgotEmail.trim() }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) throw new Error(data?.message ?? 'Could not request password reset')
      if (data?.devResetToken) {
        setResetToken(String(data.devResetToken))
        setResetMessage('Reset token generated in dev mode. Set a new password below.')
      } else {
        setForgotMessage('If an account exists for that email, a reset link has been sent.')
      }
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  async function submitResetPassword() {
    setError(null)
    setResetMessage(null)
    if (resetPassword !== resetPasswordConfirm) {
      setError('Passwords do not match')
      return
    }
    setBusy(true)
    try {
      const res = await fetch(`${serverUrl}/api/auth/reset-password`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: resetToken.trim(), newPassword: resetPassword }),
      })
      const data = await res.json().catch(() => null)
      if (!res.ok || !data?.ok) throw new Error(data?.message ?? 'Could not reset password')
      localStorage.removeItem('dc_authToken')
      localStorage.removeItem('dc_authDisplayName')
      setResetPassword('')
      setResetPasswordConfirm('')
      setResetMessage('Password reset successful. Please sign in with your new password.')
      setMode('LOGIN')
      setForgotMode(false)
      if (typeof window !== 'undefined' && window.location.search.includes('resetToken=')) {
        window.history.replaceState(null, '', '/account')
      }
      setResetToken('')
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
      setIncomingChallenges([])
      setIncomingInvites([])
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
      await refreshFriendsLeaderboard(serverUrl, setFriendsLeaderboard, statsModeView)
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
      await refreshFriendsLeaderboard(serverUrl, setFriendsLeaderboard, statsModeView)
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
      await refreshFriendsLeaderboard(serverUrl, setFriendsLeaderboard, statsModeView)
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
      await refreshIncomingChallenges(serverUrl, setIncomingChallenges)
      setError(null)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  async function respondChallenge(challengeId: string, accept: boolean) {
    setError(null)
    setBusy(true)
    try {
      const token = localStorage.getItem('dc_authToken')
      if (!token) throw new Error('Not signed in')
      const socket = getSocket(serverUrl)
      const res = await socket.emitWithAck('friends:challengeRespond', { challengeId, accept, authToken: token })
      if (!res?.ok) throw new Error(res?.message ?? 'Could not respond to challenge')
      await refreshIncomingChallenges(serverUrl, setIncomingChallenges)
    } catch (e: any) {
      setError(e?.message ?? String(e))
    } finally {
      setBusy(false)
    }
  }

  async function respondRoomInvite(inviteId: string, accept: boolean) {
    setError(null)
    setBusy(true)
    try {
      const token = localStorage.getItem('dc_authToken')
      if (!token) throw new Error('Not signed in')
      const socket = getSocket(serverUrl)
      const res = await socket.emitWithAck('room:inviteRespond', { inviteId, accept, authToken: token })
      if (!res?.ok) throw new Error(res?.message ?? 'Could not respond to invite')
      await refreshIncomingInvites(serverUrl, setIncomingInvites)
      if (accept && typeof res?.roomCode === 'string') {
        localStorage.setItem('dc_role', 'PLAYER')
        window.location.href = `/room/${String(res.roomCode).toUpperCase()}/lobby`
      }
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

  function applyUiDensity(next: 'spacious' | 'compact') {
    setUiDensity(next)
    if (typeof window === 'undefined') return
    localStorage.setItem('dc_uiDensity', next)
    document.documentElement.setAttribute('data-ui-density', next)
    window.dispatchEvent(new Event('dc:uiDensityChanged'))
  }

  const requestCount = (friends?.incoming.length ?? 0) + incomingChallenges.length + incomingInvites.length
  const resetting = Boolean(!me && resetToken)
  const currentSection = (!me && section === 'friends') || resetting ? 'overview' : section
  const tabs: Array<{ id: AccountSection; label: string; count?: number }> = [
    { id: 'overview', label: me ? 'Overview' : 'Sign in' },
    ...(me ? [{ id: 'friends' as const, label: 'Friends', count: requestCount }] : []),
    { id: 'stats', label: me ? 'Stats' : 'Records' },
    { id: 'boards', label: 'Boards' },
  ]

  return (
    <main className="col overviewPage">
      <header className="card overviewHero">
        {me ? <NameMark name={me.displayName} /> : null}
        <div className="overviewIdentity">
          <span className="eyebrow">{me ? 'Your account' : 'Player profile'}</span>
          <h1 className="title">{me?.displayName ?? 'Account'}</h1>
          <p className="subtitle">{me?.email ?? 'Sign in to keep your stats, play with friends, and connect a board.'}</p>
        </div>
      </header>

      {!resetting ? <SectionTabs group="account" label="Account sections" tabs={tabs} active={currentSection} onChange={selectSection} /> : null}

      <SectionPanel group="account" id="boards" active={currentSection}>
        <section className="card sectionCard col">
          <div className="row spread"><h2 className="sectionTitle">Your Autodarts board</h2><span className="pill">{me?.autodartsDeviceId ? 'Board saved' : 'No board linked'}</span></div>
          {me ? <>
            <label className="settingsField">Board ID
              <input
                className="input"
                value={autodartsDeviceIdInput}
                onChange={(e) => setAutodartsDeviceIdInput(e.target.value)}
                placeholder="e.g. board-home"
              />
            </label>
            <p className="help sectionMuted">Your board connects automatically when it’s your turn to throw.</p>
            <div className="row"><button className="btn btnPrimary" disabled={busy} onClick={saveAutodartsDevice}>Save board</button><Link className="btn" href="/autodarts">Setup guide</Link></div>
          </> : <><p className="help sectionMuted">Sign in to link a personal board.</p><div className="row"><button className="btn btnPrimary" onClick={() => selectSection('overview')}>Sign in</button><Link className="btn" href="/autodarts">Setup guide</Link></div></>}
        </section>
        {me ? <details className="card sectionCard sectionFold"><summary>Advanced Autodarts credentials</summary><div className="col">
              <label className="settingsField">Access token
              <input
                className="input"
                type="password"
                value={autodartsTokenInput}
                onChange={(e) => setAutodartsTokenInput(e.target.value)}
                placeholder="Or enter an email and password"
              />
              </label>
              <div className="grid2">
              <label className="settingsField">Autodarts email
              <input
                className="input"
                type="email"
                value={autodartsEmailInput}
                onChange={(e) => setAutodartsEmailInput(e.target.value)}
                placeholder="Autodarts email"
              />
              </label>
              <label className="settingsField">Autodarts password
              <input
                className="input"
                type="password"
                value={autodartsPasswordInput}
                onChange={(e) => setAutodartsPasswordInput(e.target.value)}
                placeholder="Autodarts password"
              />
              </label>
              <label className="settingsField">API base override
              <input
                className="input"
                value={autodartsApiBaseInput}
                onChange={(e) => setAutodartsApiBaseInput(e.target.value)}
                placeholder="Optional API base override"
              />
              </label>
              <label className="settingsField">WebSocket base override
              <input
                className="input"
                value={autodartsWsBaseInput}
                onChange={(e) => setAutodartsWsBaseInput(e.target.value)}
                placeholder="Optional WS base override"
              />
              </label>
              </div>
              <div className="row" style={{ flexWrap: 'wrap' }}>
                <button className="btn" disabled={busy} onClick={() => void saveAutodartsCredentials(false)}>
                  Save credentials
                </button>
                <button className="btn" disabled={busy || !me.hasAutodartsCredentials} onClick={() => void saveAutodartsCredentials(true)}>
                  Clear credentials
                </button>
                <span className="pill">Saved: {me.hasAutodartsCredentials ? 'yes' : 'no'}</span>
              </div>
              <div className="help">Credentials are stored on this server and used for your personal board binding.</div>
        </div></details> : null}
        <details className="card sectionCard sectionFold"><summary>Bridge diagnostics</summary>
          <div className="col">
            <div className="row"><button className="btn" disabled={busy} onClick={() => void refreshBridgeHealth(serverUrl, setBridgeHealth)}>Refresh bridge</button></div>
            {bridgeHealth ? <div className="row">
              <span className="pill">{bridgeHealth.reachable ? 'Reachable' : 'Not reachable'}</span><span className="pill">Latency: {bridgeHealth.latencyMs} ms</span>
              <span className="pill">HTTP: {bridgeHealth.status ?? '–'}</span><span className="pill">Mode: {bridgeHealth.health?.mode ?? '–'}</span>
              <span className="pill">Sessions: {bridgeHealth.health?.sessions ?? '–'}</span>
              {bridgeHealth.error ? <span className="pill" style={{ color: 'var(--bad)' }}>{bridgeHealth.error}</span> : null}
            </div> : <p className="help sectionMuted">No bridge status loaded yet.</p>}
          </div>
        </details>
      </SectionPanel>

      <SectionPanel group="account" id="overview" active={currentSection} labelledBy={resetting ? 'account-reset-heading' : undefined}>
      {me ? <>
        <section className="card sectionCard col">
          <div className="row spread"><h2 className="sectionTitle">X01 at a glance</h2><button className="btn" onClick={() => selectSection('stats')}>View stats</button></div>
          <FactTiles facts={[
            ['Games played', stats?.allTime.totalGames ?? '–'], ['Wins', stats?.allTime.wins ?? '–'], ['3-dart average', stats?.allTime.threeDartAvg ?? '–'],
          ]} />
          {requestCount > 0 ? <div className="row"><button className="btn btnPrimary" onClick={() => selectSection('friends')}>{requestCount} pending {requestCount === 1 ? 'request' : 'requests'}</button></div> : null}
        </section>
        <section className="card sectionCard col">
          <h2 className="sectionTitle">Appearance</h2>
          <div className="row" role="group" aria-label="Layout density">
            <button className="btn" aria-pressed={uiDensity === 'spacious'} disabled={busy} onClick={() => applyUiDensity('spacious')}>Spacious</button>
            <button className="btn" aria-pressed={uiDensity === 'compact'} disabled={busy} onClick={() => applyUiDensity('compact')}>Compact</button>
          </div>
        </section>
        <div className="row"><button className="btn" disabled={busy} onClick={logout}>Sign out</button></div>
      </> : (
        <section className="card sectionCard col">
          {resetToken ? (
            <form className="col" onSubmit={(event) => { event.preventDefault(); if (!busy) void submitResetPassword() }}>
              <h2 className="sectionTitle" id="account-reset-heading">Reset password</h2>
              <label className="settingsField">New password
              <input
                className="input"
                type="password"
                value={resetPassword}
                onChange={(e) => setResetPassword(e.target.value)}
                placeholder="At least 8 characters"
                autoComplete="new-password" minLength={8} required
              />
              </label>
              <label className="settingsField">Confirm new password
              <input
                className="input"
                type="password"
                value={resetPasswordConfirm}
                onChange={(e) => setResetPasswordConfirm(e.target.value)}
                placeholder="Repeat your new password"
                autoComplete="new-password" minLength={8} required
              />
              </label>
              <button className="btn btnPrimary" type="submit" disabled={busy || resetPassword.length < 8 || resetPasswordConfirm.length < 8}>
                {busy ? 'Working...' : 'Reset password'}
              </button>
              {resetMessage ? <div className="help">{resetMessage}</div> : null}
            </form>
          ) : forgotMode ? (
            <form className="col" onSubmit={(event) => { event.preventDefault(); if (!busy && forgotEmail.trim()) void submitForgotPassword() }}>
              <h2 className="sectionTitle">Forgot password</h2>
              <label className="settingsField">Account email
                <input type="email" className="input" value={forgotEmail} onChange={(e) => setForgotEmail(e.target.value)} placeholder="name@example.com" autoComplete="email" required />
              </label>
              <div className="row"><button className="btn btnPrimary" type="submit" disabled={busy || !forgotEmail.trim()}>{busy ? 'Working...' : 'Send reset link'}</button>
                <button className="btn" type="button" onClick={() => setForgotMode(false)}>Back to sign in</button></div>
              {forgotMessage ? <div className="help">{forgotMessage}</div> : null}
            </form>
          ) : (
            <form className="col" onSubmit={(event) => { event.preventDefault(); if (!busy && email.trim() && password) void submit() }}>
              <div className="row spread"><h2 className="sectionTitle">{mode === 'LOGIN' ? 'Sign in' : 'Create account'}</h2>
                <button type="button" className="btn" disabled={busy} onClick={() => setMode(mode === 'LOGIN' ? 'REGISTER' : 'LOGIN')}>{mode === 'LOGIN' ? 'Register' : 'Back to sign in'}</button>
              </div>
              <label className="settingsField">Email
                <input className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="name@example.com" autoComplete="email" required />
              </label>
              {mode === 'REGISTER' ? <label className="settingsField">Display name
                <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="nickname" maxLength={32} required />
              </label> : null}
              <label className="settingsField">Password
                <input className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'LOGIN' ? 'current-password' : 'new-password'} minLength={mode === 'REGISTER' ? 8 : undefined} required />
              </label>
              {mode === 'LOGIN' ? <label className="settingToggle"><input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} /> Remember me</label> : null}
              <div className="row">
                <button className="btn btnPrimary" type="submit" disabled={busy || !email.trim() || !password}>{busy ? 'Working...' : mode === 'LOGIN' ? 'Sign in' : 'Create account'}</button>
                {mode === 'LOGIN' ? <button className="btn" type="button" disabled={busy} onClick={() => setForgotMode(true)}>Forgot password</button> : null}
              </div>
            </form>
          )}
        </section>
      )}
      </SectionPanel>

      {me ? (
        <SectionPanel group="account" id="friends" active={currentSection}>
          {requestCount > 0 ? <section className="card sectionCard col">
            <h2 className="sectionTitle">Requests &amp; invites</h2>
            <div className="nameList">
              {friends?.incoming.map((f) => <NameRow key={`friend-${f.user.userId}`} name={f.user.displayName} detail={`Friend request · ${f.user.email}`} actions={<>
                <button className="btn btnPrimary" disabled={busy} onClick={() => void respondFriend(f.user.userId, true)}>Accept</button>
                <button className="btn" disabled={busy} onClick={() => void respondFriend(f.user.userId, false)}>Decline</button>
              </>} />)}
              {incomingChallenges.map((c) => <NameRow key={`challenge-${c.challengeId}`} name={c.from.displayName} detail={`Challenge · expires ${new Date(c.expiresAt).toLocaleTimeString()}`} actions={<>
                <button className="btn btnPrimary" disabled={busy} onClick={() => void respondChallenge(c.challengeId, true)}>Accept challenge</button>
                <button className="btn" disabled={busy} onClick={() => void respondChallenge(c.challengeId, false)}>Decline</button>
              </>} />)}
              {incomingInvites.map((inv) => <NameRow key={`invite-${inv.inviteId}`} name={inv.from.displayName} detail={`Lobby invite · ${inv.roomTitle ? `${inv.roomTitle} · ` : ''}${inv.roomCode}`} actions={<>
                <button className="btn btnPrimary" disabled={busy} onClick={() => void respondRoomInvite(inv.inviteId, true)}>Join lobby</button>
                <button className="btn" disabled={busy} onClick={() => void respondRoomInvite(inv.inviteId, false)}>Decline</button>
              </>} />)}
            </div>
          </section> : null}
          <section className="card sectionCard col">
            <div className="row spread"><h2 className="sectionTitle">Your friends</h2><button className="btn" disabled={busy} onClick={() => void refreshFriends(serverUrl, setFriends)}>Refresh</button></div>
            {friends?.friends.length ? <div className="nameList">{friends.friends.map((f) => <NameRow key={f.user.userId} name={f.user.displayName} detail={f.user.email}
              badge={<span className={`nameTag${f.online ? '' : ' nameTagMuted'}`}>{f.online ? 'Online' : 'Offline'}</span>} actions={<>
                <button className="btn" disabled={busy} onClick={() => void challengeFriend(f.user.userId)}>Challenge</button>
                <button className="btn" disabled={busy} onClick={() => void removeFriendship(f.user.userId)}>Remove</button>
              </>} />)}</div> : <p className="help sectionMuted">No friends to show yet.</p>}
            <form className="col" onSubmit={(e) => { e.preventDefault(); if (!busy && friendIdentityInput.trim()) void sendFriendRequest() }}>
              <label className="settingsField">Add a friend by name or email
                <input className="input" value={friendIdentityInput} onChange={(e) => setFriendIdentityInput(e.target.value)} placeholder="Display name or email" />
              </label>
              <div className="row"><button className="btn btnPrimary" type="submit" disabled={busy || !friendIdentityInput.trim()}>Send request</button></div>
            </form>
          </section>
          {friends?.outgoing.length ? <details className="card sectionCard sectionFold"><summary>Sent requests ({friends.outgoing.length})</summary>
            <div className="nameList">{friends.outgoing.map((f) => <NameRow key={f.user.userId} name={f.user.displayName} detail={f.user.email}
              actions={<button className="btn" disabled={busy} onClick={() => void removeFriendship(f.user.userId)}>Cancel request</button>} />)}</div>
          </details> : null}
        </SectionPanel>
      ) : null}

      <SectionPanel group="account" id="stats" active={currentSection}>
      <section className="card sectionCard col">
        <div className="row spread">
          <h2 className="sectionTitle">{me ? 'Match stats' : 'Global records'}</h2>
          <div className="settingsOptions" role="group" aria-label="Stats game mode">
            <button className="btn" aria-pressed={statsModeView === 'X01'} onClick={() => setStatsModeView('X01')}>X01</button>
            <button className="btn" aria-pressed={statsModeView === 'AROUND'} onClick={() => setStatsModeView('AROUND')}>Around</button>
          </div>
        </div>
        {stats && statsModeView === 'X01' ? <FactTiles facts={[
          ['Games played', stats.allTime.totalGames], ['Win rate', percent(stats.allTime.winRate)], ['3-dart average', stats.allTime.threeDartAvg ?? '–'],
        ]} /> : stats?.byMode?.AROUND && statsModeView === 'AROUND' ? <FactTiles facts={[
          ['Games played', stats.byMode.AROUND.allTime.totalGames], ['Win rate', percent(stats.byMode.AROUND.allTime.winRate)], ['Darts thrown', stats.byMode.AROUND.allTime.dartsThrown],
        ]} /> : me ? <p className="help sectionMuted">No personal stats available yet.</p> : null}
        {!me && records ? <RecordRows records={records.byMode[statsModeView]} mode={statsModeView} /> : null}
        {!me && !records ? <p className="help sectionMuted">No records available yet.</p> : null}
      </section>

      <details className="card sectionCard sectionFold" hidden={!stats}><summary>Detailed stats</summary>
      {stats && statsModeView === 'X01' ? (
        <div className="grid2">
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 16, marginBottom: 8 }}>All-time stats</div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <span className="pill">Games: {stats.allTime.totalGames}</span>
              <span className="pill">W/L: {stats.allTime.wins}/{stats.allTime.losses}</span>
              <span className="pill">Win%: {stats.allTime.winRate ?? '-'}</span>
              <span className="pill">Darts: {stats.allTime.dartsThrown}</span>
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
              <span className="pill">Darts: {stats.lastTen.dartsThrown}</span>
              <span className="pill">Avg: {stats.lastTen.threeDartAvg ?? '-'}</span>
              <span className="pill">CO%: {stats.lastTen.checkoutRate ?? '-'}</span>
              <span className="pill">Hi finish: {stats.lastTen.highestCheckout ?? '-'}</span>
              <span className="pill">Hi score: {stats.lastTen.highestScore}</span>
            </div>
          </div>
        </div>
      ) : null}

      {stats && statsModeView === 'X01' && stats.history.length > 0 ? (
        <div className="col" style={{ marginTop: 12 }}>
          <h3 className="sectionSubheading">Recent X01 games</h3>
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

      {statsModeView === 'AROUND' && stats?.byMode?.AROUND ? (
        <div className="grid2">
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 16, marginBottom: 8 }}>Around all-time</div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <span className="pill">Games: {stats.byMode.AROUND.allTime.totalGames}</span>
              <span className="pill">W/L: {stats.byMode.AROUND.allTime.wins}/{stats.byMode.AROUND.allTime.losses}</span>
              <span className="pill">Win%: {stats.byMode.AROUND.allTime.winRate ?? '-'}</span>
              <span className="pill">Darts: {stats.byMode.AROUND.allTime.dartsThrown}</span>
            </div>
          </div>
          <div className="card" style={{ padding: 16 }}>
            <div style={{ fontSize: 16, marginBottom: 8 }}>Around last 10</div>
            <div className="row" style={{ flexWrap: 'wrap' }}>
              <span className="pill">Games: {stats.byMode.AROUND.lastTen.games}</span>
              <span className="pill">W/L: {stats.byMode.AROUND.lastTen.wins}/{stats.byMode.AROUND.lastTen.losses}</span>
              <span className="pill">Win%: {stats.byMode.AROUND.lastTen.winRate ?? '-'}</span>
              <span className="pill">Darts: {stats.byMode.AROUND.lastTen.dartsThrown}</span>
            </div>
          </div>
        </div>
      ) : null}

      {statsModeView === 'AROUND' && stats?.byMode?.AROUND?.history?.length ? (
        <div className="col" style={{ marginTop: 12 }}>
          <h3 className="sectionSubheading">Recent Around the Board games</h3>
          <div className="col">
            {stats.byMode.AROUND.history.map((g, idx) => (
              <div key={`${g.roomCode}-${g.finishedAt}-${idx}`} className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap' }}>
                <span className="pill">{g.result}</span>
                <span className="pill">Room: {g.roomCode}</span>
                <span className="pill">Darts: {g.dartsThrown ?? '-'}</span>
                <span className="help">{new Date(g.finishedAt).toLocaleString()}</span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      </details>

      {me && records ? <details className="card sectionCard sectionFold"><summary>Global records</summary><RecordRows records={records.byMode[statsModeView]} mode={statsModeView} /></details> : null}
      {me ? <details className="card sectionCard sectionFold"><summary>Friends leaderboard</summary><div className="col">
        <div className="row"><button className="btn" disabled={busy} onClick={() => void refreshFriendsLeaderboard(serverUrl, setFriendsLeaderboard, statsModeView)}>Refresh leaderboard</button></div>
        {friendsLeaderboard.length ? <div className="nameList">{friendsLeaderboard.map((row) => {
          const { allTime, lastTen } = modeStats(row, statsModeView)
          return <NameRow key={row.userId} name={row.displayName} badge={row.isYou ? <span className="nameTag">You</span> : null}
            detail={<div className="col" style={{ gap: 2 }}>
              <span>All time: {allTime.wins}/{allTime.losses} W/L · {statsModeView === 'X01' ? `${allTime.threeDartAvg ?? '–'} avg · ${allTime.highestCheckout ?? '–'} high checkout` : `${allTime.dartsThrown ?? '–'} darts`}</span>
              <span>Last 10: {lastTen.wins}/{lastTen.losses} W/L · {statsModeView === 'X01' ? `${lastTen.threeDartAvg ?? '–'} avg` : `${lastTen.dartsThrown ?? '–'} darts`}</span>
            </div>} />
        })}</div> : <p className="help sectionMuted">No friend stats yet.</p>}
      </div></details> : null}
      </SectionPanel>

      {error ? <div className="toast" role="status">{error}</div> : null}
    </main>
  )
}

function FactTiles({ facts }: { facts: Array<[string, string | number]> }) {
  return <dl className="overviewFacts">{facts.map(([label, value]) => <div className="overviewFact" key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
}

function percent(value: number | null) {
  return value === null ? '–' : `${value}%`
}

function RecordRows({ records, mode }: { records: GlobalRecords['byMode']['X01']; mode: 'X01' | 'AROUND' }) {
  return <div className="grid2">{(['allTime', 'lastTen'] as const).map((period) => {
    const rows = records[period]
    return <div className="col" key={period}>
      <h3 className="sectionSubheading">{period === 'allTime' ? 'All time' : 'Last 10 games'}</h3>
      <div className="row"><span className="pill">Most wins: {recordLabel(rows.mostWins)}</span>
        {mode === 'X01' ? <><span className="pill">Highest checkout: {recordLabel(rows.highestCheckout)}</span><span className="pill">Highest score: {recordLabel(rows.highestScore)}</span><span className="pill">Best average: {recordLabel(rows.bestThreeDartAverage)}</span></> : null}
      </div>
    </div>
  })}</div>
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
  gameType: 'X01' | 'AROUND',
): Promise<void> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('dc_authToken') : null
  if (!token) {
    setRows([])
    return
  }

  const res = await fetch(`${serverUrl}/api/stats/friends?gameType=${gameType}`, {
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

function modeStats(row: FriendLeaderboardRow, gameType: 'X01' | 'AROUND'): any {
  if (row.byMode?.[gameType]) return row.byMode[gameType]
  return {
    allTime: row.allTime,
    lastTen: row.lastTen,
    history: [],
  }
}

async function refreshIncomingChallenges(
  serverUrl: string,
  setIncoming: (rows: IncomingChallenge[]) => void,
): Promise<void> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('dc_authToken') : null
  if (!token) {
    setIncoming([])
    return
  }

  const res = await fetch(`${serverUrl}/api/friends/challenges/me`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok || !Array.isArray(data.incoming)) {
    setIncoming([])
    return
  }

  setIncoming(data.incoming as IncomingChallenge[])
}

async function refreshIncomingInvites(
  serverUrl: string,
  setIncoming: (rows: IncomingRoomInvite[]) => void,
): Promise<void> {
  const token = typeof window !== 'undefined' ? localStorage.getItem('dc_authToken') : null
  if (!token) {
    setIncoming([])
    return
  }

  const res = await fetch(`${serverUrl}/api/friends/invites/me`, {
    headers: {
      authorization: `Bearer ${token}`,
    },
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data?.ok || !Array.isArray(data.incoming)) {
    setIncoming([])
    return
  }

  setIncoming(data.incoming as IncomingRoomInvite[])
}

function recordLabel(record: { userId: string; value: number; displayName?: string | null } | null): string {
  if (!record) return '-'
  return `${record.value} (${record.displayName ?? record.userId.slice(0, 8)})`
}
