'use client'

import { useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { getServerUrl } from '@/lib/config'
import { getSocket } from '@/lib/socket'
import { hostSecretForRoom, rememberHostSecret, rememberRoomIdentity } from '@/lib/room-session'
import Icon from './Icon'
import { ScoringMenuContext } from './ScoringScreen'

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

const destinations = [
  { href: '/', label: 'Home', icon: 'home' },
  { href: '/lobbies', label: 'Lobbies', icon: 'users' },
  { href: '/my-matches', label: 'My matches', icon: 'clipboard' },
  { href: '/daily-checkout', label: 'Daily', icon: 'daily' },
  { href: '/tournaments', label: 'Tournaments', icon: 'trophy' },
  { href: '/account', label: 'Account', icon: 'user' },
] as const

export default function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const [open, setOpen] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [serverUrl, setServerUrl] = useState('')
  const [incomingRequestCount, setIncomingRequestCount] = useState(0)
  const [uiDensity, setUiDensity] = useState<'spacious' | 'compact'>('spacious')
  const [hostSecret, setHostSecret] = useState<string | null>(null)
  const [scoringMenuTarget, setScoringMenuTarget] = useState<HTMLDivElement | null>(null)
  const [undoing, setUndoing] = useState(false)
  const undoPending = useRef(false)
  const menuRef = useRef<HTMLDialogElement>(null)
  const wakeLockRef = useRef<any>(null)
  const roomRoute = pathname.match(/^\/room\/([^/]+)\/(lobby|game)\/?$/i)
  const roomCode = roomRoute?.[1]?.toUpperCase() ?? null
  const inGame = roomRoute?.[2] === 'game'
  const inDaily = /^\/daily-checkout\/.+/.test(pathname)
  const inScoring = inGame || inDaily
  const showBottomNav = !inScoring

  useEffect(() => {
    setServerUrl(getServerUrl())

    const applyDensity = () => {
      const density = localStorage.getItem('dc_uiDensity') === 'compact' ? 'compact' : 'spacious'
      setUiDensity(density)
      document.documentElement.setAttribute('data-ui-density', density)
    }
    applyDensity()

    const onDensityChanged = () => applyDensity()
    window.addEventListener('dc:uiDensityChanged', onDensityChanged)
    return () => {
      window.removeEventListener('dc:uiDensityChanged', onDensityChanged)
    }
  }, [])

  useEffect(() => {
    setOpen(false)
    function readHost() { setHostSecret(roomCode ? hostSecretForRoom(roomCode) : null) }
    readHost()
    window.addEventListener('dc:hostSecretChanged', readHost)
    return () => window.removeEventListener('dc:hostSecretChanged', readHost)
  }, [pathname, roomCode])

  useEffect(() => {
    const dialog = menuRef.current
    if (open && !dialog?.open) dialog?.showModal()
    if (!open && dialog?.open) dialog.close()
  }, [open])

  useEffect(() => {
    function onAuthExpired() {
      setIncomingRequestCount(0)
      setToast('Session expired. Please sign in again.')
      setTimeout(() => setToast(null), 2600)
    }
    window.addEventListener('dc:authExpired', onAuthExpired as any)
    return () => {
      window.removeEventListener('dc:authExpired', onAuthExpired as any)
    }
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

      if (hostSecretIncoming) rememberHostSecret(roomCode, hostSecretIncoming)
      rememberRoomIdentity(roomCode, localStorage.getItem('dc_authDisplayName') || localStorage.getItem('dc_name') || 'Guest', 'PLAYER')
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
      const code = typeof evt?.code === 'string' ? evt.code.toUpperCase() : null
      if (!hostSecret || !code) return
      rememberHostSecret(code, hostSecret)
      if (window.location.pathname.split('/')[2]?.toUpperCase() === code) setHostSecret(hostSecret)
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
    window.location.href = '/'
  }

  async function undoLastTurn() {
    if (undoPending.current) return
    undoPending.current = true
    setUndoing(true)
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
    } finally {
      undoPending.current = false
      setUndoing(false)
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
    <ScoringMenuContext.Provider value={{ target: scoringMenuTarget, open, show: () => setOpen(true), undo: inGame && hostSecret ? undoLastTurn : null, undoing }}>
    <div className={`${inScoring ? 'gameShell' : 'appShell'}${showBottomNav ? ' withDock' : ''}`}>
      {!inScoring ? <header className="topbar">
        <div className="topbarContent">
          <Link className="brand" href="/"><Image className="brandMark" src="/favicon.svg?v=2" alt="" width={36} height={36} unoptimized />Dartcounter</Link>
          <nav className="topbarNav" aria-label="Main navigation">{navLinks(false)}</nav>
          <button className="btn menuTrigger" onClick={() => setOpen(true)} aria-label="Menu" aria-haspopup="dialog" aria-expanded={open}>
            <Icon name="menu" /> <span>Menu</span>
            {incomingRequestCount > 0 ? <span className="navBadge">{incomingRequestCount}</span> : null}
          </button>
        </div>
      </header> : null}

      <dialog className="menuPanel" ref={menuRef} aria-labelledby="menu-heading" onClose={() => setOpen(false)} onClick={(event) => {
        if (event.target === event.currentTarget) setOpen(false)
      }}>
        <div className="menuContent col">
          <div className="row spread">
            <h2 id="menu-heading" className="sectionTitle">{inScoring ? 'Game menu' : 'Menu'}</h2>
            <button className="btn iconButton" aria-label="Close menu" onClick={() => setOpen(false)}><Icon name="close" /></button>
          </div>
          {inScoring ? <div className="col" ref={setScoringMenuTarget} /> : null}
          {roomCode ? (
            <div className="col">
              <div className="row spread"><span className="pill">Room {roomCode}</span><button className="btn" onClick={() => { void copyRoomCode(); setOpen(false) }}>Copy code</button></div>
              <div className="row">
                {inGame && hostSecret ? <button className="btn" disabled={undoing} onClick={() => { void undoLastTurn(); setOpen(false) }}>Undo last turn</button> : null}
                <button className="btn" onClick={() => { void leaveRoom(); setOpen(false) }}>Leave room</button>
              </div>
            </div>
          ) : null}
          {inScoring ? <details className="card scoringMenuSection"><summary>App options</summary><div className="col scoringMenuBody">{appOptions()}</div></details> : appOptions()}
        </div>
      </dialog>

      <div className="container">{children}</div>
      {showBottomNav ? <nav className="mobileDock" aria-label="Main navigation">{navLinks(true)}</nav> : null}
      {toast ? <div className="toast" role="status">{toast}</div> : null}
    </div>
    </ScoringMenuContext.Provider>
  )

  function appOptions() {
    return <>
          <nav className="menuLinks" aria-label="Menu navigation">{navLinks(false, true)}</nav>
          <div className="row spread">
            <span className="help">Layout density</span>
            <div className="row" role="group" aria-label="Layout density">
              {(['spacious', 'compact'] as const).map((density) => (
                <button key={density} className="btn" aria-pressed={uiDensity === density} onClick={() => applyUiDensity(density)}>{density === 'spacious' ? 'Spacious' : 'Compact'}</button>
              ))}
            </div>
          </div>
          <div className="row">
            <button className="btn" onClick={() => { setOpen(false); void install() }}>Install app</button>
            <button className="btn" onClick={() => { setOpen(false); void toggleFullscreen() }}>Fullscreen</button>
          </div>
    </>
  }

  function navLinks(dock: boolean, menu = false) {
    return destinations.filter(({ href }) => !dock || href !== '/my-matches').map(({ href, icon, label }) => {
      const active = pathname === href || (href !== '/' && pathname.startsWith(`${href}/`))
      return (
        <Link key={href} href={href} className={dock ? 'mobileDockItem' : 'topbarLink'} aria-current={active ? 'page' : undefined} onClick={menu ? () => setOpen(false) : undefined}>
          <Icon name={icon} />
          <span>{dock && href === '/tournaments' ? 'Brackets' : label}</span>
          {href === '/account' && incomingRequestCount > 0 ? <span className="navBadge" aria-label={`${incomingRequestCount} notifications`}>{incomingRequestCount}</span> : null}
        </Link>
      )
    })
  }
}
