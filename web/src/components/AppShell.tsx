'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { usePathname } from 'next/navigation'
import { getServerUrl } from '@/lib/config'
import { getSocket } from '@/lib/socket'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [serverUrl, setServerUrl] = useState('')
  const [roomCode, setRoomCode] = useState<string | null>(null)
  const [incomingRequestCount, setIncomingRequestCount] = useState(0)
  const [uiDensity, setUiDensity] = useState<'spacious' | 'compact'>('spacious')
  const [isMobile, setIsMobile] = useState(() => {
    if (typeof window === 'undefined') return false
    return window.matchMedia('(max-width: 520px)').matches
  })

  const hostSecret = typeof window !== 'undefined' ? localStorage.getItem('dc_hostSecret') : null
  const wakeLockRef = useRef<any>(null)

  const canFullscreen = useMemo(() => {
    if (typeof document === 'undefined') return false
    return Boolean((document.documentElement as any)?.requestFullscreen)
  }, [])

  useEffect(() => {
    setServerUrl(getServerUrl())

    const applyDensity = () => {
      const density = localStorage.getItem('dc_uiDensity') === 'compact' ? 'compact' : 'spacious'
      setUiDensity(density)
      document.documentElement.setAttribute('data-ui-density', density)
    }
    applyDensity()

    const onDensityChanged = () => applyDensity()
    window.addEventListener('dc:uiDensityChanged', onDensityChanged as any)

    const mq = window.matchMedia('(max-width: 520px)')
    const onChange = () => setIsMobile(Boolean(mq.matches))
    onChange()
    if (typeof mq.addEventListener === 'function') mq.addEventListener('change', onChange)
    else mq.addListener(onChange)
    return () => {
      window.removeEventListener('dc:uiDensityChanged', onDensityChanged as any)
      if (typeof mq.removeEventListener === 'function') mq.removeEventListener('change', onChange)
      else mq.removeListener(onChange)
    }
  }, [])

  useEffect(() => {
    const m = pathname.match(/^\/room\/([^/]+)\/(lobby|game)/i)
    setRoomCode(m ? m[1].toUpperCase() : null)
  }, [pathname, isMobile])

  const hideTopbar = isMobile && Boolean(pathname.match(/^\/room\/[^/]+\/game/i))
  const showBottomNav = !Boolean(pathname.match(/^\/room\/[^/]+\/game/i) || pathname.match(/^\/daily-checkout(\/|$)/i))

  useEffect(() => {
    function onOpenMenu() {
      setOpen(true)
    }
    window.addEventListener('dc:openMenu', onOpenMenu as any)
    return () => window.removeEventListener('dc:openMenu', onOpenMenu as any)
  }, [])

  useEffect(() => {
    function onBip(e: Event) {
      e.preventDefault()
      setDeferredPrompt(e as BeforeInstallPromptEvent)
    }

    window.addEventListener('beforeinstallprompt', onBip)
    return () => window.removeEventListener('beforeinstallprompt', onBip)
  }, [])

  useEffect(() => {
    if (typeof window === 'undefined') return

    const isStandalone =
      window.matchMedia('(display-mode: standalone)').matches ||
      ((window.navigator as any).standalone === true)
    if (!isStandalone) return

    let cancelled = false

    async function requestWakeLock() {
      try {
        if (cancelled) return
        const nav: any = navigator
        if (!nav?.wakeLock?.request) return
        const lock = await nav.wakeLock.request('screen')
        if (cancelled) {
          try {
            await lock.release()
          } catch {
            // ignore
          }
          return
        }
        wakeLockRef.current = lock
        lock.addEventListener?.('release', () => {
          if (wakeLockRef.current === lock) wakeLockRef.current = null
        })
      } catch {
        // Wake Lock may be unsupported or denied.
      }
    }

    function onVisibility() {
      if (document.visibilityState === 'visible' && !wakeLockRef.current) {
        void requestWakeLock()
      }
    }

    void requestWakeLock()
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      if (wakeLockRef.current) {
        void wakeLockRef.current.release().catch(() => undefined)
        wakeLockRef.current = null
      }
    }
  }, [])

  useEffect(() => {
    if (!serverUrl) return
    const socket = getSocket(serverUrl)

    async function refreshIncomingRequestCount() {
      const token = typeof window !== 'undefined' ? localStorage.getItem('dc_authToken') : null
      if (!token) {
        setIncomingRequestCount(0)
        return
      }

      try {
        const [friendsRes, challengesRes, invitesRes] = await Promise.all([
          fetch(`${serverUrl}/api/friends/me`, { headers: { authorization: `Bearer ${token}` } }),
          fetch(`${serverUrl}/api/friends/challenges/me`, { headers: { authorization: `Bearer ${token}` } }),
          fetch(`${serverUrl}/api/friends/invites/me`, { headers: { authorization: `Bearer ${token}` } }),
        ])
        const friendsData = await friendsRes.json().catch(() => null)
        const challengesData = await challengesRes.json().catch(() => null)
        const invitesData = await invitesRes.json().catch(() => null)
        const incomingFriends = Array.isArray(friendsData?.incoming) ? friendsData.incoming.length : 0
        const incomingChallenges = Array.isArray(challengesData?.incoming) ? challengesData.incoming.length : 0
        const incomingInvites = Array.isArray(invitesData?.incoming) ? invitesData.incoming.length : 0
        setIncomingRequestCount(incomingFriends + incomingChallenges + incomingInvites)
      } catch {
        // ignore badge refresh failures
      }
    }

    function identifyNow() {
      const token = typeof window !== 'undefined' ? localStorage.getItem('dc_authToken') : null
      if (!token) return
      void socket.emitWithAck('social:identify', { authToken: token, token })
    }

    identifyNow()
    void refreshIncomingRequestCount()

    function onConnect() {
      identifyNow()
    }

    const identifyTimer = window.setInterval(() => identifyNow(), 20_000)
    const badgeTimer = window.setInterval(() => void refreshIncomingRequestCount(), 12_000)

    function onVisibility() {
      if (document.visibilityState === 'visible') {
        identifyNow()
        void refreshIncomingRequestCount()
      }
    }

    function onChallengeInvite(evt: any) {
      const fromName = String(evt?.from?.displayName ?? 'A friend')
      setToast(`${fromName} sent you a challenge. Check incoming requests on Account.`)
      setTimeout(() => setToast(null), 2600)
      window.dispatchEvent(new Event('dc:challengeInvite'))
      void refreshIncomingRequestCount()
    }

    function onFriendRequestReceived(evt: any) {
      const fromName = String(evt?.from?.displayName ?? 'Someone')
      setToast(`${fromName} sent you a friend request.`)
      setTimeout(() => setToast(null), 2200)
      void refreshIncomingRequestCount()
    }

    function onChallengeResolved(evt: any) {
      if (evt?.accepted === false) {
        setToast('Challenge declined.')
        setTimeout(() => setToast(null), 1800)
      }
    }

    function onChallengeMatchReady(evt: any) {
      const roomCode = String(evt?.roomCode ?? '').toUpperCase()
      const hostSecretIncoming = typeof evt?.hostSecret === 'string' ? evt.hostSecret : null
      if (!roomCode) return

      if (hostSecretIncoming) localStorage.setItem('dc_hostSecret', hostSecretIncoming)
      localStorage.setItem('dc_role', 'PLAYER')
      setToast('Challenge accepted. Joining lobby...')
      setTimeout(() => setToast(null), 1600)
      window.location.href = `/room/${roomCode}/lobby`
    }

    function onRoomInvite(evt: any) {
      const roomCode = String(evt?.roomCode ?? '').toUpperCase()
      const fromName = String(evt?.from?.displayName ?? 'A friend')
      if (!roomCode) return
      setToast(`${fromName} invited you to room ${roomCode}. Use code on Home to join.`)
      setTimeout(() => setToast(null), 3800)
      window.dispatchEvent(new Event('dc:roomInvite'))
      void refreshIncomingRequestCount()
    }

    function onHostGranted(evt: any) {
      const hostSecret = typeof evt?.hostSecret === 'string' ? evt.hostSecret : null
      if (!hostSecret) return
      localStorage.setItem('dc_hostSecret', hostSecret)
      setToast('You are now host for this room.')
      setTimeout(() => setToast(null), 2200)
    }

    socket.on('friends:challengeInvite', onChallengeInvite)
    socket.on('friends:requestReceived', onFriendRequestReceived)
    socket.on('friends:challengeResolved', onChallengeResolved)
    socket.on('friends:challengeMatchReady', onChallengeMatchReady)
    socket.on('friends:roomInvite', onRoomInvite)
    socket.on('room:hostGranted', onHostGranted)
    socket.on('connect', onConnect)
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      window.clearInterval(identifyTimer)
      window.clearInterval(badgeTimer)
      socket.off('friends:challengeInvite', onChallengeInvite)
      socket.off('friends:requestReceived', onFriendRequestReceived)
      socket.off('friends:challengeResolved', onChallengeResolved)
      socket.off('friends:challengeMatchReady', onChallengeMatchReady)
      socket.off('friends:roomInvite', onRoomInvite)
      socket.off('room:hostGranted', onHostGranted)
      socket.off('connect', onConnect)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [serverUrl])

  function applyUiDensity(next: 'spacious' | 'compact') {
    if (typeof window === 'undefined') return
    localStorage.setItem('dc_uiDensity', next)
    setUiDensity(next)
    document.documentElement.setAttribute('data-ui-density', next)
    window.dispatchEvent(new Event('dc:uiDensityChanged'))
  }

  async function install() {
    try {
      if (!deferredPrompt) {
        setToast(
          'Install: iPhone Safari → Share → Add to Home Screen. Android Chrome → Install app / Add to Home screen.',
        )
        setTimeout(() => setToast(null), 4500)
        return
      }
      await deferredPrompt.prompt()
      await deferredPrompt.userChoice
      setDeferredPrompt(null)
      setToast('Install prompt opened.')
      setTimeout(() => setToast(null), 2000)
    } catch {
      setToast('Install not available in this browser.')
      setTimeout(() => setToast(null), 2500)
    }
  }

  async function toggleFullscreen() {
    try {
      const doc: any = document
      if (doc.fullscreenElement) {
        await doc.exitFullscreen()
        return
      }
      const el: any = document.documentElement
      if (el.requestFullscreen) await el.requestFullscreen()
      else {
        setToast('Fullscreen not supported on this device/browser.')
        setTimeout(() => setToast(null), 2500)
      }
    } catch {
      setToast('Fullscreen blocked by browser.')
      setTimeout(() => setToast(null), 2500)
    }
  }

  async function leaveRoom() {
    try {
      const socket = getSocket(serverUrl)
      await socket.emitWithAck('room:leave')
    } catch {
      // ignore
    }
    localStorage.setItem('dc_role', 'SPECTATOR')
    window.location.href = '/'
  }

  async function undoLastTurn() {
    try {
      if (!hostSecret) throw new Error('Host secret missing on this device')
      const socket = getSocket(serverUrl)
      const res = await socket.emitWithAck('game:undoLastTurn', { hostSecret })
      if (!res?.ok) throw new Error(res?.message ?? 'Undo failed')
      setToast('Undid last turn.')
      setTimeout(() => setToast(null), 1500)
    } catch (e: any) {
      setToast(e?.message ?? 'Undo failed')
      setTimeout(() => setToast(null), 2500)
    }
  }

  async function copyRoomCode() {
    try {
      if (!roomCode) return
      await navigator.clipboard.writeText(roomCode)
      setToast('Copied room code.')
      setTimeout(() => setToast(null), 1200)
    } catch {
      setToast('Copy not supported.')
      setTimeout(() => setToast(null), 2000)
    }
  }

  return (
    <div>
      {!hideTopbar ? (
        <div className="topbar">
          <a className="brand" href="/">
            Dartcounter
          </a>
          <button className="btn" onClick={() => setOpen((v) => !v)} aria-label="Menu">
            {incomingRequestCount > 0 ? `Menu (${incomingRequestCount})` : 'Menu'}
          </button>
        </div>
      ) : null}

      {open ? (
        <div
          className="menuOverlay"
          role="dialog"
          aria-modal="true"
          onClick={() => setOpen(false)}
        >
          <div className="menuPanel card" style={{ padding: 12 }} onClick={(e) => e.stopPropagation()}>
            <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
              <span className="pill">Menu</span>
              <button className="btn" onClick={() => setOpen(false)}>
                Close
              </button>
            </div>

            {roomCode ? (
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', marginTop: 10 }}>
                <span className="pill">Room: {roomCode}</span>
                <button
                  className="btn"
                  onClick={() => {
                    copyRoomCode()
                    setOpen(false)
                  }}
                >
                  Copy code
                </button>
              </div>
            ) : null}

            <div className="col" style={{ marginTop: 10 }}>
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center' }}>
                <span className="pill">UI density</span>
                <div className="row" style={{ gap: 8 }}>
                  <button className={uiDensity === 'spacious' ? 'btn btnPrimary' : 'btn'} onClick={() => applyUiDensity('spacious')}>
                    Spacious
                  </button>
                  <button className={uiDensity === 'compact' ? 'btn btnPrimary' : 'btn'} onClick={() => applyUiDensity('compact')}>
                    Compact
                  </button>
                </div>
              </div>
              <a className="btn menuNavBtn" href="/" onClick={() => setOpen(false)}>
                <span className="menuBtnIcon" aria-hidden="true">H</span>
                <span>Home</span>
              </a>
              <a className="btn menuNavBtn" href="/lobbies" onClick={() => setOpen(false)}>
                <span className="menuBtnIcon" aria-hidden="true">L</span>
                <span>Public lobbies</span>
              </a>
              <a className="btn menuNavBtn" href="/account" onClick={() => setOpen(false)}>
                <span className="menuBtnIcon" aria-hidden="true">A</span>
                {incomingRequestCount > 0 ? `Account (${incomingRequestCount})` : 'Account'}
              </a>
              <a className="btn menuNavBtn" href="/daily-checkout" onClick={() => setOpen(false)}>
                <span className="menuBtnIcon" aria-hidden="true">D</span>
                <span>Daily checkout</span>
              </a>
              <a className="btn menuNavBtn" href="/tournaments" onClick={() => setOpen(false)}>
                <span className="menuBtnIcon" aria-hidden="true">T</span>
                <span>Tournaments</span>
              </a>
              {roomCode ? (
                <button
                  className="btn menuNavBtn"
                  onClick={() => {
                    setOpen(false)
                    leaveRoom()
                  }}
                >
                  <span className="menuBtnIcon" aria-hidden="true">X</span>
                  <span>Leave room</span>
                </button>
              ) : null}
              {roomCode && hostSecret ? (
                <button
                  className="btn menuNavBtn"
                  onClick={() => {
                    setOpen(false)
                    undoLastTurn()
                  }}
                >
                  <span className="menuBtnIcon" aria-hidden="true">U</span>
                  <span>Undo last turn</span>
                </button>
              ) : null}
              <button
                className={deferredPrompt ? 'btn btnPrimary menuNavBtn' : 'btn menuNavBtn'}
                onClick={() => {
                  setOpen(false)
                  install()
                }}
              >
                <span className="menuBtnIcon" aria-hidden="true">I</span>
                <span>Install app</span>
              </button>
              <button
                className="btn menuNavBtn"
                onClick={() => {
                  setOpen(false)
                  toggleFullscreen()
                }}
              >
                <span className="menuBtnIcon" aria-hidden="true">F</span>
                <span>Fullscreen</span>
              </button>
              <div className="help">Best fullscreen: use Install (Add to Home Screen).</div>
            </div>
          </div>
        </div>
      ) : null}

      {children}

      {showBottomNav ? (
        <nav className="mobileDock" aria-label="Primary">
          <a className={pathname === '/' ? 'mobileDockItem mobileDockItemActive' : 'mobileDockItem'} href="/">
            <span className="mobileDockIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M4 11.5 12 5l8 6.5V20h-5v-5h-6v5H4z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </span>
            <span>Home</span>
          </a>
          <a className={pathname.startsWith('/lobbies') ? 'mobileDockItem mobileDockItemActive' : 'mobileDockItem'} href="/lobbies">
            <span className="mobileDockIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M12 4v16M4 12h16" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span>Lobbies</span>
          </a>
          <a className={pathname.startsWith('/account') ? 'mobileDockItem mobileDockItemActive' : 'mobileDockItem'} href="/account">
            <span className="mobileDockIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="8" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M5 20a7 7 0 0 1 14 0" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span>Account</span>
          </a>
          <a className={pathname.startsWith('/daily-checkout') ? 'mobileDockItem mobileDockItemActive' : 'mobileDockItem'} href="/daily-checkout">
            <span className="mobileDockIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" strokeWidth="1.8" />
                <path d="M12 8v4l3 2" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <span>Daily</span>
          </a>
          <a className={pathname.startsWith('/tournaments') ? 'mobileDockItem mobileDockItemActive' : 'mobileDockItem'} href="/tournaments">
            <span className="mobileDockIcon" aria-hidden="true">
              <svg viewBox="0 0 24 24">
                <path d="M6 5h12v2a6 6 0 0 1-4 5.64V16h3v2H7v-2h3v-3.36A6 6 0 0 1 6 7V5Z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
              </svg>
            </span>
            <span>Tourneys</span>
          </a>
        </nav>
      ) : null}

      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  )
}
